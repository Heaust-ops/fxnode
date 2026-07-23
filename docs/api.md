# Browser API

`createFxNode({ canvas, viewport, applicationId, applicationVersion, resources, historyLimit, workerUrl })` creates an isolated worker-backed editor with an empty graph and empty node/socket language. Initialization sends application identity, version, and resources directly. Install theme, header styles, compatibility, sockets, and nodes afterward through the live composition methods, then make `setState(initialLayout)` the final bootstrap call. `initialLayout` is canonical runtime `GraphState` (`graphId`, `catalogVersion`, `nodes`, `links`, and `metadata`), has no persistence `schemaVersion` or runtime `version`, and marks every known node `known: true`. Imported JSON may be passed directly; the worker remains the exact decoder. Use `loadComposition` for one explicit bulk composition transaction. `viewport` uses logical CSS pixels plus DPR and is sent without reading DOM layout. The host owns canvas backing dimensions and later calls `setViewport()`. `workerUrl?: string | URL` overrides the package-relative module-worker URL. History is limited to 1,000 entries.

> **Runtime state is not a persistence format.** `getState()` and `setState()` operate only on the current process and current composition. When `historyLimit > 0`, a committed `setState()` is one undo step, but that undo boundary is process-local. Use `getSaveData()` and `load()` for durable storage. Use `load()`—not `setState()`—for historical or migratable data. `setState()` requires an exact state for the currently bound composition.

`load(data, { expectedVersion? })` accepts historical/current graph layouts and `FxNodeSaveData`. Save-data replay is validated and staged entirely in the worker. Its embedded save-time composition must be compatible with the current composition: the ID and replay semantics must remain, while current-only definitions, presentation changes, and a different top-level composition version are allowed. Incompatibility rejects with `composition.incompatible`, a `/composition` path, and bounded path-specific issues available on `FxNodeWorkerError.issues`. A changed terminal graph publishes one `load` mutation/snapshot pair and advances graph version once; an identical terminal graph returns `noop`, installs the imported undo/journal state, and emits nothing. Malformed commands, stale versions, and incompatible compositions reject without partially changing graph, history, journal, layout, or events.

Call `getSaveData()` only after installing the application composition. If queried earlier, it serializes the worker's valid but intentionally empty bootstrap composition rather than definitions the application has not yet sent.

Committed changes emit `onMutations` and then `onSnapshots`, in version order. Each subscriber is isolated: an exception does not prevent other subscribers from receiving the event. Remove a subscriber with its returned function. `copyTo`, mirrors, and `whenRendered` synchronize rendered frames. Copy and mirror destinations retain their host-owned dimensions. `destroy` is idempotent and rejects pending/future work.

`FxNodeWorkerError` exposes `code` and typed, structured `FxNodeIssue[]` for composition/decode/load failures. `FxNodeCapabilityError` exposes a capability `code`. Fatal/protocol/startup failures are terminal: pending work rejects, resources are released, and every future call rejects the stored terminal error. Explicit `destroy()` uses `FxNodeDestroyedError`. Commands use optimistic `expectedVersion` when supplied. Parameter and socket-default values are tagged `ParameterValue` objects and are checked against the bound composition's `FxNodeValueSchema`.

The library registers no canvas, document, or window listeners; creates no DOM controls or menus; performs no focus or pointer capture; and constructs no resize observer. Hosts convert DOM events into `feedInput()` DTOs and own cleanup. The worker performs authoritative graph hit-testing and emits `add-node-menu` and `resource-open` through `onHostRequests()`. A resource request contains an immutable descriptor and authorization, but no DOM event, file, callback, coordinates, or projected geometry. The application may show a modal, native picker, asset browser, or other UI and later calls `provideResource(request.authorization, data)`. Cancellation requires no response. Because this request crosses the worker boundary, applications must not rely on the original pointer's browser user activation; require another explicit host interaction when necessary. Successful submission transfers and detaches the supplied `ArrayBuffer`; graph or composition changes make old authorizations stale.

This is an editing and presentation API only; it does not evaluate graphs.

Controls follow composition `ui` order rather than persisted object-key order. Number, integer, vector, and color components support horizontal scrubbing; Shift gives fine adjustment and Ctrl applies composition-defined stepping. Boolean and enum controls edit on click; string edits commit on Enter and cancel on Escape. Backspace resets the focused control (or hovered control when none is focused) through composition-owned defaults. Reset and link-mute commands are atomic and one-step undoable.

Node-editor gestures include selected-node movement, box selection, resize, link creation/replacement, Ctrl-RMB link cutting, Ctrl-Alt-RMB link muting, `M` muting for ordinary known nodes, `H` collapse, `G` modal movement, and undo/redo. Muted nodes gray out; definitions with compatible `muteBypass` pairs additionally show red bypass curves. Collapse state commits immediately while its chevron rotates over a worker-owned 120 ms ease-out animation. Gesture previews remain worker-only and emit no public update until one atomic commit.

