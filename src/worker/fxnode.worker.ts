/// <reference lib="webworker" />
import {
  validRequest,
  PROTOCOL_VERSION,
  type CompositionChange,
  type CompositionChangeEnvelope,
  type CompositionReceipt,
  type CompositionUpdateWire,
  type Viewport,
  type WorkerMessage,
  type WorkerRequest,
} from "../browser/protocol.js";
import { commandId, linkId, nodeId } from "../core/types.js";
import {
  createInitialFxNodeComposition,
  compileFxNodeComposition,
  FxNodeCompositionError,
} from "../composition/compile.js";
import { bindFxNodeHeadless } from "../headless-runtime.js";
import type { CompiledFxNodeComposition, FxNodeCompositionData } from "../composition/types.js";
import {
  rebindBoundEngineAuthority,
  type EngineState as BoundEngineState,
  type LoadResult as BoundLoadResult,
  type MutationEnvelope as BoundMutationEnvelope,
  type ReplayResult as BoundReplayResult,
  type SnapshotEnvelope as BoundSnapshotEnvelope,
  type TransitionResult as BoundTransitionResult,
} from "../composition/bound-engine.js";
import { applyNodeOrder, layoutGraph } from "../layout/layout-graph.js";
import { IndexedLayoutStore } from "../layout/indexed-layout-store.js";
import { viewToWorld, worldToView } from "../layout/geometry.js";
import type { LayoutSnapshot } from "../layout/types.js";
import { layoutColorPicker } from "../layout/color-picker-layout.js";
import { renderCanvas } from "../render/canvas-renderer.js";
import { paintColorPicker } from "../render/color-picker-renderer.js";
import { DirtyReason, RenderScheduler } from "./render-scheduler.js";
import { createSession, resetSessionForCompositionRebind, resetSessionForGraphReplacement } from "./session.js";
import { cycleEnum, numericStep, scrubValue, setNumericComponent } from "./control-edit.js";
import {
  boxNodes,
  clampResize,
  compatibleTargets,
  frameDropCandidate,
  groupRoots,
  hitTest,
  planLink,
  zoomAt,
} from "./interaction.js";
import {
  addRampMidpoint,
  addRampStop,
  distributeColorRamp,
  flipColorRamp,
  isColorRamp,
  moveRampStop,
  removeRampStop,
  setRampColor,
  type ColorRamp,
} from "../widgets/color-ramp.js";
import { appendKnifePoint, crossedLinks } from "./knife-path.js";
import { pointerLaneFence, readPointerMove } from "../browser/pointer-lane.js";
import type { PointerFence } from "../browser/protocol.js";
import { mapOklchToSrgb, maxSrgbChroma, oklabToOklch, srgbToOklab, type Rgba } from "../color/oklab.js";
import { canonicalJsonEqual, nullRecord } from "../core/json.js";
import { advanceJournal, checkpointJournal, importJournal, journalSaveData, type WorkerJournal } from "./journal.js";
import type { Command } from "../commands/types.js";
import { planSelectionMute, planSelectionRemoval } from "./selection-actions.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const session = createSession();
let state: BoundEngineState | undefined;
let journal: WorkerJournal | undefined;
let viewport: Viewport = { width: 1, height: 1, dpr: 1 };
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;
let currentLayout: LayoutSnapshot | undefined;
let gestureLayout: LayoutSnapshot | undefined;
let application:
  | {
      compiled: CompiledFxNodeComposition<FxNodeCompositionData>;
      runtime: ReturnType<typeof bindFxNodeHeadless<FxNodeCompositionData>>;
    }
  | undefined;
let layoutStore: IndexedLayoutStore<FxNodeCompositionData> | undefined;
let pointerLane: SharedArrayBuffer | undefined;
let handledPointerFence = 0;
let consumedPointerSequence = 0;
let hostGeneration = 0;
const resourceImages = new Map<string, { bitmap: ImageBitmap; name: string; bytes: number; lastUsed: number }>();
const resourceGenerations = new Map<string, number>();
let resourceSerial = 0;
let compositionRevision = 0;
let selectionSignature = "";
const post = (message: WorkerMessage, transfer: Transferable[] = []): void => scope.postMessage(message, transfer);
type WireIssue = { readonly code: string; readonly path: string; readonly message: string };
type WireError = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly issues?: readonly WireIssue[];
};
const bounded = (value: unknown, limit: number, fallback: string) => String(value ?? fallback).slice(0, limit);
function toWireIssues(value: unknown): readonly WireIssue[] | undefined {
  if (!Array.isArray(value)) return;
  return value.slice(0, 100).map((issue) => {
    const item =
      typeof issue === "object" && issue !== null
        ? (issue as { code?: unknown; path?: unknown; message?: unknown })
        : {};
    return {
      code: bounded(item.code, 128, "error"),
      path: bounded(item.path, 512, "/"),
      message: bounded(item.message, 1024, "Request failed"),
    };
  });
}
function toWireError(
  value: { readonly code?: unknown; readonly message?: unknown; readonly path?: unknown; readonly issues?: unknown },
  fallbackCode = "worker.error",
  fallbackMessage = "Request failed",
): WireError {
  const path = value.path === undefined ? undefined : bounded(value.path, 512, "/");
  const issues = toWireIssues(value.issues);
  return {
    code: bounded(value.code, 128, fallbackCode),
    message: bounded(value.message, 2048, fallbackMessage),
    ...(path === undefined ? {} : { path }),
    ...(issues === undefined ? {} : { issues }),
  };
}
function reject(
  id: string,
  error: { readonly code?: unknown; readonly message?: unknown; readonly path?: unknown; readonly issues?: unknown },
): void {
  post({ protocol: PROTOCOL_VERSION, type: "response", id, ok: false, error: toWireError(error) });
}

