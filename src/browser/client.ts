import type { Command } from "../commands/types.js";
import type { GraphLayoutV2, GraphSnapshot } from "../core/types.js";
import type { MutationEnvelope, SnapshotEnvelope } from "../engine/engine.js";
import { validWorkerMessage, type InputEventWire, type PointerFence, type VersionExpectation, type WorkerRequest } from "./protocol.js";
import { advancePointerLaneFence, createPointerLane, publishPointerMove, supportsPointerLane, type PointerLaneSnapshot, type PointerMoveWire } from "./pointer-lane.js";
import { createAddNodeMenu, type AddNodeMenu } from "./add-node-menu.js";
import type { BuiltinNodeTypeId } from "../catalog/scope.js";
import defaultWorkerUrl from "../worker/fxnode.worker.ts?worker&url";

export interface FxNodeIssue { readonly code: string; readonly message: string; readonly path?: string }
export class FxNodeCapabilityError extends Error {
  override name = "FxNodeCapabilityError";
  constructor(message: string, readonly code = "capability.unavailable") { super(message); }
}
export class FxNodeProtocolError extends Error { override name = "FxNodeProtocolError"; }
export class FxNodeWorkerError extends Error {
  override name = "FxNodeWorkerError";
  constructor(message: string, readonly code = "worker.error", readonly issues?: readonly FxNodeIssue[]) { super(message); }
}
export class FxNodeDestroyedError extends Error {
  override name = "FxNodeDestroyedError";
  constructor() { super("FxNode has been destroyed"); }
}

export type CommandIntent = Command
  | (Omit<Extract<Command, { type: "node.add" }>, "nodeId"> & { nodeId?: Extract<Command, { type: "node.add" }>["nodeId"] })
  | (Omit<Extract<Command, { type: "link.add" }>, "link"> & { link: Omit<Extract<Command, { type: "link.add" }>["link"], "id"> & { id?: Extract<Command, { type: "link.add" }>["link"]["id"] } });
