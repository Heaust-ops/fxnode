import assert from "node:assert/strict";
import test from "node:test";
import { DirtyReason, RenderScheduler } from "../src/worker/render-scheduler.js";

test("continuous RAF polls while idle and preserves one-frame backpressure", () => {
  const callbacks: Array<() => void> = [];
  const draws: Array<readonly [number, number, number]> = [];
  let polls = 0;
  const scheduler = new RenderScheduler((...args) => draws.push(args), callback => callbacks.push(callback));
  const tick = () => { const callback = callbacks.shift(); assert.ok(callback); callback(); };

  scheduler.start(() => polls++);
  assert.equal(callbacks.length, 1);
  tick();
  assert.equal(polls, 1);
  assert.equal(draws.length, 0);
  assert.equal(callbacks.length, 1);

  scheduler.request(4, DirtyReason.Preview);
  tick();
  assert.deepEqual(draws, [[1, 4, DirtyReason.Preview]]);
  scheduler.request(5, DirtyReason.Scene);
  tick();
  assert.equal(draws.length, 1);
  scheduler.consumed(99);
  tick();
  assert.equal(draws.length, 1);
  scheduler.consumed(1);
  tick();
  assert.deepEqual(draws[1], [2, 5, DirtyReason.Scene]);
  assert.equal(scheduler.metrics.staleAcks, 1);
  assert.equal(scheduler.metrics.maxInFlight, 1);

  scheduler.stop();
  tick();
  assert.equal(callbacks.length, 0);
});
