import type { Command, FxNodeSaveData } from "../commands/types.js";
import type { GraphLayoutV2, GraphSnapshot } from "../core/types.js";
import type { BoundMutationEnvelope, BoundSnapshotEnvelope } from "../composition/bound-engine.js";
import { createInitialFxNodeComposition } from "../composition/compile.js";
import {
  validCommandReceipt,
  validCompositionReceipt,
  validWorkerMessage,
  PROTOCOL_VERSION,
  type CompositionChange,
  type CompositionChangeEnvelope,
  type CompositionReceipt,
  type CompositionRevisionExpectation,
  type CompositionUpdateWire,
  type InputEventWire,
  type PointerFence,
  type VersionExpectation,
  type WorkerRequest,
} from "./protocol.js";
import {
  advancePointerLaneFence,
  createPointerLane,
  pointerLaneFence,
  publishPointerMove,
  supportsPointerLane,
  type PointerLaneSnapshot,
  type PointerMoveWire,
} from "./pointer-lane.js";
import type {
  FxNodeCompositionData,
  NodeTypeId,
  FxNodeDefinition,
  FxNodeSocketTypeDefinition,
  FxNodeStyleDefinition,
  FxNodeTheme,
} from "../composition/types.js";
import type { NodeReferenceCheck, ReferenceCheck } from "../composition/references.js";
import defaultWorkerUrl from "../worker/fxnode.worker.ts?worker&url";
import type {
  AddNodeParams,
  FxNodeActionOptions,
  FxNodeHostRequest,
  FxNodeHostSnapshot,
  FxNodeInput,
  FxNodeResourceAuthorization,
  FxNodeResourceData,
  FxNodeSelectionSnapshot,
  FxNodeViewport,
} from "./host-types.js";
import {
  decodeFxNodeActionOptions,
  decodeFxNodeAddNodeParams,
  decodeFxNodeInput,
  decodeFxNodeResourceAuthorization,
  decodeFxNodeResourceData,
  decodeFxNodeViewport,
} from "./host-decode.js";

export interface FxNodeIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}
export class FxNodeCapabilityError extends Error {
  override name = "FxNodeCapabilityError";
  constructor(
    message: string,
    readonly code = "capability.unavailable",
  ) {
    super(message);
  }
}
export class FxNodeProtocolError extends Error {
  override name = "FxNodeProtocolError";
}
export class FxNodeWorkerError extends Error {
  override name = "FxNodeWorkerError";
  constructor(
    message: string,
    readonly code = "worker.error",
    readonly issues?: readonly FxNodeIssue[],
    readonly path?: string,
  ) {
    super(message);
  }
}
export class FxNodeDestroyedError extends Error {
  override name = "FxNodeDestroyedError";
  constructor() {
    super("FxNode has been destroyed");
  }
}

export type CommandIntent =
  | Exclude<Command, { type: "node.add" }>
  | (Omit<Extract<Command, { type: "node.add" }>, "nodeId"> & {
      nodeId?: Extract<Command, { type: "node.add" }>["nodeId"];
    })
  | (Omit<Extract<Command, { type: "link.add" }>, "link"> & {
      link: Omit<Extract<Command, { type: "link.add" }>["link"], "id"> & {
        id?: Extract<Command, { type: "link.add" }>["link"]["id"];
      };
    });
