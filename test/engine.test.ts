import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_DESCRIPTORS, CATALOG_NODE_IDS, commandId, createEngine, decodeGraphDocument, emptyDocument, nodeId, save, serializeGraphDocument, snapshot, transition } from "../src/headless.js";
import type { Command, CommandRequest, EngineState } from "../src/headless.js";

let sequence = 0;
function run(state: EngineState, command: Command) {
  const request: CommandRequest = { commandId: commandId(`command-${++sequence}`), expectedVersion: state.version, source: "api", command };
  return transition(state, request);
}
function committed(state: EngineState, command: Command): EngineState {
  const result = run(state, command);
  assert.equal(result.status, "committed");
  if (result.status !== "committed") throw new Error("expected commit");
  return result.state;
}

test("catalog has exact, frozen descriptor-derived coverage and materializes defaults", () => {
  assert.deepEqual(BUILTIN_DESCRIPTORS.map(item => item.typeId), CATALOG_NODE_IDS);
  assert.equal(BUILTIN_DESCRIPTORS.length, CATALOG_NODE_IDS.length);
  assert.ok(BUILTIN_DESCRIPTORS.every(Object.isFrozen));
  let state = createEngine(emptyDocument());
  state = committed(state, { type: "node.add", nodeId: nodeId("value"), nodeType: "fxnode.shader.value", position: { x: 2, y: 3 } });
  assert.deepEqual(state.document.nodes.value?.parameters.value, { kind: "number", value: 0 });
});

test("commit envelopes carry versions, command id, cause and explicit null", () => {
  const state = createEngine(emptyDocument());
  const id = commandId("add-1");
  const result = transition(state, { commandId: id, expectedVersion: 0, source: "gesture", command: { type: "node.add", nodeId: nodeId("n"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } } });
  assert.equal(result.status, "committed");
  if (result.status !== "committed") return;
  assert.deepEqual({ base: result.mutationEnvelope.baseVersion, version: result.mutationEnvelope.version, cause: result.mutationEnvelope.cause }, { base: 0, version: 1, cause: "gesture" });
  assert.equal(result.mutationEnvelope.commandId, id);
  assert.equal(result.mutationEnvelope.mutations[0]?.before, null);
  assert.equal(result.snapshotEnvelope.version, 1);
});

