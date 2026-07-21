import type { Command } from "../commands/types.js";
import type { GraphLayoutV2, GraphSnapshot } from "../core/types.js";
import type { MutationEnvelope, SnapshotEnvelope } from "../engine/engine.js";
import type { PointerLaneSnapshot } from "./pointer-lane.js";
import { CATALOG_NODE_IDS, type BuiltinNodeTypeId } from "../catalog/scope.js";

export const PROTOCOL_VERSION = 1 as const;
export type VersionExpectation = { readonly kind: "current" } | { readonly kind: "exact"; readonly version: number };
export type WorkerRequest =
  | { protocol: 1; type: "init"; id: string; layout: unknown; historyLimit: number; viewport: Viewport; pointerLane?: SharedArrayBuffer }
  | { protocol: 1; type: "command"; id: string; command: Command; expected: VersionExpectation }
  | { protocol: 1; type: "load"; id: string; layout: unknown; expected: VersionExpectation }
  | { protocol: 1; type: "snapshot" | "save"; id: string }
  | { protocol: 1; type: "viewport"; viewport: Viewport; renderId: number }
  | { protocol: 1; type: "input"; event: InputEventWire; pointerFence?: PointerFence; nodeMenuRequestId?: string }
  | { protocol: 1; type: "node.add-at-view"; id:string;nodeId:string;nodeType:BuiltinNodeTypeId;viewPosition:{x:number;y:number};pointerFence?:PointerFence }
  | { protocol:1;type:"resource.set";id:string;token:string;name:string;mime:string;bytes:ArrayBuffer }
  | { protocol: 1; type: "pointer.flush"; pointerFence: PointerFence }
  | { protocol: 1; type: "frame.consumed"; frameId: number }
  | { protocol: 1; type: "dispose" };
export interface Viewport { width: number; height: number; dpr: number }
export interface PointerFence { readonly generation: number; readonly before?: PointerLaneSnapshot }
export type InputEventWire =
  | { kind: "pointer"; phase: "down" | "move" | "up" | "cancel"; pointerId: number; pointerType: string; position: { x: number; y: number }; button: number; buttons: number; modifiers: number }
  | { kind: "wheel"; position: { x: number; y: number }; delta: { x: number; y: number }; modifiers: number }
  | { kind: "key"; phase: "down" | "up"; key: string; code: string; repeat: boolean; modifiers: number }
  | { kind: "focus"; phase: "focus" | "blur" }
  | { kind:"outside-pointer";button:number };
export interface HostInteractionSnapshot { readonly colorPickerOpen:boolean;readonly actions:readonly {readonly kind:"resource.open";readonly token:string;readonly bounds:{readonly x:number;readonly y:number;readonly width:number;readonly height:number}}[] }
export type WorkerMessage =
  | { protocol: 1; type: "response"; id: string; ok: true; value?: GraphSnapshot | GraphLayoutV2 | { status: "committed" | "noop"; version: number } }
  | { protocol: 1; type: "response"; id: string; ok: false; error: { code: string; message: string; issues?: unknown } }
  | { protocol: 1; type: "mutation"; envelope: MutationEnvelope }
  | { protocol: 1; type: "snapshot.event"; envelope: SnapshotEnvelope }
  | { protocol: 1; type: "frame"; bitmap: ImageBitmap; renderId: number; frameId:number;host:HostInteractionSnapshot }
  | { protocol: 1; type: "node-menu.result"; requestId:string;open:boolean;viewPosition?:{x:number;y:number} }
  | { protocol: 1; type: "fatal"; error: { code: string; message: string } };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every(k => keys.includes(k)) && keys.every(k => k in v);
