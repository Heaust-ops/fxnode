# fxnode

> **Internal prerelease:** the package remains `private: true`; do not publish it.

fxnode is a clean-room, Blender-inspired node-editor presentation and persistence library. It is not affiliated with or endorsed by Blender or the Blender Foundation.

It provides a command-driven node editor that runs graph ownership, layout, interaction, history, and rendering in a dedicated worker. Application code supplies an initial graph and an on-screen canvas, then communicates with the editor through the typed main-thread API. The main thread does not maintain a shadow copy of the graph.

fxnode provides editing and presentation only: **no graph evaluation, Blender file compatibility, or parity claim**. Blender reference captures are **0/8 pending**. Existing image snapshots are fxnode regression goldens, not Blender references or evidence of visual parity.

## Install

```sh
npm install fxnode
```

The current repository is an internal prerelease, so installation from a registry is only applicable after the package is made publishable.

## Create an editor

Give `createFxNode` an HTML canvas and a persisted graph layout. The supplied canvas is the primary on-screen presentation surface.

```ts
import { createFxNode, type FxNode } from "fxnode";

const canvas = document.querySelector<HTMLCanvasElement>("#node-editor");
if (!canvas) throw new Error("Node editor canvas is missing");

const layout = {
  schemaVersion: 2,
  graphId: "material-editor",
  catalogVersion: 3,
  nodes: [],
  links: [],
  metadata: {},
};

const editor: FxNode = await createFxNode({
  canvas,
  layout,
  historyLimit: 100,
});

await editor.whenRendered();
```

Always release the worker when the editor is no longer needed:

```ts
editor.destroy(); // Idempotent. Pending and future operations reject.
```

The module worker renders to an `OffscreenCanvas` and transfers `ImageBitmap` frames for presentation. There is deliberately no blob-worker, classic-worker, or main-thread fallback. The default worker URL is package-relative; `workerUrl` can identify a separately hosted module worker:

```ts
const editor = await createFxNode({
  canvas,
  layout,
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
  nodes: [/* persisted nodes */],
  links: [/* persisted links */],
  metadata: { project: "demo" },
};
```

- `schemaVersion` identifies the persistence format. Version 2 is current.
- `graphId` identifies the graph independently of its editor instance.
- `catalogVersion` identifies the built-in node catalog expected by the saved data.
- `nodes` contains node geometry, parameters, sockets, mute/collapse state, frame parenting, and extension data.
- `links` connects an output socket to an input socket.
- `metadata` is application-owned JSON that round-trips with the graph.

A persisted node resembles the following. This abbreviated sample is illustrative; a loadable known node must include every catalog-owned socket.

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
    // Other catalog-owned sockets omitted here.
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

Known built-in nodes must match their catalog descriptor exactly. Unsupported type IDs and future descriptor versions are retained as opaque, read-only nodes. See [persistence](docs/persistence.md) and [catalog](docs/catalog.md) for validation and migration details.

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
const before = await editor.snapshot();
const knownIds = new Set(before.nodes.map(node => node.id));

await editor.dispatch({
  type: "node.add",
  nodeType: "fxnode.shader.math",
  position: { x: 80, y: 100 },
});

const after = await editor.snapshot();
const math = after.nodes.find(node => !knownIds.has(node.id));
if (!math) throw new Error("Added node was not found");
```

Edit catalog-owned parameters with tagged values:

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
const graph = await editor.snapshot();
const valueNode = graph.nodes.find(node => node.typeId === "fxnode.shader.value");
const mathNode = graph.nodes.find(node => node.id === math.id);
const output = valueNode?.sockets.find(socket => socket.key === "value");
const input = mathNode?.sockets.find(socket => socket.key === "a");

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
const current = await editor.snapshot();

await editor.dispatch(
  { type: "node.mute", id: math.id, value: true },
  { expectedVersion: current.version },
);
```

## Observe committed updates

fxnode exposes concrete graph changes at two levels. Both event streams are emitted for the same commit version, with the fine-grained mutation event emitted first.

### Fine-grained mutations

Use `onMutations` when an integration only needs to react to changed records:

```ts
const stopMutations = editor.onMutations(event => {
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
const stopSnapshots = editor.onSnapshots(event => {
  console.log(event.version, event.snapshot.nodes, event.snapshot.links);
});
```

Correlate both streams using `version`:

