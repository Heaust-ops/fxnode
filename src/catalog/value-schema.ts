import { isRecord } from "../core/json.js";
import type { ParameterValue } from "../core/types.js";
import type { ValueSchema } from "./types.js";
import { isColorRamp } from "./color-ramp.js";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateValue(schema: ValueSchema, value: unknown): value is ParameterValue {
  if (!isRecord(value) || value.kind !== schema.type && !(schema.type === "color-ramp" && value.kind === "json")) return false;
  if (schema.type === "number") return finite(value.value) && (!schema.integer || Number.isSafeInteger(value.value)) && (schema.minimum === undefined || value.value >= schema.minimum) && (schema.maximum === undefined || value.value <= schema.maximum);
  if (schema.type === "boolean") return typeof value.value === "boolean";
  if (schema.type === "string") return typeof value.value === "string" && (!schema.enum || schema.enum.includes(value.value));
  if (schema.type === "vector" || schema.type === "color") {
    const length = schema.type === "vector" ? 3 : 4;
    return Array.isArray(value.value) && value.value.length === length && value.value.every(component => finite(component) && (schema.minimum === undefined || component >= schema.minimum) && (schema.maximum === undefined || component <= schema.maximum));
  }
  return isColorRamp(value.value);
}

export function assertValueSchema(schema: ValueSchema, path: string): void {
  if (!validateValue(schema, schema.default)) throw new TypeError(`Invalid ValueSchema default at ${path}`);
  if (schema.type === "number" && schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) throw new TypeError(`Invalid ValueSchema range at ${path}`);
}
