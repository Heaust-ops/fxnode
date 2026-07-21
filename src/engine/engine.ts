import { getDescriptor } from "../catalog/registry.js";
import { validateValue } from "../catalog/value-schema.js";
import type { Command, CommandError, CommandRequest } from "../commands/types.js";
import { decodeGraphDocument, materializeNode, validateDocument, type ValidationIssue } from "../core/document.js";
import { cloneJson, deepFreeze } from "../core/json.js";
import type { CommandId, GraphDocument, GraphNode, GraphSnapshot, ParameterValue } from "../core/types.js";
import { invert, type Mutation } from "./mutations.js";
import { reduceMutations } from "./reducer.js";

interface HistoryEntry { readonly forward: readonly Mutation[]; readonly inverse: readonly Mutation[] }
export interface GraphEngineState { readonly version: number; readonly document: GraphDocument; readonly undo: readonly HistoryEntry[]; readonly redo: readonly HistoryEntry[]; readonly historyLimit: number }
/** @deprecated Use GraphEngineState. */
export type EngineState = GraphEngineState;
export interface MutationEnvelope { readonly baseVersion: number; readonly version: number; readonly commandId: CommandId; readonly cause: "api" | "gesture" | "undo" | "redo" | "load"; readonly mutations: readonly Mutation[] }
export interface SnapshotEnvelope { readonly version: number; readonly snapshot: GraphSnapshot }
export type TransitionResult =
  | { readonly status: "committed"; readonly state: EngineState; readonly mutationEnvelope: MutationEnvelope; readonly snapshotEnvelope: SnapshotEnvelope }
  | { readonly status: "noop"; readonly state: EngineState }
  | { readonly status: "rejected"; readonly state: EngineState; readonly error: CommandError };

export function snapshot(state: EngineState): GraphSnapshot {
  return deepFreeze({ version: state.version, graphId: state.document.graphId, catalogVersion: state.document.catalogVersion, nodes: Object.values(state.document.nodes).slice().sort((a, b) => a.id.localeCompare(b.id)), links: Object.values(state.document.links).slice().sort((a, b) => a.id.localeCompare(b.id)), metadata: state.document.metadata });
}
export function createEngine(document: GraphDocument, historyLimit = 100): EngineState {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) throw new RangeError("historyLimit must be a finite nonnegative integer");
  return deepFreeze({ version: 0, document: cloneJson(document), undo: [], redo: [], historyLimit });
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const reject = (code: string, message: string): CommandError => ({ code, message });

