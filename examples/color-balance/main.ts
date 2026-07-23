import { createFxNode, type FxNodeSocketTypeDefinition, type FxNodeStyleDefinition } from "@lib/index.js";
import { prepareFxNodeBrowserHost } from "../shared/browser-host.js";
import { colorBalanceNode } from "../shared/nodes/color-balance.js";
import { exampleTheme } from "../shared/theme.js";
const floatSocket = [
  "float",
  { title: "Float", color: "#a8a8a8", acceptsFrom: ["float"] },
] as const satisfies readonly [string, FxNodeSocketTypeDefinition];
const colorSocket = [
  "color",
  { title: "Color", color: "#d7ca63", acceptsFrom: ["color"] },
] as const satisfies readonly [string, FxNodeSocketTypeDefinition];
const styles = { compositorColor: { header: "#8c5cc4" } } as const satisfies Readonly<
  Record<string, FxNodeStyleDefinition>
>;
const canvas = document.querySelector<HTMLCanvasElement>("#graph")!,
  host = prepareFxNodeBrowserHost({ canvas });
let cleanedUp = false;
function cleanup() {
  window.removeEventListener("pagehide", cleanup);
  cleanedUp = true;
  const api = handle.api;
  handle.api = null;
  host.destroy();
  api?.destroy();
}
const handle: StandaloneExampleHandle = {
  api: null,
  host,
  ready: Promise.resolve(),
  cleanup,
};
window.fxnodeStandalone = handle;
window.addEventListener("pagehide", cleanup);
handle.ready = (async () => {
  try {
    const api = await createFxNode({
      canvas,
      viewport: host.initialViewport,
      applicationId: "fxnode.example.color-balance",
      applicationVersion: 1,
      resources: {},
    });
    if (cleanedUp) {
      api.destroy();
      return;
    }
    handle.api = api;
    await api.setTheme(exampleTheme);
    await api.setHeaderStyles(styles);
    await api.composeSocket(...floatSocket);
    await api.composeSocket(...colorSocket);
    await api.composeNode(...colorBalanceNode);
    await api.setState({ graphId: "color-balance", catalogVersion: 1, nodes: [], links: [], metadata: {} });
    await api.addNode({ nodeId: "color-balance", typeId: colorBalanceNode[0], viewPosition: { x: 300, y: 40 } });
    host.attach(api);
    await api.whenRendered();
  } catch (error) {
    handle.cleanup();
    throw error;
  }
})();
