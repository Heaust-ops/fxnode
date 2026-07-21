import { createFxNode, type FxNode } from "../../src/index.js";
import { materializeNode } from "../../src/core/document.js";
import type { GraphLayoutV2 } from "../../src/core/types.js";

const frame = materializeNode("frame", "fxnode.common.frame", { x: -300, y: 250 });
const ramp = materializeNode("ramp", "fxnode.shader.color-ramp", { x: 40, y: -40 });
const rampValue = {
  colorMode: "rgb", interpolation: "linear", hueInterpolation: "near",
  stops: [
    { id: "red", position: .1, color: [1, 0, 0, 1] },
    { id: "green", position: .35, color: [0, 1, 0, .8] },
    { id: "blue", position: .9, color: [0, 0, 1, .6] },
  ],
};
const layout: GraphLayoutV2 = {
  schemaVersion: 2, graphId: "ramp-test", catalogVersion: 7,
  nodes: [
    { ...frame, known: undefined, size: { x: 380, y: 310 } },
    { ...ramp, known: undefined, parentId: "frame", parameters: { ...ramp.parameters, ramp: { kind: "json", value: rampValue } } },
  ].map(({ known: _known, ...node }) => node),
  links: [], metadata: {},
};
const canvas = document.querySelector<HTMLCanvasElement>("#ramp");
if (!canvas) throw new Error("Ramp test canvas missing");
const handle: { api: FxNode | null; ready: Promise<void> } = { api: null, ready: Promise.resolve() };
(window as typeof window & { rampTest: typeof handle }).rampTest = handle;
handle.ready = (async () => { handle.api = await createFxNode({ canvas, layout }); await handle.api.whenRendered(); })();