const scheduler = new RenderScheduler((frameId, renderId) => {
  if (!state || !canvas || !context) return;
  const frameHostGeneration = hostGeneration;
  advanceCollapseAnimations(performance.now());
  const deviceWidth = Math.max(1, Math.round(viewport.width * viewport.dpr)),
    deviceHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));
  if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
  if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
  const preview = session.previewPositions.size || session.previewSizes.size || session.previewValues.size;
  const nodes = preview
    ? Object.fromEntries(
        Object.entries(state.document.nodes).map(([id, node]) => {
          const values = [...session.previewValues].filter(([controlId]) => controlId.startsWith(`${id}:`));
          let next = {
            ...node,
            ...(session.previewPositions.has(node.id) ? { position: session.previewPositions.get(node.id)! } : {}),
            ...(session.previewSizes.has(node.id) ? { size: session.previewSizes.get(node.id)! } : {}),
          };
          for (const [controlId, value] of values) {
            const control = currentLayout?.controls.get(controlId);
            if (control?.source === "parameter" && next.known)
              next = { ...next, parameters: { ...next.parameters, [control.key]: value } };
            else if (control?.source === "socket-default")
              next = {
                ...next,
                sockets: next.sockets.map((socket) =>
                  socket.id === control.key ? { ...socket, defaultValue: value } : socket,
                ),
              };
          }
          return [id, next];
        }),
      )
    : state.document.nodes;
  const transform = currentTransform();
  const layout = applyNodeOrder(
    nodes === state.document.nodes && layoutStore
      ? layoutStore.view(transform)
      : layoutGraph(application!.compiled, { ...state.document, nodes }, transform),
    session.uiOrder,
  );
  currentLayout = layout;
  publishSelection();
  renderCanvas(context, layout, application!.compiled.theme, session, resourceImages);
  if (session.colorPicker)
    paintColorPicker(
      context,
      session.colorPicker.layout,
      session.colorPicker.model,
      session.colorPicker.rgba,
      session.colorPicker.hsv,
      session.colorPicker.edit,
      viewport.dpr,
    );
  if (session.collapseAnimations.size) scheduler.request(renderId, DirtyReason.Preview);
  const bitmap = canvas.transferToImageBitmap();
  try {
    post(
      {
        protocol: PROTOCOL_VERSION,
        type: "frame",
        bitmap,
        renderId,
        frameId,
        hostGeneration: frameHostGeneration,
        host: { colorPickerOpen: !!session.colorPicker },
      },
      [bitmap],
    );
  } catch (error) {
    bitmap.close();
    throw error;
  }
});
function fatal(error: unknown, code = "worker.fatal"): void {
  closeResourceImages();
  post({
    protocol: PROTOCOL_VERSION,
    type: "fatal",
    error: { code, message: error instanceof Error ? error.message : "Worker failure" },
  });
  scope.close();
}
function commit(result: Extract<BoundTransitionResult, { status: "committed" }>, command: Command): void {
  const nextJournal = advanceJournal(
    journal!,
    command,
    application!.runtime.save(result.state.document),
    (baseline, commands) => application!.runtime.validateReplayJournal(baseline, commands, result.state.historyLimit),
  );
  if (result.mutationEnvelope.mutations.some((mutation) => mutation.kind === "document.replaced")) {
    installDocumentReplacement(result, nextJournal);
    return;
  }
  state = result.state;
  journal = nextJournal;
  seedCollapseAnimations(result.mutationEnvelope.mutations, performance.now());
  const added = result.mutationEnvelope.mutations.flatMap((mutation) =>
      mutation.kind === "node.set" && !mutation.before && mutation.after ? [mutation.id] : [],
    ),
    latest = added.at(-1);
  if (latest) {
    session.selectedNodes = new Set([latest]);
    session.selectedLinks.clear();
    session.activeNode = latest;
    raiseNode(latest);
  }
  layoutStore?.rebuild(result.state.document);
  pruneSession();
  post({ protocol: PROTOCOL_VERSION, type: "mutation", envelope: result.mutationEnvelope });
  post({ protocol: PROTOCOL_VERSION, type: "snapshot.event", envelope: result.snapshotEnvelope });
  publishSelection();
  scheduler.request();
}
function installDocumentReplacement(
  result:
    | Extract<BoundTransitionResult, { status: "committed" }>
    | Extract<BoundLoadResult, { ok: true }>
    | Extract<BoundReplayResult, { ok: true; status: "committed" }>,
  nextJournal: WorkerJournal,
): void {
  const nextStore = new IndexedLayoutStore(application!.compiled, result.state.document),
    nextLayout = applyNodeOrder(nextStore.view(currentTransform()), []);
  cancelGesture();
  state = result.state;
  journal = nextJournal;
  layoutStore = nextStore;
  gestureLayout = undefined;
  currentLayout = nextLayout;
  resetSessionForGraphReplacement(session);
  closeResourceImages();
  resourceGenerations.clear();
  post({ protocol: PROTOCOL_VERSION, type: "mutation", envelope: result.mutationEnvelope });
  post({ protocol: PROTOCOL_VERSION, type: "snapshot.event", envelope: result.snapshotEnvelope });
  publishSelection();
  scheduler.request();
}
function collapseValue(animation: import("./session.js").CollapseAnimation, now: number): number {
  const t = Math.max(0, Math.min(1, (now - animation.startedAt) / animation.durationMs)),
    eased = 1 - (1 - t) ** 3;
  return animation.from + (animation.to - animation.from) * eased;
}
function advanceCollapseAnimations(now: number): void {
  for (const [id, animation] of session.collapseAnimations) {
    animation.value = collapseValue(animation, now);
    if (now - animation.startedAt >= animation.durationMs) session.collapseAnimations.delete(id);
  }
}
function seedCollapseAnimations(mutations: readonly import("../engine/mutations.js").Mutation[], now: number): void {
  const changes = new Map<
    import("../core/types.js").NodeId,
    { before: import("../core/types.js").GraphNode | null; after: import("../core/types.js").GraphNode | null }
  >();
  for (const mutation of mutations)
    if (mutation.kind === "node.set") {
      const prior = changes.get(mutation.id);
      changes.set(mutation.id, { before: prior ? prior.before : mutation.before, after: mutation.after });
    }
  for (const [id, change] of changes) {
    if (!change.after) {
      session.collapseAnimations.delete(id);
      continue;
    }
    if (!change.before || change.before.collapsed === change.after.collapsed) continue;
    const existing = session.collapseAnimations.get(id),
      from = existing ? collapseValue(existing, now) : change.before.collapsed ? 1 : 0,
      to = change.after.collapsed ? 1 : 0,
      distance = Math.abs(to - from);
    if (distance < 0.001) {
      session.collapseAnimations.delete(id);
      continue;
    }
    session.collapseAnimations.set(id, { from, to, value: from, startedAt: now, durationMs: 120 * distance });
  }
}
function cancelGesture(): boolean {
  const active =
    !!session.knife ||
    !!session.drag ||
    !!session.scrub ||
    !!session.rampDrag ||
    !!session.reroutePress ||
    !!session.modalMove ||
    !!session.box ||
    !!session.linkDrag ||
    !!session.resize ||
    !!session.pan ||
    !!session.controlEdit ||
    !!session.colorPicker ||
    !!session.colorWheel ||
    !!gestureLayout ||
    session.previewValues.size > 0 ||
    session.previewPositions.size > 0 ||
    session.previewSizes.size > 0;
  if (session.box) session.selectedNodes = new Set(session.box.checkpoint);
  delete session.knife;
  delete session.drag;
  delete session.scrub;
  delete session.rampDrag;
  delete session.reroutePress;
  delete session.modalMove;
  delete session.box;
  delete session.linkDrag;
  delete session.resize;
  delete session.parentHighlight;
  delete session.pan;
  delete session.controlEdit;
  delete session.colorPicker;
  delete session.colorWheel;
  session.previewValues.clear();
  gestureLayout = undefined;
  session.previewPositions.clear();
  session.previewSizes.clear();
  return active;
}
const currentTransform = () => ({
  center: session.cameraCenter,
  zoom: session.zoom,
  viewport: { x: viewport.width, y: viewport.height },
  dpr: viewport.dpr,
});
function raiseNode(id: import("../core/types.js").NodeId): void {
  session.uiOrder = [...session.uiOrder.filter((value) => value !== id), id];
}
function selectNode(id: import("../core/types.js").NodeId, add = false): void {
  if (add) {
    session.selectedNodes.has(id) ? session.selectedNodes.delete(id) : session.selectedNodes.add(id);
  } else {
    session.selectedNodes.clear();
    session.selectedNodes.add(id);
  }
  session.selectedLinks.clear();
  session.activeNode = id;
  raiseNode(id);
}
function refreshLayout(): void {
  if (layoutStore) currentLayout = applyNodeOrder(layoutStore.view(currentTransform()), session.uiOrder);
}
function pruneSession(): void {
  if (!state) return;
  const ids = new Set(Object.keys(state.document.nodes)),
    links = new Set(Object.keys(state.document.links));
  session.selectedNodes = new Set([...session.selectedNodes].filter((id) => ids.has(id)));
  session.selectedLinks = new Set([...session.selectedLinks].filter((id) => links.has(id)));
  session.uiOrder = session.uiOrder.filter((id) => ids.has(id));
  if (session.activeNode && !ids.has(session.activeNode)) delete session.activeNode;
}
function isStandardNode(id: import("../core/types.js").NodeId): boolean {
  const node = state?.document.nodes[id];
  return !!node?.known && application?.compiled.nodes.get(node.typeId)?.behavior === "standard";
}
function publishSelection(force = false): void {
  if (!state || !application) return;
  const nodes = [...session.selectedNodes]
      .map((id) => state!.document.nodes[id])
      .filter((node): node is NonNullable<typeof node> => !!node),
    linkCount = [...session.selectedLinks].filter((id) => state!.document.links[id]).length,
    eligible = nodes.filter((node) => isStandardNode(node.id)),
    mute = eligible.length
      ? {
          enabled: true as const,
          state: (eligible.every((node) => node.muted)
            ? "all-muted"
            : eligible.every((node) => !node.muted)
              ? "all-unmuted"
              : "mixed") as "all-muted" | "all-unmuted" | "mixed",
        }
      : { enabled: false as const },
    projection = { nodeCount: nodes.length, linkCount, canRemove: nodes.length + linkCount > 0, mute },
    signature = `${projection.nodeCount}|${projection.linkCount}|${+projection.canRemove}|${mute.enabled ? mute.state : "disabled"}`;
  if (!force && signature === selectionSignature) return;
  selectionSignature = signature;
  post({ protocol: PROTOCOL_VERSION, type: "selection.host", projection });
}
function controlCommand(
  id: string,
  value?: import("../core/types.js").ParameterValue,
  reset = false,
): import("../commands/types.js").Command | undefined {
  const control = currentLayout?.controls.get(id);
  if (!control || control.source === "unknown") return;
  if (control.source === "parameter")
    return reset
      ? { type: "node.parameter-reset", id: control.nodeId, key: control.key }
      : { type: "node.parameter", id: control.nodeId, key: control.key, value: value! };
  return reset
    ? {
        type: "node.socket-default-reset",
        id: control.nodeId,
        socketId: control.key as import("../core/types.js").SocketId,
      }
    : {
        type: "node.socket-default",
        id: control.nodeId,
        socketId: control.key as import("../core/types.js").SocketId,
        value: value!,
      };
}
function gestureCommand(command: import("../commands/types.js").Command): void {
  if (!state) return;
  const result = application!.runtime.transition(state, {
    commandId: commandId(`gesture-${state.version + 1}`),
    expectedVersion: state.version,
    source: "gesture",
    command,
  });
  if (result.status === "committed") commit(result, command);
}
const rampValue = (id: string, layout = currentLayout) => {
  const c = layout?.controls.get(id),
    v = c?.value as { kind?: unknown; value?: unknown };
  return c?.kind === "color-ramp" && c.rampBounds && v?.kind === "json" && isColorRamp(v.value)
    ? { control: c, ramp: v.value }
    : undefined;
};
const activeStop = (id: string, ramp: ColorRamp) => {
  const stored = session.activeRampStopByControl.get(id);
  return ramp.stops.find((s) => s.id === stored) ?? ramp.stops[0]!;
};
function commitRamp(id: string, ramp: ColorRamp, active?: string) {
  const c = currentLayout?.controls.get(id);
  if (!c) return;
  if (active) session.activeRampStopByControl.set(id, active);
  const command = controlCommand(id, { kind: "json", value: ramp as unknown as import("../core/types.js").JsonValue });
  if (command) gestureCommand(command);
}
function rampAction(id: string, target: string, position?: number): void {
  const found = rampValue(id);
  if (!found) return;
  let { ramp } = found;
  const active = activeStop(id, ramp);
  if (target === "add") {
    const newId = `stop-${state!.version + 1}-${ramp.stops.length}`,
      next = addRampMidpoint(ramp, active.id, newId);
    commitRamp(id, next, next === ramp ? active.id : newId);
    return;
  }
  if (target === "remove") {
    const next = removeRampStop(ramp, active.id),
      survivor = next.stops.reduce((a, b) =>
        Math.abs(b.position - active.position) < Math.abs(a.position - active.position) ? b : a,
      );
    commitRamp(id, next, survivor.id);
    return;
  }
  if (target === "flip") ramp = flipColorRamp(ramp);
  else if (target === "distribute") ramp = distributeColorRamp(ramp);
  else if (target === "mode") {
    const options = ["rgb", "hsv", "hsl"] as const;
    ramp = { ...ramp, colorMode: options[(options.indexOf(ramp.colorMode) + 1) % options.length]! };
  } else if (target === "interpolation") {
    const options = ["linear", "ease", "constant", "cardinal", "b-spline"] as const;
    ramp = { ...ramp, interpolation: options[(options.indexOf(ramp.interpolation) + 1) % options.length]! };
  } else if (target === "hue") {
    const options = ["near", "far", "clockwise", "counter-clockwise"] as const;
    ramp = { ...ramp, hueInterpolation: options[(options.indexOf(ramp.hueInterpolation) + 1) % options.length]! };
  } else if (target === "gradient" && position !== undefined) {
    const newId = `stop-${state!.version + 1}-${ramp.stops.length}`,
      next = addRampStop(ramp, position, newId);
    commitRamp(id, next, next === ramp ? active.id : newId);
    return;
  }
  commitRamp(id, ramp, active.id);
}
const containsView = (point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
function rgbToHsv(rgba: Rgba, oldHue = 0): readonly [number, number, number] {
  const [r, g, b] = rgba,
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    s = max ? d / max : 0;
  let h = oldHue;
  if (d) h = 60 * (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return [((h % 360) + 360) % 360, s, max];
}
function hsvToRgb(h: number, s: number, v: number, a: number): Rgba {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c,
    [r, g, b] =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
  return [r + m, g + m, b + m, a];
}
function beginColorPicker(
  id: string,
  anchor: { x: number; y: number; width: number; height: number },
  rgba: Rgba,
  target: { kind: "control" } | { kind: "ramp-stop"; stopId: string; original: ColorRamp },
): void {
  const model = oklabToOklch(srgbToOklab([rgba[0], rgba[1], rgba[2]]));
  session.colorPicker = {
    layout: layoutColorPicker(anchor, { x: viewport.width, y: viewport.height }),
    controlId: id,
    target,
    model,
    rgba,
    hsv: rgbToHsv(rgba),
  };
  publishPicker();
  scheduler.request();
}
function publishPicker(): void {
  const p = session.colorPicker;
  if (!p) return;
  p.model = oklabToOklch(srgbToOklab([p.rgba[0], p.rgba[1], p.rgba[2]]), p.model.h);
  if (p.target.kind === "control") session.previewValues.set(p.controlId, { kind: "color", value: p.rgba });
  else
    session.previewValues.set(p.controlId, {
      kind: "json",
      value: setRampColor(
        p.target.original,
        p.target.stopId,
        p.rgba,
      ) as unknown as import("../core/types.js").JsonValue,
    });
  scheduler.request();
}
function applyPickerEdit(keepInvalid = true): boolean {
  const p = session.colorPicker,
    e = p?.edit;
  if (!p || !e) return true;
  let rgba: Rgba | undefined;
  if (e.field === "hex") {
    const match = e.buffer.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i),
      raw = match?.[1];
    if (raw) {
      const expanded = raw.length < 5 ? [...raw].map((value) => value + value).join("") : raw,
        full = expanded.length === 6 ? expanded + "ff" : expanded;
      rgba = [0, 2, 4, 6].map((index) => parseInt(full.slice(index, index + 2), 16) / 255) as unknown as Rgba;
    }
  } else {
    const value = Number(e.buffer);
    if (Number.isFinite(value)) {
      if (e.field === "rgba") {
        const next = [...p.rgba] as number[];
        next[e.index] = Math.max(0, Math.min(1, value));
        rgba = next as unknown as Rgba;
      } else {
        const next = [...p.hsv] as number[];
        next[e.index] = e.index ? Math.max(0, Math.min(1, value)) : ((value % 360) + 360) % 360;
        p.hsv = next as unknown as typeof p.hsv;
        rgba = hsvToRgb(next[0]!, next[1]!, next[2]!, p.rgba[3]);
      }
    }
  }
  if (!rgba) {
    if (keepInvalid) {
      p.edit = { ...e, invalid: true };
      scheduler.request();
    } else delete p.edit;
    return false;
  }
  p.rgba = rgba;
  p.hsv = rgbToHsv(rgba, p.hsv[0]);
  delete p.edit;
  publishPicker();
  return true;
}
function openRampPicker(id: string, ramp: ColorRamp): void {
  const control = currentLayout?.controls.get(id),
    bounds = control?.rampBounds;
  if (!control || !bounds) return;
  const stop = activeStop(id, ramp),
    anchor = viewRectFromWorld(bounds.color, currentLayout!);
  beginColorPicker(id, anchor, stop.color as Rgba, { kind: "ramp-stop", stopId: stop.id, original: ramp });
}
function openControlPicker(id: string): void {
  const control = currentLayout?.controls.get(id),
    value = control?.value as import("../core/types.js").ParameterValue | undefined;
  if (!control || control.kind !== "color" || control.linked || control.source === "unknown" || value?.kind !== "color")
    return;
  beginColorPicker(id, viewRectFromWorld(control.bounds, currentLayout!), value.value as Rgba, { kind: "control" });
}
function updatePicker(position: { x: number; y: number }): void {
  const picker = session.colorPicker;
  if (!picker?.drag) return;
  const rect = picker.layout[picker.drag.region];
  if (picker.drag.region === "plane") {
    const radius = rect.width / 2,
      dx = (position.x - (rect.x + radius)) / radius,
      dy = (rect.y + radius - position.y) / radius,
      length = Math.min(1, Math.hypot(dx, dy)),
      h = Math.atan2(dy, dx),
      c = length * maxSrgbChroma(picker.model.l, h);
    picker.model = { ...picker.model, c, h };
  } else if (picker.drag.region === "lightness") {
    const l = 1 - Math.max(0, Math.min(1, (position.y - rect.y) / rect.height));
    picker.model = { ...picker.model, l, c: Math.min(picker.model.c, maxSrgbChroma(l, picker.model.h)) };
  } else
    picker.rgba = [
      picker.rgba[0],
      picker.rgba[1],
      picker.rgba[2],
      1 - Math.max(0, Math.min(1, (position.y - rect.y) / rect.height)),
    ];
  const rgb = mapOklchToSrgb(picker.model);
  picker.rgba = [rgb[0], rgb[1], rgb[2], picker.rgba[3]];
  picker.hsv = rgbToHsv(picker.rgba, picker.hsv[0]);
  publishPicker();
}
function finishPicker(commitValue: boolean): void {
  const picker = session.colorPicker;
  if (!picker) return;
  if (commitValue) applyPickerEdit(false);
  const preview = session.previewValues.get(picker.controlId);
  session.previewValues.delete(picker.controlId);
  delete session.colorPicker;
  if (commitValue && preview) {
    if (picker.target.kind === "control") {
      const command = controlCommand(picker.controlId, preview);
      if (command) gestureCommand(command);
    } else {
      const value = preview as { kind?: unknown; value?: unknown };
      if (value.kind === "json" && isColorRamp(value.value))
        commitRamp(picker.controlId, value.value, picker.target.stopId);
    }
  }
  scheduler.request();
}
const viewRectFromWorld = (rect: { x: number; y: number; width: number; height: number }, layout: LayoutSnapshot) => {
  const p = worldToView({ x: rect.x, y: rect.y }, layout.transform);
  return { x: p.x, y: p.y, width: rect.width * layout.transform.zoom, height: rect.height * layout.transform.zoom };
};
function updateInlineWheel(position: { x: number; y: number }): void {
  const wheel = session.colorWheel;
  if (!wheel) return;
  const { bounds } = wheel;
  if (wheel.region === "plane") {
    const radius = bounds.width / 2,
      dx = (position.x - (bounds.x + radius)) / radius,
      dy = (bounds.y + radius - position.y) / radius,
      length = Math.min(1, Math.hypot(dx, dy)),
      h = Math.atan2(dy, dx),
      l = Math.min(0.9, Math.max(0.1, wheel.model.l));
    wheel.model = { l, h, c: length * maxSrgbChroma(l, h) };
  } else {
    const l = 1 - Math.max(0, Math.min(1, (position.y - bounds.y) / bounds.height));
    wheel.model = { ...wheel.model, l, c: Math.min(wheel.model.c, maxSrgbChroma(l, wheel.model.h)) };
  }
  const rgb = mapOklchToSrgb(wheel.model);
  wheel.rgba = [rgb[0], rgb[1], rgb[2], wheel.rgba[3]];
  session.previewValues.set(wheel.controlId, { kind: "color", value: wheel.rgba });
  scheduler.request();
}
function finishInlineWheel(commitValue: boolean): void {
  const wheel = session.colorWheel;
  if (!wheel) return;
  const preview = session.previewValues.get(wheel.controlId);
  session.previewValues.delete(wheel.controlId);
  delete session.colorWheel;
  gestureLayout = undefined;
  if (commitValue && preview) {
    const command = controlCommand(wheel.controlId, preview);
    if (command) gestureCommand(command);
  } else scheduler.request();
}
function processInput(
  event: Extract<import("../browser/protocol.js").WorkerRequest, { type: "input" }>["event"],
  nodeMenuRequestId?: string,
  resourceOpenRequestId?: string,
): void {
  if (!state) return;
  if (!currentLayout && layoutStore) currentLayout = layoutStore.view(currentTransform());
  if (!currentLayout) return;
  if (event.kind === "outside-pointer") {
    if (event.button === 0 && session.colorPicker) finishPicker(true);
    return;
  }
  if (event.kind === "focus" && event.phase === "blur") delete session.knife;
  if (event.kind === "key" && event.phase === "down" && event.key === "Escape") delete session.knife;
  if (event.kind === "focus") {
    if (event.phase === "blur") {
      cancelGesture();
      scheduler.request();
    }
    return;
  }
  if (event.kind === "wheel") {
    if (session.colorPicker) return;
    const next = zoomAt(currentTransform(), event.position, event.delta.y);
    session.zoom = next.zoom;
    session.cameraCenter = next.center;
    refreshLayout();
    scheduler.request();
    return;
  }
  if (event.kind === "key" && event.phase === "down") {
    const modifier = (event.modifiers & 6) !== 0;
    if (event.key === "Escape") {
      cancelGesture();
      scheduler.request();
      return;
    }
    if (session.colorPicker) {
      const p = session.colorPicker,
        e = p.edit;
      if (e) {
        if (event.key === "Enter") {
          applyPickerEdit();
          return;
        }
        if (event.key === "Backspace") {
          p.edit = { ...e, buffer: e.selectAll ? "" : e.buffer.slice(0, -1), selectAll: false, invalid: false };
          scheduler.request();
          return;
        }
        if (event.key.length === 1 && !modifier) {
          p.edit = { ...e, buffer: e.selectAll ? event.key : e.buffer + event.key, selectAll: false, invalid: false };
          scheduler.request();
        }
        return;
      }
      return;
    }
    if (event.key === "Backspace" && session.controlEdit) {
      session.controlEdit = {
        ...session.controlEdit,
        buffer:
          session.controlEdit.kind === "number" && session.controlEdit.selectAll
            ? ""
            : session.controlEdit.buffer.slice(0, -1),
        ...(session.controlEdit.kind === "number" ? { selectAll: false } : {}),
      };
      scheduler.request();
      return;
    }
    if (event.key === "Backspace") {
      if (session.colorPicker) finishPicker(false);
      const id = session.focusedControl ?? session.hoveredControl;
      if (id) {
        const rv = rampValue(id);
        if (rv) {
          const stop = activeStop(id, rv.ramp),
            target = session.focusedRampTarget;
          if (target === "swatch") commitRamp(id, setRampColor(rv.ramp, stop.id, [0, 0, 0, 1]), stop.id);
          else {
            const command = controlCommand(id, undefined, true);
            if (command) gestureCommand(command);
          }
          return;
        }
        const command = controlCommand(id, undefined, true);
        if (command) gestureCommand(command);
      }
      return;
    }
    if (session.focusedControl && session.focusedRampTarget) {
      const rv = rampValue(session.focusedControl);
      if (rv) {
        const stop = activeStop(session.focusedControl, rv.ramp);
        if (event.key === "Delete" || event.key.toLowerCase() === "x") {
          rampAction(session.focusedControl, "remove");
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const step = (event.modifiers & 8) !== 0 ? 0.001 : 0.01;
          commitRamp(
            session.focusedControl,
            moveRampStop(rv.ramp, stop.id, stop.position + (event.key === "ArrowRight" ? step : -step)),
            stop.id,
          );
          return;
        }
        return;
      }
    }
    if (session.focusedControl && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const control = currentLayout.controls.get(session.focusedControl);
      const value = control?.value;
      if (
        control?.kind === "enum" &&
        control.schema?.type === "string" &&
        control.schema.enum &&
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "string" &&
        "value" in value &&
        typeof value.value === "string"
      ) {
        const next = cycleEnum(control.schema.enum, value.value, event.key === "ArrowDown" ? 1 : -1);
        const command = controlCommand(control.id, { kind: "string", value: next });
        if (command) gestureCommand(command);
      }
      return;
    }
    if (session.controlEdit?.kind === "string") {
      if (event.key === "Enter") {
        const edit = session.controlEdit;
        delete session.controlEdit;
        const command = controlCommand(edit.controlId, { kind: "string", value: edit.buffer });
        if (command) gestureCommand(command);
        return;
      }
      if (event.key.length === 1 && !modifier) {
        session.controlEdit = { ...session.controlEdit, buffer: session.controlEdit.buffer + event.key };
        scheduler.request();
        return;
      }
    }
    if (session.controlEdit?.kind === "number") {
      if (event.key === "Enter") {
        const edit = session.controlEdit,
          value = Number(edit.buffer),
          control = currentLayout.controls.get(edit.controlId),
          original = control?.value as import("../core/types.js").ParameterValue | undefined;
        if (Number.isFinite(value) && control && original) {
          delete session.controlEdit;
          const command = controlCommand(edit.controlId, setNumericComponent(control, original, edit.component, value));
          if (command) gestureCommand(command);
        }
        return;
      }
      if (event.key.length === 1 && !modifier && /[0-9eE+.-]/.test(event.key)) {
        session.controlEdit = {
          ...session.controlEdit,
          buffer: session.controlEdit.selectAll ? event.key : session.controlEdit.buffer + event.key,
          selectAll: false,
        };
        scheduler.request();
        return;
      }
    }
    if (modifier && event.key.toLowerCase() === "z") {
      gestureCommand({ type: (event.modifiers & 8) !== 0 ? "redo" : "undo" });
      return;
    }
    if (event.key === "Home") {
      const b = currentLayout.graphBounds;
      if (b.width || b.height) {
        session.cameraCenter = { x: b.x + b.width / 2, y: b.y - b.height / 2 };
        session.zoom = Math.min(
          2,
          Math.max(0.1, Math.min(viewport.width / (b.width + 80), viewport.height / (b.height + 80))),
        );
        scheduler.request();
      }
      return;
    }
    const ids = [...session.selectedNodes];
    if (event.key.toLowerCase() === "g" && ids.length && !session.modalMove) {
      const startView = session.pointer ?? { x: viewport.width / 2, y: viewport.height / 2 },
        roots = groupRoots(session.selectedNodes, currentLayout);
      gestureLayout = currentLayout;
      session.modalMove = {
        startView,
        startWorld: viewToWorld(startView, currentLayout.transform),
        origins: new Map(roots.map((id) => [id, state!.document.nodes[id]!.position])),
        moved: true,
      };
      return;
    }
    if (event.key === "Enter" && session.modalMove) {
      finishMove();
      return;
    }
    if (event.key === "Delete" || event.key.toLowerCase() === "x") {
      const command = planSelectionRemoval(state.document, session.selectedNodes, session.selectedLinks);
      if (command) gestureCommand(command);
    } else if (event.key.toLowerCase() === "m" && ids.length) {
      const command = planSelectionMute(state.document, session.selectedNodes, isStandardNode);
      if (command) gestureCommand(command);
    } else if (event.key.toLowerCase() === "h" && ids.length)
      gestureCommand({
        type: "batch",
        commands: ids.map((id) => ({ type: "node.collapse", id, value: !state!.document.nodes[id]?.collapsed })),
      });
    return;
  }
  if (event.kind !== "pointer") return;
  session.pointer = event.position;
  if (session.colorPicker) {
    const picker = session.colorPicker;
    if (event.phase === "down" && event.button === 2) {
      finishPicker(false);
      return;
    }
    if (picker.drag?.pointerId === event.pointerId) {
      if (event.phase === "move") updatePicker(event.position);
      else {
        delete picker.drag;
        scheduler.request();
      }
      return;
    }
    if (event.phase === "down" && event.button === 0) {
      if (containsView(event.position, picker.layout.confirm)) {
        finishPicker(true);
        return;
      }
      if (picker.edit) applyPickerEdit(false);
      const region = (["plane", "lightness", "alpha"] as const).find((name) =>
        containsView(event.position, picker.layout[name]),
      );
      if (region) {
        picker.drag = { pointerId: event.pointerId, region };
        updatePicker(event.position);
        return;
      }
      for (const name of ["rgba", "hsv"] as const) {
        const index = picker.layout[name].findIndex((r) => containsView(event.position, r));
        if (index >= 0) {
          const values = name === "rgba" ? picker.rgba : picker.hsv;
          picker.edit = {
            field: name,
            index,
            buffer: name === "hsv" && index === 0 ? values[index]!.toFixed(1) : values[index]!.toFixed(3),
            selectAll: true,
            invalid: false,
          };
          scheduler.request();
          return;
        }
      }
      if (containsView(event.position, picker.layout.hex)) {
        picker.edit = {
          field: "hex",
          index: 0,
          buffer:
            "#" +
            picker.rgba
              .map((v) =>
                Math.round(v * 255)
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("")
              .toUpperCase(),
          selectAll: true,
          invalid: false,
        };
        scheduler.request();
        return;
      }
      finishPicker(true);
      return;
    }
    return;
  }
  if (session.colorWheel?.pointerId === event.pointerId) {
    if (event.phase === "move") updateInlineWheel(event.position);
    else finishInlineWheel(event.phase === "up");
    return;
  }
  if (event.phase === "cancel") delete session.knife;
  if (event.phase === "down" && event.button === 2 && (event.modifiers & 2) !== 0) {
    cancelGesture();
    gestureLayout = currentLayout;
    session.knife = {
      pointerId: event.pointerId,
      points: [event.position],
      crossed: new Set(),
      mode: (event.modifiers & 1) !== 0 ? "mute" : "remove",
    };
    scheduler.request();
    return;
  }
  if (session.knife?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      session.knife.points = appendKnifePoint(session.knife.points, event.position);
      session.knife.crossed = crossedLinks(gestureLayout!, session.knife.points, session.knife.mode === "mute");
      scheduler.request();
      return;
    }
    if (event.phase === "up") {
      const knife = session.knife;
      delete session.knife;
      gestureLayout = undefined;
      const commands = [...knife.crossed].map((id) =>
        knife.mode === "remove"
          ? { type: "link.remove" as const, id }
          : { type: "link.mute" as const, id, value: !state!.document.links[id]!.muted },
      );
      if (commands.length) gestureCommand({ type: "batch", commands });
      else scheduler.request();
      return;
    }
  }
  if (event.phase === "down" && event.button === 2) {
    const canceled = cancelGesture(),
      menuLayout = layoutStore?.view(currentTransform()),
      open = !!nodeMenuRequestId && !canceled && !!menuLayout && hitTest(menuLayout, event.position).kind === "canvas";
    if (nodeMenuRequestId)
      post(
        open
          ? {
              protocol: PROTOCOL_VERSION,
              type: "node-menu.result",
              requestId: nodeMenuRequestId,
              open: true,
              compositionRevision,
              viewPosition: event.position,
            }
          : { protocol: PROTOCOL_VERSION, type: "node-menu.result", requestId: nodeMenuRequestId, open: false },
      );
    scheduler.request();
    return;
  }
  if (event.phase === "move") {
    const hover = hitTest(currentLayout, event.position);
    if (hover.kind === "control" || hover.kind === "control-step" || hover.kind === "ramp") {
      session.hoveredControl = hover.id;
      if (hover.kind === "ramp") session.hoveredRampTarget = hover.target;
      else delete session.hoveredRampTarget;
    } else {
      delete session.hoveredControl;
      delete session.hoveredRampTarget;
      if (!session.controlEdit) delete session.focusedControl;
    }
  }
  if (event.phase === "cancel") {
    cancelGesture();
    scheduler.request();
    return;
  }
  if (session.reroutePress?.pointerId === event.pointerId) {
    const press = session.reroutePress;
    if (event.phase === "move" && Math.hypot(event.position.x - press.start.x, event.position.y - press.start.y) >= 4) {
      delete session.reroutePress;
      session.linkDrag = { pointerId: event.pointerId, from: press.socketId, current: event.position };
      const hit = hitTest(gestureLayout!, event.position, "input");
      if (
        hit.kind === "socket" &&
        compatibleTargets(gestureLayout!, press.socketId).some((socket) => socket.id === hit.id)
      )
        session.linkDrag.candidate = hit.id;
      scheduler.request();
      return;
    }
    if (event.phase === "up") {
      delete session.reroutePress;
      gestureLayout = undefined;
      selectNode(press.nodeId, (event.modifiers & 8) !== 0);
      refreshLayout();
      scheduler.request();
      return;
    }
    return;
  }
  if (session.scrub?.pointerId === event.pointerId) {
    if (event.phase === "down" && event.button === 2) {
      cancelGesture();
      scheduler.request();
      return;
    }
    if (event.phase === "move") {
      const control = gestureLayout?.controls.get(session.scrub.controlId);
      if (Math.abs(event.position.x - session.scrub.startX) >= 2) session.scrub.moved = true;
      if (!session.scrub.moved) return;
      const raw = session.scrub.original as { kind?: unknown; value?: unknown };
      if (control && raw.kind === "json" && isColorRamp(raw.value)) {
        const stop = activeStop(control.id, raw.value),
          delta = (event.position.x - session.scrub.startX) * ((event.modifiers & 8) !== 0 ? 0.001 : 0.01);
        const ramp =
          session.scrub.component < 0
            ? moveRampStop(raw.value, stop.id, stop.position + delta)
            : setRampColor(
                raw.value,
                stop.id,
                stop.color.map((c, i) => (i === session.scrub!.component ? c + delta : c)) as unknown as readonly [
                  number,
                  number,
                  number,
                  number,
                ],
              );
        session.previewValues.set(control.id, {
          kind: "json",
          value: ramp as unknown as import("../core/types.js").JsonValue,
        });
        scheduler.request();
      } else if (control) {
        const value = scrubValue(
          control,
          session.scrub.original,
          session.scrub.component,
          event.position.x - session.scrub.startX,
          (event.modifiers & 8) !== 0,
          (event.modifiers & 2) !== 0,
        );
        session.previewValues.set(control.id, value);
        scheduler.request();
      }
    } else {
      const scrub = session.scrub,
        id = scrub.controlId,
        value = session.previewValues.get(id),
        moved = scrub.moved;
      cancelGesture();
      if (!moved) {
        session.focusedControl = id;
        if (scrub.original.kind !== "json") {
          const original = scrub.original,
            component =
              original.kind === "number"
                ? original.value
                : original.kind === "vector" || original.kind === "color"
                  ? (original.value[scrub.component] ?? 0)
                  : 0;
          session.controlEdit = {
            kind: "number",
            controlId: id,
            component: scrub.component,
            buffer: component.toFixed(3),
            selectAll: true,
          };
        }
        scheduler.request();
        return;
      }
      const command = value ? controlCommand(id, value) : undefined;
      if (command) gestureCommand(command);
      else scheduler.request();
    }
    return;
  }
  if (session.rampDrag?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      const found = rampValue(session.rampDrag.controlId, gestureLayout),
        b = found?.control.rampBounds;
      if (found && b) {
        const world = viewToWorld(event.position, gestureLayout!.transform),
          p = Math.max(0, Math.min(1, (world.x - b.handles.x) / b.handles.width));
        session.previewValues.set(found.control.id, {
          kind: "json",
          value: moveRampStop(
            found.ramp,
            session.rampDrag.stopId,
            p,
          ) as unknown as import("../core/types.js").JsonValue,
        });
        scheduler.request();
      }
    } else {
      const drag = session.rampDrag,
        value = session.previewValues.get(drag.controlId) as { kind?: unknown; value?: unknown } | undefined;
      cancelGesture();
      if (value?.kind === "json" && isColorRamp(value.value)) commitRamp(drag.controlId, value.value, drag.stopId);
      else scheduler.request();
    }
    return;
  }
  if (event.phase === "down" && event.button === 1) {
    session.pan = { pointerId: event.pointerId, last: event.position };
    return;
  }
  if (session.pan?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      session.cameraCenter = {
        x: session.cameraCenter.x - (event.position.x - session.pan.last.x) / session.zoom,
        y: session.cameraCenter.y + (event.position.y - session.pan.last.y) / session.zoom,
      };
      session.pan = { ...session.pan, last: event.position };
      scheduler.request();
    } else delete session.pan;
    return;
  }
  if (session.modalMove) {
    if (event.phase === "move") {
      previewMove(session.modalMove, event.position);
      return;
    }
    if (event.phase === "down" && event.button === 0) {
      finishMove();
      return;
    }
  }
  if (event.phase === "down" && event.button === 0) {
    const previousEdit = session.controlEdit;
    if (previousEdit) {
      delete session.controlEdit;
      scheduler.request();
    }
    const interactionLayout = layoutStore
      ? applyNodeOrder(layoutStore.view(currentTransform()), session.uiOrder)
      : currentLayout;
    let hit = hitTest(interactionLayout, event.position, "output");
    if (
      previousEdit?.kind === "number" &&
      hit.kind === "control-step" &&
      hit.id === previousEdit.controlId &&
      hit.component === previousEdit.component
    )
      hit = { kind: "control", id: hit.id, component: hit.component };
    if (hit.kind === "resource") {
      const control = interactionLayout.controls.get(hit.id),
        policy = control?.resourceId && application?.compiled.resources.get(control.resourceId as never);
      if (resourceOpenRequestId && control?.kind === "resource" && control.source === "parameter" && policy)
        post({
          protocol: PROTOCOL_VERSION,
          type: "resource.open",
          requestId: resourceOpenRequestId,
          authorization: {
            token: control.id,
            graphVersion: state.version,
            compositionRevision,
          },
          resource: {
            id: policy.id,
            kind: "image",
            title: control.label,
            openTitle: control.openTitle ?? policy.openTitle ?? "Open",
            accept: [...policy.accept],
            maxBytes: policy.maxBytes,
            maxWidth: policy.maxWidth,
            maxHeight: policy.maxHeight,
            maxPixels: policy.maxPixels,
          },
        });
      return;
    }
    gestureLayout = interactionLayout;
    if (hit.kind === "ramp") {
      const found = rampValue(hit.id);
      if (!found) return;
      session.focusedControl = hit.id;
      session.focusedRampTarget = hit.target;
      const active = activeStop(hit.id, found.ramp);
      if (hit.target === "handle" && hit.stopId) {
        const same = found.ramp.stops.filter(
          (s) =>
            Math.abs(s.position - (hit.position ?? s.position)) <
            7 / currentLayout!.transform.zoom / found.control.rampBounds!.handles.width,
        );
        let id = hit.stopId;
        if (same.length > 1) {
          const old = session.activeRampStopByControl.get(found.control.id),
            i = same.findIndex((s) => s.id === old);
          id = same[(i + 1) % same.length]!.id;
        }
        session.activeRampStopByControl.set(found.control.id, id);
        session.rampDrag = {
          pointerId: event.pointerId,
          controlId: hit.id,
          stopId: id,
          original: found.control.value as import("../core/types.js").ParameterValue,
        };
        scheduler.request();
        return;
      }
      if (hit.target === "gradient") {
        rampAction(hit.id, "gradient", hit.position);
        return;
      }
      if (hit.target === "position") {
        session.scrub = {
          pointerId: event.pointerId,
          controlId: hit.id,
          component: -1,
          startX: event.position.x,
          original: found.control.value as import("../core/types.js").ParameterValue,
          moved: false,
        };
        return;
      }
      if (hit.target === "selector") {
        const i = found.ramp.stops.findIndex((s) => s.id === active.id);
        session.activeRampStopByControl.set(found.control.id, found.ramp.stops[(i + 1) % found.ramp.stops.length]!.id);
        scheduler.request();
        return;
      }
      if (hit.target === "swatch") {
        openRampPicker(hit.id, found.ramp);
        return;
      }
      rampAction(hit.id, hit.target);
      scheduler.request();
      return;
    }
    if (hit.kind === "color-wheel") {
      const control = currentLayout.controls.get(hit.id),
        value = control?.value as import("../core/types.js").ParameterValue | undefined,
        bounds = control?.colorWheelBounds?.[hit.region];
      if (!control || value?.kind !== "color" || !bounds) return;
      const rgba = value.value as Rgba;
      gestureLayout = currentLayout;
      session.colorWheel = {
        controlId: hit.id,
        original: value,
        model: oklabToOklch(srgbToOklab([rgba[0], rgba[1], rgba[2]])),
        rgba,
        pointerId: event.pointerId,
        region: hit.region,
        bounds: viewRectFromWorld(bounds, currentLayout),
      };
      updateInlineWheel(event.position);
      return;
    }
    if (hit.kind === "control-step") {
      const control = currentLayout.controls.get(hit.id),
        original = control?.value as import("../core/types.js").ParameterValue | undefined;
      if (control && original) {
        session.focusedControl = hit.id;
        const current =
            original.kind === "number"
              ? original.value
              : original.kind === "vector" || original.kind === "color"
                ? (original.value[hit.component] ?? 0)
                : 0,
          next = setNumericComponent(
            control,
            original,
            hit.component,
            current + hit.direction * numericStep(control, (event.modifiers & 8) !== 0),
          ),
          command = controlCommand(hit.id, next);
        if (command) gestureCommand(command);
      }
      return;
    }
    if (hit.kind === "control") {
      const control = currentLayout.controls.get(hit.id);
      session.focusedControl = hit.id;
      if (control && !control.linked && control.source !== "unknown") {
        const current = control.value as import("../core/types.js").ParameterValue;
        if (control.kind === "boolean" && current.kind === "boolean") {
          const command = controlCommand(hit.id, { kind: "boolean", value: !current.value });
          if (command) gestureCommand(command);
        } else if (
          control.kind === "enum" &&
          control.schema?.type === "string" &&
          control.schema.enum &&
          current.kind === "string"
        ) {
          const command = controlCommand(hit.id, {
            kind: "string",
            value: cycleEnum(control.schema.enum, current.value, 1),
          });
          if (command) gestureCommand(command);
        } else if ((control.kind === "string" || control.kind === "resource") && current.kind === "string")
          session.controlEdit = { kind: "string", controlId: hit.id, buffer: current.value };
        else if (control.kind === "color" && current.kind === "color") openControlPicker(hit.id);
        else if (control.kind === "number" || control.kind === "vector")
          session.scrub = {
            pointerId: event.pointerId,
            controlId: hit.id,
            component: hit.component,
            startX: event.position.x,
            original: current,
            moved: false,
          };
      }
      scheduler.request();
      return;
    }
    if (hit.kind === "socket") {
      const socket = currentLayout.sockets.get(hit.id),
        node = socket && currentLayout.nodes.get(socket.nodeId);
      if (socket?.direction === "output" && node?.kind === "reroute")
        session.reroutePress = { pointerId: event.pointerId, nodeId: node.id, socketId: hit.id, start: event.position };
      else if (socket?.direction === "output")
        session.linkDrag = { pointerId: event.pointerId, from: hit.id, current: event.position };
      scheduler.request();
      return;
    }
    if (hit.kind === "collapse") {
      const n = state.document.nodes[hit.id];
      if (n) gestureCommand({ type: "node.collapse", id: hit.id, value: !n.collapsed });
      return;
    }
    if (hit.kind === "resize") {
      session.resize = { pointerId: event.pointerId, id: hit.id };
      return;
    }
    if (hit.kind === "link") {
      session.selectedNodes.clear();
      if ((event.modifiers & 8) === 0) session.selectedLinks.clear();
      session.selectedLinks.add(hit.id);
      scheduler.request();
      return;
    }
    if (hit.kind === "canvas") {
      session.box = {
        pointerId: event.pointerId,
        start: event.position,
        current: event.position,
        checkpoint: new Set(session.selectedNodes),
        add: (event.modifiers & 8) !== 0,
      };
      if (!session.box.add) session.selectedNodes.clear();
      scheduler.request();
      return;
    }
    const id = hit.id;
    if ((event.modifiers & 8) !== 0) selectNode(id, true);
    else if (!session.selectedNodes.has(id)) selectNode(id);
    else {
      session.activeNode = id;
      raiseNode(id);
    }
    refreshLayout();
    gestureLayout = currentLayout;
    const roots = groupRoots(session.selectedNodes, currentLayout);
    session.drag = {
      pointerId: event.pointerId,
      startView: event.position,
      startWorld: viewToWorld(event.position, currentLayout.transform),
      origins: new Map(roots.map((root) => [root, state!.document.nodes[root]!.position])),
      moved: false,
    };
    scheduler.request();
    return;
  }
  if (session.box?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      session.box.current = event.position;
      const found = boxNodes(gestureLayout!, session.box.start, event.position);
      session.selectedNodes = new Set(session.box.add ? [...session.box.checkpoint, ...found] : found);
      scheduler.request();
    } else {
      for (const id of gestureLayout!.drawOrder) if (session.selectedNodes.has(id)) raiseNode(id);
      delete session.box;
      gestureLayout = undefined;
      refreshLayout();
      scheduler.request();
    }
    return;
  }
  if (session.linkDrag?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      session.linkDrag.current = event.position;
      const hit = hitTest(gestureLayout!, event.position, "input");
      if (
        hit.kind === "socket" &&
        compatibleTargets(gestureLayout!, session.linkDrag.from).some((s) => s.id === hit.id)
      )
        session.linkDrag.candidate = hit.id;
      else delete session.linkDrag.candidate;
      scheduler.request();
    } else {
      const command = session.linkDrag.candidate
        ? planLink(
            gestureLayout!,
            session.linkDrag.from,
            session.linkDrag.candidate,
            linkId(`gesture-link-${state.version + 1}`),
          )
        : undefined;
      cancelGesture();
      if (command) gestureCommand(command);
      else scheduler.request();
    }
    return;
  }
  if (session.resize?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      const size = clampResize(
        gestureLayout!,
        session.resize.id,
        viewToWorld(event.position, gestureLayout!.transform),
      );
      if (size) session.previewSizes.set(session.resize.id, size);
      scheduler.request();
    } else {
      const id = session.resize.id,
        size = session.previewSizes.get(id);
      cancelGesture();
      if (size) gestureCommand({ type: "node.resize", id, size });
      else scheduler.request();
    }
    return;
  }
  if (session.drag?.pointerId === event.pointerId) {
    if (event.phase === "move") {
      const distance = Math.hypot(
        event.position.x - session.drag.startView.x,
        event.position.y - session.drag.startView.y,
      );
      if (distance >= 4) session.drag.moved = true;
      if (session.drag.moved) previewMove(session.drag, event.position);
    } else if (event.phase === "up") finishMove();
    return;
  }
}
function input(
  event: Extract<import("../browser/protocol.js").WorkerRequest, { type: "input" }>["event"],
  nodeMenuRequestId?: string,
  resourceOpenRequestId?: string,
): void {
  try {
    processInput(event, nodeMenuRequestId, resourceOpenRequestId);
  } finally {
    publishSelection();
  }
}