export function validViewport(v: unknown): v is Viewport { return record(v) && exact(v, ["width", "height", "dpr"]) && typeof v.width === "number" && Number.isFinite(v.width) && v.width >= 0 && v.width <= 8192 && typeof v.height === "number" && Number.isFinite(v.height) && v.height >= 0 && v.height <= 8192 && v.width * v.height <= 16_777_216 && typeof v.dpr === "number" && Number.isFinite(v.dpr) && v.dpr > 0 && v.dpr <= 4; }
export function validRequest(v: unknown): v is WorkerRequest {
  if (!record(v) || v.protocol !== 1 || typeof v.type !== "string") return false;
  if (v.type === "init") return Object.keys(v).every(k => ["protocol","type","id","layout","historyLimit","viewport","pointerLane"].includes(k)) && ["protocol","type","id","layout","historyLimit","viewport"].every(k => k in v) && typeof v.id === "string" && Number.isSafeInteger(v.historyLimit) && (v.historyLimit as number) >= 0 && (v.historyLimit as number) <= 1000 && validViewport(v.viewport) && (v.pointerLane === undefined || (typeof SharedArrayBuffer === "function" && v.pointerLane instanceof SharedArrayBuffer));
  if (v.type === "command") return exact(v, ["protocol","type","id","command","expected"]) && typeof v.id === "string" && validCommand(v.command) && validExpectation(v.expected);
  if (v.type === "load") return exact(v, ["protocol","type","id","layout","expected"]) && typeof v.id === "string" && validExpectation(v.expected);
  if (v.type === "snapshot" || v.type === "save") return exact(v, ["protocol","type","id"]) && typeof v.id === "string";
  if (v.type === "viewport") return exact(v, ["protocol","type","viewport","renderId"]) && validViewport(v.viewport) && Number.isSafeInteger(v.renderId);
  if (v.type === "frame.consumed") return exact(v, ["protocol","type","frameId"]) && Number.isSafeInteger(v.frameId);
  if (v.type === "dispose") return exact(v, ["protocol","type"]);
  if (v.type === "pointer.flush") return exact(v,["protocol","type","pointerFence"]) && validPointerFence(v.pointerFence);
  if(v.type==="node.add-at-view")return Object.keys(v).every(k=>["protocol","type","id","nodeId","nodeType","viewPosition","pointerFence"].includes(k))&&["protocol","type","id","nodeId","nodeType","viewPosition"].every(k=>k in v)&&id(v.id)&&id(v.nodeId)&&CATALOG_NODE_IDS.includes(v.nodeType as BuiltinNodeTypeId)&&finitePoint(v.viewPosition)&&(v.pointerFence===undefined||validPointerFence(v.pointerFence));
  if(v.type==="resource.set")return exact(v,["protocol","type","id","token","name","mime","bytes"])&&id(v.id)&&id(v.token)&&typeof v.name==="string"&&v.name.length>0&&v.name.length<=255&&!/[\u0000-\u001f\u007f]/.test(v.name)&&typeof v.mime==="string"&&v.mime.length<=128&&v.bytes instanceof ArrayBuffer&&v.bytes.byteLength>0&&v.bytes.byteLength<=32*1024*1024;
  return v.type === "input" && Object.keys(v).every(k => ["protocol","type","event","pointerFence","nodeMenuRequestId"].includes(k)) && ["protocol","type","event"].every(k => k in v) && validInput(v.event) && (v.pointerFence === undefined || validPointerFence(v.pointerFence)) && (v.nodeMenuRequestId===undefined||id(v.nodeMenuRequestId));
}
const finitePoint = (v: unknown): boolean => record(v) && exact(v,["x","y"]) && typeof v.x === "number" && Number.isFinite(v.x) && typeof v.y === "number" && Number.isFinite(v.y);
function validInput(v: unknown): v is InputEventWire {
  if (!record(v)) return false;
  if(v.kind==="outside-pointer")return exact(v,["kind","button"])&&Number.isInteger(v.button);
  if (v.kind === "pointer") return exact(v,["kind","phase","pointerId","pointerType","position","button","buttons","modifiers"]) && ["down","move","up","cancel"].includes(String(v.phase)) && Number.isSafeInteger(v.pointerId) && typeof v.pointerType === "string" && finitePoint(v.position) && Number.isInteger(v.button) && Number.isInteger(v.buttons) && Number.isInteger(v.modifiers);
  if (v.kind === "wheel") return exact(v,["kind","position","delta","modifiers"]) && finitePoint(v.position) && finitePoint(v.delta) && Number.isInteger(v.modifiers);
  if (v.kind === "key") return exact(v,["kind","phase","key","code","repeat","modifiers"]) && ["down","up"].includes(String(v.phase)) && typeof v.key === "string" && typeof v.code === "string" && typeof v.repeat === "boolean" && Number.isInteger(v.modifiers);
  return v.kind === "focus" && exact(v,["kind","phase"]) && (v.phase === "focus" || v.phase === "blur");
}
function validPointerFence(v: unknown): v is PointerFence {
  return record(v) && Object.keys(v).every(k=>["generation","before"].includes(k)) && "generation" in v && Number.isInteger(v.generation) && (v.before===undefined || (record(v.before) && exact(v.before,["sequence","event"]) && Number.isInteger(v.before.sequence) && validInput(v.before.event) && record(v.before.event) && v.before.event.kind==="pointer" && v.before.event.phase==="move"));
}
const id = (v: unknown): boolean => typeof v === "string" && v.length > 0 && v.length <= 512;
function validCommand(v: unknown, nested = false): v is Command {
  if (!record(v) || typeof v.type !== "string") return false;
  if (v.type === "batch") return !nested && exact(v,["type","commands"]) && Array.isArray(v.commands) && v.commands.length <= 256 && v.commands.every(item => validCommand(item,true) && ["node.move","node.resize","node.remove","node.mute","node.collapse","node.parent","link.remove","link.mute"].includes((item as {type:string}).type));
  if (v.type === "undo" || v.type === "redo") return !nested && exact(v,["type"]);
  if (v.type === "node.remove" || v.type === "link.remove") return exact(v,["type","id"]) && id(v.id);
  if (v.type === "node.move" || v.type === "node.resize") return exact(v,["type","id",v.type === "node.move"?"position":"size"]) && id(v.id) && finitePoint(v[v.type === "node.move"?"position":"size"]);
  if (v.type === "node.mute" || v.type === "node.collapse" || v.type === "link.mute") return exact(v,["type","id","value"]) && id(v.id) && typeof v.value === "boolean";
  if (v.type === "node.parent") return exact(v,["type","id","parentId"]) && id(v.id) && (v.parentId===null||id(v.parentId));
  if (nested) return false;
  // Remaining API commands are semantically validated by the engine; reject extra fields here.
  if (v.type === "node.label") return exact(v,["type","id","label"])&&id(v.id)&&typeof v.label==="string";
  if (v.type === "node.add") return Object.keys(v).every(k=>["type","nodeId","nodeType","position","parentId"].includes(k))&&["type","nodeId","nodeType","position"].every(k=>k in v)&&id(v.nodeId)&&id(v.nodeType)&&finitePoint(v.position)&&(v.parentId===undefined||id(v.parentId));
  if (v.type === "link.add") return exact(v,["type","link"])&&record(v.link);
  if (v.type === "link.replace") return exact(v,["type","removeId","link"])&&id(v.removeId)&&record(v.link);
  if (v.type === "node.parameter") return exact(v,["type","id","key","value"])&&id(v.id)&&typeof v.key==="string"&&record(v.value);
  if (v.type === "node.parameter-reset") return exact(v,["type","id","key"])&&id(v.id)&&typeof v.key==="string";
  if (v.type === "node.socket-default-reset") return exact(v,["type","id","socketId"])&&id(v.id)&&id(v.socketId);
  return v.type === "node.socket-default"&&exact(v,["type","id","socketId","value"])&&id(v.id)&&id(v.socketId)&&record(v.value);
}
function validExpectation(v: unknown): v is VersionExpectation { return record(v) && ((v.kind === "current" && exact(v,["kind"])) || (v.kind === "exact" && exact(v,["kind","version"]) && Number.isSafeInteger(v.version) && (v.version as number) >= 0)); }
export function validWorkerMessage(v: unknown): v is WorkerMessage {
  if (!record(v) || v.protocol !== 1 || typeof v.type !== "string") return false;
  if (v.type === "frame") return exact(v,["protocol","type","bitmap","renderId","frameId","host"]) && typeof ImageBitmap !== "undefined" && v.bitmap instanceof ImageBitmap && Number.isSafeInteger(v.renderId) && Number.isSafeInteger(v.frameId)&&validHostSnapshot(v.host);
  if (v.type === "mutation") return exact(v,["protocol","type","envelope"]) && record(v.envelope) && Number.isSafeInteger(v.envelope.version);
  if (v.type === "snapshot.event") return exact(v,["protocol","type","envelope"]) && record(v.envelope) && Number.isSafeInteger(v.envelope.version);
  if(v.type==="node-menu.result")return Object.keys(v).every(k=>["protocol","type","requestId","open","viewPosition"].includes(k))&&["protocol","type","requestId","open"].every(k=>k in v)&&id(v.requestId)&&typeof v.open==="boolean"&&(v.open?finitePoint(v.viewPosition):v.viewPosition===undefined);
  if (v.type === "fatal") return exact(v,["protocol","type","error"]) && record(v.error) && exact(v.error,["code","message"]) && typeof v.error.code === "string" && typeof v.error.message === "string";
  return v.type === "response" && typeof v.id === "string" && typeof v.ok === "boolean" && (v.ok ? Object.keys(v).every(k => ["protocol","type","id","ok","value"].includes(k)) : exact(v,["protocol","type","id","ok","error"]) && record(v.error) && typeof v.error.code === "string" && typeof v.error.message === "string");
}
function validHostSnapshot(v:unknown):v is HostInteractionSnapshot{return record(v)&&exact(v,["colorPickerOpen","actions"])&&typeof v.colorPickerOpen==="boolean"&&Array.isArray(v.actions)&&v.actions.length<=256&&v.actions.every(action=>record(action)&&exact(action,["kind","token","bounds"])&&action.kind==="resource.open"&&id(action.token)&&record(action.bounds)&&exact(action.bounds,["x","y","width","height"])&&finitePoint({x:action.bounds.x,y:action.bounds.y})&&typeof action.bounds.width==="number"&&Number.isFinite(action.bounds.width)&&action.bounds.width>=0&&typeof action.bounds.height==="number"&&Number.isFinite(action.bounds.height)&&action.bounds.height>=0);}