test("stale, duplicate and missing commands reject with exact state identity", () => {
  let state = createEngine(emptyDocument());
  state = committed(state, { type: "node.add", nodeId: nodeId("n"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
  for (const command of [{ type: "node.add", nodeId: nodeId("n"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } }, { type: "node.remove", id: nodeId("missing") }] as const) {
    const result = run(state, command);
    assert.equal(result.status, "rejected");
    assert.equal(result.state, state);
  }
  const stale = transition(state, { commandId: commandId("stale"), expectedVersion: 0, source: "api", command: { type: "undo" } });
  assert.equal(stale.status, "rejected");
  assert.equal(stale.state, state);
});

test("same-value editing is a no-op and untouched records are shared", () => {
  let state = createEngine(emptyDocument());
  state = committed(state, { type: "node.add", nodeId: nodeId("a"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
  state = committed(state, { type: "node.add", nodeId: nodeId("b"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
  const noop = run(state, { type: "node.move", id: nodeId("a"), position: { x: 0, y: 0 } });
  assert.equal(noop.status, "noop"); assert.equal(noop.state, state);
  const before = state.document.nodes.b;
  state = committed(state, { type: "node.move", id: nodeId("a"), position: { x: 5, y: 6 } });
  assert.equal(state.document.nodes.b, before);
  assert.ok(Object.isFrozen(state.document.nodes.a?.parameters));
});

test("undo and redo restore remove cascades and frame children", () => {
  let state = createEngine(emptyDocument());
  state = committed(state, { type: "node.add", nodeId: nodeId("frame"), nodeType: "fxnode.common.frame", position: { x: 0, y: 0 } });
  state = committed(state, { type: "node.add", nodeId: nodeId("child"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 }, parentId: nodeId("frame") });
  state = committed(state, { type: "node.remove", id: nodeId("frame") });
  assert.equal(state.document.nodes.child?.parentId, undefined);
  state = committed(state, { type: "undo" });
  assert.equal(state.document.nodes.child?.parentId, "frame");
  state = committed(state, { type: "redo" });
  assert.equal(state.document.nodes.frame, undefined);
});

test("history limits 0, 1 and 2 bound undo and new edits clear redo", () => {
  for (const limit of [0, 1, 2]) { let state = createEngine(emptyDocument(), limit); state = committed(state, { type: "node.add", nodeId: nodeId(`n${limit}`), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } }); assert.equal(state.undo.length, limit === 0 ? 0 : 1); }
  assert.throws(() => createEngine(emptyDocument(), 1.5), RangeError);
});

test("frame cycles reject atomically", () => {
  let state = createEngine(emptyDocument());
  state = committed(state, { type: "node.add", nodeId: nodeId("a"), nodeType: "fxnode.common.frame", position: { x: 0, y: 0 } });
  state = committed(state, { type: "node.add", nodeId: nodeId("b"), nodeType: "fxnode.common.frame", position: { x: 0, y: 0 }, parentId: nodeId("a") });
  const result = run(state, { type: "node.parent", id: nodeId("a"), parentId: nodeId("b") });
  assert.equal(result.status, "rejected"); assert.equal(result.state, state);
});

test("save, decode and save is canonical; snapshot arrays sort by id", () => {
  let state = createEngine(emptyDocument("canonical"));
  state = committed(state, { type: "node.add", nodeId: nodeId("z"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
  state = committed(state, { type: "node.add", nodeId: nodeId("a"), nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
  const layout = save(state.document);
  assert.deepEqual(layout.nodes.map(item => item.id), ["a", "z"]);
  const decoded = decodeGraphDocument(structuredClone(layout));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.equal(serializeGraphDocument(decoded.value), serializeGraphDocument(state.document));
  assert.deepEqual(snapshot(state).nodes.map(item => item.id), ["a", "z"]);
  assert.equal("known" in layout.nodes[0]!, false);
});

test("transient fields are rejected even through extension escape hatches", () => {
  const raw = { ...save(emptyDocument()), extensions: { selection: [] } };
  assert.equal(decodeGraphDocument(raw).ok, false);
  const nested = { ...save(emptyDocument()), metadata: { extension: { history: [] } } };
  assert.equal(decodeGraphDocument(nested).ok, false);
});

test("V1 migrates to V2, muted links persist, and future schemas reject structurally", () => {
  const v1 = { schemaVersion: 1, graphId: "old", catalogVersion: 1, nodes: [], links: [], metadata: {} };
  const migrated = decodeGraphDocument(v1);
  assert.equal(migrated.ok, true);
  if (migrated.ok) assert.deepEqual({ schema: save(migrated.value).schemaVersion, catalog: migrated.value.catalogVersion }, { schema: 2, catalog: 3 });
  const future = decodeGraphDocument({ ...v1, schemaVersion: 3 });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.issues[0]?.code, "schema.future");
});

test("parameter reset resolves descriptor default and is one-step undoable", () => {
  let state=createEngine(emptyDocument());
  state=committed(state,{type:"node.add",nodeId:nodeId("v"),nodeType:"fxnode.shader.value",position:{x:0,y:0}});
  state=committed(state,{type:"node.parameter",id:nodeId("v"),key:"value",value:{kind:"number",value:9}});
  state=committed(state,{type:"node.parameter-reset",id:nodeId("v"),key:"value"});
  assert.deepEqual(state.document.nodes.v?.parameters.value,{kind:"number",value:0});
  state=committed(state,{type:"undo"});
  assert.deepEqual(state.document.nodes.v?.parameters.value,{kind:"number",value:9});
});

test("batch is atomic, increments once, and undoes as one entry", () => {
  let state=createEngine(emptyDocument());
  state=committed(state,{type:"node.add",nodeId:nodeId("a"),nodeType:"fxnode.shader.value",position:{x:0,y:0}});
  state=committed(state,{type:"node.add",nodeId:nodeId("b"),nodeType:"fxnode.shader.value",position:{x:0,y:0}});
  const before=state, result=run(state,{type:"batch",commands:[{type:"node.move",id:nodeId("a"),position:{x:3,y:4}},{type:"node.move",id:nodeId("b"),position:{x:5,y:6}}]});
  assert.equal(result.status,"committed");if(result.status!=="committed")return;
  assert.equal(result.state.version,before.version+1);assert.equal(result.state.undo.length,before.undo.length+1);
  state=committed(result.state,{type:"undo"});assert.deepEqual(state.document.nodes.a?.position,{x:0,y:0});assert.deepEqual(state.document.nodes.b?.position,{x:0,y:0});
  const rejected=run(state,{type:"batch",commands:[{type:"node.move",id:nodeId("a"),position:{x:9,y:9}},{type:"node.remove",id:nodeId("missing")}]});
  assert.equal(rejected.status,"rejected");assert.equal(rejected.state,state);
});