function previewMove(
  move: {
    startWorld: { x: number; y: number };
    origins: ReadonlyMap<import("../core/types.js").NodeId, { x: number; y: number }>;
  },
  position: { x: number; y: number },
): void {
  const layout = gestureLayout ?? currentLayout!;
  const now = viewToWorld(position, layout.transform);
  for (const [id, p] of move.origins)
    session.previewPositions.set(id, { x: p.x + now.x - move.startWorld.x, y: p.y + now.y - move.startWorld.y });
  const first = [...move.origins][0];
  if (first) {
    const n = layout.nodes.get(first[0]);
    const preview = session.previewPositions.get(first[0]);
    const target =
      n && preview
        ? frameDropCandidate(layout, first[0], {
            x: n.worldPosition.x + preview.x - n.localPosition.x + n.bounds.width / 2,
            y: n.worldPosition.y + preview.y - n.localPosition.y - n.bounds.height / 2,
          })
        : undefined;
    if (target) session.parentHighlight = target;
    else delete session.parentHighlight;
  }
  scheduler.request();
}
function finishMove(): void {
  const layout = gestureLayout ?? currentLayout!;
  const commands: import("../commands/types.js").BatchCommand[] = [...session.previewPositions].map(
    ([id, position]) => ({ type: "node.move", id, position }),
  );
  for (const [id] of session.previewPositions) {
    const n = layout.nodes.get(id);
    if (!n) continue;
    const target = session.parentHighlight;
    if ((target ?? undefined) !== (n.parentId ?? undefined))
      commands.push({ type: "node.parent", id, parentId: target ?? null });
  }
  cancelGesture();
  if (commands.length) gestureCommand({ type: "batch", commands });
  else scheduler.request();
}

