import type { FxNode, FxNodeModifiers, FxNodeResourceOpenRequest, FxNodeViewport } from "@lib/index.js";
import { createAddNodeMenu, type AddNodeMenu } from "./add-node-menu.js";

export interface FxNodeBrowserHostOptions {
  readonly canvas: HTMLCanvasElement;
  readonly addNodeMenuTemplate?: HTMLTemplateElement;
  readonly activateResourcePicker?: (request: FxNodeResourceOpenRequest) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface PreparedFxNodeBrowserHost {
  readonly initialViewport: FxNodeViewport;
  attach(api: FxNode): void;
  syncViewport(): void;
  destroy(): void;
}

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "mousedown",
  "wheel",
  "keydown",
  "keyup",
  "focus",
  "blur",
] as const;
const activeHosts = new WeakMap<HTMLCanvasElement, PreparedFxNodeBrowserHost>();

function measureViewport(canvas: HTMLCanvasElement): FxNodeViewport {
  const width = Math.min(8192, Math.max(1, canvas.clientWidth));
  const height = Math.min(8192, Math.floor(16_777_216 / width), Math.max(1, canvas.clientHeight));
  const dpr = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
  return { width, height, dpr };
}

function sameViewport(left: FxNodeViewport, right: FxNodeViewport): boolean {
  return left.width === right.width && left.height === right.height && left.dpr === right.dpr;
}
function sizeCanvas(canvas: HTMLCanvasElement, viewport: FxNodeViewport): void {
  const width = Math.max(1, Math.round(viewport.width * viewport.dpr)),
    height = Math.max(1, Math.round(viewport.height * viewport.dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}
function modifiers(event: MouseEvent | KeyboardEvent): FxNodeModifiers {
  return { alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey };
}
export function prepareFxNodeBrowserHost({
  canvas,
  addNodeMenuTemplate,
  activateResourcePicker,
  onError = console.error,
}: FxNodeBrowserHostOptions): PreparedFxNodeBrowserHost {
  if (activeHosts.has(canvas)) throw new Error("Canvas already has an active FxNode browser host");
  const originalTabIndex = canvas.getAttribute("tabindex"),
    originalTouchAction = canvas.style.touchAction;
  let viewport = measureViewport(canvas);
  sizeCanvas(canvas, viewport);
  let api: FxNode | undefined,
    active = true,
    attached = false,
    authorization: { request: FxNodeResourceOpenRequest; generation: number } | undefined,
    observer: ResizeObserver | undefined;
  let changedTabIndex = false,
    appliedTabIndex: string | null = null,
    changedTouchAction = false,
    pickerGeneration = 0,
    menuPending = false;
  const capturedPointers = new Set<number>(),
    subscriptions = new Set<() => void>();
  let menu: AddNodeMenu | undefined;
  let resourceFile: HTMLInputElement | undefined;

  const defaultPicker = (request: FxNodeResourceOpenRequest) => {
    if (!resourceFile) {
      resourceFile = document.createElement("input");
      resourceFile.type = "file";
      resourceFile.hidden = true;
      resourceFile.dataset.fxnodeResourceFile = "";
      document.body.append(resourceFile);
      resourceFile.addEventListener("change", resourceChanged);
    }
    const generation = ++pickerGeneration;
    authorization = { request, generation };
    resourceFile.accept = request.resource.accept.join(",");
    resourceFile.value = "";
    resourceFile.click();
  };
  const resourceChanged = () => {
    const pending = authorization,
      file = resourceFile?.files?.[0];
    authorization = undefined;
    if (!pending || !file || !api) return;
    void file
      .arrayBuffer()
      .then((bytes) => {
        if (active && api && pending.generation === pickerGeneration)
          return api.provideResource(pending.request.authorization, { name: file.name, mime: file.type, bytes });
      })
      .catch((error) => {
        if (active && pending.generation === pickerGeneration) onError(error);
      });
  };
  const activate = activateResourcePicker ?? defaultPicker;
  const position = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const input = (event: Event) => {
    if (!active || !api) return;
    if (event instanceof PointerEvent) {
      const phase =
        event.type === "pointerdown"
          ? "down"
          : event.type === "pointermove"
            ? "move"
            : event.type === "pointerup"
              ? "up"
              : "cancel";
      const point = position(event);
      if (phase === "down") {
        menu?.close(false);
        menuPending = event.button === 2 && !event.ctrlKey && (event.buttons & 1) === 0;
        canvas.focus();
        try {
          canvas.setPointerCapture(event.pointerId);
          capturedPointers.add(event.pointerId);
        } catch {
          /* unsupported or detached */
        }
      }
      if ((phase === "up" || phase === "cancel") && capturedPointers.delete(event.pointerId))
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch {
          /* detached */
        }
      api.feedInput({
        kind: "pointer",
        phase,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        position: point,
        button: event.button,
        buttons: event.buttons,
        modifiers: modifiers(event),
      });
      return;
    }
    if (event instanceof WheelEvent) {
      event.preventDefault();
      menu?.close(false);
      menuPending = false;
      const rect = canvas.getBoundingClientRect(),
        scale =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? Math.max(1, rect.height)
              : 1;
      api.feedInput({
        kind: "wheel",
        position: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        delta: { x: event.deltaX * scale, y: event.deltaY * scale },
        modifiers: modifiers(event),
      });
      return;
    }
    if (event instanceof MouseEvent) {
      if (event.button !== 2 || (event.buttons & 1) === 0) return;
      menuPending = false;
      api.feedInput({
        kind: "pointer",
        phase: "down",
        pointerId: 1,
        pointerType: "mouse",
        position: position(event),
        button: event.button,
        buttons: event.buttons,
        modifiers: modifiers(event),
      });
      return;
    }
    if (event instanceof KeyboardEvent) {
      menu?.close(false);
      menuPending = false;
      api.feedInput({
        kind: "key",
        phase: event.type === "keydown" ? "down" : "up",
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        modifiers: modifiers(event),
      });
      return;
    }
    api.feedInput({ kind: "focus", phase: event.type === "focus" ? "focus" : "blur" });
  };
  const contextMenu = (event: Event) => event.preventDefault();
  const lostCapture = (event: PointerEvent) => capturedPointers.delete(event.pointerId);
  const outsidePointer = (event: PointerEvent) => {
    if (
      active &&
      api &&
      event.button === 0 &&
      api.getHostSnapshot().colorPickerOpen &&
      event.target !== canvas &&
      !canvas.contains(event.target as Node)
    ) {
      menuPending = false;
      api.feedInput({ kind: "outside-pointer", button: 0 });
    }
  };
  const syncViewport = () => {
    if (!active) return;
    const next = measureViewport(canvas);
    sizeCanvas(canvas, next);
    if (api && !sameViewport(viewport, next)) {
      menu?.close(false);
      menuPending = false;
      viewport = next;
      api.setViewport(next);
    } else viewport = next;
  };
  const resize = () => syncViewport();
  const host: PreparedFxNodeBrowserHost = {
    initialViewport: viewport,
    attach(value) {
      if (!active) throw new Error("FxNode browser host has been destroyed");
      if (attached) throw new Error("FxNode browser host is already attached");
      attached = true;
      api = value;
      try {
        if (addNodeMenuTemplate) menu = createAddNodeMenu(addNodeMenuTemplate, canvas, value, onError);
        if (canvas.tabIndex < 0) {
          canvas.tabIndex = 0;
          changedTabIndex = true;
          appliedTabIndex = canvas.getAttribute("tabindex");
        }
        if (canvas.style.touchAction !== "none") {
          canvas.style.touchAction = "none";
          changedTouchAction = true;
        }
        observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
        for (const name of INPUT_EVENTS) canvas.addEventListener(name, input, { passive: name !== "wheel" });
        canvas.addEventListener("contextmenu", contextMenu);
        canvas.addEventListener("lostpointercapture", lostCapture);
        document.addEventListener("pointerdown", outsidePointer, true);
        window.addEventListener("resize", resize);
        observer?.observe(canvas);
        subscriptions.add(
          value.onHostRequests((request) => {
            if (request.kind === "add-node-menu") {
              if (!menuPending) return;
              menuPending = false;
              menu?.open(request.viewPosition);
              return;
            }
            menuPending = false;
            menu?.close(false);
            try {
              void Promise.resolve(activate(request)).catch((error) => {
                if (active) onError(error);
              });
            } catch (error) {
              if (active) onError(error);
            }
          }),
        );
        const closeMenu = () => {
          menuPending = false;
          menu?.close(false);
        };
        const invalidatePicker = () => {
          pickerGeneration++;
          authorization = undefined;
          closeMenu();
        };
        subscriptions.add(value.onCompositionChanges(invalidatePicker));
        subscriptions.add(value.onMutations(invalidatePicker));
        syncViewport();
      } catch (error) {
        host.destroy();
        throw error;
      }
    },
    syncViewport,
    destroy() {
      if (!active) return;
      active = false;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
      pickerGeneration++;
      menuPending = false;
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outsidePointer, true);
      for (const name of INPUT_EVENTS) canvas.removeEventListener(name, input);
      canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("lostpointercapture", lostCapture);
      for (const pointerId of capturedPointers)
        try {
          if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        } catch {
          /* detached */
        }
      capturedPointers.clear();
      authorization = undefined;
      menu?.destroy();
      if (resourceFile) {
        resourceFile.removeEventListener("change", resourceChanged);
        resourceFile.remove();
        resourceFile = undefined;
      }
      if (changedTouchAction && canvas.style.touchAction === "none") canvas.style.touchAction = originalTouchAction;
      if (changedTabIndex && canvas.getAttribute("tabindex") === appliedTabIndex) {
        if (originalTabIndex === null) canvas.removeAttribute("tabindex");
        else canvas.setAttribute("tabindex", originalTabIndex);
      }
      if (activeHosts.get(canvas) === host) activeHosts.delete(canvas);
      api = undefined;
    },
  };
  activeHosts.set(canvas, host);
  return host;
}
