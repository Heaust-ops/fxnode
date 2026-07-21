import type { FxNode } from "../src/index.js";

declare global {
  interface FxNodeExampleHandle {
    api: FxNode | null;
    ready: Promise<void>;
    readonly rendered: Promise<void>;
  }
  interface Window { fxnodeExample: FxNodeExampleHandle; linkToolsTest: { api: FxNode | null; ready: Promise<void> } }
}

export {};