function resourceTarget(token: string, fresh = false) {
  const control = (fresh && layoutStore ? layoutStore.view(currentTransform()) : currentLayout)?.controls.get(token);
  return control?.kind === "resource" && control.source === "parameter" ? control : undefined;
}
function closeResourceImages(): void {
  for (const image of resourceImages.values()) image.bitmap.close();
  resourceImages.clear();
  resourceGenerations.clear();
}
function trimResourceImages(): void {
  let bytes = [...resourceImages.values()].reduce((sum, image) => sum + image.bytes, 0);
  while (resourceImages.size > 16 || bytes > 128 * 1024 * 1024) {
    const oldest = [...resourceImages].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!oldest) break;
    oldest[1].bitmap.close();
    bytes -= oldest[1].bytes;
    resourceImages.delete(oldest[0]);
  }
}
async function setResource(
  data: Extract<import("../browser/protocol.js").WorkerRequest, { type: "resource.set" }>,
): Promise<void> {
  applyPointerFence(data.pointerFence);
  const { authorization, resource } = data;
  if (
    !state ||
    authorization.graphVersion !== state.version ||
    authorization.compositionRevision !== compositionRevision
  ) {
    reject(data.id, { code: "resource.stale", message: "The image authorization is stale" });
    return;
  }
  if (data.expected.kind === "exact" && data.expected.version !== state.version) {
    reject(data.id, { code: "version.stale", message: "Expected version does not match" });
    return;
  }
  const decodeRevision = compositionRevision,
    decodeGraphVersion = state.version,
    target = resourceTarget(authorization.token, true),
    targetNode = target && state.document.nodes[target.nodeId];
  if (!target || !targetNode) {
    reject(data.id, { code: "resource.stale", message: "The image target is no longer available" });
    return;
  }
  const policy = target.resourceId && application?.compiled.resources.get(target.resourceId as never);
  if (!policy) {
    reject(data.id, { code: "resource.policy", message: "The image resource policy is unavailable" });
    return;
  }
  if (resource.bytes.byteLength > Math.min(policy.maxBytes, 32 * 1024 * 1024)) {
    reject(data.id, { code: "resource.bytes", message: "The selected file is too large" });
    return;
  }
  const generation = (resourceGenerations.get(authorization.token) ?? 0) + 1;
  resourceGenerations.set(authorization.token, generation);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([resource.bytes], { type: resource.mime || "application/octet-stream" }));
  } catch {
    reject(data.id, { code: "resource.decode", message: "The selected file is not a supported image" });
    return;
  }
  const current = resourceTarget(authorization.token, true);
  if (
    state.version !== decodeGraphVersion ||
    state.document.nodes[target.nodeId] !== targetNode ||
    compositionRevision !== decodeRevision ||
    resourceGenerations.get(authorization.token) !== generation ||
    !current ||
    current.nodeId !== target.nodeId ||
    current.key !== target.key ||
    current.resourceId !== target.resourceId
  ) {
    bitmap.close();
    reject(data.id, { code: "resource.stale", message: "The image target changed while decoding" });
    return;
  }
  if (
    bitmap.width > Math.min(policy.maxWidth, 8192) ||
    bitmap.height > Math.min(policy.maxHeight, 8192) ||
    bitmap.width * bitmap.height > Math.min(policy.maxPixels, 16_777_216)
  ) {
    bitmap.close();
    reject(data.id, { code: "resource.dimensions", message: "The decoded image is too large" });
    return;
  }
  const cancelled = cancelGesture();
  publishSelection();
  if (cancelled) scheduler.request();
  const finalTarget = resourceTarget(authorization.token, true);
  if (
    !finalTarget ||
    finalTarget.nodeId !== target.nodeId ||
    finalTarget.key !== target.key ||
    finalTarget.resourceId !== target.resourceId
  ) {
    bitmap.close();
    reject(data.id, { code: "resource.stale", message: "The image target changed before commit" });
    return;
  }
  const reference = `${policy.referencePrefix}${state.document.graphId}:${++resourceSerial}:${encodeURIComponent(resource.name)}`,
    result = application!.runtime.transition(state, {
      commandId: commandId(data.id),
      expectedVersion: state.version,
      source: "gesture",
      command: {
        type: "node.parameter",
        id: target.nodeId,
        key: target.key,
        value: { kind: "string", value: reference },
      },
    });
  if (result.status === "rejected") {
    bitmap.close();
    reject(data.id, result.error);
    return;
  }
  if (result.status === "noop") {
    bitmap.close();
    post({
      protocol: PROTOCOL_VERSION,
      type: "response",
      id: data.id,
      ok: true,
      value: { status: "noop", version: state.version },
    });
    return;
  }
  commit(result, {
    type: "node.parameter",
    id: target.nodeId,
    key: target.key,
    value: { kind: "string", value: reference },
  });
  resourceImages.set(reference, {
    bitmap,
    name: resource.name,
    bytes: bitmap.width * bitmap.height * 4,
    lastUsed: performance.now(),
  });
  trimResourceImages();
  post({
    protocol: PROTOCOL_VERSION,
    type: "response",
    id: data.id,
    ok: true,
    value: { status: "committed", version: state.version },
  });
}

