import { compileFxNodeComposition } from "./composition/compile.js";
import { bindDocument } from "./composition/bound-document.js";
import { bindEngine } from "./composition/bound-engine.js";
import type { CompiledFxNodeComposition, FxNodeCompositionData } from "./composition/types.js";
import type { ReferenceCheck } from "./composition/references.js";

export interface FxNodeHeadless<C extends FxNodeCompositionData>
  extends ReturnType<typeof bindDocument<C>>,
    ReturnType<typeof bindEngine<C>> {}
/** @internal Binds an already compiled authority without recompiling it. */
export function bindFxNodeHeadless<C extends FxNodeCompositionData>(
  compiled: CompiledFxNodeComposition<C>,
): FxNodeHeadless<C> {
  return Object.freeze({ ...bindDocument(compiled), ...bindEngine(compiled) });
}

/** Creates an isolated composition-bound document and engine runtime. The composition is compiled exactly once. */
export function createFxNodeHeadless<const C extends FxNodeCompositionData>(
  composition: C & ReferenceCheck<C>,
): FxNodeHeadless<C> {
  const compiled = compileFxNodeComposition(composition);
  return bindFxNodeHeadless(compiled);
}
