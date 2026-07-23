import { createApplicationFxNode } from "./application-browser.js";
import { prepareFxNodeBrowserHost } from "./browser-host.js";
import initialLayout from "./initialLayout.json";

const canvas = document.querySelector<HTMLCanvasElement>("#graph");
const addNodeMenuTemplate = document.querySelector<HTMLTemplateElement>("#add-node-menu-template");
if (!canvas || !addNodeMenuTemplate) throw new Error("Example canvas or add-node menu template is missing");
const host = prepareFxNodeBrowserHost({ canvas, addNodeMenuTemplate });

let resolveRendered!: () => void;
const rendered = new Promise<void>((resolve) => {
  resolveRendered = resolve;
});
const handle: FxNodeExampleHandle = { api: null, host, ready: Promise.resolve(), rendered };
window.fxnodeExample = handle;

handle.ready = (async () => {
  let api: Awaited<ReturnType<typeof createApplicationFxNode>> | undefined;
  try {
    api = await createApplicationFxNode({ canvas, viewport: host.initialViewport, initialLayout });
    handle.api = api;
    host.attach(api);
    await api.whenRendered();
    resolveRendered();
  } catch (error) {
    host.destroy();
    api?.destroy();
    throw error;
  }
})();
