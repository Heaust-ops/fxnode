import type { CompositionReceipt, FxNode } from "@lib/index.js";
import type { PreparedFxNodeBrowserHost } from "./browser-host.js";

declare global {
  interface StandaloneExampleHandle {
    api: FxNode | null;
    host: PreparedFxNodeBrowserHost;
    ready: Promise<void>;
    graphVersion?: number;
    lastCompositionReceipt?: CompositionReceipt;
    cleanup(): void;
  }
  interface Window {
    fxnodeStandalone: StandaloneExampleHandle;
  }
}
export {};
