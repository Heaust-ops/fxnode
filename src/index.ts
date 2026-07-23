/**
 * Browser client and static composition API for fxnode.
 *
 * The client owns its worker and canvas resources until {@link FxNode.destroy};
 * graph state is worker-owned and observed through snapshots and versioned events.
 * @module fxnode
 */
export * from "./browser/client.js";
export type {
  FxNodeModifiers,
  FxNodeInput,
  FxNodeViewport,
  FxNodeHostSnapshot,
  AddNodeParams,
  FxNodeActionOptions,
  FxNodeSelectionSnapshot,
  FxNodeAddNodeMenuRequest,
  FxNodeResourceAuthorization,
  FxNodeImageResourceDescriptor,
  FxNodeResourceOpenRequest,
  FxNodeResourceData,
  FxNodeHostRequest,
} from "./browser/host-types.js";
export * from "./core/types.js";
export type { Command, BatchCommand, FxNodeReplayCommand, FxNodeSaveData } from "./commands/types.js";
export type { Mutation } from "./engine/mutations.js";
export type { MutationEnvelope, SnapshotEnvelope } from "./composition/bound-engine.js";
export * from "./composition/index.js";
