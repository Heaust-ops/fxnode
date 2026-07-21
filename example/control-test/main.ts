import { createFxNode, type FxNode } from "../../src/index.js";
import { materializeNode } from "../../src/core/document.js";
import type { GraphLayoutV2 } from "../../src/core/types.js";

const nodes = [
  materializeNode("value", "fxnode.shader.value", { x: -500, y: 200 }),
  materializeNode("math", "fxnode.shader.math", { x: -250, y: 200 }),
  materializeNode("vector", "fxnode.shader.vector-math", { x: 20, y: 200 }),
  materializeNode("color", "fxnode.shader.color", { x: 300, y: 200 }),
  materializeNode("group", "fxnode.common.group-input", { x: -100, y: -100 }),
];
const layout: GraphLayoutV2 = {
  schemaVersion: 2, graphId: "control-test", catalogVersion: 3,
  nodes: nodes.map(({ known: _known, ...node }) => node),
  links: [{ id: "value-math", fromNodeId: "value", fromSocketId: "value:value", toNodeId: "math", toSocketId: "math:a", muted: false, extensions: {} }], metadata: {},
};
const canvas = document.querySelector<HTMLCanvasElement>("#controls");
if (!canvas) throw new Error("Control test canvas missing");
const handle: { api: FxNode | null; ready: Promise<void> } = { api: null, ready: Promise.resolve() };
window.controlTest = handle;
handle.ready = (async () => {
  handle.api = await createFxNode({ canvas, layout });
  await handle.api.whenRendered();
})();