function adoptHostGeneration(next: number): boolean {
  if (next < hostGeneration) throw new Error("Host generation regressed");
  const advanced = next > hostGeneration;
  hostGeneration = next;
  if (advanced) scheduler.request(undefined, DirtyReason.HostInteraction);
  return advanced;
}
function applyPointerSnapshot(snapshot: import("../browser/pointer-lane.js").PointerLaneSnapshot | undefined): void {
  if (snapshot && snapshot.sequence !== consumedPointerSequence) {
    consumedPointerSequence = snapshot.sequence;
    adoptHostGeneration(snapshot.hostGeneration);
    input(snapshot.event);
  }
}
function applyPointerFence(fence: PointerFence | undefined): void {
  if (!fence) return;
  applyPointerSnapshot(fence.before);
  handledPointerFence = fence.generation;
}
function pollPointerLane(): void {
  if (!pointerLane) return;
  const generation = pointerLaneFence(pointerLane);
  if (generation !== handledPointerFence) return;
  const move = readPointerMove(pointerLane, consumedPointerSequence);
  if (pointerLaneFence(pointerLane) !== generation) return;
  applyPointerSnapshot(move);
}

type ApplicationAuthority = NonNullable<typeof application>;
interface StagedCompositionUpdate {
  readonly baseRevision: number;
  readonly revision: number;
  readonly change: CompositionChange;
  readonly baseGraphVersion: number;
  readonly graphVersion: number;
  readonly graphChanged: boolean;
  readonly application: ApplicationAuthority;
  readonly state: BoundEngineState;
  readonly layoutStore: IndexedLayoutStore<FxNodeCompositionData>;
  readonly currentLayout: LayoutSnapshot;
  readonly retainedUiOrder: readonly import("../core/types.js").NodeId[];
  readonly mutationEnvelope?: BoundMutationEnvelope;
  readonly snapshotEnvelope?: BoundSnapshotEnvelope;
}
function putCompositionEntry(
  record: Readonly<Record<string, unknown>>,
  id: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  const entries: Array<readonly [string, unknown]> = [];
  let replaced = false;
  for (const [key, current] of Object.entries(record)) {
    if (key === id) {
      entries.push([key, value]);
      replaced = true;
    } else entries.push([key, current]);
  }
  if (!replaced) entries.push([id, value]);
  return nullRecord(entries);
}
function removeCompositionEntry(
  record: Readonly<Record<string, unknown>>,
  id: string,
): Readonly<Record<string, unknown>> {
  return nullRecord(Object.entries(record).filter(([key]) => key !== id));
}
function patchCompositionSource(source: FxNodeCompositionData, update: CompositionUpdateWire): unknown {
  switch (update.kind) {
    case "composition.load":
      return update.composition;
    case "theme.set":
      return { ...source, theme: update.theme };
    case "header-styles.set":
      return { ...source, nodeStyles: update.styles };
    case "compatibility.set":
      return { ...source, compatibility: update.compatibility };
    case "socket.compose":
      return { ...source, socketTypes: putCompositionEntry(source.socketTypes, update.id, update.definition) };
    case "socket.remove":
      return { ...source, socketTypes: removeCompositionEntry(source.socketTypes, update.id) };
    case "node.compose":
      return { ...source, nodes: putCompositionEntry(source.nodes, update.id, update.definition) };
    case "node.remove":
      return { ...source, nodes: removeCompositionEntry(source.nodes, update.id) };
  }
}
const compositionChange = (update: CompositionUpdateWire): CompositionChange =>
  update.kind === "theme.set" ||
  update.kind === "header-styles.set" ||
  update.kind === "composition.load" ||
  update.kind === "compatibility.set"
    ? { kind: update.kind }
    : { kind: update.kind, id: update.id };
