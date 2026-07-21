# fxnode

> **Internal prerelease:** the package remains `private: true`; do not publish it.

fxnode is a clean-room, Blender-inspired node-editor presentation and persistence library. It is not affiliated with or endorsed by Blender or the Blender Foundation.

```sh
npm install fxnode
```

```ts
import { createFxNode } from "fxnode";
const editor = await createFxNode({ canvas, layout });
await editor.whenRendered();
editor.destroy(); // idempotent; always release the dedicated worker
```

The module worker owns graph state, layout, interaction, and rendering. The main thread receives transferred `ImageBitmap` frames. There is deliberately no blob worker, classic worker, or main-thread fallback. The default worker is package-relative; `workerUrl` can identify a separately hosted module worker. Your CSP and server MIME configuration must permit it; see [CSP](docs/csp.md).

fxnode provides editing/presentation only: **no graph evaluation, Blender file compatibility, or parity claim**. Blender reference captures are **0/8 pending**. Existing image snapshots are fxnode regression goldens, not Blender references or evidence of visual parity. See [browser support](docs/browser-support.md), [accessibility](docs/accessibility.md), [API](docs/api.md), [persistence](docs/persistence.md), and [catalog](docs/catalog.md).

Development requires Node 20+. `npm run release:check` runs static/unit/performance/reference checks, the functional browser matrix, Chromium-only goldens, and packed-package smoke checks. Pending references are reported honestly; strict reference checking remains `npm run check:references:strict`.
