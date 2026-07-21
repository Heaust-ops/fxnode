# Browser API

`createFxNode({ canvas, layout, historyLimit, workerUrl })` creates an isolated worker-backed editor. `workerUrl?: string | URL` overrides the package-relative module-worker URL. History is limited to 1,000 entries. `dispatch`, `undo`, `redo`, and `load` resolve only after validation; rejected commands do not change version or state. `save` returns canonical persistent `GraphLayoutV2`; `snapshot` is a query and emits no mutation events.

Committed changes emit `onMutations` and then `onSnapshots`, in version order. Each subscriber is isolated: an exception does not prevent other subscribers from receiving the event. Remove a subscriber with its returned function. `copyTo`, mirrors, and `whenRendered` synchronize rendered frames. `destroy` is idempotent and rejects pending/future work.

`FxNodeWorkerError` exposes `code` and typed, structured `FxNodeIssue[]` for decode/load failures. `FxNodeCapabilityError` exposes a capability `code`. Fatal/protocol/startup failures are terminal: pending work rejects, resources are released, and every future call rejects the stored terminal error. Explicit `destroy()` uses `FxNodeDestroyedError` and restores the original canvas `tabindex` and inline `touch-action`. Commands use optimistic `expectedVersion` when supplied. Parameter and socket-default values are tagged `ParameterValue` objects and are checked against the public catalog `ValueSchema`.

This is an editing and presentation API only; it does not evaluate graphs.

Controls follow descriptor `ui` order rather than persisted object-key order. Number, integer, vector, and color components support horizontal scrubbing; Shift gives fine adjustment and Ctrl applies descriptor stepping. Boolean and enum controls edit on click; string edits commit on Enter and cancel on Escape. Backspace resets the focused control (or hovered control when none is focused) through descriptor-owned defaults. Reset and link-mute commands are atomic and one-step undoable.

Node-editor gestures include selected-node movement, box selection, resize, link creation/replacement, Ctrl-RMB link cutting, Ctrl-Alt-RMB link muting, `M` node muting for descriptors with declared bypass pairs, `H` collapse, `G` modal movement, and undo/redo. Gesture previews remain worker-only and emit no public update until one atomic commit.
