# fxnode

> **Internal prerelease:** the package remains `private: true`; do not publish it.

fxnode is a clean-room, Blender-inspired node-editor presentation and persistence library. It is not affiliated with or endorsed by Blender or the Blender Foundation. The library owns the generic editor; applications define every concrete node, socket type, style, resource, theme color, and migration in a serializable composition. Applications own add-menu markup, grouping, ordering, and search terms.

It provides a command-driven node editor that runs graph ownership, layout, interaction, history, and rendering in a dedicated worker. Application code supplies an initial graph and an on-screen canvas, then communicates with the editor through the typed main-thread API. The main thread does not maintain a shadow copy of the graph.

fxnode provides editing and presentation only: **no graph evaluation, Blender file compatibility, or parity claim**. Blender reference captures are **0/8 pending**. Existing image snapshots are fxnode regression goldens, not Blender references or evidence of visual parity.

## Install

```sh
npm install fxnode
```

The current repository is an internal prerelease, so installation from a registry is only applicable after the package is made publishable.

## Define a composition

A composition is plain, structured-clone-safe data: no callbacks, class instances, or global registry. An `as const` object or immutable helper chain preserves literal IDs; `compileFxNodeComposition` and `createFxNodeHeadless` are the checked boundaries. The sample browser installs definitions sequentially, while its private Node-only runtime compiles and binds the same chain once for repository tooling.

```ts
// application.ts
import type { FxNodeCompositionSeed } from "fxnode";

export const application = {
  schemaVersion: 2,
  id: "acme.material-editor",
  version: 1,
  compatibility: { wildcardInputTypes: ["any"] },
  socketTypes: {},
  nodeStyles: { input: { header: "#8b3f72" } },
  resources: {},
  nodes: {},
} as const satisfies FxNodeCompositionSeed;
```

Each node can then live in its own small module:

```ts
// nodes/value.ts
export const valueNode = [
  "acme.value",
  {
    version: 1,
    title: "Value",
    behavior: "standard",
    style: "input",
    parameters: {
      value: {
        type: "number",
        default: { kind: "number", value: 0.5 },
        softMin: 0,
        softMax: 1,
        step: 0.01,
        precision: 3,
      },
    },
    sockets: {
      value: {
        title: "Value",
        direction: "output",
        type: "float",
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
] as const;
```

The final composition file stays short:

```ts
import { composeNode, composeSocket, compileFxNodeComposition, setTheme } from "fxnode";
import { application as base } from "./application.js";
import { theme } from "./theme.js";
import { valueNode } from "./nodes/value.js";

const themed = setTheme(base, theme);
const any = composeSocket(themed, "any", {
  title: "Any",
  color: "#999999",
  acceptsFrom: ["any"],
});
const sockets = composeSocket(any, "float", {
  title: "Value",
  color: "#a8a8a8",
  acceptsFrom: ["float", "any"],
});

export const composition = composeNode(sockets, ...valueNode);
export const compiledComposition = compileFxNodeComposition(composition);
```

For incremental authoring, start with an `FxNodeCompositionSeed` (empty `socketTypes` and `nodes`, and no theme), then call `setTheme(seed, theme)`, `composeSocket(...)`, and `composeNode(...)` before the final `compileFxNodeComposition(...)`. These helpers return new plain objects: they never mutate their input. Reusing an ID overrides that entry; `removeNode` and `removeSocket` also return immutable copies and only accept IDs currently present in the inferred literal union.

Composition controls are finite and declarative: parameter and socket rows, text rows, image resources, color ramps, and grading wheels. Socket colors and compatibility come from `socketTypes`; node headers come from `nodeStyles`; `muteBypass` declares input/output pairs shown when a node is muted. Conditional rows use `visibleWhen`. Node sizes are calculated from the title and currently visible rows: ordinary nodes initially use at least 140×100, frames 300×100 with a 100×100 minimum, and reroutes 10×10. Persisted authored sizes remain separate and are clamped only for effective layout. See [composition](docs/catalog.md) and [persistence migrations](docs/persistence.md) for the full contract.

