# Content Security Policy

fxnode starts one same-origin ES module worker and has no blob/classic/main-thread fallback. A typical policy includes `worker-src 'self'` (and an appropriate `script-src`). Serve the worker as JavaScript with a correct MIME type. Nested deployments work because the built default URL is package-relative.

If assets are moved independently, pass `workerUrl` to `createFxNode`. CSP `worker-src 'none'`, a missing URL, cross-origin restrictions, or an invalid MIME type produces actionable `worker.load`/`worker.timeout` capability errors after at most about five seconds; it does not silently downgrade.
