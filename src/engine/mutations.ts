import type { GraphDocument, GraphLink, GraphNode, LinkId, NodeId } from "../core/types.js";

export type Mutation =
  | { readonly kind: "node.set"; readonly id: NodeId; readonly before: GraphNode | null; readonly after: GraphNode | null }
  | { readonly kind: "link.set"; readonly id: LinkId; readonly before: GraphLink | null; readonly after: GraphLink | null }
  | { readonly kind: "document.replaced"; readonly before: GraphDocument; readonly after: GraphDocument };
export function invert(mutations: readonly Mutation[]): readonly Mutation[] {
  return mutations.slice().reverse().map(mutation => mutation.kind === "node.set"
    ? { kind: "node.set", id: mutation.id, before: mutation.after, after: mutation.before }
    : mutation.kind === "link.set" ? { kind: "link.set", id: mutation.id, before: mutation.after, after: mutation.before }
    : { kind: "document.replaced", before: mutation.after, after: mutation.before });
}