For headless validation, persistence, and command execution without a browser:

```ts
import { createFxNodeHeadless } from "fxnode/headless";

const headless = createFxNodeHeadless(composition);
const node = headless.materializeNode("value-1", "acme.value");
```

## Create an editor

Give `createFxNode` an HTML canvas, its logical CSS-pixel viewport, and the application's identity, version, and resource policies. Install the node language through the live composition API, then install initial runtime state separately with `setState()`. The supplied canvas is the primary on-screen presentation surface. fxnode does not register DOM listeners, observe layout, focus/capture pointers, resize canvases, or create menus and file controls; those lifecycle decisions belong to your application.

```ts
import { createFxNode, type FxNode } from "fxnode";

const canvas = document.querySelector<HTMLCanvasElement>("#node-editor");
if (!canvas) throw new Error("Node editor canvas is missing");
const viewport = {
  width: Math.max(1, canvas.clientWidth),
  height: Math.max(1, canvas.clientHeight),
  dpr: Math.min(4, Math.max(1, devicePixelRatio || 1)),
};
canvas.width = Math.round(viewport.width * viewport.dpr);
canvas.height = Math.round(viewport.height * viewport.dpr);

const initialState = {
  graphId: "material-editor",
  catalogVersion: 3,
  nodes: [],
  links: [],
  metadata: {},
};

const editor: FxNode = await createFxNode({
  canvas,
  viewport,
  applicationId: "my-editor",
  applicationVersion: 3,
  resources,
  historyLimit: 100,
});

await editor.setTheme(theme);
await editor.setHeaderStyles(nodeStyles);
await editor.composeSocket("scalar", scalarSocket);
await editor.setCompatibility({ wildcardInputTypes: [] });
await editor.composeNode("value", valueNode);
await editor.setState(initialState);

await editor.whenRendered();
```

Your host forwards normalized input with `feedInput()` and layout changes with `setViewport()`. It may attach pointer/wheel/keyboard listeners directly, through React effects, or through any other UI framework, and can remove them without hidden library listeners remaining. `onHostRequests()` publishes worker-authorized requests after authoritative worker hit-testing. For `add-node-menu`, your host decides whether and how to render a menu, then calls `addNode()`. For `resource-open`, show application-owned UI, obtain the file or asset, and call `provideResource(request.authorization, data)`; the supplied `ArrayBuffer` is transferred and detached. Because the request arrives after a worker round trip, do not assume browser user activation is still available—use a modal or another explicit host interaction when a native picker requires it. Cancellation requires no response.

### Update a live composition

The top-level `setTheme`, `composeSocket`, `composeNode`, `removeSocket`, and `removeNode` helpers build immutable composition data for headless/static use. The worker-backed editor exposes asynchronous live methods after `createFxNode()`; `setCompatibility` controls wildcard socket types:

```ts
await editor.setTheme(nextTheme);
await editor.composeSocket("acme.scalar", scalarSocket);
await editor.setCompatibility({ wildcardInputTypes: [] });
await editor.composeNode("acme.value", valueNode);
await editor.removeNode("acme.value");
await editor.removeSocket("acme.scalar");
```

Sockets and nodes are keyed collections: composing distinct IDs in different orders produces the same definitions. Await dependencies such as socket definitions before nodes that reference them; replacing or removing the same ID is naturally order-sensitive. Each result is a receipt containing `status`, `revision`, `graphVersion`, `graphChanged`, and `historyReset`. Pass `expectedRevision` only when compare-and-swap behavior is useful. All calls use the same non-generic editor handle; definitions and validation remain worker-owned. `loadComposition(fullComposition)` replaces the complete composition in one worker transaction.

Always release the worker when the editor is no longer needed:

```ts
editor.destroy(); // Idempotent. Pending and future operations reject.
```

