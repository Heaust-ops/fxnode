# fxnode

> **Internal private 0.x prerelease.** This package has `private: true`; its API and data formats may change.

![fxnode Color Balance node showing three grading wheels and image sockets](https://raw.githubusercontent.com/Heaust-ops/fxnode/main/examples/assets/color-balance.png)

_The Color Balance example rendered by fxnode. It demonstrates editor presentation only; fxnode does not process pixels._

fxnode is a typed, worker-owned node editor for application-defined nodes, sockets, styles, resources, and migrations.
The application explicitly owns its DOM integration: canvas sizing, input forwarding, menus, file pickers,
accessibility, lifecycle, and cleanup. The worker owns graph state, validation, history, hit testing, layout, and frame
generation; the browser client presents transferred frames to the application canvas without keeping a shadow graph.

fxnode edits and presents graphs. It does **not** execute or evaluate graphs and contains no image-processing engine.
It does not read or write Blender files, and makes no Blender compatibility, affiliation, endorsement, or parity claim.

## Install and platform requirements

```sh
npm install fxnode
```

That command is for a future registry release; this repository is currently private and not publishable.
Consumers need a modern browser with module workers, Canvas 2D, and worker-side `OffscreenCanvas`/`ImageBitmap` support.
See the committed [browser support matrix](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/guides/browser-support.md) and
[Content Security Policy guide](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/guides/csp.md) before integrating.

## The simplest node

Definitions are serializable, consumer-facing tuples. This complete definition matches the executable
[minimal definition](https://github.com/Heaust-ops/fxnode/blob/main/examples/minimal/definition.ts):

```ts
import type { FxNodeDefinition, FxNodeSocketTypeDefinition, FxNodeStyleDefinition } from "fxnode";

export const numberSocket = [
  "number",
  { title: "Number", color: "#a8a8a8", acceptsFrom: ["number"] },
] as const satisfies readonly [string, FxNodeSocketTypeDefinition];

export const minimalStyles = {
  value: { header: "#4c6ef5" },
} as const satisfies Readonly<Record<string, FxNodeStyleDefinition>>;

export const valueNode = [
  "example.minimal.value",
  {
    version: 1,
    title: "Number Value",
    behavior: "standard",
    style: "value",
    parameters: {
      value: { type: "number", default: { kind: "number", value: 42 }, step: 1 },
    },
    sockets: {
      value: {
        title: "Value",
        direction: "output",
        type: "number",
        maxIncomingLinks: 0,
        visible: true,
        value: null,
        showValue: false,
      },
    },
    ui: [
      { kind: "parameter", parameter: "value" },
      { kind: "socket", socket: "value" },
    ],
    muteBypass: [],
    migrations: [],
  },
] as const satisfies readonly [string, FxNodeDefinition];
```

Bootstrap the editor after creating an application-local host and theme:

```ts
import { createFxNode } from "fxnode";
import { prepareFxNodeBrowserHost } from "./browser-host.js";
import { exampleTheme } from "./theme.js";
import { minimalStyles, numberSocket, valueNode } from "./definition.js";

const canvas = document.querySelector<HTMLCanvasElement>("#graph")!;
const host = prepareFxNodeBrowserHost({ canvas });
let cleaned = false;
let api: Awaited<ReturnType<typeof createFxNode>> | null = null;
function cleanup() {
  window.removeEventListener("pagehide", cleanup);
  cleaned = true;
  api?.destroy();
  api = null;
  host.destroy();
}
window.addEventListener("pagehide", cleanup);
try {
  const created = await createFxNode({
    canvas,
    viewport: host.initialViewport,
    applicationId: "fxnode.example.minimal",
    applicationVersion: 1,
    resources: {},
  });
  if (cleaned) created.destroy();
  else {
    api = created;
    await api.setTheme(exampleTheme);
    await api.setHeaderStyles(minimalStyles);
    await api.composeSocket(...numberSocket);
    await api.composeNode(...valueNode);
    await api.setState({ graphId: "minimal", catalogVersion: 1, nodes: [], links: [], metadata: {} });
    await api.addNode({ nodeId: "value", typeId: valueNode[0], viewPosition: { x: 360, y: 190 } });
    host.attach(api);
    await api.whenRendered();
  }
} catch (error) {
  cleanup();
  throw error;
}
```

`exampleTheme` and `prepareFxNodeBrowserHost` are application-local examples, not fxnode package exports.
![Minimal Number Value node rendered by fxnode](https://raw.githubusercontent.com/Heaust-ops/fxnode/main/examples/assets/minimal.png)

Complete sources: [definition](https://github.com/Heaust-ops/fxnode/blob/main/examples/minimal/definition.ts), [bootstrap](https://github.com/Heaust-ops/fxnode/blob/main/examples/minimal/main.ts), and
[first-node tutorial](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/tutorials/first-node.md).

## Focused example: Color Balance

The Color Balance example keeps strict local socket tuples and styles, then composes its larger node definition:

```ts
import type { FxNode, FxNodeSocketTypeDefinition, FxNodeStyleDefinition } from "fxnode";
import { colorBalanceNode } from "./color-balance.js";
import { exampleTheme } from "./theme.js";

const floatSocket = [
  "float",
  { title: "Float", color: "#a8a8a8", acceptsFrom: ["float"] },
] as const satisfies readonly [string, FxNodeSocketTypeDefinition];
const colorSocket = [
  "color",
  { title: "Color", color: "#d7ca63", acceptsFrom: ["color"] },
] as const satisfies readonly [string, FxNodeSocketTypeDefinition];
const styles = {
  compositorColor: { header: "#8c5cc4" },
} as const satisfies Readonly<Record<string, FxNodeStyleDefinition>>;

async function installColorBalance(api: FxNode) {
  await api.setTheme(exampleTheme);
  await api.setHeaderStyles(styles);
  await api.composeSocket(...floatSocket);
  await api.composeSocket(...colorSocket);
  await api.composeNode(...colorBalanceNode);
}
```

The node's UI schema includes a representative grading-wheels row:

```ts
import type { FxNodeDefinition } from "fxnode";

const gradingWheelsRow = {
  kind: "widget",
  widget: "grading-wheels",
  bindings: [
    { title: "Lift", scalar: "lift", color: "liftColor" },
    { title: "Gamma", scalar: "gamma", color: "gammaColor" },
    { title: "Gain", scalar: "gain", color: "gainColor" },
  ],
  visibleWhen: { parameter: "mode", equals: "Lift/Gamma/Gain" },
} satisfies FxNodeDefinition["ui"][number];
```

See the complete [bootstrap](https://github.com/Heaust-ops/fxnode/blob/main/examples/color-balance/main.ts),
[definition](https://github.com/Heaust-ops/fxnode/blob/main/examples/shared/nodes/color-balance.ts), and
[tutorial](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/tutorials/color-balance.md). This schema renders controls and connections; it does not evaluate
the graph or process pixels.

## Application-owned browser host

fxnode deliberately does not install global listeners or create application UI. A compact host should:

- measure and DPR-size the canvas, observe resize, and call `setViewport`;
- translate pointer, wheel, keyboard, focus, and outside-pointer events into `feedInput`;
- manage pointer capture, focus, context menus, add-node UI, and authorized resource pickers;
- subscribe to bounded host projections/requests and provide an accessible DOM workflow; and
- remove listeners, subscriptions, observers, temporary DOM, and captures during teardown.

Use the [browser-host guide](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/guides/browser-host.md),
[interaction guide](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/guides/interactions.md), and the repository's
[compact host implementation](https://github.com/Heaust-ops/fxnode/blob/main/examples/shared/browser-host.ts).

## State, persistence, and events

The worker is authoritative. All calls are asynchronous unless their signature says otherwise.

| API               | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `getState()`      | Detached, readonly current graph snapshot with graph version; does not mutate runtime state. |
| `setState(value)` | Validates and atomically replaces graph state; supports optimistic `expectedVersion`.        |
| `save()`          | Canonical current `GraphLayoutV2`; a compact graph export, not command history.              |
| `getSaveData()`   | Durable envelope: canonical baseline, applied journal, and effective save-time composition.  |
| `load(value)`     | Atomically validates/loads durable data; failure preserves current state.                    |

Committed graph changes publish mutations **before** snapshots in version order. `onMutations` and `onSnapshots`
do not mutate state; each returns an unsubscribe function, and subscriber failures are isolated. Composition has a
separate revision domain and `onCompositionChanges`; a rebind that changes the graph publishes its composition event
before the corresponding mutation and snapshot. Read [graph state and events](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/concepts/graph-state-and-events.md)
and [state and persistence](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/concepts/state-and-persistence.md).

## Headless use

`fxnode/headless` exposes the same composition-bound document and command authority without browser or worker
resources. With the minimal tuples above:

```ts
import { createFxNodeHeadless } from "fxnode/headless";
import { exampleTheme } from "./theme.js";

const runtime = createFxNodeHeadless({
  schemaVersion: 2,
  id: "fxnode.example.minimal",
  version: 1,
  compatibility: { wildcardInputTypes: [] },
  theme: exampleTheme,
  socketTypes: { [numberSocket[0]]: numberSocket[1] },
  nodeStyles: minimalStyles,
  resources: {},
  nodes: { [valueNode[0]]: valueNode[1] },
} as const);

const empty = runtime.emptyDocument("minimal");
const document = {
  ...empty,
  nodes: { value: runtime.materializeNode("value", valueNode[0], { x: 360, y: 190 }) },
};
const issues = runtime.validateDocument(document);
if (issues.length) throw new Error(issues.map((issue) => issue.message).join("; "));
const layout = runtime.save(document);
```

Headless operations are explicit and immutable; they still edit graph documents and never evaluate them.

## Documentation

- [Learn](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/index.md): tutorials, concepts, integration guides, and examples
- [Concepts](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/concepts/index.md): worker authority, composition, state, and persistence
- [Guides](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/guides/index.md): browser hosting, lifecycle, accessibility, CSP, and support
- [Tutorials](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/tutorials/index.md): minimal, Color Balance, and live composition
- [API reference landing page](https://github.com/Heaust-ops/fxnode/blob/main/docs/reference/index.md)
- [Research notes](https://github.com/Heaust-ops/fxnode/blob/main/docs/research/blender.md) and [architecture decision](https://github.com/Heaust-ops/fxnode/blob/main/docs/decisions/worker-transport-protobuf-benchmark.md)

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm run typecheck             # TypeScript checks
npm test                      # Node test suite
npm run build                 # Vite library build + declarations
npm run examples              # Example gallery development server
npm run test:examples:visual  # Example screenshot checks
npm run docs:dev              # Generated API + VitePress development server
npm run docs:build            # Build generated API and documentation
npm run format:check          # Prettier verification
npm run release:check         # Full release gate (maintainers)
```

For contribution context, start with the executable [examples](https://github.com/Heaust-ops/fxnode/tree/main/examples) and committed
[Learn landing page](https://github.com/Heaust-ops/fxnode/blob/main/docs/learn/index.md). The MIT license is in [LICENSE](LICENSE); notices are in
[NOTICE.md](NOTICE.md).
