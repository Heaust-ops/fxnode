import { createFxNode } from "@lib/index.js";
import { prepareFxNodeBrowserHost } from "../shared/browser-host.js";
import { exampleTheme } from "../shared/theme.js";
import { liveNodeV1, liveNodeV2, liveSocket, liveStyles } from "./definitions.js";
const canvas = document.querySelector<HTMLCanvasElement>("#graph")!,
  button = document.querySelector<HTMLButtonElement>("#compose")!,
  status = document.querySelector<HTMLElement>("#status")!,
  host = prepareFxNodeBrowserHost({ canvas });
let cleanedUp = false;
function cleanup() {
  window.removeEventListener("pagehide", cleanup);
  cleanedUp = true;
  button.removeEventListener("click", compose);
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
let revision = 0;
async function compose() {
  if (!handle.api) return;
  button.disabled = true;
  status.textContent = "Composing version 2…";
  try {
    const receipt = await handle.api.composeNode(...liveNodeV2, { expectedRevision: revision });
    revision = receipt.revision;
    handle.lastCompositionReceipt = receipt;
    status.textContent = `Version 2 ${receipt.status}; revision ${receipt.revision}; graph ${receipt.graphChanged ? "migrated" : "unchanged"}`;
    await handle.api.whenRendered();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    button.disabled = false;
    throw error;
  }
}
button.addEventListener("click", compose);
handle.ready = (async () => {
  try {
    const api = await createFxNode({
      canvas,
      viewport: host.initialViewport,
      applicationId: "fxnode.example.live-composition",
      applicationVersion: 1,
      resources: {},
    });
    if (cleanedUp) {
      api.destroy();
      return;
    }
    handle.api = api;
    await api.setTheme(exampleTheme);
    await api.setHeaderStyles(liveStyles);
    await api.composeSocket(...liveSocket);
    const receipt = await api.composeNode(...liveNodeV1);
    revision = receipt.revision;
    await api.setState({ graphId: "live", catalogVersion: 1, nodes: [], links: [], metadata: {} });
    const added = await api.addNode({
      nodeId: "live-node",
      typeId: liveNodeV1[0],
      viewPosition: { x: 340, y: 160 },
    });
    handle.graphVersion = added.version;
    host.attach(api);
    await api.whenRendered();
  } catch (error) {
    handle.cleanup();
    throw error;
  }
})();
