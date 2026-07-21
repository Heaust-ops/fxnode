import { deepFreeze } from "../core/json.js";
import { CATALOG_NODE_IDS, type BuiltinNodeTypeId } from "./scope.js";
import { BUILTIN_DESCRIPTORS } from "./descriptors.js";
import type { NodeDescriptor } from "./types.js";
import { assertValueSchema } from "./value-schema.js";

deepFreeze(BUILTIN_DESCRIPTORS);
const registry = new Map<BuiltinNodeTypeId, NodeDescriptor>(BUILTIN_DESCRIPTORS.map(item => [item.typeId, item.ui ? item : deepFreeze({ ...item, ui: [
  ...Object.keys(item.parameters).map(key => ({ kind: "parameter" as const, key })),
  ...item.sockets.map(socket => ({ kind: "socket" as const, key: socket.key })),
] })]));

if (registry.size !== CATALOG_NODE_IDS.length || CATALOG_NODE_IDS.some(id => !registry.has(id))) throw new Error("Catalog must cover every declared node type exactly once");
for (const item of BUILTIN_DESCRIPTORS) {
  if (!item.typeId.startsWith(`fxnode.${item.family}.`)) throw new Error(`Invalid family for ${item.typeId}`);
  const keys = item.sockets.map(socket => socket.key);
  if (new Set(keys).size !== keys.length) throw new Error(`Duplicate socket key in ${item.typeId}`);
  for (const [key, schema] of Object.entries(item.parameters)) assertValueSchema(schema, `${item.typeId}.parameters.${key}`);
  for (const socket of item.sockets) {
    if (socket.value) assertValueSchema(socket.value, `${item.typeId}.sockets.${socket.key}`);
    if (socket.value && (socket.direction !== "input" || socket.maxIncomingLinks === 0 || socket.dataType === "shader" || socket.dataType === "geometry" || socket.dataType === "any")) throw new Error(`Invalid editable socket ${item.typeId}.${socket.key}`);
    if (socket.visibleWhen && "parameter" in socket.visibleWhen && !(socket.visibleWhen.parameter in item.parameters)) throw new Error(`Unknown visibility parameter ${item.typeId}.${socket.key}`);
  }
}

export const DESCRIPTOR_REGISTRY: ReadonlyMap<BuiltinNodeTypeId, NodeDescriptor> = Object.freeze({
  get: (key: BuiltinNodeTypeId) => registry.get(key),
  has: (key: BuiltinNodeTypeId) => registry.has(key),
  entries: () => registry.entries(),
  keys: () => registry.keys(),
  values: () => registry.values(),
  forEach: (callback: (value: NodeDescriptor, key: BuiltinNodeTypeId, map: ReadonlyMap<BuiltinNodeTypeId, NodeDescriptor>) => void, thisArg?: unknown) => registry.forEach((value, key) => callback.call(thisArg, value, key, DESCRIPTOR_REGISTRY)),
  get size() { return registry.size; },
  [Symbol.iterator]: () => registry[Symbol.iterator](),
});

export function getDescriptor(typeId: string): NodeDescriptor | undefined {
  return registry.get(typeId as BuiltinNodeTypeId);
}