export interface FxNode {
  dispatch(intent: CommandIntent, options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  undo(options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  redo(options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  save(): Promise<GraphLayoutV2>; load(layout: unknown, options?: { expectedVersion?: number }): Promise<CommandReceipt>;
  snapshot(): Promise<GraphSnapshot>;
  onMutations(callback: (event: MutationEnvelope) => void): () => void;
  onSnapshots(callback: (event: SnapshotEnvelope) => void): () => void;
  copyTo(canvas: HTMLCanvasElement): Promise<void>; addMirror(canvas: HTMLCanvasElement): void;
  removeMirror(canvas: HTMLCanvasElement): void; whenRendered(): Promise<void>; destroy(): void;
}
export interface CreateFxNodeOptions { canvas: HTMLCanvasElement; layout: unknown; historyLimit?: number; workerUrl?: string | URL }
export interface CommandReceipt { status: "committed" | "noop"; version: number }

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
type Barrier = { resolve: () => void; reject: (reason: unknown) => void };
type RpcRequest = WorkerRequest extends infer R ? R extends { id: string } ? Omit<R, "id" | "protocol"> : never : never;
const INPUT_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "wheel", "keydown", "keyup", "focus", "blur"] as const;
const STARTUP_TIMEOUT_MS = 5_000;

class FxNodeClient implements FxNode {
  private terminalError: Error | undefined;
  private renderId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly barriers = new Map<number, Barrier[]>();
  private readonly copies = new Map<number, Set<HTMLCanvasElement>>();
  private readonly mirrors = new Set<HTMLCanvasElement>();
  private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  private readonly mutations = new Set<(event: MutationEnvelope) => void>();
  private readonly snapshots = new Set<(event: SnapshotEnvelope) => void>();
  private readonly observer: ResizeObserver;
  private readonly originalTabIndex: string | null;
  private readonly originalTouchAction: string;
  private latestPointerMove: PointerLaneSnapshot | undefined;
  private knifePointerId: number | undefined;
  private lanePointerId: number | undefined;
  private pendingNodeMenuRequestId: string | undefined;
  private readonly addNodeMenu: AddNodeMenu;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly worker: Worker, private readonly pointerLane?: SharedArrayBuffer) {
    this.originalTabIndex = canvas.getAttribute("tabindex");
    this.originalTouchAction = canvas.style.touchAction;
    canvas.tabIndex = canvas.tabIndex < 0 ? 0 : canvas.tabIndex;
    canvas.style.touchAction = "none";
    this.observer = new ResizeObserver(this.viewport);
    this.observer.observe(canvas);
    window.addEventListener("resize", this.viewport);
    for (const name of INPUT_EVENTS) canvas.addEventListener(name, this.input, { passive: name !== "wheel" });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
    this.addNodeMenu=createAddNodeMenu(canvas,(typeId,viewPosition)=>this.addNodeAt(typeId,viewPosition));
    worker.onmessage = this.onMessage;
    worker.onerror = () => this.shutdown(new FxNodeCapabilityError("The FxNode module worker failed to load. Check workerUrl, CSP worker-src, URL accessibility, and JavaScript MIME type.", "worker.load"));
    worker.onmessageerror = () => this.shutdown(new FxNodeProtocolError("The FxNode worker sent an uncloneable message"));
  }

  async initialize(layout: unknown, historyLimit: number): Promise<void> {
    const timeout = window.setTimeout(() => this.shutdown(new FxNodeCapabilityError("FxNode worker startup timed out. Check workerUrl, CSP worker-src, URL accessibility, and JavaScript MIME type.", "worker.timeout")), STARTUP_TIMEOUT_MS);
    try { await this.post({ type: "init", layout, historyLimit, viewport: this.size(), ...(this.pointerLane ? { pointerLane: this.pointerLane } : {}) }); }
    finally { clearTimeout(timeout); }
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const recognizableBitmap = this.bitmapFrom(event.data);
    try {
      if (!validWorkerMessage(event.data)) { this.shutdown(new FxNodeProtocolError("Invalid message from FxNode worker")); return; }
      const data = event.data;
      if (data.type === "response") {
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        if (data.ok) pending.resolve(structuredClone(data.value));
        else pending.reject(new FxNodeWorkerError(data.error.message, data.error.code, data.error.issues as readonly FxNodeIssue[] | undefined));
      } else if (data.type === "mutation") this.notify(this.mutations, data.envelope);
      else if (data.type === "snapshot.event") this.notify(this.snapshots, data.envelope);
      else if(data.type==="node-menu.result"){if(data.requestId!==this.pendingNodeMenuRequestId)return;this.pendingNodeMenuRequestId=undefined;if(data.open&&data.viewPosition)this.addNodeMenu.open(data.viewPosition);}
      else if (data.type === "fatal") this.shutdown(new FxNodeWorkerError(data.error.message, data.error.code));
      else this.consumeFrame(data);
    } finally { recognizableBitmap?.close(); }
  };

  private bitmapFrom(data: unknown): ImageBitmap | undefined {
    if (typeof ImageBitmap === "undefined" || typeof data !== "object" || data === null) return undefined;
    const bitmap = (data as { bitmap?: unknown }).bitmap;
    return bitmap instanceof ImageBitmap ? bitmap : undefined;
  }
  private notify<T>(callbacks: ReadonlySet<(event: T) => void>, event: T): void {
    for (const callback of callbacks) try { callback(event); } catch (error) { console.error("FxNode subscriber failed", error); }
  }
  private consumeFrame(data: Extract<import("./protocol.js").WorkerMessage, { type: "frame" }>): void {
    let primaryError: unknown;
    try { this.draw(this.canvas, data.bitmap); } catch (error) { primaryError = error; }
    for (const mirror of [...this.mirrors]) try { this.draw(mirror, data.bitmap); } catch { this.mirrors.delete(mirror); }
    for (const [id, targets] of [...this.copies]) if (id <= data.renderId) {
      for (const target of targets) try { this.draw(target, data.bitmap); } catch (error) { this.rejectBarrier(id, error); }
      this.copies.delete(id);
    }
    this.safePost({ protocol: 1, type: "frame.consumed", frameId: data.frameId });
    for (const [id, list] of [...this.barriers]) if (id <= data.renderId) {
      for (const item of list) primaryError ? item.reject(primaryError) : item.resolve();
      this.barriers.delete(id);
    }
  }
  private draw(target: HTMLCanvasElement, bitmap: ImageBitmap): void {
    const context = this.contexts.get(target) ?? target.getContext("2d");
    if (!context) throw new FxNodeCapabilityError("Canvas 2D context is unavailable", "canvas.2d");
    this.contexts.set(target, context);
    if (target.width !== bitmap.width) target.width = bitmap.width;
    if (target.height !== bitmap.height) target.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
  }
  private rejectBarrier(id: number, error: unknown): void { for (const item of this.barriers.get(id) ?? []) item.reject(error); this.barriers.delete(id); }
  private size = () => ({ width: Math.min(8192, this.canvas.clientWidth || this.canvas.width || 1), height: Math.min(8192, this.canvas.clientHeight || this.canvas.height || 1), dpr: Math.min(4, window.devicePixelRatio || 1) });
  private readonly viewport = (): void => { this.pendingNodeMenuRequestId=undefined;this.addNodeMenu.close(false);if (!this.terminalError && this.flushPointerLane()) { this.renderId++; this.requiredPost({ protocol: 1, type: "viewport", viewport: this.size(), renderId: this.renderId }); } };
  private safePost(message: WorkerRequest): boolean { try { this.worker.postMessage(message); return true; } catch { return false; } }
  private requiredPost(message: WorkerRequest): boolean { if(this.safePost(message))return true;this.shutdown(new FxNodeProtocolError("Unable to send a message to the FxNode worker"));return false; }
  private post<T>(message: RpcRequest): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if ((message.type === "command" || message.type === "load") && !this.flushPointerLane()) return Promise.reject(this.terminalError!);
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try { this.worker.postMessage({ protocol: 1, id, ...message }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  private expected(version?: number): VersionExpectation { return version === undefined ? { kind: "current" } : { kind: "exact", version }; }
  private renderBarrier(target?: HTMLCanvasElement): Promise<void> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = ++this.renderId;
    if (target) this.copies.set(id, new Set([target]));
    if(!this.flushPointerLane()||!this.requiredPost({ protocol: 1, type: "viewport", viewport: this.size(), renderId: id }))return Promise.reject(this.terminalError!);
    return new Promise((resolve, reject) => this.barriers.set(id, [...this.barriers.get(id) ?? [], { resolve, reject }]));
  }
  private readonly preventContextMenu = (event: Event): void => event.preventDefault();
  private readonly input = (event: Event): void => {
    if (this.terminalError) return;
    if(event instanceof PointerEvent&&event.type==="pointerdown"||event instanceof WheelEvent||event instanceof KeyboardEvent){this.pendingNodeMenuRequestId=undefined;this.addNodeMenu.close(false);}
    const rect = this.canvas.getBoundingClientRect();
    const mods = (value: MouseEvent | KeyboardEvent) => (value.altKey ? 1 : 0) | (value.ctrlKey ? 2 : 0) | (value.metaKey ? 4 : 0) | (value.shiftKey ? 8 : 0);
    let wire: InputEventWire;
    if (event instanceof PointerEvent) {
      const phase = event.type === "pointerdown" ? "down" : event.type === "pointermove" ? "move" : event.type === "pointerup" ? "up" : "cancel";
      wire = { kind: "pointer", phase, pointerId: event.pointerId, pointerType: event.pointerType, position: { x: event.clientX - rect.left, y: event.clientY - rect.top }, button: event.button, buttons: event.buttons, modifiers: mods(event) };
      if (phase === "down") { this.canvas.focus(); this.canvas.setPointerCapture(event.pointerId); }
      if (phase === "up" && this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    } else if (event instanceof WheelEvent) {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, rect.height) : 1;
      wire = { kind: "wheel", position: { x: event.clientX - rect.left, y: event.clientY - rect.top }, delta: { x: event.deltaX * scale, y: event.deltaY * scale }, modifiers: mods(event) }; event.preventDefault();
    } else if (event instanceof MouseEvent) {
      // Pointer Events do not emit a second pointerdown when RMB is pressed
      // while LMB is held. Forward that chord so in-progress gestures can use
      // the conventional secondary-button cancellation.
      if (event.button !== 2 || (event.buttons & 1) === 0) return;
      wire = { kind: "pointer", phase: "down", pointerId: 1, pointerType: "mouse", position: { x: event.clientX - rect.left, y: event.clientY - rect.top }, button: event.button, buttons: event.buttons, modifiers: mods(event) };
    } else if (event instanceof KeyboardEvent) {
      wire = { kind: "key", phase: event.type === "keydown" ? "down" : "up", key: event.key, code: event.code, repeat: event.repeat, modifiers: mods(event) };
    } else wire = { kind: "focus", phase: event.type === "focus" ? "focus" : "blur" };
    if (wire.kind === "pointer" && wire.phase === "move" && this.pointerLane && this.knifePointerId !== wire.pointerId && (this.lanePointerId === undefined || this.lanePointerId === wire.pointerId)) {
      const sequence = publishPointerMove(this.pointerLane, wire as PointerMoveWire);
      if (sequence !== undefined) { this.latestPointerMove = { sequence, event: wire as PointerMoveWire }; return; }
    }
    const nodeMenuRequestId=event instanceof PointerEvent&&wire.kind==="pointer"&&wire.phase==="down"&&wire.button===2&&(wire.modifiers&2)===0?crypto.randomUUID():undefined;
    if(nodeMenuRequestId)this.pendingNodeMenuRequestId=nodeMenuRequestId;
    this.sendInput(wire,nodeMenuRequestId);
    if (wire.kind === "pointer" && wire.phase === "down" && this.lanePointerId === undefined) this.lanePointerId = wire.pointerId;
    if (wire.kind === "pointer" && wire.phase === "down" && wire.button === 2 && (wire.modifiers & 2) !== 0) this.knifePointerId = wire.pointerId;
    if (wire.kind === "pointer" && (wire.phase === "up" || wire.phase === "cancel")) { if(this.knifePointerId === wire.pointerId)this.knifePointerId = undefined;if(this.lanePointerId === wire.pointerId)this.lanePointerId = undefined; }
  };

  private nextPointerFence(): PointerFence | undefined {
    if (!this.pointerLane) return undefined;
    const generation = advancePointerLaneFence(this.pointerLane);
    return this.latestPointerMove ? { generation, before: this.latestPointerMove } : { generation };
  }
  private flushPointerLane(): boolean {
    const pointerFence = this.nextPointerFence();
    return !pointerFence || this.requiredPost({ protocol: 1, type: "pointer.flush", pointerFence });
  }
  private sendInput(event: InputEventWire,nodeMenuRequestId?:string): void {
    const pointerFence = this.nextPointerFence();
    this.requiredPost({ protocol: 1, type: "input", event, ...(pointerFence ? { pointerFence } : {}),...(nodeMenuRequestId?{nodeMenuRequestId}:{}) });
  }

  private addNodeAt(nodeType:BuiltinNodeTypeId,viewPosition:{x:number;y:number}):void{const pointerFence=this.nextPointerFence();void this.post<CommandReceipt>({type:"node.add-at-view",nodeId:crypto.randomUUID(),nodeType,viewPosition,...(pointerFence?{pointerFence}:{})}).catch(error=>console.error("FxNode add-node menu failed",error));}

  dispatch(intent: CommandIntent, options?: { expectedVersion?: number }): Promise<CommandReceipt> {
    this.addNodeMenu.close(false);
    let command = intent as Command;
    if (intent.type === "node.add" && !intent.nodeId) command = { ...intent, nodeId: crypto.randomUUID() } as Command;
    if (intent.type === "link.add" && !intent.link.id) command = { ...intent, link: { ...intent.link, id: crypto.randomUUID() } } as Command;
    return this.post({ type: "command", command, expected: this.expected(options?.expectedVersion) });
  }
  undo(options?: { expectedVersion?: number }) { return this.dispatch({ type: "undo" }, options); }
  redo(options?: { expectedVersion?: number }) { return this.dispatch({ type: "redo" }, options); }
  save() { return this.post<GraphLayoutV2>({ type: "save" }); }
  load(layout: unknown, options?: { expectedVersion?: number }) { return this.post<CommandReceipt>({ type: "load", layout, expected: this.expected(options?.expectedVersion) }); }
  snapshot() { return this.post<GraphSnapshot>({ type: "snapshot" }); }
  onMutations(callback: (event: MutationEnvelope) => void) { if (this.terminalError) throw this.terminalError; this.mutations.add(callback); return () => this.mutations.delete(callback); }
  onSnapshots(callback: (event: SnapshotEnvelope) => void) { if (this.terminalError) throw this.terminalError; this.snapshots.add(callback); return () => this.snapshots.delete(callback); }
  copyTo(canvas: HTMLCanvasElement) { return this.renderBarrier(canvas); }
  addMirror(canvas: HTMLCanvasElement) { if (this.terminalError) throw this.terminalError; this.mirrors.add(canvas); void this.renderBarrier().catch(() => this.mirrors.delete(canvas)); }
  removeMirror(canvas: HTMLCanvasElement) { this.mirrors.delete(canvas); }
  whenRendered() { return this.renderBarrier(); }
  destroy() { this.shutdown(new FxNodeDestroyedError()); }
  private shutdown(error: Error): void {
    if (this.terminalError) return; this.terminalError = error;
    this.observer.disconnect(); window.removeEventListener("resize", this.viewport);
    for (const name of INPUT_EVENTS) this.canvas.removeEventListener(name, this.input);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
    this.addNodeMenu.destroy();this.pendingNodeMenuRequestId=undefined;
    if (this.originalTabIndex === null) this.canvas.removeAttribute("tabindex"); else this.canvas.setAttribute("tabindex", this.originalTabIndex);
    this.canvas.style.touchAction = this.originalTouchAction;
    for (const pointerId of [1, 2, 3, 4, 5]) try { if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId); } catch { /* detached canvas */ }
    for (const item of this.pending.values()) item.reject(error); this.pending.clear();
    for (const list of this.barriers.values()) for (const item of list) item.reject(error); this.barriers.clear();
    this.safePost({ protocol: 1, type: "dispose" }); this.worker.terminate();
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null;
    this.mutations.clear(); this.snapshots.clear(); this.mirrors.clear(); this.copies.clear();
  }
}

export async function createFxNode({ canvas, layout, historyLimit = 100, workerUrl }: CreateFxNodeOptions): Promise<FxNode> {
  if (typeof Worker === "undefined") throw new FxNodeCapabilityError("FxNode requires module Worker support", "worker.missing");
  if (typeof ResizeObserver === "undefined") throw new FxNodeCapabilityError("FxNode requires ResizeObserver", "resize-observer.missing");
  if (typeof crypto?.randomUUID !== "function") throw new FxNodeCapabilityError("FxNode requires crypto.randomUUID", "crypto.random-uuid.missing");
  if (!canvas.getContext("2d")) throw new FxNodeCapabilityError("FxNode requires Canvas 2D", "canvas.2d");
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 1000) throw new RangeError("historyLimit must be an integer from 0 to 1000");
  const url = workerUrl === undefined ? new URL(defaultWorkerUrl, import.meta.url) : new URL(workerUrl, document.baseURI);
  let worker: Worker;
  try { worker = new Worker(url, { type: "module" }); }
  catch { throw new FxNodeCapabilityError("Unable to construct the FxNode module worker. Check workerUrl and CSP worker-src.", "worker.construct"); }
  const pointerLane = supportsPointerLane() ? createPointerLane() : undefined;
  const client = new FxNodeClient(canvas, worker, pointerLane);
  try { await client.initialize(layout, historyLimit); return client; }
  catch (error) { client.destroy(); throw error; }
}
