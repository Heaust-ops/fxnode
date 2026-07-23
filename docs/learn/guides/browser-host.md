# Browser host

`createFxNode` needs a canvas, logical CSS-pixel viewport plus DPR, application identity/version, resource policies, and optionally a worker URL/history limit. The **application owns the DOM and canvas dimensions**. Measure layout, set backing dimensions, call `setViewport()` on changes, and attach your own listeners.

fxnode creates one module worker and never creates a resize observer, menu, modal, or file picker. Convert pointer/keyboard/wheel events to `feedInput()` values. The worker performs authoritative hit testing and may issue `add-node-menu` or `resource-open` host requests; your DOM decides presentation and ordering.

Install composition before initial state. Imported/historical data belongs in `load()`, not `setState()`. See [state and persistence](../concepts/state-and-persistence).
