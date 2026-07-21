import { createFxNode, type FxNode } from "../src/index.js";
import { getDescriptor } from "../src/catalog/registry.js";
import { materializeNode } from "../src/core/document.js";
import type { BuiltinNodeTypeId } from "../src/catalog/scope.js";

const canvas = document.querySelector<HTMLCanvasElement>("#graph");
if (!canvas) throw new Error("Example canvas is missing");

let resolveRendered!: () => void;
const rendered = new Promise<void>(resolve => { resolveRendered = resolve; });
const handle: FxNodeExampleHandle = { api: null, ready: Promise.resolve(), rendered };
window.fxnodeExample = handle;

handle.ready = (async () => {
  const response = await fetch("./fixture.json");
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  const persisted = await response.json() as {nodes:Array<Record<string,unknown>>;links:unknown[];[key:string]:unknown};
  // Keep the compact interaction fixture coordinate-stable while deriving its
  // catalog-owned fields from current descriptors.
  const layout: unknown = {...persisted,nodes:persisted.nodes.map(raw=>{const type=String(raw.typeId);if(!getDescriptor(type))return raw;const fresh=materializeNode(String(raw.id),type as BuiltinNodeTypeId,raw.position as {x:number;y:number},raw.parentId as string|undefined);const {known:_,...node}=fresh;return{...node,size:raw.size,label:raw.label,muted:raw.muted,collapsed:raw.collapsed,extensions:raw.extensions};})};
  const api: FxNode = await createFxNode({ canvas, layout });
  handle.api = api;
  await api.whenRendered();
  resolveRendered();
})();
