import { createApplicationFxNode } from "../application-browser.js";
import { prepareFxNodeBrowserHost } from "../../shared/browser-host.js";
import initialLayout from "./initialLayout.json" with { type: "json" };
const canvas = document.querySelector("canvas")!;
const host = prepareFxNodeBrowserHost({ canvas });
let fxnode: Awaited<ReturnType<typeof createApplicationFxNode>> | undefined;
try {
  fxnode = await createApplicationFxNode({ canvas, viewport: host.initialViewport, initialLayout });
  host.attach(fxnode);
  await fxnode.whenRendered();
  window.parityExample = fxnode;
} catch (error) {
  host.destroy();
  fxnode?.destroy();
  throw error;
}