```ts
const mutationsByVersion = new Map<number, unknown>();

const offMutations = editor.onMutations(event => {
  mutationsByVersion.set(event.version, event);
});

const offSnapshots = editor.onSnapshots(event => {
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

Use `snapshot()` for a versioned view of the current graph:

```ts
const snapshot = await editor.snapshot();
console.log(snapshot.version, snapshot.nodes, snapshot.links);
```

`snapshot()` is a query. It does not increment the graph version or emit mutation/snapshot events.

Use `save()` for canonical durable JSON:

```ts
const savedLayout = await editor.save();
localStorage.setItem("node-graph", JSON.stringify(savedLayout));
```

The distinction is intentional:

| API | Intended use | Contains commit version? | Emits events? |
| --- | --- | ---: | ---: |
| `snapshot()` | Inspect the current runtime graph | Yes | No |
| `save()` | Persist or transmit canonical `GraphLayoutV2` | No | No |
| `load(layout)` | Atomically replace the graph | Returns new version | Yes, when committed |

Load previously persisted data through the worker:

```ts
const raw = localStorage.getItem("node-graph");
if (raw) {
  const receipt = await editor.load(JSON.parse(raw));
  await editor.whenRendered();
  console.log(receipt.version);
}
```

Returned snapshots and saved layouts are detached copies. Mutating them cannot mutate worker state; send a command or call `load()` to make a concrete change.

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

fxnode observes its CSS size, applies the device pixel ratio, and presents worker-rendered frames into its backing store.

### Continuous mirror

Use a mirror when another canvas should continuously display every rendered frame:

```ts
const minimap = document.querySelector<HTMLCanvasElement>("#node-minimap")!;

editor.addMirror(minimap);

// Later:
editor.removeMirror(minimap);
```

The mirror is a presentation surface owned by fxnode while registered. Do not draw application overlays directly into it between frames; use a separate overlay canvas instead.

### One synchronized copy

Use `copyTo` for a one-shot copy synchronized to a requested render:

```ts
const staging = document.createElement("canvas");
await editor.copyTo(staging);

const destination = document.querySelector<HTMLCanvasElement>("#composite")!;
const context = destination.getContext("2d");
if (!context) throw new Error("Canvas 2D is unavailable");

context.drawImage(staging, 0, 0, destination.width, destination.height);
```

This is useful for application-owned compositing, screenshots, previews, and exports. `copyTo` replaces the target canvas backing store with the editor frame. It does not copy graph state to the main thread.

Use `whenRendered()` when no copy is needed but application logic must wait until the latest requested graph state has reached the primary canvas:

```ts
await editor.whenRendered();
```

## Error handling and lifecycle

Commands and loads reject without changing state when validation fails. Capability, worker startup, and protocol failures are terminal; pending and future operations reject with the stored error.

```ts
import {
  FxNodeCapabilityError,
  FxNodeWorkerError,
} from "fxnode";

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

`destroy()` disconnects observers and listeners, terminates the worker, rejects pending work, restores the canvas's original `tabindex` and inline `touch-action`, and is safe to call more than once.

## Architecture summary

```diagram
┌──────────────────────────────── Main thread ────────────────────────────────┐
│                                                                            │
│  Application ──commands/queries──▶ FxNode API ──messages──┐                │
│       ▲                         │                          │                │
│       │ mutation + snapshot    │ transferred ImageBitmap │                │
│       │ events                 ▼                          │                │
│       │                  Primary/mirror canvases          │                │
└───────┼───────────────────────────────────────────────────┼────────────────┘
        │                                                   │
┌───────┼──────────────── Dedicated worker ─────────────────┼────────────────┐
│       │                                                   ▼                │
│  Versioned graph ◀── command/history engine ──▶ layout + renderer          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

The worker is authoritative. The only time application code receives graph data is when it explicitly queries `snapshot()`/`save()` or subscribes to committed events.

## More documentation

- [Browser API](docs/api.md)
- [Persistence and migrations](docs/persistence.md)
- [Catalog scope](docs/catalog.md)
- [Browser support](docs/browser-support.md)
- [Content Security Policy](docs/csp.md)
- [Accessibility](docs/accessibility.md)

## Development

Development requires Node 20+. `npm run release:check` runs static/unit/performance/reference checks, the functional browser matrix, Chromium-only goldens, and packed-package smoke checks. Pending references are reported honestly; strict reference checking remains `npm run check:references:strict`.