type StageResult =
  | { readonly status: "noop"; readonly receipt: CompositionReceipt }
  | { readonly status: "rejected"; readonly error: WireError }
  | { readonly status: "committed"; readonly staged: StagedCompositionUpdate };
function stageCompositionUpdate(data: Extract<WorkerRequest, { type: "composition.update" }>): StageResult {
  const currentApplication = application!,
    currentState = state!;
  if (data.expected.kind === "exact" && data.expected.revision !== compositionRevision)
    return {
      status: "rejected",
      error: toWireError({
        code: "composition.revision.stale",
        message: "Expected composition revision does not match",
      }),
    };
  let candidateCompiled: CompiledFxNodeComposition<FxNodeCompositionData>;
  try {
    candidateCompiled = compileFxNodeComposition(
      patchCompositionSource(currentApplication.compiled.source, data.update) as FxNodeCompositionData,
    );
  } catch (error) {
    if (error instanceof FxNodeCompositionError)
      return {
        status: "rejected",
        error: toWireError({ code: "composition.invalid", message: error.message, issues: error.issues }),
      };
    throw error;
  }
  if (canonicalJsonEqual(candidateCompiled.source, currentApplication.compiled.source))
    return {
      status: "noop",
      receipt: {
        status: "noop",
        revision: compositionRevision,
        graphVersion: currentState.version,
        graphChanged: false,
        historyReset: false,
      },
    };
  if (compositionRevision >= Number.MAX_SAFE_INTEGER)
    return {
      status: "rejected",
      error: toWireError({ code: "composition.revision.overflow", message: "Composition revision exhausted" }),
    };
  const removedNodeTypes =
    data.update.kind === "composition.load"
      ? new Set(
          Object.keys(currentApplication.compiled.source.nodes).filter(
            (id) => !Object.hasOwn(candidateCompiled.source.nodes, id),
          ),
        )
      : data.update.kind === "node.remove"
        ? new Set([data.update.id])
        : undefined;
  const candidateRuntime = bindFxNodeHeadless(candidateCompiled),
    rebound = rebindBoundEngineAuthority(currentState, currentApplication.runtime, candidateRuntime, {
      commandId: commandId(data.id),
      ...(removedNodeTypes ? { removedNodeTypes } : {}),
    });
  if (!rebound.ok) {
    const demotion = rebound.issues.some((issue) => issue.code === "composition.node-demotion"),
      overflow = rebound.issues.some((issue) => issue.code === "version.overflow");
    return {
      status: "rejected",
      error: toWireError({
        code: demotion ? "composition.node-demotion" : overflow ? "version.overflow" : "composition.rebind.invalid",
        message: demotion
          ? "Composition update would demote a known node"
          : overflow
            ? "Graph version exhausted"
            : "Current graph is incompatible with the composition update",
        issues: rebound.issues,
      }),
    };
  }
  const candidateStore = new IndexedLayoutStore(candidateCompiled, rebound.state.document),
    nodeIds = new Set(Object.keys(rebound.state.document.nodes)),
    retainedUiOrder = session.uiOrder.filter((id) => nodeIds.has(id)),
    candidateLayout = applyNodeOrder(candidateStore.view(currentTransform()), retainedUiOrder);
  const revision = compositionRevision + 1;
  return {
    status: "committed",
    staged: {
      baseRevision: compositionRevision,
      revision,
      change: compositionChange(data.update),
      baseGraphVersion: currentState.version,
      graphVersion: rebound.state.version,
      graphChanged: rebound.graphChanged,
      application: { compiled: candidateCompiled, runtime: candidateRuntime },
      state: rebound.state,
      layoutStore: candidateStore,
      currentLayout: candidateLayout,
      retainedUiOrder,
      ...(rebound.graphChanged
        ? { mutationEnvelope: rebound.mutationEnvelope, snapshotEnvelope: rebound.snapshotEnvelope }
        : {}),
    },
  };
}
function publishCompositionUpdate(id: string, staged: StagedCompositionUpdate): void {
  cancelGesture();
  application = staged.application;
  state = staged.state;
  layoutStore = staged.layoutStore;
  gestureLayout = undefined;
  currentLayout = staged.currentLayout;
  compositionRevision = staged.revision;
  resetSessionForCompositionRebind(
    session,
    new Set(Object.keys(state.document.nodes) as import("../core/types.js").NodeId[]),
    new Set(Object.keys(state.document.links) as import("../core/types.js").LinkId[]),
    staged.retainedUiOrder,
  );
  journal = checkpointJournal(application.runtime.save(state.document));
  const envelope: CompositionChangeEnvelope = {
    baseRevision: staged.baseRevision,
    revision: staged.revision,
    change: staged.change,
    baseGraphVersion: staged.baseGraphVersion,
    graphVersion: staged.graphVersion,
    graphChanged: staged.graphChanged,
    historyReset: true,
  };
  post({ protocol: PROTOCOL_VERSION, type: "composition.event", envelope });
  publishSelection();
  if (staged.graphChanged) {
    post({ protocol: PROTOCOL_VERSION, type: "mutation", envelope: staged.mutationEnvelope! });
    post({ protocol: PROTOCOL_VERSION, type: "snapshot.event", envelope: staged.snapshotEnvelope! });
  }
  scheduler.request();
  post({
    protocol: PROTOCOL_VERSION,
    type: "response",
    id,
    ok: true,
    value: {
      status: "committed",
      revision: staged.revision,
      graphVersion: staged.graphVersion,
      graphChanged: staged.graphChanged,
      historyReset: true,
    },
  });
}
function recognizableInvalidRpc(value: unknown):
  | {
      readonly type:
        | "init"
        | "command"
        | "load"
        | "save.data"
        | "state.set"
        | "composition.update"
        | "node.add"
        | "selection.remove"
        | "selection.mute"
        | "resource.set";
      readonly id: string;
    }
  | undefined {
  try {
    if (typeof value !== "object" || value === null || (value as { protocol?: unknown }).protocol !== PROTOCOL_VERSION)
      return;
    const type = (value as { type?: unknown }).type,
      id = (value as { id?: unknown }).id;
    if (
      (type !== "init" &&
        type !== "command" &&
        type !== "load" &&
        type !== "save.data" &&
        type !== "state.set" &&
        type !== "composition.update" &&
        type !== "node.add" &&
        type !== "selection.remove" &&
        type !== "selection.mute" &&
        type !== "resource.set") ||
      typeof id !== "string" ||
      !id.length ||
      id.length > 512
    )
      return;
    return { type, id };
  } catch {
    return;
  }
}

