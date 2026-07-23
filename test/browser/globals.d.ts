import type { FxNode } from "@lib/index.js";
import type { PreparedFxNodeBrowserHost } from "../../example/browser-host.js";
type LegacyFxNode = FxNode;

declare global {
  interface Window {
    api: LegacyFxNode;
    fxnodeHost: PreparedFxNodeBrowserHost;
    ready: Promise<boolean>;
    fxnodeExample: FxNodeExampleHandle;
    parityExample: LegacyFxNode;
    controlTest: { api: LegacyFxNode | null; ready: Promise<void> };
    linkToolsTest: { api: LegacyFxNode | null; ready: Promise<void> };
    controlEvents: { mutations: number[]; snapshots: number[] };
  }
  interface FxNodeExampleHandle {
    api: LegacyFxNode | null;
    ready: Promise<void>;
    readonly rendered: Promise<void>;
  }
  interface FxNodeEvidenceCounters {
    mutations: number;
    snapshots: number;
  }
}

export {};
