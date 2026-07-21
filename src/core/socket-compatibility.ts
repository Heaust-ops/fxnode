import type { Socket } from "./types.js";

/** `any` is a destination wildcard only when it is the destination data type. */
export function socketsCompatible(from: Pick<Socket, "direction" | "dataType">, to: Pick<Socket, "direction" | "dataType" | "accepts">): boolean {
  return from.direction === "output" && to.direction === "input" &&
    (to.dataType === "any" || to.accepts.includes(from.dataType));
}
