# Composition model

fxnode has no built-in graph catalog or global node registry. `createFxNodeHeadless` receives one complete `FxNodeComposition`. Browser `createFxNode` receives application identity, version, and resources directly, then the application installs theme, header styles, compatibility, socket types, and nodes through the live API. Composition data is plain and structured-clone-safe and is independently compiled in the worker; callbacks and class instances are not accepted.

`compileFxNodeComposition` preserves literal keys, so `NodeTypeId<typeof composition>`, socket IDs, and parameter IDs remain precise TypeScript unions. `compileFxNodeComposition` validates cross-references and builds immutable lookup maps without adding application semantics.

Large compositions can be assembled incrementally. `setTheme` accepts a theme-less `FxNodeCompositionSeed`; `composeSocket` adds or overrides a socket type and checks `acceptsFrom` against itself and socket types already present; `composeNode` adds or overrides a node and checks its style, socket types, resources, UI rows, bypasses, and migrations against the current composition. `removeSocket` and `removeNode` only accept an ID known on their input. Every helper is immutable and returns ordinary structured-clone-safe data.

A composition owns:

- socket type titles, colors, and accepted source types;
- semantic theme colors and node-header styles;
- bounded image-resource policies;
- node titles, behavior, parameters, sockets, UI rows, mute bypasses, and migrations.

UI rows use a finite declarative vocabulary: parameter, socket, text, hidden, image resource, color-ramp widget, and grading-wheel widget. Visibility predicates can depend on parameter values. The library does not inspect naming conventions or special-case application node IDs.

Node definitions do not author a default size. Initial and minimum dimensions are calculated from the behavior, title, and visible UI rows; persisted graph-node sizes remain authored document state. Collapsed ordinary nodes lay out at header height, frames clamp to at least 100×100 before fitting children, and reroutes remain 10×10.

The repository's Blender-inspired sample is application code, not package authority. Its 22 concrete definitions are split by family under [`example/nodes`](../example/nodes). Browser startup installs them sequentially; a private headless repository runtime builds the same immutable helper chain for Node-only tests and tools. There is no public authored aggregate or registry.

The add menu is application-owned HTML. The worker authorizes opening it only for an eligible empty-canvas gesture; the application decides its groups, labels, ordering, search terms, lifecycle, and which `api.addNode()` call each option performs.

Unknown type IDs and unsupported future node versions load as opaque, read-only records and round-trip without being reinterpreted. Known nodes are validated against the composition that owns the editor.
