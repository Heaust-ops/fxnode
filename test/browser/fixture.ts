import { createApplicationFxNode } from "../../example/application-browser.js";
import { prepareFxNodeBrowserHost } from "../../example/browser-host.js";
const initialLayout = { graphId: "browser", catalogVersion: 4, nodes: [], links: [], metadata: {} };
window.ready = (async () => {
  const primary = document.querySelector<HTMLCanvasElement>("#primary");
  const addNodeMenuTemplate = document.querySelector<HTMLTemplateElement>("#add-node-menu-template");
  if (!primary || !addNodeMenuTemplate) throw new Error("Primary canvas or add-node menu template missing");
  const host = prepareFxNodeBrowserHost({ canvas: primary, addNodeMenuTemplate });
  let api: Awaited<ReturnType<typeof createApplicationFxNode>> | undefined;
  try {
    api = await createApplicationFxNode({
      canvas: primary,
      viewport: host.initialViewport,
      initialLayout,
    });
    host.attach(api);
    window.api = api;
    window.fxnodeHost = host;
    await api.whenRendered();
    return true;
  } catch (error) {
    host.destroy();
    api?.destroy();
    throw error;
  }
})();
