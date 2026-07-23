# Rendering and lifecycle

`whenRendered()` synchronizes a worker-rendered frame. `copyTo` and mirrors copy presentation while each destination retains host-owned dimensions. Resize by updating the host canvas and calling `setViewport()`.

Keep every listener, observer, menu, and focus behavior in an application-owned cleanup object. On unmount/page teardown, remove those resources and call `destroy()`. Destruction is idempotent; pending and future work rejects with `FxNodeDestroyedError`. Fatal startup/protocol failures also release resources and make future calls reject the stored terminal error.

Do not use rendering completion as graph execution completion: fxnode never executes graphs.
