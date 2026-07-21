import type { ParameterValue, SocketDataType } from "../core/types.js";
import type { BuiltinNodeTypeId, CatalogDomain } from "./scope.js";

export type ValueSchema =
  | { readonly type: "number"; readonly default: ParameterValue; readonly minimum?: number; readonly maximum?: number; readonly hardMin?: number; readonly hardMax?: number; readonly softMin?: number; readonly softMax?: number; readonly step?: number; readonly precision?: number; readonly integer?: boolean }
  | { readonly type: "string"; readonly default: ParameterValue; readonly enum?: readonly string[] }
  | { readonly type: "boolean" | "vector" | "color"; readonly default: ParameterValue; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: "color-ramp"; readonly default: ParameterValue };
/** @deprecated ValueSchema is shared by parameters and editable socket values. */
export type ParameterSchema = ValueSchema;
export interface SocketDescriptor {
  readonly key: string;
  readonly label: string;
  readonly direction: "input" | "output";
  readonly dataType: SocketDataType;
  readonly accepts: readonly SocketDataType[];
  readonly maxIncomingLinks: number;
  /** Schema and initial value for an editable input. Not persisted verbatim. */
  readonly value?: ValueSchema;
  readonly visible: boolean;
  readonly visibleWhen?: VisibilityExpression;
}
export type VisibilityExpression =
  | { readonly parameter: string; readonly equals: string | boolean | number }
  | { readonly parameter: string; readonly in: readonly (string | boolean | number)[] }
  | { readonly all: readonly VisibilityExpression[] }
  | { readonly any: readonly VisibilityExpression[] };
export type DescriptorUiItem =
  | { readonly kind: "parameter"; readonly key: string; readonly label?: string; readonly visibleWhen?: VisibilityExpression }
  | { readonly kind: "resource"; readonly key: string; readonly label?: string; readonly openLabel?: string; readonly newLabel?: string; readonly visibleWhen?: VisibilityExpression }
  | { readonly kind: "grading-pair"; readonly scalar: string; readonly color: string; readonly label: string; readonly visibleWhen?: VisibilityExpression }
  | { readonly kind: "section" | "panel"; readonly label: string; readonly visibleWhen?: VisibilityExpression }
  | { readonly kind: "eyedropper"; readonly label: string; readonly visibleWhen?: VisibilityExpression }
  | { readonly kind: "socket"; readonly key: string; readonly label?: string; readonly visibleWhen?: VisibilityExpression; readonly muteBypass?: readonly [string, string] }
  | { readonly kind: "header" | "category"; readonly label: string; readonly visibleWhen?: VisibilityExpression };
export interface NodeDescriptor {
  readonly typeId: BuiltinNodeTypeId;
  readonly version: number;
  readonly family: CatalogDomain;
  readonly role: "container" | "input" | "output" | "operator" | "utility";
  readonly label: string;
  readonly defaultWidth: number;
  readonly sockets: readonly SocketDescriptor[];
  readonly parameters: Readonly<Record<string, ValueSchema>>;
  /** Explicit, type-compatible input/output socket keys used for muted-node display bypasses. */
  readonly muteBypass?: readonly (readonly [string, string])[];
  /** Authoritative display order. Registry construction derives this once when omitted. */
  readonly ui?: readonly DescriptorUiItem[];
}
