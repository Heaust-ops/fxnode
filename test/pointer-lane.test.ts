import assert from "node:assert/strict";
import test from "node:test";
import { advancePointerLaneFence, createPointerLane, pointerLaneFence, publishPointerMove, readPointerMove, type PointerMoveWire } from "../src/browser/pointer-lane.js";

const move = (x: number, y: number): PointerMoveWire => ({ kind: "pointer", phase: "move", pointerId: 7, pointerType: "pen", position: { x, y }, button: -1, buttons: 1, modifiers: 8 });

test("shared pointer lane publishes exact latest coordinates and fences", () => {
  const lane = createPointerLane();
  assert.equal(pointerLaneFence(lane), 0);
  const sequence = publishPointerMove(lane, move(-12.25, 987.125));
  assert.equal(sequence, 1);
  assert.deepEqual(readPointerMove(lane), { sequence: 1, event: move(-12.25, 987.125) });
  assert.equal(advancePointerLaneFence(lane), 1);
  assert.equal(pointerLaneFence(lane), 1);
  assert.equal(publishPointerMove(lane, { ...move(4, 5), pointerType: "unknown" }), undefined);
  assert.deepEqual(readPointerMove(lane), { sequence: 1, event: move(-12.25, 987.125) });
});

test("shared pointer lane rejects an in-progress publication", () => {
  const lane = createPointerLane();
  publishPointerMove(lane, move(1, 2));
  const words = new Int32Array(lane);
  Atomics.store(words, 0, Atomics.load(words, 0) | 1);
  assert.equal(readPointerMove(lane), undefined);
});
