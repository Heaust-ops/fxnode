# Built-in graph catalog

The canonical, compile-time checked list is `src/catalog/scope.ts`. Catalog checks and the generated all-supported example derive coverage from that list.

| Domain | IDs |
| --- | --- |
| Common (4) | `fxnode.common.frame`, `fxnode.common.reroute`, `fxnode.common.group-input`, `fxnode.common.group-output` |
| Shader (11) | `fxnode.shader.value`, `fxnode.shader.color`, `fxnode.shader.math`, `fxnode.shader.vector-math`, `fxnode.shader.mix`, `fxnode.shader.color-ramp`, `fxnode.shader.texture-coordinate`, `fxnode.shader.noise-texture`, `fxnode.shader.image-texture`, `fxnode.shader.principled-bsdf`, `fxnode.shader.material-output` |
| Geometry (5) | `fxnode.geometry.position`, `fxnode.geometry.mesh-cube`, `fxnode.geometry.set-position`, `fxnode.geometry.transform-geometry`, `fxnode.geometry.join-geometry` |
| Compositor (2) | `fxnode.compositor.image`, `fxnode.compositor.color-balance` |

Descriptors in `src/catalog/descriptors.ts` define stable sockets, parameters, and defaults. These are persistent fxnode identifiers, not Blender RNA identifiers.