The module worker renders to an `OffscreenCanvas` and transfers `ImageBitmap` frames for presentation. There is deliberately no blob-worker, classic-worker, or main-thread fallback. The default worker URL is package-relative; `workerUrl` can identify a separately hosted module worker:

```ts
const editor = await createFxNode({
  canvas,
  viewport,
  applicationId: "acme.material-editor",
  applicationVersion: 1,
  resources: {},
  workerUrl: new URL("/workers/fxnode.worker.js", location.origin),
});
```

Your CSP and server MIME configuration must permit module workers; see [CSP](docs/csp.md) and [browser support](docs/browser-support.md).

## Graph structure

A graph has six durable top-level fields:

```ts
const layout = {
  schemaVersion: 2,
  graphId: "my-graph",
  catalogVersion: 3,
  nodes: [
    /* persisted nodes */
  ],
  links: [
    /* persisted links */
  ],
  metadata: { project: "demo" },
};
```

- `schemaVersion` identifies the persistence format. Version 2 is current.
- `graphId` identifies the graph independently of its editor instance.
- `catalogVersion` is the historical persistence-field name for the composition version. On decode it is normalized to the bound composition's `version`; it does not select migrations.
- `nodes` contains node geometry, parameters, sockets, mute/collapse state, frame parenting, and extension data.
- `links` connects an output socket to an input socket.
- `metadata` is application-owned JSON that round-trips with the graph.

Three independent version domains are intentional:

| Version                                  | Meaning                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Composition revision                     | Process-local counter starting at `0`; advances only when a live composition update commits and is not persisted. |
| Graph version                            | Runtime commit counter; advances when a graph command, load, or composition rebind changes the canonical graph.   |
| `composition.version` / `catalogVersion` | Durable authored composition version stored with the graph; unaffected by the live composition revision.          |

A persisted node resembles the following. This abbreviated sample is illustrative; a loadable known node must include every composition-defined parameter and socket.

```ts
const node = {
  id: "math-1",
  typeId: "fxnode.shader.math",
  typeVersion: 1,
  position: { x: 120, y: 80 }, // Upper-left origin; +Y points upward.
  size: { x: 180, y: 100 },
  label: "Math",
  parameters: {
    operation: { kind: "string", value: "add" },
    clamp: { kind: "boolean", value: false },
  },
  sockets: [
    {
      id: "math-1:a",
      key: "a",
      label: "A",
      direction: "input",
      dataType: "float",
      accepts: ["float", "any"],
      maxIncomingLinks: 1,
      defaultValue: { kind: "number", value: 0 },
      visible: true,
    },
    // Other composition-defined sockets omitted here.
  ],
  muted: false,
  collapsed: false,
  extensions: {},
};
```

Values are tagged so consumers do not have to infer whether an array is a vector, color, or arbitrary JSON:

```ts
type ParameterValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "vector"; value: readonly [number, number, number] }
  | { kind: "color"; value: readonly [number, number, number, number] }
  | { kind: "json"; value: JsonValue };
```

A link references both its nodes and sockets:

```ts
const link = {
  id: "value-to-math",
  fromNodeId: "value-1",
  fromSocketId: "value-1:value",
  toNodeId: "math-1",
  toSocketId: "math-1:a",
  muted: false,
  extensions: {},
};
```

Known nodes must match their composition definition exactly. Unsupported type IDs, future node versions, and nodes without a complete migration route are retained byte-equivalently as opaque, read-only nodes. See [persistence](docs/persistence.md) and [composition](docs/catalog.md) for validation and migration details.

## Compose and edit nodes

All concrete changes are commands. Commands are validated and committed atomically in the worker, which is what makes undo/redo and versioned events reliable.

Add a node by type and position:

```ts
const receipt = await editor.dispatch({
  type: "node.add",
  nodeType: "fxnode.shader.value",
  position: { x: -200, y: 100 },
});

console.log(receipt.status, receipt.version); // "committed", 1
```

