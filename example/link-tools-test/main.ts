import { createFxNode, type FxNode } from "../../src/index.js";
import { materializeNode } from "../../src/core/document.js";
import type { GraphLayoutV2, GraphNode } from "../../src/core/types.js";

const node = (id: string, type: Parameters<typeof materializeNode>[1], x: number, y: number): GraphNode => {
  const { known: _known, ...result } = materializeNode(id, type, { x, y });
  return result;
};
const nodes = [
  // Page map at 1200x640, camera origin (600,320): the first three links
  // are horizontal at CSS y=100, 220 and 340 and cross the x=600 stroke.
  node("source-a", "fxnode.shader.value", -560, 240), node("math-a", "fxnode.shader.math", 180, 240),
  node("source-b", "fxnode.shader.value", -560, 120), node("math-b", "fxnode.shader.math", 180, 120),
  node("source-c", "fxnode.shader.value", -560, 0), node("math-c", "fxnode.shader.math", 180, 0),
  // A separate reroute chain crosses x=600 at y=440. Muting its authored
  // incoming link makes the authored-clean outgoing link effectively muted.
  node("chain-source", "fxnode.shader.value", -560, -100), node("reroute", "fxnode.common.reroute", 0, -100),
  node("chain-math", "fxnode.shader.math", 260, -100),
  node("transform", "fxnode.geometry.transform-geometry", -300, -230),
  node("noise", "fxnode.shader.noise-texture", 180, -230),
];
const links = [
  ["parallel-a", "source-a", "source-a:value", "math-a", "math-a:a"],
  ["parallel-b", "source-b", "source-b:value", "math-b", "math-b:a"],
  ["parallel-c", "source-c", "source-c:value", "math-c", "math-c:a"],
  ["chain-in", "chain-source", "chain-source:value", "reroute", "reroute:input"],
  ["chain-out", "reroute", "reroute:output", "chain-math", "chain-math:a"],
] as const;
const layout: GraphLayoutV2 = { schemaVersion: 2, graphId: "link-tools-test", catalogVersion: 3, nodes,
  links: links.map(([id, fromNodeId, fromSocketId, toNodeId, toSocketId]) => ({ id, fromNodeId, fromSocketId, toNodeId, toSocketId, muted: false, extensions: {} })), metadata: {} };
const canvas = document.querySelector<HTMLCanvasElement>("#link-tools");
if (!canvas) throw new Error("Link tools test canvas missing");
const handle: { api: FxNode | null; ready: Promise<void> } = { api: null, ready: Promise.resolve() };
window.linkToolsTest = handle;
handle.ready = (async () => { handle.api = await createFxNode({ canvas, layout }); await handle.api.whenRendered(); })();
