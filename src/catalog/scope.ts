export const COMMON_NODE_IDS = [
  "fxnode.common.frame", "fxnode.common.reroute", "fxnode.common.group-input", "fxnode.common.group-output",
] as const satisfies readonly string[];
export const SHADER_NODE_IDS = [
  "fxnode.shader.value", "fxnode.shader.color", "fxnode.shader.math", "fxnode.shader.vector-math", "fxnode.shader.mix",
  "fxnode.shader.color-ramp", "fxnode.shader.texture-coordinate", "fxnode.shader.noise-texture",
  "fxnode.shader.image-texture",
  "fxnode.shader.principled-bsdf", "fxnode.shader.material-output",
] as const satisfies readonly string[];
export const GEOMETRY_NODE_IDS = [
  "fxnode.geometry.position", "fxnode.geometry.mesh-cube", "fxnode.geometry.set-position",
  "fxnode.geometry.transform-geometry", "fxnode.geometry.join-geometry",
] as const satisfies readonly string[];
export const COMPOSITOR_NODE_IDS = ["fxnode.compositor.image", "fxnode.compositor.color-balance"] as const satisfies readonly string[];
export const CATALOG_VERSION = 3 as const;
export const CATALOG_NODE_IDS = [...COMMON_NODE_IDS, ...SHADER_NODE_IDS, ...GEOMETRY_NODE_IDS, ...COMPOSITOR_NODE_IDS] as const satisfies readonly string[];
export type CommonNodeId = typeof COMMON_NODE_IDS[number];
export type ShaderNodeId = typeof SHADER_NODE_IDS[number];
export type GeometryNodeId = typeof GEOMETRY_NODE_IDS[number];
export type BuiltinNodeTypeId = typeof CATALOG_NODE_IDS[number];
/** @deprecated use BuiltinNodeTypeId */
export type CatalogNodeId = BuiltinNodeTypeId;
export type CompositorNodeId = typeof COMPOSITOR_NODE_IDS[number];
export type CatalogDomain = "common" | "shader" | "geometry" | "compositor";
export const CATALOG_SCOPE = {
  common: COMMON_NODE_IDS, shader: SHADER_NODE_IDS, geometry: GEOMETRY_NODE_IDS, compositor: COMPOSITOR_NODE_IDS,
} as const satisfies Record<CatalogDomain, readonly BuiltinNodeTypeId[]>;
