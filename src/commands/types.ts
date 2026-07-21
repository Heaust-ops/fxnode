import type { BuiltinNodeTypeId } from "../catalog/scope.js";
import type { CommandId, GraphLink, LinkId, NodeId, ParameterValue, SocketId, Vec2 } from "../core/types.js";

export type Command =
  | { readonly type: "batch"; readonly commands: readonly BatchCommand[] }
  | { readonly type: "node.add"; readonly nodeId: NodeId; readonly nodeType: BuiltinNodeTypeId; readonly position: Vec2; readonly parentId?: NodeId }
  | { readonly type: "node.remove"; readonly id: NodeId }
  | { readonly type: "node.move"; readonly id: NodeId; readonly position: Vec2 }
  | { readonly type: "node.resize"; readonly id: NodeId; readonly size: Vec2 }
  | { readonly type: "node.label"; readonly id: NodeId; readonly label: string }
  | { readonly type: "node.parameter"; readonly id: NodeId; readonly key: string; readonly value: ParameterValue }
  | { readonly type: "node.parameter-reset"; readonly id: NodeId; readonly key: string }
  | { readonly type: "node.socket-default"; readonly id: NodeId; readonly socketId: SocketId; readonly value: ParameterValue }
  | { readonly type: "node.socket-default-reset"; readonly id: NodeId; readonly socketId: SocketId }
  | { readonly type: "node.mute" | "node.collapse"; readonly id: NodeId; readonly value: boolean }
  | { readonly type: "node.parent"; readonly id: NodeId; readonly parentId: NodeId | null }
  | { readonly type: "link.add"; readonly link: GraphLink }
  | { readonly type: "link.remove"; readonly id: LinkId }
  | { readonly type: "link.mute"; readonly id: LinkId; readonly value: boolean }
  | { readonly type: "link.replace"; readonly removeId: LinkId; readonly link: GraphLink }
  | { readonly type: "undo" }
  | { readonly type: "redo" };
/** Atomic, deliberately non-recursive operations used by completed gestures. */
export type BatchCommand = Extract<Command,
  { readonly type: "node.move" | "node.resize" | "node.remove" | "node.mute" | "node.collapse" | "node.parent" | "link.remove" | "link.mute" }>;
export interface CommandRequest { readonly commandId: CommandId; readonly expectedVersion: number; readonly source: "api" | "gesture"; readonly command: Command }
export interface CommandError { readonly code: string; readonly message: string; readonly path?: string }