export interface FxNode {
  feedInput: (input: FxNodeInput) => void;
  setViewport: (viewport: FxNodeViewport) => void;
  getHostSnapshot: () => FxNodeHostSnapshot;
  subscribeHost: (callback: () => void) => () => void;
  addNode(params: AddNodeParams, options?: FxNodeActionOptions): Promise<CommandReceipt>;
  removeSelected(options?: FxNodeActionOptions): Promise<CommandReceipt>;
  setSelectedMuted(value: boolean, options?: FxNodeActionOptions): Promise<CommandReceipt>;
  onHostRequests(callback: (request: FxNodeHostRequest) => void): () => void;
  provideResource(
    authorization: FxNodeResourceAuthorization,
    data: FxNodeResourceData,
    options?: FxNodeActionOptions,
  ): Promise<CommandReceipt>;
  dispatch(intent: CommandIntent, options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  undo(options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  redo(options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  save(): Promise<GraphLayoutV2>;
  getSaveData(): Promise<FxNodeSaveData<FxNodeCompositionData>>;
  load(data: unknown, options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  getState(): Promise<GraphSnapshot<FxNodeCompositionData>>;
  setState(state: unknown, options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  onMutations(callback: (event: BoundMutationEnvelope<FxNodeCompositionData>) => void): () => void;
  onSnapshots(callback: (event: BoundSnapshotEnvelope<FxNodeCompositionData>) => void): () => void;
  setTheme(theme: FxNodeTheme, options?: CompositionUpdateOptions): Promise<CompositionReceipt>;
  setHeaderStyles(
    styles: Readonly<Record<string, FxNodeStyleDefinition>>,
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt>;
  setCompatibility(
    compatibility: FxNodeCompositionData["compatibility"],
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt>;
  composeSocket(
    id: string,
    definition: FxNodeSocketTypeDefinition,
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt>;
  removeSocket(id: string, options?: CompositionUpdateOptions): Promise<CompositionReceipt>;
  composeNode<const D extends FxNodeDefinition>(
    id: string,
    definition: D & NodeReferenceCheck<FxNodeCompositionData, D>,
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt>;
  removeNode(id: string, options?: CompositionUpdateOptions): Promise<CompositionReceipt>;
  loadComposition<const C extends FxNodeCompositionData>(
    composition: C & ReferenceCheck<C>,
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt>;
  onCompositionChanges(callback: (event: CompositionChangeEnvelope) => void): () => void;
  copyTo(canvas: HTMLCanvasElement): Promise<void>;
  addMirror(canvas: HTMLCanvasElement): void;
  removeMirror(canvas: HTMLCanvasElement): void;
  whenRendered(): Promise<void>;
  destroy(): void;
}
export interface CreateFxNodeOptions {
  canvas: HTMLCanvasElement;
  viewport: FxNodeViewport;
  applicationId: string;
  applicationVersion: number;
  resources: FxNodeCompositionData["resources"];
  historyLimit?: number;
  workerUrl?: string | URL;
}
export interface CommandReceipt {
  status: "committed" | "noop";
  version: number;
}
export interface CompositionUpdateOptions {
  readonly expectedRevision?: number;
}
export type { CompositionChange, CompositionChangeEnvelope, CompositionReceipt } from "./protocol.js";

type Pending = {
  requestType: RpcRequest["type"];
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
type Barrier = { resolve: () => void; reject: (reason: unknown) => void };
type RpcRequest = WorkerRequest extends infer R
  ? R extends { id: string }
    ? Omit<R, "id" | "protocol">
    : never
  : never;
const STARTUP_TIMEOUT_MS = 5_000;
const emptySelection = (): FxNodeSelectionSnapshot =>
  Object.freeze({ nodeCount: 0, linkCount: 0, canRemove: false, mute: Object.freeze({ enabled: false as const }) });

class FxNodeClient implements FxNode {
  private terminalError: Error | undefined;
  private renderId = 1;
  private hostGeneration = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly barriers = new Map<number, Barrier[]>();
  private readonly copies = new Map<number, Set<HTMLCanvasElement>>();
  private readonly mirrors = new Set<HTMLCanvasElement>();
  private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  private readonly mutations = new Set<(event: BoundMutationEnvelope<FxNodeCompositionData>) => void>();
  private readonly snapshots = new Set<(event: BoundSnapshotEnvelope<FxNodeCompositionData>) => void>();
  private readonly compositionChanges = new Set<(event: CompositionChangeEnvelope) => void>();
  private readonly unclaimedCompositionEvents = new Map<number, CompositionChangeEnvelope>();
  private compositionRevision: number | undefined;
  private latestPointerMove: PointerLaneSnapshot | undefined;
  private knifePointerId: number | undefined;
  private lanePointerId: number | undefined;
  private pendingNodeMenuRequestId: string | undefined;
  private pendingResourceOpenRequestId: string | undefined;
  private selection: FxNodeSelectionSnapshot = emptySelection();
  private initialSelectionReceived = false;
  private hostSnapshot: FxNodeHostSnapshot = Object.freeze({
    compositionRevision: 0,
    colorPickerOpen: false,
    selection: this.selection,
  });
  private readonly hostSubscribers = new Set<() => void>();
  private readonly hostRequests = new Set<(request: FxNodeHostRequest) => void>();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worker: Worker,
    private explicitViewport: FxNodeViewport,
    private readonly pointerLane?: SharedArrayBuffer,
  ) {
    worker.onmessage = this.onMessage;
    worker.onerror = () =>
      this.shutdown(
        new FxNodeCapabilityError(
          "The FxNode module worker failed to load. Check workerUrl, CSP worker-src, URL accessibility, and JavaScript MIME type.",
          "worker.load",
        ),
      );
    worker.onmessageerror = () =>
      this.shutdown(new FxNodeProtocolError("The FxNode worker sent an uncloneable message"));
  }

  async initialize(
    applicationId: string,
    applicationVersion: number,
    resources: FxNodeCompositionData["resources"],
    historyLimit: number,
  ): Promise<void> {
    const timeout = setTimeout(
      () =>
        this.shutdown(
          new FxNodeCapabilityError(
            "FxNode worker startup timed out. Check workerUrl, CSP worker-src, URL accessibility, and JavaScript MIME type.",
            "worker.timeout",
          ),
        ),
      STARTUP_TIMEOUT_MS,
    );
    try {
      await this.post({
        type: "init",
        applicationId,
        applicationVersion,
        resources,
        historyLimit,
        viewport: this.explicitViewport,
        ...(this.pointerLane ? { pointerLane: this.pointerLane } : {}),
      });
      if (this.compositionRevision !== 0 || !this.initialSelectionReceived)
        this.protocolFailure("FxNode worker did not publish its initial host state");
    } finally {
      clearTimeout(timeout);
    }
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const recognizableBitmap = this.bitmapFrom(event.data);
    try {
      if (!validWorkerMessage(event.data)) {
        this.shutdown(new FxNodeProtocolError("Invalid message from FxNode worker"));
        return;
      }
      const data = event.data;
      if (data.type === "response") {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        if (pending.requestType === "init" && data.ok && Object.hasOwn(data, "value")) {
          this.shutdown(new FxNodeProtocolError("FxNode worker returned state in the init response"));
          return;
        }
        this.pending.delete(data.id);
        if (data.ok) {
          if (pending.requestType === "init") this.compositionRevision = 0;
          pending.resolve(Object.hasOwn(data, "value") ? structuredClone(data.value) : undefined);
        } else
          pending.reject(
            new FxNodeWorkerError(
              data.error.message,
              data.error.code,
              data.error.issues as readonly FxNodeIssue[] | undefined,
              data.error.path,
            ),
          );
      } else if (data.type === "composition.event") {
        const envelope = data.envelope;
        if (
          this.compositionRevision === undefined ||
          envelope.baseRevision !== this.compositionRevision ||
          envelope.revision !== this.compositionRevision + 1 ||
          this.unclaimedCompositionEvents.has(envelope.revision)
        ) {
          this.shutdown(new FxNodeProtocolError("FxNode worker published an invalid composition revision sequence"));
          return;
        }
        this.compositionRevision = envelope.revision;
        this.clearDocumentDependentHostState(envelope.revision);
        this.unclaimedCompositionEvents.set(envelope.revision, envelope);
        this.notify(this.compositionChanges, envelope);
      } else if (data.type === "mutation") {
        this.clearDocumentDependentHostState();
        this.notify(this.mutations, data.envelope);
      } else if (data.type === "snapshot.event") this.notify(this.snapshots, data.envelope);
      else if (data.type === "selection.host") this.consumeSelection(data.projection);
      else if (data.type === "node-menu.result") {
        if (data.requestId !== this.pendingNodeMenuRequestId) return;
        this.pendingNodeMenuRequestId = undefined;
        if (data.open) {
          if (data.compositionRevision !== this.compositionRevision)
            return this.protocolFailure("FxNode worker returned a stale node-menu result");
          const request = Object.freeze({
            kind: "add-node-menu" as const,
            viewPosition: Object.freeze({ ...data.viewPosition }),
            compositionRevision: data.compositionRevision,
          });
          this.notify(this.hostRequests, request);
        }
      } else if (data.type === "resource.open") {
        if (data.requestId !== this.pendingResourceOpenRequestId) return;
        this.pendingResourceOpenRequestId = undefined;
        if (data.authorization.compositionRevision !== this.compositionRevision)
          return this.protocolFailure("FxNode worker returned a stale resource request");
        const request = Object.freeze({
          kind: "resource-open" as const,
          authorization: Object.freeze({ ...data.authorization }),
          resource: Object.freeze({ ...data.resource, accept: Object.freeze([...data.resource.accept]) }),
        });
        this.notify(this.hostRequests, request);
      } else if (data.type === "fatal") this.shutdown(new FxNodeWorkerError(data.error.message, data.error.code));
      else this.consumeFrame(data);
    } finally {
      recognizableBitmap?.close();
    }
  };

  private bitmapFrom(data: unknown): ImageBitmap | undefined {
    if (typeof ImageBitmap === "undefined" || typeof data !== "object" || data === null) return undefined;
    const bitmap = (data as { bitmap?: unknown }).bitmap;
    return bitmap instanceof ImageBitmap ? bitmap : undefined;
  }
  private notify<T>(callbacks: ReadonlySet<(event: T) => void>, event: T): void {
    for (const callback of callbacks)
      try {
        callback(event);
      } catch (error) {
        console.error("FxNode subscriber failed", error);
      }
  }
  private publishHost(compositionRevision: number, colorPickerOpen: boolean): void {
    this.hostSnapshot = Object.freeze({
      compositionRevision,
      colorPickerOpen,
      selection: this.selection,
    });
    this.notify(this.hostSubscribers, undefined);
  }
  private consumeSelection(value: FxNodeSelectionSnapshot): void {
    const next = Object.freeze({ ...value, mute: Object.freeze({ ...value.mute }) });
    this.initialSelectionReceived = true;
    if (JSON.stringify(next) === JSON.stringify(this.selection)) return;
    this.selection = next;
    this.publishHost(this.hostSnapshot.compositionRevision, this.hostSnapshot.colorPickerOpen);
  }
  private clearDocumentDependentHostState(compositionRevision = this.hostSnapshot.compositionRevision): void {
    this.invalidateHostInteractions();
    this.pendingNodeMenuRequestId = undefined;
    this.pendingResourceOpenRequestId = undefined;
    this.publishHost(compositionRevision, false);
  }
  private invalidateHostInteractions(): number {
    if (this.hostGeneration === Number.MAX_SAFE_INTEGER)
      return this.protocolFailure("FxNode host generation exhausted");
    this.hostGeneration++;
    return this.hostGeneration;
  }
  private consumeFrame(data: Extract<import("./protocol.js").WorkerMessage, { type: "frame" }>): void {
    let primaryError: unknown;
    try {
      this.draw(this.canvas, data.bitmap);
    } catch (error) {
      primaryError = error;
    }
    for (const mirror of [...this.mirrors])
      try {
        this.draw(mirror, data.bitmap);
      } catch {
        this.mirrors.delete(mirror);
      }
    for (const [id, targets] of [...this.copies])
      if (id <= data.renderId) {
        for (const target of targets)
          try {
            this.draw(target, data.bitmap);
          } catch (error) {
            this.rejectBarrier(id, error);
          }
        this.copies.delete(id);
      }
    if (data.hostGeneration > this.hostGeneration)
      return this.protocolFailure("FxNode worker published a future host generation");
    if (data.hostGeneration === this.hostGeneration && this.hostSnapshot.colorPickerOpen !== data.host.colorPickerOpen)
      this.publishHost(this.hostSnapshot.compositionRevision, data.host.colorPickerOpen);
    this.safePost({ protocol: PROTOCOL_VERSION, type: "frame.consumed", frameId: data.frameId });
    for (const [id, list] of [...this.barriers])
      if (id <= data.renderId) {
        for (const item of list) primaryError ? item.reject(primaryError) : item.resolve();
        this.barriers.delete(id);
      }
  }
  private draw(target: HTMLCanvasElement, bitmap: ImageBitmap): void {
    const context = this.contexts.get(target) ?? target.getContext("2d");
    if (!context) throw new FxNodeCapabilityError("Canvas 2D context is unavailable", "canvas.2d");
    this.contexts.set(target, context);
    context.drawImage(bitmap, 0, 0, target.width, target.height);
  }
  private rejectBarrier(id: number, error: unknown): void {
    for (const item of this.barriers.get(id) ?? []) item.reject(error);
    this.barriers.delete(id);
  }
  private safePost(message: WorkerRequest, transfer: Transferable[] = []): boolean {
    try {
      this.worker.postMessage(message, transfer);
      return true;
    } catch {
      return false;
    }
  }
  private requiredPost(message: WorkerRequest): boolean {
    if (this.safePost(message)) return true;
    this.shutdown(new FxNodeProtocolError("Unable to send a message to the FxNode worker"));
    return false;
  }
  private post<T>(message: RpcRequest, transfer: Transferable[] = [], onPosted?: () => void): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (
      (message.type === "command" ||
        message.type === "load" ||
        message.type === "state.set" ||
        message.type === "composition.update") &&
      !this.flushPointerLane()
    )
      return Promise.reject(this.terminalError!);
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { requestType: message.type, resolve: (value) => resolve(value as T), reject });
      try {
        this.worker.postMessage({ protocol: PROTOCOL_VERSION, id, ...message }, transfer);
        onPosted?.();
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private expected(version?: number): VersionExpectation {
    return version === undefined ? { kind: "current" } : { kind: "exact", version };
  }
  private compositionExpected(revision?: number): CompositionRevisionExpectation {
    return revision === undefined ? { kind: "current" } : { kind: "exact", revision };
  }
  private compositionChange(update: CompositionUpdateWire): CompositionChange {
    return update.kind === "theme.set" ||
      update.kind === "header-styles.set" ||
      update.kind === "composition.load" ||
      update.kind === "compatibility.set"
      ? { kind: update.kind }
      : { kind: update.kind, id: update.id };
  }
  private sameCompositionChange(left: CompositionChange, right: CompositionChange): boolean {
    return (
      left.kind === right.kind &&
      (left.kind === "theme.set" ||
        left.kind === "header-styles.set" ||
        left.kind === "composition.load" ||
        left.kind === "compatibility.set" ||
        (right.kind !== "theme.set" &&
          right.kind !== "header-styles.set" &&
          right.kind !== "composition.load" &&
          right.kind !== "compatibility.set" &&
          left.id === right.id))
    );
  }
  private protocolFailure(message: string): never {
    const error = new FxNodeProtocolError(message);
    this.shutdown(error);
    throw error;
  }
  private async updateComposition(
    update: CompositionUpdateWire,
    options?: CompositionUpdateOptions,
  ): Promise<CompositionReceipt> {
    const receipt = await this.post<unknown>({
      type: "composition.update",
      expected: this.compositionExpected(options?.expectedRevision),
      update,
    });
    if (!validCompositionReceipt(receipt))
      return this.protocolFailure("FxNode worker returned an invalid composition receipt");
    if (receipt.revision !== this.compositionRevision)
      return this.protocolFailure("FxNode composition receipt does not match the published revision");
    if (options?.expectedRevision !== undefined) {
      const expected = receipt.status === "committed" ? options.expectedRevision + 1 : options.expectedRevision;
      if (receipt.revision !== expected)
        return this.protocolFailure("FxNode composition receipt violates its revision expectation");
    }
    if (receipt.status === "committed") {
      const envelope = this.unclaimedCompositionEvents.get(receipt.revision);
      if (
        !envelope ||
        !this.sameCompositionChange(envelope.change, this.compositionChange(update)) ||
        envelope.graphVersion !== receipt.graphVersion ||
        envelope.graphChanged !== receipt.graphChanged ||
        !envelope.historyReset
      )
        return this.protocolFailure("FxNode composition receipt does not match its composition event");
      this.unclaimedCompositionEvents.delete(receipt.revision);
    }
    return receipt;
  }
  private renderBarrier(target?: HTMLCanvasElement): Promise<void> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = this.renderId + 1,
      pointerFence = this.nextPointerFence();
    if (
      !this.requiredPost({
        protocol: PROTOCOL_VERSION,
        type: "viewport",
        viewport: this.explicitViewport,
        renderId: id,
        hostGeneration: this.hostGeneration,
        ...(pointerFence ? { pointerFence } : {}),
      })
    )
      return Promise.reject(this.terminalError!);
    if (pointerFence) advancePointerLaneFence(this.pointerLane!);
    this.renderId = id;
    if (target) this.copies.set(id, new Set([target]));
    return new Promise((resolve, reject) =>
      this.barriers.set(id, [...(this.barriers.get(id) ?? []), { resolve, reject }]),
    );
  }
  private nextPointerFence(): PointerFence | undefined {
    if (!this.pointerLane) return undefined;
    const generation = (pointerLaneFence(this.pointerLane) + 1) | 0;
    return this.latestPointerMove ? { generation, before: this.latestPointerMove } : { generation };
  }
  private flushPointerLane(): boolean {
    const pointerFence = this.nextPointerFence();
    if (!pointerFence) return true;
    const sent = this.requiredPost({ protocol: PROTOCOL_VERSION, type: "pointer.flush", pointerFence });
    if (sent) advancePointerLaneFence(this.pointerLane!);
    return sent;
  }
  private sendInput(event: InputEventWire, nodeMenuRequestId?: string, resourceOpenRequestId?: string): void {
    const pointerFence = this.nextPointerFence();
    const sent = this.requiredPost({
      protocol: PROTOCOL_VERSION,
      type: "input",
      event,
      hostGeneration: this.hostGeneration,
      ...(pointerFence ? { pointerFence } : {}),
      ...(nodeMenuRequestId ? { nodeMenuRequestId } : {}),
      ...(resourceOpenRequestId ? { resourceOpenRequestId } : {}),
    });
    if (!sent) throw this.terminalError!;
    if (pointerFence) advancePointerLaneFence(this.pointerLane!);
  }

  readonly feedInput = (input: FxNodeInput): void => {
    if (this.terminalError) throw this.terminalError;
    const wire = decodeFxNodeInput(input);
    const invalidates = wire.kind !== "pointer" || wire.phase !== "move" || wire.buttons !== 0;
    if (invalidates) this.invalidateHostInteractions();
    if (
      wire.kind === "pointer" &&
      wire.phase === "move" &&
      this.pointerLane &&
      this.knifePointerId !== wire.pointerId &&
      (this.lanePointerId === undefined || this.lanePointerId === wire.pointerId)
    ) {
      const sequence = publishPointerMove(this.pointerLane, wire as PointerMoveWire, this.hostGeneration);
      if (sequence !== undefined) {
        this.latestPointerMove = { sequence, hostGeneration: this.hostGeneration, event: wire as PointerMoveWire };
        return;
      }
    }
    const nodeMenuRequestId =
      wire.kind === "pointer" &&
      wire.phase === "down" &&
      wire.button === 2 &&
      (wire.modifiers & 2) === 0 &&
      (wire.buttons & 1) === 0
        ? crypto.randomUUID()
        : undefined;
    const resourceOpenRequestId =
      wire.kind === "pointer" && wire.phase === "down" && wire.button === 0 ? crypto.randomUUID() : undefined;
    this.sendInput(wire, nodeMenuRequestId, resourceOpenRequestId);
    if ((wire.kind === "pointer" && wire.phase === "down") || wire.kind === "wheel" || wire.kind === "key") {
      this.pendingNodeMenuRequestId = undefined;
      this.pendingResourceOpenRequestId = undefined;
    }
    if (nodeMenuRequestId) this.pendingNodeMenuRequestId = nodeMenuRequestId;
    if (resourceOpenRequestId) this.pendingResourceOpenRequestId = resourceOpenRequestId;
    if (wire.kind === "pointer" && wire.phase === "down" && this.lanePointerId === undefined)
      this.lanePointerId = wire.pointerId;
    if (wire.kind === "pointer" && wire.phase === "down" && wire.button === 2 && (wire.modifiers & 2) !== 0)
      this.knifePointerId = wire.pointerId;
    if (wire.kind === "pointer" && (wire.phase === "up" || wire.phase === "cancel")) {
      if (this.knifePointerId === wire.pointerId) this.knifePointerId = undefined;
      if (this.lanePointerId === wire.pointerId) this.lanePointerId = undefined;
    }
  };
  readonly setViewport = (viewport: FxNodeViewport): void => {
    if (this.terminalError) throw this.terminalError;
    const decoded = decodeFxNodeViewport(viewport);
    const hostGeneration = this.invalidateHostInteractions(),
      renderId = this.renderId + 1,
      pointerFence = this.nextPointerFence();
    if (
      !this.requiredPost({
        protocol: PROTOCOL_VERSION,
        type: "viewport",
        viewport: decoded,
        renderId,
        hostGeneration,
        ...(pointerFence ? { pointerFence } : {}),
      })
    )
      throw this.terminalError!;
    if (pointerFence) advancePointerLaneFence(this.pointerLane!);
    this.explicitViewport = decoded;
    this.renderId = renderId;
    this.pendingNodeMenuRequestId = undefined;
    this.pendingResourceOpenRequestId = undefined;
  };
  readonly getHostSnapshot = (): FxNodeHostSnapshot => this.hostSnapshot;
  readonly subscribeHost = (callback: () => void): (() => void) => {
    if (this.terminalError) throw this.terminalError;
    if (typeof callback !== "function") throw new TypeError("Host subscriber must be a function");
    this.hostSubscribers.add(callback);
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.hostSubscribers.delete(callback);
      }
    };
  };
  readonly onHostRequests = (callback: (request: FxNodeHostRequest) => void): (() => void) => {
    if (this.terminalError) throw this.terminalError;
    if (typeof callback !== "function") throw new TypeError("Host request subscriber must be a function");
    this.hostRequests.add(callback);
    return () => this.hostRequests.delete(callback);
  };

  private commandReceipt(value: unknown, expected: VersionExpectation): CommandReceipt {
    if (!validCommandReceipt(value)) return this.protocolFailure("FxNode worker returned an invalid command receipt");
    if (
      expected.kind === "exact" &&
      value.version !== (value.status === "committed" ? expected.version + 1 : expected.version)
    )
      return this.protocolFailure("FxNode worker returned an incoherent command receipt");
    return value;
  }
  private async postCommand(request: RpcRequest, expected: VersionExpectation): Promise<CommandReceipt> {
    return this.commandReceipt(await this.post<unknown>(request), expected);
  }
  private async postFencedAction(
    request: RpcRequest,
    expected: VersionExpectation,
    fenced: boolean,
    transfer: Transferable[] = [],
  ): Promise<CommandReceipt> {
    let receipt: unknown;
    try {
      receipt = await this.post<unknown>(
        request,
        transfer,
        fenced && this.pointerLane ? () => advancePointerLaneFence(this.pointerLane!) : undefined,
      );
    } catch (error) {
      if (error instanceof FxNodeWorkerError) throw error;
      if (!this.terminalError) this.shutdown(new FxNodeProtocolError("Unable to send an action to the FxNode worker"));
      throw this.terminalError!;
    }
    return this.commandReceipt(receipt, expected);
  }
  addNode(params: AddNodeParams, options?: FxNodeActionOptions): Promise<CommandReceipt> {
    const decoded = decodeFxNodeAddNodeParams(params),
      expected = decodeFxNodeActionOptions(options),
      pointerFence = this.nextPointerFence();
    return this.postFencedAction(
      {
        type: "node.add",
        nodeId: decoded.nodeId ?? crypto.randomUUID(),
        typeId: decoded.typeId,
        viewPosition: decoded.viewPosition,
        expected,
        ...(pointerFence ? { pointerFence } : {}),
      },
      expected,
      !!pointerFence,
    );
  }
  removeSelected(options?: FxNodeActionOptions): Promise<CommandReceipt> {
    const expected = decodeFxNodeActionOptions(options),
      pointerFence = this.nextPointerFence();
    return this.postFencedAction(
      { type: "selection.remove", expected, ...(pointerFence ? { pointerFence } : {}) },
      expected,
      !!pointerFence,
    );
  }
  setSelectedMuted(value: boolean, options?: FxNodeActionOptions): Promise<CommandReceipt> {
    if (typeof value !== "boolean") throw new TypeError("Muted state must be boolean");
    const expected = decodeFxNodeActionOptions(options),
      pointerFence = this.nextPointerFence();
    return this.postFencedAction(
      { type: "selection.mute", value, expected, ...(pointerFence ? { pointerFence } : {}) },
      expected,
      !!pointerFence,
    );
  }
  provideResource(
    authorization: FxNodeResourceAuthorization,
    data: FxNodeResourceData,
    options?: FxNodeActionOptions,
  ): Promise<CommandReceipt> {
    const auth = decodeFxNodeResourceAuthorization(authorization),
      resource = decodeFxNodeResourceData(data),
      expected = decodeFxNodeActionOptions(options),
      pointerFence = this.nextPointerFence();
    return this.postFencedAction(
      { type: "resource.set", authorization: auth, resource, expected, ...(pointerFence ? { pointerFence } : {}) },
      expected,
      !!pointerFence,
      [resource.bytes],
    );
  }

  dispatch(intent: CommandIntent, options?: { expectedVersion?: number }): Promise<CommandReceipt> {
    let command = intent as Command;
    if (intent.type === "node.add" && !intent.nodeId)
      command = { ...intent, nodeId: crypto.randomUUID() } as unknown as Command;
    if (intent.type === "link.add" && !intent.link.id)
      command = { ...intent, link: { ...intent.link, id: crypto.randomUUID() } } as Command;
    const expected = this.expected(options?.expectedVersion);
    return this.postCommand({ type: "command", command, expected }, expected);
  }
  undo(options?: { expectedVersion?: number }) {
    return this.dispatch({ type: "undo" }, options);
  }
  redo(options?: { expectedVersion?: number }) {
    return this.dispatch({ type: "redo" }, options);
  }
  save() {
    return this.post<GraphLayoutV2>({ type: "save" });
  }
  getSaveData() {
    return this.post<FxNodeSaveData<FxNodeCompositionData>>({ type: "save.data" });
  }
  load(layout: unknown, options?: { expectedVersion?: number }) {
    const expected = this.expected(options?.expectedVersion);
    return this.postCommand({ type: "load", data: layout, expected }, expected);
  }
  getState() {
    return this.post<GraphSnapshot<FxNodeCompositionData>>({ type: "state.get" });
  }
  setState(state: unknown, options?: { expectedVersion?: number }) {
    const expected = this.expected(options?.expectedVersion);
    return this.postCommand({ type: "state.set", state, expected }, expected);
  }
  onMutations(callback: (event: BoundMutationEnvelope<FxNodeCompositionData>) => void) {
    if (this.terminalError) throw this.terminalError;
    this.mutations.add(callback);
    return () => this.mutations.delete(callback);
  }
  onSnapshots(callback: (event: BoundSnapshotEnvelope<FxNodeCompositionData>) => void) {
    if (this.terminalError) throw this.terminalError;
    this.snapshots.add(callback);
    return () => this.snapshots.delete(callback);
  }
  setTheme(theme: FxNodeTheme, options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "theme.set", theme }, options);
  }
  setHeaderStyles(styles: Readonly<Record<string, FxNodeStyleDefinition>>, options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "header-styles.set", styles }, options);
  }
  setCompatibility(compatibility: FxNodeCompositionData["compatibility"], options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "compatibility.set", compatibility }, options);
  }
  composeSocket(id: string, definition: FxNodeSocketTypeDefinition, options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "socket.compose", id, definition }, options);
  }
  removeSocket(id: string, options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "socket.remove", id }, options);
  }
  composeNode<const D extends FxNodeDefinition>(
    id: string,
    definition: D & NodeReferenceCheck<FxNodeCompositionData, D>,
    options?: CompositionUpdateOptions,
  ) {
    return this.updateComposition({ kind: "node.compose", id, definition }, options);
  }
  removeNode(id: string, options?: CompositionUpdateOptions) {
    return this.updateComposition({ kind: "node.remove", id }, options);
  }
  loadComposition<const T extends FxNodeCompositionData>(
    composition: T & ReferenceCheck<T>,
    options?: CompositionUpdateOptions,
  ) {
    return this.updateComposition({ kind: "composition.load", composition }, options);
  }
  onCompositionChanges(callback: (event: CompositionChangeEnvelope) => void) {
    if (this.terminalError) throw this.terminalError;
    this.compositionChanges.add(callback);
    return () => this.compositionChanges.delete(callback);
  }
  copyTo(canvas: HTMLCanvasElement) {
    return this.renderBarrier(canvas);
  }
  addMirror(canvas: HTMLCanvasElement) {
    if (this.terminalError) throw this.terminalError;
    this.mirrors.add(canvas);
    void this.renderBarrier().catch(() => this.mirrors.delete(canvas));
  }
  removeMirror(canvas: HTMLCanvasElement) {
    this.mirrors.delete(canvas);
  }
  whenRendered() {
    return this.renderBarrier();
  }
  destroy() {
    this.shutdown(new FxNodeDestroyedError());
  }
  private shutdown(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.pendingNodeMenuRequestId = undefined;
    this.pendingResourceOpenRequestId = undefined;
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
    for (const list of this.barriers.values()) for (const item of list) item.reject(error);
    this.barriers.clear();
    this.safePost({ protocol: PROTOCOL_VERSION, type: "dispose" });
    this.worker.terminate();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.mutations.clear();
    this.snapshots.clear();
    this.compositionChanges.clear();
    this.hostSubscribers.clear();
    this.hostRequests.clear();
    this.unclaimedCompositionEvents.clear();
    this.mirrors.clear();
    this.copies.clear();
  }
}

