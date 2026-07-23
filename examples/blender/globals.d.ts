import type { FxNode } from "@lib/index.js";
import type { PreparedFxNodeBrowserHost } from "../shared/browser-host.js";

declare global {
  interface FxNodeExampleHandle {
    api: FxNode | null;
    host: PreparedFxNodeBrowserHost;
    ready: Promise<void>;
    readonly rendered: Promise<void>;
  }
  interface Window {
    fxnodeExample: FxNodeExampleHandle;
    linkToolsTest: { api: FxNode | null; ready: Promise<void> };
  }
}

export {};
