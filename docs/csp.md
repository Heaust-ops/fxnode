# Content Security Policy

fxnode starts one same-origin ES module worker and has no blob/classic/main-thread fallback. A typical policy includes `worker-src 'self'` (and an appropriate `script-src`). Serve the worker as JavaScript with a correct MIME type. Nested deployments work because the built default URL is package-relative.

If assets are moved independently, pass `workerUrl` to `createFxNode`. CSP `worker-src 'none'`, a missing URL, cross-origin restrictions, or an invalid MIME type produces actionable `worker.load`/`worker.timeout` capability errors after at most about five seconds; it does not silently downgrade.

Shared-memory pointer transport is an optional performance path. It requires a cross-origin-isolated document, normally established with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; every embedded cross-origin resource must then satisfy COEP through CORS or CORP. fxnode automatically uses the ordinary message transport when these headers are not appropriate for the host application.