export async function createFxNode({
  canvas,
  viewport,
  applicationId,
  applicationVersion,
  resources,
  historyLimit = 100,
  workerUrl,
}: CreateFxNodeOptions): Promise<FxNode> {
  const initialViewport = decodeFxNodeViewport(viewport);
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 1000)
    throw new RangeError("historyLimit must be an integer from 0 to 1000");
  if (typeof Worker === "undefined")
    throw new FxNodeCapabilityError("FxNode requires module Worker support", "worker.missing");
  if (typeof crypto?.randomUUID !== "function")
    throw new FxNodeCapabilityError("FxNode requires crypto.randomUUID", "crypto.random-uuid.missing");
  if (!canvas.getContext("2d")) throw new FxNodeCapabilityError("FxNode requires Canvas 2D", "canvas.2d");
  const bootstrap = createInitialFxNodeComposition(applicationId, applicationVersion, resources).source;
  const url =
    workerUrl === undefined
      ? new URL(defaultWorkerUrl, import.meta.url)
      : workerUrl instanceof URL
        ? workerUrl
        : new URL(workerUrl, import.meta.url);
  const pointerLane = supportsPointerLane() ? createPointerLane() : undefined;
  let worker: Worker;
  try {
    worker = new Worker(url, { type: "module" });
  } catch {
    throw new FxNodeCapabilityError(
      "Unable to construct the FxNode module worker. Check workerUrl and CSP worker-src.",
      "worker.construct",
    );
  }
  const client = new FxNodeClient(canvas, worker, initialViewport, pointerLane);
  try {
    await client.initialize(bootstrap.id, bootstrap.version, bootstrap.resources, historyLimit);
    return client;
  } catch (error) {
    client.destroy();
    throw error;
  }
}
