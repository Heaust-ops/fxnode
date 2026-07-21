import type { BuiltinNodeTypeId } from "../catalog/scope.js";
import { getDescriptor } from "../catalog/registry.js";
import { canonicalize, cloneJson, deepFreeze, isJson, isRecord, nullRecord } from "./json.js";
import { graphId, linkId, nodeId, socketId, type GraphDocument, type GraphLayoutV2, type GraphLink, type GraphNode, type JsonValue, type ParameterValue, type Socket } from "./types.js";
import { socketsCompatible } from "./socket-compatibility.js";
import { CATALOG_VERSION } from "../catalog/scope.js";
import { validateValue } from "../catalog/value-schema.js";
import { migrateColorRamp } from "../catalog/color-ramp.js";

export interface ValidationIssue { readonly code: string; readonly path: string; readonly message: string }
export type DecodeResult = { readonly ok: true; readonly value: GraphDocument } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const forbidden = new Set(["selection", "selected", "camera", "hover", "hovered", "runtimeVersion", "history", "undo", "redo", "session", "layout"]);
const idValid = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/u.test(value);
const dataTypes = new Set(["float", "vector", "color", "shader", "geometry", "any"]);
const parameter = (value: unknown): value is ParameterValue => {
  if (!isRecord(value) || !("value" in value) || Object.keys(value).some(key => key !== "kind" && key !== "value")) return false;
  if (value.kind === "number") return finite(value.value);
  if (value.kind === "boolean") return typeof value.value === "boolean";
  if (value.kind === "string") return typeof value.value === "string";
  if (value.kind === "vector") return Array.isArray(value.value) && value.value.length === 3 && value.value.every(finite);
  if (value.kind === "color") return Array.isArray(value.value) && value.value.length === 4 && value.value.every(finite);
  return value.kind === "json" && isJson(value.value);
};
const pointer = (...parts: string[]): string => `/${parts.map(part => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;

export function materializeNode(id: string, typeId: BuiltinNodeTypeId, position = { x: 0, y: 0 }, parentId?: string): GraphNode {
  const descriptor = getDescriptor(typeId);
  if (!descriptor) throw new TypeError(`Unknown catalog type: ${typeId}`);
  const sockets = descriptor.sockets.map(item => deepFreeze({ id: socketId(`${id}:${item.key}`), key: item.key, label: item.label, direction: item.direction, dataType: item.dataType, accepts: item.accepts, maxIncomingLinks: item.maxIncomingLinks, visible: item.visible, ...(item.value ? { defaultValue: cloneJson(item.value.default) } : {}) }));
  const parameters = Object.entries(descriptor.parameters).map(([key, schema]) => [key, cloneJson(schema.default)] as const);
  return deepFreeze({ id: nodeId(id), typeId, typeVersion: descriptor.version, known: true, position: cloneJson(position), size: deepFreeze({ x: descriptor.defaultWidth, y: 100 }), label: descriptor.label, parameters: nullRecord(parameters), sockets: deepFreeze(sockets), muted: false, collapsed: false, ...(parentId === undefined ? {} : { parentId: nodeId(parentId) }), extensions: nullRecord<JsonValue>() });
}
export const createNode = materializeNode;
export function emptyDocument(id = "graph"): GraphDocument {
  return deepFreeze({ schemaVersion: 2, graphId: graphId(id), catalogVersion: CATALOG_VERSION, nodes: nullRecord(), links: nullRecord(), metadata: nullRecord() });
}

export function validateDocument(document: GraphDocument): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const incomingBySocket=new Map<string,number>();for(const link of Object.values(document.links))if(!link.muted)incomingBySocket.set(link.toSocketId,(incomingBySocket.get(link.toSocketId)??0)+1);
  for (const [key, node] of Object.entries(document.nodes)) {
    if (key !== node.id) issues.push({ code: "id.mismatch", path: pointer("nodes", key), message: "Node key and id differ" });
    if (![node.position.x, node.position.y, node.size.x, node.size.y].every(finite)) issues.push({ code: "number.invalid", path: pointer("nodes", key), message: "Geometry must be finite" });
    if (node.size.x <= 0 || node.size.y <= 0) issues.push({ code: "size.nonpositive", path: pointer("nodes", key, "size"), message: "Node size must be positive" });
    if (node.known) {
      const descriptor=getDescriptor(node.typeId);
      if(!descriptor||node.typeVersion!==descriptor.version) issues.push({code:"catalog.version",path:pointer("nodes",key),message:"Unsupported descriptor version"});
      else { for(const [name,schema] of Object.entries(descriptor.parameters)) if(!validateValue(schema,node.parameters[name])) issues.push({code:"parameter.invalid",path:pointer("nodes",key,"parameters",name),message:"Parameter does not match schema"}); descriptor.sockets.forEach((expected,index)=>{const actual=node.sockets[index];if(!actual||actual.key!==expected.key||actual.direction!==expected.direction||actual.dataType!==expected.dataType||(expected.value?!validateValue(expected.value,actual.defaultValue):actual.defaultValue!==undefined))issues.push({code:"catalog.invalid",path:pointer("nodes",key,"sockets",String(index)),message:"Socket does not match descriptor schema"});}); }
    }
    if (node.parentId) {
      const parent = document.nodes[node.parentId];
      if (!parent || parent.typeId !== "fxnode.common.frame") issues.push({ code: "parent.frame", path: pointer("nodes", key, "parentId"), message: "Parent must be a frame" });
      const seen = new Set<string>([node.id]);
      let current = parent;
      while (current) { if (seen.has(current.id)) { issues.push({ code: "parent.cycle", path: pointer("nodes", key, "parentId"), message: "Parent cycle" }); break; } seen.add(current.id); current = current.parentId ? document.nodes[current.parentId] : undefined; }
    }
  }
  for (const [key, link] of Object.entries(document.links)) {
    const from = document.nodes[link.fromNodeId]?.sockets.find(item => item.id === link.fromSocketId);
    const to = document.nodes[link.toNodeId]?.sockets.find(item => item.id === link.toSocketId);
    if (!from || !to) { issues.push({ code: "link.endpoint", path: pointer("links", key), message: "Endpoint does not exist" }); continue; }
    if (!socketsCompatible(from, to)) issues.push({ code: from.direction !== "output" || to.direction !== "input" ? "link.direction" : "link.type", path: pointer("links", key), message: "Incompatible socket endpoints" });
    const incoming = incomingBySocket.get(to.id)??0;
    if (incoming > to.maxIncomingLinks) issues.push({ code: "link.limit", path: pointer("links", key), message: "Too many incoming links" });
  }
  return issues;
}

function hasForbidden(value: unknown, path: string, issues: ValidationIssue[], depth = 0): void {
  if (depth > 50) return;
  if (Array.isArray(value)) { value.forEach((child, index) => hasForbidden(child, `${path}/${index}`, issues, depth + 1)); return; }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) issues.push({ code: "field.transient", path: `${path}/${key}`, message: "Transient field is forbidden" });
    if (isRecord(child) || Array.isArray(child)) hasForbidden(child, `${path}/${key}`, issues, depth + 1);
  }
}

export function decodeGraphDocument(value: unknown): DecodeResult {
  const issues: ValidationIssue[] = [];
  if (isRecord(value) && Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) > 2) return { ok: false, issues: [{ code: "schema.future", path: "/schemaVersion", message: `Unsupported future schema version ${value.schemaVersion}` }] };
  // Persistence migration is deliberately performed on a clone; caller-owned JSON is never changed.
  if (isRecord(value)) value = structuredClone(value);
  if (isRecord(value) && value.schemaVersion === 1) value = { ...value, schemaVersion: 2, catalogVersion: CATALOG_VERSION, links: Array.isArray(value.links) ? value.links.map(link => isRecord(link) ? { ...link, muted: false } : link) : value.links };
  if(isRecord(value)){for(const[key,child]of Object.entries(value))if(key!=="nodes")hasForbidden(child,`/${key}`,issues);if(Array.isArray(value.nodes))value.nodes.forEach((node,index)=>{if(!isRecord(node)||getDescriptor(String(node.typeId)))hasForbidden(node,`/nodes/${index}`,issues);});}
  if (!isRecord(value) || value.schemaVersion !== 2 || !idValid(value.graphId) || !Number.isSafeInteger(value.catalogVersion) || (value.catalogVersion as number) <= 0 || !Array.isArray(value.nodes) || !Array.isArray(value.links) || !isRecord(value.metadata) || !isJson(value.metadata)) return { ok: false, issues: [...issues, { code: "decode.shape", path: "/", message: "Invalid GraphLayoutV2" }] };
  const nodes = new Map<string, GraphNode>();
  for (let index = 0; index < value.nodes.length; index++) {
    const raw = value.nodes[index];
    if (!isRecord(raw) || !idValid(raw.id) || !idValid(raw.typeId) || !Number.isSafeInteger(raw.typeVersion) || (raw.typeVersion as number) <= 0 || !isRecord(raw.position) || !finite(raw.position.x) || !finite(raw.position.y) || !isRecord(raw.size) || !finite(raw.size.x) || !finite(raw.size.y) || raw.size.x <= 0 || raw.size.y <= 0 || typeof raw.label !== "string" || !isRecord(raw.parameters) || !isJson(raw.parameters) || !Array.isArray(raw.sockets) || typeof raw.muted !== "boolean" || typeof raw.collapsed !== "boolean" || (raw.parentId !== undefined && !idValid(raw.parentId)) || !isRecord(raw.extensions) || !isJson(raw.extensions)) { issues.push({ code: "decode.node", path: pointer("nodes", String(index)), message: "Invalid node" }); continue; }
    if (nodes.has(raw.id)) { issues.push({ code: "id.duplicate", path: pointer("nodes", String(index), "id"), message: "Duplicate node id" }); continue; }
    const candidate=getDescriptor(raw.typeId);
    if (raw.typeId === "fxnode.shader.color-ramp") {
      const migrated = migrateColorRamp(raw.parameters.ramp);
      if (migrated) raw.parameters = { ...raw.parameters, ramp: { kind: "json", value: migrated } };
    }
    // Catalog v1 shipped incomplete Noise payloads and an untagged ramp stop array.
    if (candidate && raw.typeVersion === 1 && candidate.version === 2) {
      const fresh = materializeNode(raw.id, candidate.typeId);
      raw.parameters = { ...fresh.parameters, ...(raw.parameters as Record<string, JsonValue>) };
      const oldSockets = new Map((raw.sockets as unknown[]).filter(isRecord).map(socket => [socket.key, socket]));
      raw.sockets = fresh.sockets.map(socket => oldSockets.get(socket.key) ?? socket);
      raw.typeVersion = candidate.version;
    }
    const descriptor = candidate && raw.typeVersion === candidate.version ? candidate : undefined;
    const sockets: Socket[] = [];
    const socketIds = new Set<string>();
    for (const socket of raw.sockets as unknown[]) { if (!isRecord(socket) || !idValid(socket.id) || !idValid(socket.key) || typeof socket.label !== "string" || (socket.direction !== "input" && socket.direction !== "output") || !dataTypes.has(String(socket.dataType)) || !Array.isArray(socket.accepts) || !socket.accepts.every(type => dataTypes.has(String(type))) || new Set(socket.accepts).size !== socket.accepts.length || !Number.isSafeInteger(socket.maxIncomingLinks) || (socket.maxIncomingLinks as number) < 0 || typeof socket.visible !== "boolean" || (socket.defaultValue !== undefined && !parameter(socket.defaultValue)) || (socket.metadata !== undefined && (!isRecord(socket.metadata) || !isJson(socket.metadata)))) { issues.push({ code: "decode.socket", path: pointer("nodes", String(index), "sockets"), message: "Invalid socket" }); continue; } if (socketIds.has(socket.id)) { issues.push({ code: "id.duplicate", path: pointer("nodes", String(index), "sockets"), message: "Duplicate socket id" }); continue; } socketIds.add(socket.id); sockets.push(socket as unknown as Socket); }
    if (descriptor) {
      const rawParameters = raw.parameters as Record<string, unknown>;
      const descriptorSockets = descriptor.sockets.every((expected, i) => { const actual = sockets[i]; return actual !== undefined && actual.key === expected.key && actual.id === `${raw.id}:${expected.key}` && actual.label === expected.label && actual.direction === expected.direction && actual.dataType === expected.dataType && actual.maxIncomingLinks === expected.maxIncomingLinks && actual.visible === expected.visible && JSON.stringify(actual.accepts) === JSON.stringify(expected.accepts) && (expected.value ? validateValue(expected.value,actual.defaultValue) : actual.defaultValue === undefined); });
      const params = Object.entries(descriptor.parameters);
      const parametersMatch = Object.keys(rawParameters).length === params.length && params.every(([key, schema]) => validateValue(schema,rawParameters[key]));
      if (sockets.length !== descriptor.sockets.length || !descriptorSockets || !parametersMatch) issues.push({ code: "catalog.invalid", path: pointer("nodes", String(index)), message: "Known node does not match descriptor" });
    }
    const base = { ...raw, id: nodeId(raw.id), typeId: raw.typeId, typeVersion: Number(raw.typeVersion), position: raw.position, size: raw.size, parameters: raw.parameters, sockets, parentId: typeof raw.parentId === "string" ? nodeId(raw.parentId) : undefined };
    nodes.set(raw.id, cloneJson(descriptor ? { ...base, known: true, typeId: descriptor.typeId } : { ...base, known: false }) as unknown as GraphNode);
  }
  const links = new Map<string, GraphLink>();
  for (const raw of value.links) { if (!isRecord(raw) || !idValid(raw.id) || !idValid(raw.fromNodeId) || !idValid(raw.fromSocketId) || !idValid(raw.toNodeId) || !idValid(raw.toSocketId) || typeof raw.muted !== "boolean" || !isRecord(raw.extensions) || !isJson(raw.extensions)) { issues.push({ code: "decode.link", path: "/links", message: "Invalid link" }); continue; } if (links.has(raw.id)) { issues.push({ code: "id.duplicate", path: "/links", message: "Duplicate link id" }); continue; } links.set(raw.id, cloneJson({ ...raw, id: linkId(raw.id), fromNodeId: nodeId(raw.fromNodeId), fromSocketId: socketId(raw.fromSocketId), toNodeId: nodeId(raw.toNodeId), toSocketId: socketId(raw.toSocketId) }) as GraphLink); }
  if (issues.length) return { ok: false, issues: deepFreeze(issues.slice(0, 100)) };
  const document = deepFreeze({ schemaVersion: 2 as const, graphId: graphId(value.graphId), catalogVersion: CATALOG_VERSION, nodes: nullRecord(nodes), links: nullRecord(links), metadata: cloneJson(value.metadata) as Readonly<Record<string, JsonValue>> });
  const semantic = validateDocument(document);
  return semantic.length ? { ok: false, issues: semantic } : { ok: true, value: document };
}

export function save(document: GraphDocument): GraphLayoutV2 {
  return deepFreeze({ schemaVersion: 2, graphId: document.graphId, catalogVersion: document.catalogVersion, nodes: Object.values(document.nodes).map(({ known: _known, ...node }) => node).sort((a, b) => a.id.localeCompare(b.id)), links: Object.values(document.links).slice().sort((a, b) => a.id.localeCompare(b.id)), metadata: document.metadata });
}
export const serializeGraphDocument = (document: GraphDocument): string => JSON.stringify(canonicalize(save(document)));
export function parseGraphDocument(text: string): DecodeResult { try { return decodeGraphDocument(JSON.parse(text)); } catch { return { ok: false, issues: [{ code: "decode.json", path: "/", message: "Invalid JSON" }] }; } }