scope.onmessage = ({ data }: MessageEvent<unknown>) => {
  if (!validRequest(data)) {
    const recognizable = recognizableInvalidRpc(data);
    if (recognizable) {
      reject(recognizable.id, {
        code:
          recognizable.type === "init"
            ? "init.invalid"
            : recognizable.type === "command"
              ? "command.invalid"
              : recognizable.type === "load"
                ? "layout.request.invalid"
                : recognizable.type === "save.data"
                  ? "save-data.request.invalid"
                  : recognizable.type === "state.set"
                    ? "state.request.invalid"
                    : recognizable.type === "composition.update"
                      ? "composition.request.invalid"
                      : recognizable.type === "resource.set"
                        ? "resource.request.invalid"
                        : "action.request.invalid",
        message: `Invalid ${recognizable.type} request`,
      });
      return;
    }
    fatal(new Error("Invalid worker protocol message"), "protocol.invalid");
    return;
  }
  try {
    if (data.type === "init") {
      if (application) {
        reject(data.id, { code: "init.duplicate", message: "Worker is already initialized" });
        return;
      }
      if (typeof OffscreenCanvas === "undefined") {
        fatal(new Error("OffscreenCanvas is unavailable in this worker"), "offscreen-canvas.missing");
        return;
      }
      if (typeof ImageBitmap === "undefined" || typeof ImageBitmap.prototype.close !== "function") {
        fatal(new Error("ImageBitmap.close is unavailable"), "image-bitmap.close.missing");
        return;
      }
      const compiled = createInitialFxNodeComposition(
          data.applicationId as string,
          data.applicationVersion as number,
          data.resources as never,
        ),
        runtime = bindFxNodeHeadless(compiled);
      const nextState = runtime.createEngine(runtime.emptyDocument(), data.historyLimit),
        nextStore = new IndexedLayoutStore(compiled, nextState.document);
      const nextCanvas = new OffscreenCanvas(1, 1),
        nextContext = nextCanvas.getContext("2d");
      if (!nextContext) throw new Error("OffscreenCanvas 2D unavailable");
      if (typeof nextCanvas.transferToImageBitmap !== "function") {
        fatal(new Error("OffscreenCanvas.transferToImageBitmap is unavailable"), "offscreen-canvas.transfer.missing");
        return;
      }
      application = { compiled, runtime };
      state = nextState;
      journal = checkpointJournal(runtime.save(nextState.document));
      layoutStore = nextStore;
      viewport = data.viewport;
      pointerLane = data.pointerLane;
      handledPointerFence = 0;
      hostGeneration = 0;
      compositionRevision = 0;
      canvas = nextCanvas;
      context = nextContext;
      publishSelection(true);
      post({ protocol: PROTOCOL_VERSION, type: "response", id: data.id, ok: true });
      scheduler.request(1);
      scheduler.start(pollPointerLane);
      return;
    }
    if (!state) {
      fatal(new Error("Worker is not initialized"));
      return;
    }
    if (data.type === "composition.update") {
      const result = stageCompositionUpdate(data);
      if (result.status === "rejected")
        post({ protocol: PROTOCOL_VERSION, type: "response", id: data.id, ok: false, error: result.error });
      else if (result.status === "noop")
        post({ protocol: PROTOCOL_VERSION, type: "response", id: data.id, ok: true, value: result.receipt });
      else publishCompositionUpdate(data.id, result.staged);
      return;
    }
    if (data.type === "command") {
      const cancelled = cancelGesture();
      publishSelection();
      if (cancelled) scheduler.request();
      const result = application!.runtime.transition(state, {
        commandId: commandId(data.id),
        expectedVersion: data.expected.kind === "current" ? state.version : data.expected.version,
        source: "api",
        command: data.command,
      });
      if (result.status === "rejected") reject(data.id, result.error);
      else {
        if (result.status === "committed") commit(result, data.command);
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: result.status, version: state.version },
        });
      }
      return;
    }
    if (data.type === "state.set") {
      const result = application!.runtime.replaceState(state, {
        commandId: commandId(data.id),
        expectedVersion: data.expected.kind === "current" ? state.version : data.expected.version,
        target: data.state as never,
      });
      if (result.status === "rejected") reject(data.id, result.error);
      else {
        if (result.status === "committed")
          installDocumentReplacement(result, checkpointJournal(application!.runtime.save(result.state.document)));
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: result.status, version: state.version },
        });
      }
      return;
    }
    if (data.type === "node.add") {
      applyPointerFence(data.pointerFence);
      const cancelled = cancelGesture();
      publishSelection();
      if (cancelled) scheduler.request();
      const command: Command = {
          type: "node.add",
          nodeId: nodeId(data.nodeId),
          nodeType: data.typeId,
          position: viewToWorld(data.viewPosition, currentTransform()),
        },
        result = application!.runtime.transition(state, {
          commandId: commandId(data.id),
          expectedVersion: data.expected.kind === "current" ? state.version : data.expected.version,
          source: "api",
          command,
        });
      if (result.status === "rejected") reject(data.id, result.error);
      else {
        if (result.status === "committed") commit(result, command);
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: result.status, version: state.version },
        });
      }
      return;
    }
    if (data.type === "selection.remove" || data.type === "selection.mute") {
      applyPointerFence(data.pointerFence);
      const cancelled = cancelGesture();
      publishSelection();
      if (cancelled) scheduler.request();
      const command =
        data.type === "selection.remove"
          ? planSelectionRemoval(state.document, session.selectedNodes, session.selectedLinks)
          : planSelectionMute(state.document, session.selectedNodes, isStandardNode, data.value);
      if (!command) {
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: "noop", version: state.version },
        });
        return;
      }
      const result = application!.runtime.transition(state, {
        commandId: commandId(data.id),
        expectedVersion: data.expected.kind === "current" ? state.version : data.expected.version,
        source: "api",
        command,
      });
      if (result.status === "rejected") reject(data.id, result.error);
      else {
        if (result.status === "committed") commit(result, command);
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: result.status, version: state.version },
        });
      }
      return;
    }
    if (data.type === "resource.set") {
      void setResource(data).catch((error) =>
        reject(data.id, {
          code: "resource.error",
          message: error instanceof Error ? error.message : "Unable to load image",
        }),
      );
      return;
    }
    if (data.type === "load") {
      const expected = data.expected.kind === "current" ? state.version : data.expected.version,
        isSaveData =
          typeof data.data === "object" &&
          data.data !== null &&
          (data.data as { kind?: unknown }).kind === "fxnode.command-log",
        result = isSaveData
          ? application!.runtime.replaySaveData(state, data.data, expected, commandId(data.id))
          : application!.runtime.load(state, data.data, expected, commandId(data.id));
      if (!result.ok)
        reject(data.id, {
          code: result.issues[0]?.code ?? "layout.invalid",
          message: result.issues[0]?.message ?? "Invalid layout",
          path: result.issues[0]?.path,
          issues: result.issues,
        });
      else if (isSaveData && "status" in result && result.status === "noop") {
        const cancelled = cancelGesture();
        state = result.state;
        journal = importJournal(result.saveData);
        publishSelection();
        if (cancelled) scheduler.request();
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: "noop", version: state.version },
        });
      } else {
        const committed = result as
          | Extract<BoundLoadResult, { ok: true }>
          | Extract<BoundReplayResult, { ok: true; status: "committed" }>;
        installDocumentReplacement(
          committed,
          "saveData" in committed
            ? importJournal(committed.saveData)
            : checkpointJournal(application!.runtime.save(committed.state.document)),
        );
        post({
          protocol: PROTOCOL_VERSION,
          type: "response",
          id: data.id,
          ok: true,
          value: { status: "committed", version: state.version },
        });
      }
      return;
    }
    if (data.type === "state.get") {
      post({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: data.id,
        ok: true,
        value: application!.runtime.getState(state),
      });
      return;
    }
    if (data.type === "save") {
      post({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: data.id,
        ok: true,
        value: application!.runtime.save(state.document),
      });
      return;
    }
    if (data.type === "save.data") {
      post({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: data.id,
        ok: true,
        value: journalSaveData(journal!, application!.compiled.source),
      });
      return;
    }
    if (data.type === "viewport") {
      applyPointerFence(data.pointerFence);
      adoptHostGeneration(data.hostGeneration);
      viewport = data.viewport;
      scheduler.request(data.renderId, DirtyReason.Viewport);
      return;
    }
    if (data.type === "frame.consumed") {
      scheduler.consumed(data.frameId);
      return;
    }
    if (data.type === "pointer.flush") {
      applyPointerFence(data.pointerFence);
      return;
    }
    if (data.type === "dispose") {
      scheduler.stop();
      closeResourceImages();
      scope.close();
      return;
    }
    if (data.type === "input") {
      applyPointerFence(data.pointerFence);
      adoptHostGeneration(data.hostGeneration);
      input(data.event, data.nodeMenuRequestId, data.resourceOpenRequestId);
    }
  } catch (error) {
    if ((data.type === "init" || data.type === "composition.update") && error instanceof FxNodeCompositionError) {
      reject(data.id, { code: "composition.invalid", message: error.message, issues: error.issues });
      return;
    }
    fatal(error);
  }
};