`nodeId` is optional for `node.add`; fxnode generates one when omitted. To find the generated node, compare snapshots before and after the command:

```ts
const before = await editor.getState();
const knownIds = new Set(before.nodes.map((node) => node.id));

await editor.dispatch({
  type: "node.add",
  nodeType: "fxnode.shader.math",
  position: { x: 80, y: 100 },
});

const after = await editor.getState();
const math = after.nodes.find((node) => !knownIds.has(node.id));
if (!math) throw new Error("Added node was not found");
```

Edit composition-defined parameters with tagged values:

```ts
await editor.dispatch({
  type: "node.parameter",
  id: math.id,
  key: "operation",
  value: { kind: "string", value: "multiply" },
});

await editor.dispatch({
  type: "node.parameter-reset",
  id: math.id,
  key: "operation",
});
```

Connect nodes using socket IDs obtained from a snapshot:

```ts
const graph = await editor.getState();
const valueNode = graph.nodes.find((node) => node.typeId === "fxnode.shader.value");
const mathNode = graph.nodes.find((node) => node.id === math.id);
const output = valueNode?.sockets.find((socket) => socket.key === "value");
const input = mathNode?.sockets.find((socket) => socket.key === "a");

if (!valueNode || !mathNode || !output || !input) {
  throw new Error("Link endpoints are missing");
}

await editor.dispatch({
  type: "link.add",
  link: {
    fromNodeId: valueNode.id,
    fromSocketId: output.id,
    toNodeId: mathNode.id,
    toSocketId: input.id,
    muted: false,
    extensions: {},
  },
});
```

The link ID is optional through the browser API and is generated when omitted. Other commands cover movement, resize, labels, socket defaults, muting, collapse, frame parenting, link replacement/removal, and reset operations.

Undo and redo are commands too:

```ts
await editor.undo();
await editor.redo();
```

Use `expectedVersion` for optimistic concurrency when application code must reject stale changes:

```ts
const current = await editor.getState();

await editor.dispatch({ type: "node.mute", id: math.id, value: true }, { expectedVersion: current.version });
```

### Local image resources

For Image Texture and compositor Image controls, the host forwards the primary pointer and the worker authoritatively hit-tests the preview and open button. A successful hit emits an immutable `resource-open` request. The application then obtains a file or asset and transfers its bytes with `provideResource()`. The worker decodes the image, keeps a bounded `ImageBitmap` cache, renders an aspect-fit thumbnail, and commits one ordinary versioned parameter mutation. No resource geometry, policy registry, or graph state is mirrored on the main thread.

Saved graphs contain a serializable local image reference and filename, not embedded image bytes or a data URL. Undo/redo can reuse a still-cached thumbnail. Loading the save in a fresh editor preserves the reference but displays an unavailable/reopen placeholder until the user selects the local file again. This keeps mutation, history, and save payloads small and avoids silently persisting user files.

## Observe committed updates

fxnode exposes concrete graph changes at two levels. Both event streams are emitted for the same commit version, with the fine-grained mutation event emitted first.

### Fine-grained mutations

Use `onMutations` when an integration only needs to react to changed records:

```ts
const stopMutations = editor.onMutations((event) => {
  console.log({
    from: event.baseVersion,
    to: event.version,
    commandId: event.commandId,
    cause: event.cause, // "api" | "gesture" | "undo" | "redo" | "load"
  });

  for (const mutation of event.mutations) {
    if (mutation.kind === "node.set") {
      // before/after are full node records; null means creation/removal.
      console.log("node", mutation.id, mutation.before, mutation.after);
    } else if (mutation.kind === "link.set") {
      // before/after are full link records; null means creation/removal.
      console.log("link", mutation.id, mutation.before, mutation.after);
    } else {
      // Loads can replace the complete document.
      console.log("document replaced", mutation.before, mutation.after);
    }
  }
});
```

