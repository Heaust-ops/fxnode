# Browser support

The functional release matrix is Chromium, Firefox, and WebKit from Playwright 1.61.1 on desktop Linux. Exact engine versions are recorded by release runs. Chromium-only image goldens are fxnode regression tests; they are not cross-engine or Blender parity tests. Safari-branded desktop builds and mobile browsers are not certified.

Required on the main thread: module `Worker`, `ResizeObserver`, `crypto.randomUUID`, and Canvas 2D. Required in the worker: `OffscreenCanvas`, a 2D context, `transferToImageBitmap`, and `ImageBitmap.close`. Unsupported engines receive a named capability error; there is no fallback. Codes include `worker.missing`, `resize-observer.missing`, `crypto.random-uuid.missing`, `canvas.2d`, `offscreen-canvas.missing`, `offscreen-canvas.transfer.missing`, `image-bitmap.close.missing`, `worker.load`, and `worker.timeout`.

Resource ceilings are DPR 4, 8192 logical pixels per dimension, 16,777,216 logical viewport pixels, history 1,000, and gesture batches/pending copies 256. Document release targets are at most 10,000 nodes and 25,000 links; applications should enforce these limits before loading unusually large external data.
