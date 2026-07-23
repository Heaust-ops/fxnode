import { createApplicationFxNode, type ApplicationFxNode } from "../application-browser.js";
import { prepareFxNodeBrowserHost } from "../browser-host.js";
import initialLayout from "./initialLayout.json";
const canvas = document.querySelector<HTMLCanvasElement>("#link-tools");
if (!canvas) throw new Error("Link tools test canvas missing");
const host = prepareFxNodeBrowserHost({ canvas });
const handle: { api: ApplicationFxNode | null; ready: Promise<void> } = { api: null, ready: Promise.resolve() };
window.linkToolsTest = handle;
handle.ready = (async () => {
  let api: ApplicationFxNode | undefined;
  try {
    api = await createApplicationFxNode({ canvas, viewport: host.initialViewport, initialLayout });
    handle.api = api;
    host.attach(api);
    await api.whenRendered();
  } catch (error) {
    host.destroy();
    api?.destroy();
    throw error;
  }
})();