### Complete graph snapshots

Use `onSnapshots` when a consumer needs the complete graph after every commit:

```ts
const stopSnapshots = editor.onSnapshots((event) => {
  console.log(event.version, event.snapshot.nodes, event.snapshot.links);
});
```

Correlate both streams using `version`:

```ts
const mutationsByVersion = new Map<number, unknown>();

const offMutations = editor.onMutations((event) => {
  mutationsByVersion.set(event.version, event);
});

const offSnapshots = editor.onSnapshots((event) => {
  const matchingMutation = mutationsByVersion.get(event.version);
  console.log("matching update", matchingMutation, event.snapshot);
  mutationsByVersion.delete(event.version);
});
```

Unsubscribe with the function returned by each registration call:

```ts
stopMutations();
stopSnapshots();
offMutations();
offSnapshots();
```

Subscriber exceptions are isolated and do not prevent other subscribers from receiving an event. Events represent committed graph changes only. Hover, selection, camera movement, drag previews, collapse animation frames, and other transient editor state are intentionally not exposed as graph mutations.

## Get, save, and load a graph

> **Warning: runtime state is not persistence.** `getState()` and `setState()` are current-process, current-composition APIs. Their undo boundary disappears with the process. Persist with `getSaveData()` and restore with `load()`; historical or migratable data must use `load()`. `setState()` accepts only strict state for the composition currently bound to the worker.

Use `getState()` for a detached, versioned view of the current graph:

```ts
const snapshot = await editor.getState();
console.log(snapshot.version, snapshot.nodes, snapshot.links);
```

`getState()` is a query. It does not increment the graph version or emit mutation/snapshot events.

Use `save()` for canonical durable JSON:

```ts
const savedLayout = await editor.save();
localStorage.setItem("node-graph", JSON.stringify(savedLayout));
```

`save()` persists the graph, not live-added definitions or the process-local composition revision. Reconstruct the effective composition or deterministically replay its live updates before reopening a graph that depends on them.

Use `getSaveData()` when you want a replayable command journal instead. It returns a serializable checkpoint plus the currently applied forward commands:

```ts
const saveData = await editor.getSaveData();
localStorage.setItem("node-session", JSON.stringify(saveData));

// load() recognizes both GraphLayoutV1/V2 and FxNodeSaveData.
await editor.load(JSON.parse(localStorage.getItem("node-session")!));
```

Undo removes commands from the applied list, redo restores them, and a new forward command clears the redo branch. `getSaveData()` is a worker query: it does not change graph version, emit events, or copy journal authority onto the main thread. Call it only after installing the application composition; before then it faithfully serializes the worker's operational empty bootstrap composition. Schema v2 embeds the complete effective composition. `load(saveData)` validates and replays the complete list inside the worker, then publishes only the final graph atomically. The current composition must have the same ID and preserve every saved replay semantic; its top-level version and presentation may change and it may conservatively add definitions.

The distinction is intentional:

| API                      | Intended use                                  |    Contains commit version? |                                Emits events? |
| ------------------------ | --------------------------------------------- | --------------------------: | -------------------------------------------: |
| `getState()`             | Inspect the current runtime graph             |                         Yes |                                           No |
| `save()`                 | Persist or transmit canonical `GraphLayoutV2` |                          No |                                           No |
| `getSaveData()`          | Persist checkpoint + applied command list     |                          No |                                           No |
| `load(layoutOrSaveData)` | Atomically replace or replay the graph        | Returns current/new version | Layout: yes; replay: only when graph changes |

Load previously persisted data through the worker:

```ts
const raw = localStorage.getItem("node-graph");
if (raw) {
  const receipt = await editor.load(JSON.parse(raw));
  await editor.whenRendered();
  console.log(receipt.version);
}
```

Returned snapshots, layouts, and command-log save data are detached copies. Mutating them cannot mutate worker state; send a command or call `load()` to make a concrete change.

