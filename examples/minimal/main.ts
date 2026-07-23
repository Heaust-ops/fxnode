import { createFxNode } from "@lib/index.js";
import { prepareFxNodeBrowserHost } from "../shared/browser-host.js";
import { exampleTheme } from "../shared/theme.js";
import { minimalStyles, numberSocket, valueNode } from "./definition.js";

const canvas = document.querySelector<HTMLCanvasElement>("#graph")!;
const host = prepareFxNodeBrowserHost({ canvas });
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
      applicationId: "fxnode.example.minimal",
      applicationVersion: 1,
      resources: {},
    });
    if (cleanedUp) {
      api.destroy();
      return;
    }
    handle.api = api;
    await api.setTheme(exampleTheme);
    await api.setHeaderStyles(minimalStyles);
    await api.composeSocket(...numberSocket);
    await api.composeNode(...valueNode);
    await api.setState({ graphId: "minimal", catalogVersion: 1, nodes: [], links: [], metadata: {} });
    await api.addNode({ nodeId: "value", typeId: valueNode[0], viewPosition: { x: 360, y: 190 } });
    host.attach(api);
    await api.whenRendered();
  } catch (error) {
    handle.cleanup();
    throw error;
  }
})();
