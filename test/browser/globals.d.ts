import type { FxNode } from "../../src/index.js";

declare global {
  interface Window {
    api: FxNode;
    ready: Promise<boolean>;
    fxnodeExample: FxNodeExampleHandle;
    parityExample: FxNode;
    controlTest: { api: FxNode | null; ready: Promise<void> };
    linkToolsTest: { api: FxNode | null; ready: Promise<void> };
    controlEvents: { mutations: number[]; snapshots: number[] };
  }
  interface FxNodeExampleHandle {
    api: FxNode | null;
    ready: Promise<void>;
    readonly rendered: Promise<void>;
  }
  interface FxNodeEvidenceCounters { mutations: number; snapshots: number }
}

export {};