Plain right-click input on empty canvas can produce an `add-node-menu` host request. The host owns the menu completely. In the example, concrete HTML sections, headings, and buttons define grouping and order; button text defines the visible title, while each button carries only `data-type-id` and optional search keywords. Filtering derives search text from that HTML and hides unmatched buttons and empty sections. Composition schema 2 contains no menu groups, per-node menu fields, or browser menu projection, so composing/removing nodes never mutates host HTML. The host calls `addNode({ typeId, viewPosition })`; the worker authorizes the empty-space hit and commits the normal command as one history/version entry. Right-click on graph content does not request a menu, and Ctrl-RMB remains the link knife.

## Live composition updates

The asynchronous `api.setTheme(theme)`, `api.setHeaderStyles(styles)`, `api.setCompatibility(compatibility)`, `api.composeSocket(id, definition)`, `api.composeNode(id, definition)`, `api.removeSocket(id)`, and `api.removeNode(id)` methods declaratively update the running worker's composition. Compose operations add or replace definitions; removal removes definitions, not graph instances. Each node definition is locally type-checked, while the worker checks references against its current styles, sockets, and resources. The worker compiles, validates, rebinds, and lays out a candidate before publishing it atomically. Rejection leaves composition, graph, revision, history, and rendering unchanged.

Use the same non-generic handle for every update. Ordinary composition does not require revision bookkeeping:

```ts
await api.setTheme(theme);
await api.composeSocket("dynamic", socketDefinition);
await api.composeNode("acme.dynamic", nodeDefinition);

await api.setState(initialState);

await api.dispatch({
  type: "node.add",
  nodeType: "acme.dynamic",
  position: { x: 0, y: 0 },
});
```

Socket and node definitions are keyed collections, so updates to distinct IDs converge to the same collection regardless of call order. Callers must await dependencies before definitions that reference them; updates to the same ID remain order-sensitive. Composition methods return receipts, never a replacement handle. `expectedRevision` is optional compare-and-swap protection for callers that need it. `api.loadComposition(fullComposition)` validates and publishes a complete replacement in one worker request and transaction.

The browser handle intentionally uses general string IDs for `dispatch`, snapshots, subscriptions, and live composition methods because its worker-owned authority can change at runtime. Precise literal-ID inference remains available for static/headless authoring through `compileFxNodeComposition`, `NodeTypeId`, and the immutable composition helpers.

### Revisions, receipts, and concurrency

| Value                  | Initial/source              | Advances when                                          | Persisted? |
| ---------------------- | --------------------------- | ------------------------------------------------------ | ---------- |
| Composition `revision` | `0` per editor              | A live update commits                                  | No         |
| Graph `version`        | Runtime graph state         | A command, load, or rebind changes the canonical graph | No         |
| `catalogVersion`       | Bound `composition.version` | Normalized while binding/decoding                      | Yes        |

Omitting `expectedRevision` applies an update to the authority current when the worker dequeues it. Supplying it requires an exact composition revision; mismatch rejects with `composition.revision.stale`. Of concurrent requests with the same exact revision, at most one can commit. Graph commands use the separate `expectedVersion` domain.

A canonically identical candidate returns `status: "noop"` without incrementing either runtime version, clearing history, publishing an event/projection, cancelling a gesture, or rendering. Its receipt has `graphChanged: false` and `historyReset: false`. Every committed definition update increments composition revision and clears undo/redo because history is definition-bound, even if it only changes presentation and leaves `graphChanged: false`. Graph version advances only if rebinding changes the canonical graph.

### Composition events

```ts
const unsubscribe = api.onCompositionChanges((event) => {
  console.log(
    event.baseRevision,
    event.revision,
    event.change,
    event.baseGraphVersion,
    event.graphVersion,
    event.graphChanged,
    event.historyReset,
  );
});
```

Events are emitted only for committed updates. `change` exposes only `{ kind }` or `{ kind, id }`, never definitions or source composition. If rebinding changes the graph, the composition event precedes the matching `onMutations` event (`cause: "composition"`) and then `onSnapshots`. Noops and rejected requests emit nothing. Subscriber exceptions are isolated.

### Definition removal

`removeNode(id)` preserves existing instances, parameters, sockets, geometry, labels, extensions, and links. Affected instances become `known: false`, opaque, and read-only; demotion changes graph version once and emits `document.replaced`. Reintroducing a compatible definition can promote them again. Other composition updates reject rather than accidentally demote a currently known node, and updates never repair incompatibility by deleting or muting links.

`removeSocket(id)` rejects while node definitions, another socket's `acceptsFrom`, or wildcard compatibility still reference it. Opaque nodes may retain removed type IDs only when the complete rebound graph remains valid. Removing an already absent definition is a runtime noop.

```ts
const added = await api.composeNode("acme.dynamic", nodeDefinition);
const removed = await api.removeNode("acme.dynamic", {
  expectedRevision: added.revision,
});

// The same handle remains usable; the worker rejects this with node.type-unknown.
await api.dispatch({
  type: "node.add",
  nodeType: "acme.dynamic",
  position: { x: 0, y: 0 },
});
```

Only each declarative patch crosses to the worker. The browser stores no live source composition, graph shadow, or composition-derived menu projection. Resource policies remain worker-owned and are included only in one-shot, worker-authorized `resource-open` requests.