function plan(document: GraphDocument, command: Command): readonly Mutation[] | CommandError | null {
  if (command.type === "batch") {
    if (command.commands.length === 0) return null;
    if (command.commands.length > 256) return reject("batch.limit", "Batch exceeds 256 commands");
    let draft = document;
    const all: Mutation[] = [];
    for (const item of command.commands) {
      const result = plan(draft, item);
      if (result === null) continue;
      if (!Array.isArray(result)) return result as CommandError;
      all.push(...result);
      draft = reduceMutations(draft, result);
    }
    return all.length ? all : null;
  }
  if (command.type === "node.add") {
    if (document.nodes[command.nodeId]) return reject("node.duplicate", "Node id already exists");
    return [{ kind: "node.set", id: command.nodeId, before: null, after: materializeNode(command.nodeId, command.nodeType, command.position, command.parentId) }];
  }
  if (command.type === "node.remove") {
    const node = document.nodes[command.id];
    if (!node) return reject("node.missing", "Node does not exist");
    return [{ kind: "node.set", id: node.id, before: node, after: null }, ...Object.values(document.links).filter(link => link.fromNodeId === node.id || link.toNodeId === node.id).map(link => ({ kind: "link.set" as const, id: link.id, before: link, after: null })), ...Object.values(document.nodes).filter(child => child.parentId === node.id).map(child => ({ kind: "node.set" as const, id: child.id, before: child, after: deepFreeze({ ...child, parentId: undefined }) }))];
  }
  if (command.type === "link.add") {
    if (document.links[command.link.id]) return reject("link.duplicate", "Link id already exists");
    if (Object.values(document.links).some(link => link.fromSocketId === command.link.fromSocketId && link.toSocketId === command.link.toSocketId)) return reject("link.endpoint-duplicate", "Endpoints are already linked");
    return [{ kind: "link.set", id: command.link.id, before: null, after: cloneJson(command.link) }];
  }
  if (command.type === "link.remove") { const link = document.links[command.id]; return link ? [{ kind: "link.set", id: link.id, before: link, after: null }] : reject("link.missing", "Link does not exist"); }
  if (command.type === "link.mute") { const link = document.links[command.id]; if (!link) return reject("link.missing", "Link does not exist"); return link.muted === command.value ? null : [{ kind: "link.set", id: link.id, before: link, after: deepFreeze({ ...link, muted: command.value }) }]; }
  if (command.type === "link.replace") {
    const old = document.links[command.removeId];
    if (!old) return reject("link.missing", "Replacement target does not exist");
    if (command.link.toSocketId !== old.toSocketId) return reject("link.replace-target", "Replacement must keep target socket");
    if (command.link.id !== old.id && document.links[command.link.id]) return reject("link.duplicate", "Replacement id collides");
    return [{ kind: "link.set", id: old.id, before: old, after: null }, { kind: "link.set", id: command.link.id, before: null, after: cloneJson(command.link) }];
  }
  if (command.type === "undo" || command.type === "redo") return null;
  const node = document.nodes[command.id];
  if (!node) return reject("node.missing", "Node does not exist");
  let after: GraphNode;
  switch (command.type) {
    case "node.move": if (same(node.position, command.position)) return null; after = { ...node, position: cloneJson(command.position) }; break;
    case "node.resize": if (command.size.x <= 0 || command.size.y <= 0) return reject("size.nonpositive", "Node size must be positive"); if (same(node.size, command.size)) return null; after = { ...node, size: cloneJson(command.size) }; break;
    case "node.label": if (node.label === command.label) return null; after = { ...node, label: command.label }; break;
    case "node.mute": if (node.muted === command.value) return null; after = { ...node, muted: command.value }; break;
    case "node.collapse": if (node.collapsed === command.value) return null; after = { ...node, collapsed: command.value }; break;
    case "node.parent": {
      if (node.parentId === (command.parentId ?? undefined)) return null;
      const world = (item: GraphNode): { x: number; y: number } => {
        let x = item.position.x;
        let y = item.position.y;
        let parent = item.parentId ? document.nodes[item.parentId] : undefined;
        while (parent) { x += parent.position.x; y += parent.position.y; parent = parent.parentId ? document.nodes[parent.parentId] : undefined; }
        return { x, y };
      };
      const requestedParent = command.parentId ? document.nodes[command.parentId] : undefined;
      if (command.parentId && (!requestedParent || requestedParent.typeId !== "fxnode.common.frame")) return reject("parent.frame", "Parent must be an existing frame");
      const origin = requestedParent ? world(requestedParent) : { x: 0, y: 0 };
      const current = world(node);
      after = { ...node, position: { x: current.x - origin.x, y: current.y - origin.y }, parentId: command.parentId ?? undefined };
      break;
    }
    case "node.parameter-reset":
    case "node.parameter": { if (!node.known) return reject("node.unknown-readonly", "Unknown node parameters are read-only"); const schema = getDescriptor(node.typeId)?.parameters[command.key]; if (!schema) return reject("parameter.unknown", "Parameter is not declared"); const value=command.type==="node.parameter-reset"?schema.default:command.value; if (!validateValue(schema, value)) return reject("parameter.invalid", "Parameter does not match its schema"); if (same(node.parameters[command.key], value)) return null; after = { ...node, parameters: deepFreeze({ ...node.parameters, [command.key]: cloneJson(value) }) }; break; }
    case "node.socket-default-reset":
    case "node.socket-default": { if (!node.known) return reject("node.unknown-readonly", "Unknown node defaults are read-only"); const index = node.sockets.findIndex(socket => socket.id === command.socketId); if (index < 0) return reject("socket.missing", "Socket does not exist"); const schema=getDescriptor(node.typeId)?.sockets[index]?.value;const value=schema&&(command.type==="node.socket-default-reset"?schema.default:command.value);if(!schema||!validateValue(schema,value))return reject("socket.default-invalid","Socket has no editable value schema or value is invalid"); if (same(node.sockets[index]?.defaultValue, value)) return null; after = { ...node, sockets: node.sockets.map((socket, i) => i === index ? deepFreeze({ ...socket, defaultValue: cloneJson(value) }) : socket) }; break; }
  }
  return [{ kind: "node.set", id: node.id, before: node, after: deepFreeze(after) }];
}