## Present or copy the rendered graph

The canvas passed to `createFxNode` is already the primary on-screen canvas:

```html
<canvas id="node-editor" aria-label="Material node graph"></canvas>
```

```css
#node-editor {
  width: 100%;
  height: 600px;
  display: block;
}
```

The host owns CSS measurement, backing-store dimensions, resize/DPR observation, and `setViewport()`. fxnode only presents worker-rendered frames into the dimensions the host has chosen.

### Continuous mirror

Use a mirror when another canvas should continuously display every rendered frame:

```ts
const minimap = document.querySelector<HTMLCanvasElement>("#node-minimap")!;
minimap.width = 320;
minimap.height = 180;

editor.addMirror(minimap);

// Later:
editor.removeMirror(minimap);
```

The mirror is a presentation surface owned by fxnode while registered. Do not draw application overlays directly into it between frames; use a separate overlay canvas instead.

### One synchronized copy

Use `copyTo` for a one-shot copy synchronized to a requested render:

```ts
const staging = document.createElement("canvas");
staging.width = canvas.width;
staging.height = canvas.height;
await editor.copyTo(staging);

const destination = document.querySelector<HTMLCanvasElement>("#composite")!;
const context = destination.getContext("2d");
if (!context) throw new Error("Canvas 2D is unavailable");

context.drawImage(staging, 0, 0, destination.width, destination.height);
```

This is useful for application-owned compositing, screenshots, previews, and exports. `copyTo` draws the editor frame scaled into the target's existing backing store; it never resizes that canvas and does not copy graph state to the main thread. The same dimension ownership applies to mirrors.

Use `whenRendered()` when no copy is needed but application logic must wait until the latest requested graph state has reached the primary canvas:

```ts
await editor.whenRendered();
```

## Error handling and lifecycle

Commands and loads reject without changing state when validation fails. Capability, worker startup, and protocol failures are terminal; pending and future operations reject with the stored error.

```ts
import { FxNodeCapabilityError, FxNodeWorkerError } from "fxnode";

try {
  await editor.load(untrustedLayout);
} catch (error) {
  if (error instanceof FxNodeWorkerError) {
    console.error(error.code, error.issues);
  } else if (error instanceof FxNodeCapabilityError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

`destroy()` terminates the worker, rejects pending work, and is safe to call more than once. Your application must separately remove its own listeners, observers, menus, file controls, and pointer captures. In a framework effect, dispose the host adapter before destroying the fxnode API.

## Architecture summary

```diagram
┌──────────────────────────────── Main thread ────────────────────────────────┐
│                                                                            │
│  Application/DOM adapter ──normalized input──▶ FxNode API ───────┐        │
│       ▲                         │                          │                │
│       │ committed events       │ transferred ImageBitmap │                │
│       │ events                 ▼                          │                │
│       │                  Primary/mirror canvases          │                │
└───────┼───────────────────────────────────────────────────┼────────────────┘
        │                                                   │
┌───────┼──────────────── Dedicated worker ─────────────────┼────────────────┐
│       │                                                   ▼                │
│  Revisioned composition + versioned graph/history ──▶ layout + renderer    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

The worker is authoritative. The browser client retains only bounded immutable host projections—not composition definitions, compiled maps, a graph shadow, or DOM lifecycle. The application owns all DOM integration and receives graph data only when it explicitly queries `getState()`/`save()` or subscribes to committed events.

## More documentation

- [Browser API](docs/api.md)
- [Persistence and migrations](docs/persistence.md)
- [Composition model](docs/catalog.md)
- [Browser support](docs/browser-support.md)
- [Content Security Policy](docs/csp.md)
- [Accessibility](docs/accessibility.md)

## Development

Development requires Node 20+. `npm run release:check` runs static/unit/performance/reference checks, the functional browser matrix, Chromium-only goldens, and packed-package smoke checks. Pending references are reported honestly; strict reference checking remains `npm run check:references:strict`.
