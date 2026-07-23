# Worker authority

The worker is authoritative for graph state, composition, validation, command history, hit testing, layout, gestures, and rendering. The browser client keeps only bounded host projections. It does not keep a graph shadow.

The application owns the DOM: canvas sizing, listeners, focus policy, menus, dialogs, measurement, and teardown. It turns DOM events into `feedInput()` DTOs. fxnode never registers document/window/canvas listeners or creates controls.

Host requests cross an asynchronous trust boundary. For `resource-open`, the worker emits an immutable descriptor and one-use authorization. The application chooses UI and later calls `provideResource(authorization, data)`. The token is consumed only by a valid accepted submission: failed data validation does **not** consume it, so the application may correct the data and retry. Do not depend on the original pointer's browser activation; ask for a fresh user action when required. Authorizations become stale after relevant graph/composition changes, and transferred `ArrayBuffer`s detach.

This boundary makes worker ordering definitive: await composition dependencies and treat terminal startup/protocol failures as terminal.