export function transition(state: EngineState, request: CommandRequest): TransitionResult {
  if (request.expectedVersion !== state.version) return { status: "rejected", state, error: reject("version.stale", "Expected version does not match") };
  if (state.version >= Number.MAX_SAFE_INTEGER) return { status: "rejected", state, error: reject("version.overflow", "Version exhausted") };
  const cause = request.command.type === "undo" ? "undo" : request.command.type === "redo" ? "redo" : request.source;
  let mutations: readonly Mutation[]; let undo = state.undo; let redo = state.redo;
  if (cause === "undo" || cause === "redo") { const source = cause === "undo" ? state.undo : state.redo; const entry = source.at(-1); if (!entry) return { status: "noop", state }; mutations = cause === "undo" ? entry.inverse : entry.forward; undo = cause === "undo" ? state.undo.slice(0, -1) : [...state.undo, entry]; redo = cause === "redo" ? state.redo.slice(0, -1) : [...state.redo, entry]; }
  else { const planned = plan(state.document, request.command); if (planned === null) return { status: "noop", state }; if (!Array.isArray(planned)) return { status: "rejected", state, error: planned as CommandError }; mutations = planned; }
  const document = reduceMutations(state.document, mutations);
  const issue = validateDocument(document)[0];
  if (issue) return { status: "rejected", state, error: { code: issue.code, message: issue.message, path: issue.path } };
  if (cause === "api" || cause === "gesture") { const entry = deepFreeze({ forward: mutations, inverse: invert(mutations) }); undo = state.historyLimit === 0 ? [] : [...state.undo, entry].slice(-state.historyLimit); redo = []; }
  const next = deepFreeze({ ...state, version: state.version + 1, document, undo, redo });
  return { status: "committed", state: next, mutationEnvelope: deepFreeze({ baseVersion: state.version, version: next.version, commandId: request.commandId, cause, mutations }), snapshotEnvelope: deepFreeze({ version: next.version, snapshot: snapshot(next) }) };
}

export type LoadResult = { readonly ok: true; readonly state: EngineState; readonly mutationEnvelope: MutationEnvelope; readonly snapshotEnvelope: SnapshotEnvelope } | { readonly ok: false; readonly state: EngineState; readonly issues: readonly ValidationIssue[] };
export function load(state: EngineState, value: unknown, expectedVersion = state.version, id: CommandId = "load" as CommandId): LoadResult {
  if (expectedVersion !== state.version) return { ok: false, state, issues: [{ code: "version.stale", path: "/", message: "Expected version does not match" }] };
  const decoded = decodeGraphDocument(value);
  if (!decoded.ok) return { ok: false, state, issues: decoded.issues };
  if (state.version >= Number.MAX_SAFE_INTEGER) return { ok: false, state, issues: [{ code: "version.overflow", path: "/", message: "Version exhausted" }] };
  const next = deepFreeze({ ...state, version: state.version + 1, document: decoded.value, undo: [], redo: [] });
  const mutationEnvelope = deepFreeze({ baseVersion: state.version, version: next.version, commandId: id, cause: "load" as const, mutations: [{ kind: "document.replaced" as const, before: state.document, after: decoded.value }] });
  return { ok: true, state: next, mutationEnvelope, snapshotEnvelope: deepFreeze({ version: next.version, snapshot: snapshot(next) }) };
}
