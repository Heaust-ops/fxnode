import type { NodeReferenceCheck } from "./references.js";
import type {
  FxNodeCompositionData,
  FxNodeDefinition,
  FxNodeSocketTypeDefinition,
  FxNodeStyleDefinition,
  FxNodeTheme,
} from "./types.js";

type ReplaceProperty<T, K extends keyof T, V> = { readonly [P in keyof T]: P extends K ? V : T[P] };
type PutProperty<T, K extends PropertyKey, V> = {
  readonly [P in keyof T | K]: P extends K ? V : P extends keyof T ? T[P] : never;
};
type EntryValue<E, K extends PropertyKey> = E extends readonly [K, infer V] ? V : never;
type PutEntries<T, E extends readonly [string, unknown]> = {
  readonly [P in keyof T | E[0]]: P extends E[0] ? EntryValue<E, P> : P extends keyof T ? T[P] : never;
};
type NodeStyleReference<D> = D extends { readonly style: infer S extends string } ? S : never;
type SocketTypeReference<D> = D extends { readonly sockets: infer S }
  ? S[keyof S] extends infer Socket
    ? Socket extends { readonly type: infer T extends string }
      ? T
      : never
    : never
  : never;
type ResourceReference<D> = D extends { readonly ui: readonly (infer R)[] }
  ? R extends { readonly kind: "resource"; readonly resource: infer I extends string }
    ? I
    : never
  : never;
export type NodeReferenceTarget<D extends FxNodeDefinition> = {
  readonly nodeStyles: Readonly<Record<NodeStyleReference<D>, unknown>>;
  readonly socketTypes: Readonly<Record<SocketTypeReference<D>, unknown>>;
  readonly resources: Readonly<Record<ResourceReference<D>, unknown>>;
};
export type NodeCompositionEntry = readonly [id: string, definition: FxNodeDefinition];
export type SocketCompositionEntry = readonly [id: string, definition: FxNodeSocketTypeDefinition];
export type ComposedNode<
  C extends FxNodeCompositionData,
  I extends string,
  D extends FxNodeDefinition,
> = ReplaceProperty<C, "nodes", PutProperty<C["nodes"], I, D>>;
export type ComposedNodes<C extends FxNodeCompositionData, E extends NodeCompositionEntry> = ReplaceProperty<
  C,
  "nodes",
  PutEntries<C["nodes"], E>
>;
export type ComposedSocket<
  C extends Pick<FxNodeCompositionData, "socketTypes">,
  I extends string,
  D extends FxNodeSocketTypeDefinition,
> = ReplaceProperty<C, "socketTypes", PutProperty<C["socketTypes"], I, D>>;
export type ComposedSockets<
  C extends Pick<FxNodeCompositionData, "socketTypes">,
  E extends SocketCompositionEntry,
> = ReplaceProperty<C, "socketTypes", PutEntries<C["socketTypes"], E>>;
type ThemeTarget = Omit<FxNodeCompositionData, "theme"> & { readonly theme?: FxNodeTheme };
export type Themed<C, T> = PutProperty<C, "theme", T>;
export type RemovedSocket<
  C extends Pick<FxNodeCompositionData, "socketTypes">,
  I extends Extract<keyof C["socketTypes"], string>,
> = ReplaceProperty<C, "socketTypes", Omit<C["socketTypes"], I>>;
export type RemovedNode<
  C extends Pick<FxNodeCompositionData, "nodes">,
  I extends Extract<keyof C["nodes"], string>,
> = ReplaceProperty<C, "nodes", Omit<C["nodes"], I>>;

export function setTheme<const C extends ThemeTarget, const T extends FxNodeTheme>(
  composition: C,
  theme: T,
): Themed<C, T>;
export function setTheme(composition: ThemeTarget, theme: FxNodeTheme): FxNodeCompositionData {
  return { ...composition, theme };
}
export type HeaderStyled<C, S> = { readonly [P in keyof C]: P extends "nodeStyles" ? S : C[P] };
export function setHeaderStyles<
  const C extends Pick<FxNodeCompositionData, "nodeStyles">,
  const S extends Readonly<Record<string, FxNodeStyleDefinition>>,
>(composition: C, styles: S): HeaderStyled<C, S>;
export function setHeaderStyles(
  composition: Pick<FxNodeCompositionData, "nodeStyles">,
  styles: Readonly<Record<string, FxNodeStyleDefinition>>,
): Pick<FxNodeCompositionData, "nodeStyles"> {
  return { ...composition, nodeStyles: styles };
}
export function composeSocket<
  const C extends Pick<FxNodeCompositionData, "socketTypes">,
  const I extends string,
  const D extends FxNodeSocketTypeDefinition<Extract<keyof NoInfer<C>["socketTypes"], string> | I>,
>(composition: C, id: I, definition: D): ComposedSocket<C, I, D>;
export function composeSocket(
  composition: Pick<FxNodeCompositionData, "socketTypes">,
  id: string,
  definition: FxNodeSocketTypeDefinition,
): Pick<FxNodeCompositionData, "socketTypes"> {
  return { ...composition, socketTypes: { ...composition.socketTypes, [id]: definition } };
}
export function removeSocket<
  const C extends Pick<FxNodeCompositionData, "socketTypes">,
  const I extends Extract<keyof C["socketTypes"], string>,
>(composition: C, id: I): RemovedSocket<C, I>;
export function removeSocket(
  composition: Pick<FxNodeCompositionData, "socketTypes">,
  id: string,
): Pick<FxNodeCompositionData, "socketTypes"> {
  const { [id]: _, ...socketTypes } = composition.socketTypes;
  return { ...composition, socketTypes };
}
export function composeNode<
  const D extends FxNodeDefinition,
  const C extends FxNodeCompositionData & NodeReferenceTarget<NoInfer<D>>,
  const I extends string,
>(
  composition: C,
  id: I,
  definition: D & NodeReferenceCheck<NoInfer<C> & NodeReferenceTarget<NoInfer<D>>, D>,
): ComposedNode<C, I, D>;
export function composeNode(
  composition: FxNodeCompositionData,
  id: string,
  definition: FxNodeDefinition,
): FxNodeCompositionData {
  return { ...composition, nodes: { ...composition.nodes, [id]: definition } };
}
export function removeNode<
  const C extends Pick<FxNodeCompositionData, "nodes">,
  const I extends Extract<keyof C["nodes"], string>,
>(composition: C, id: I): RemovedNode<C, I>;
export function removeNode(
  composition: Pick<FxNodeCompositionData, "nodes">,
  id: string,
): Pick<FxNodeCompositionData, "nodes"> {
  const { [id]: _, ...nodes } = composition.nodes;
  return { ...composition, nodes };
}
