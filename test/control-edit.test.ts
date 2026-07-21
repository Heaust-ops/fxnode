import test from "node:test";
import assert from "node:assert/strict";
import { clampNumber, cycleEnum, numericStep, scrubValue, setNumericComponent, snapNumber } from "../src/worker/control-edit.js";
import type { LayoutControl } from "../src/layout/types.js";

const numberControl: LayoutControl = {
  id: "number",
  nodeId: "node" as LayoutControl["nodeId"],
  source: "parameter",
  key: "value",
  label: "Value",
  kind: "number",
  value: { kind: "number", value: 0 },
  schema: { type: "number", default: { kind: "number", value: 0 }, hardMin: -1, hardMax: 1, step: .25 },
  linked: false,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  subfields: [],
  numericFields: [],
};

test("control edit helpers clamp, snap and apply fine scrub", () => {
  assert.equal(clampNumber(2, numberControl.schema), 1);
  assert.equal(snapNumber(.38, numberControl.schema), .5);
  assert.deepEqual(scrubValue(numberControl, { kind: "number", value: 0 }, 0, 5, true, false), { kind: "number", value: .05 });
  assert.deepEqual(scrubValue(numberControl, { kind: "number", value: 0 }, 0, 3.8, false, true), { kind: "number", value: .5 });
  assert.deepEqual(setNumericComponent(numberControl,{kind:"number",value:0},0,2),{kind:"number",value:1});
  assert.equal(numericStep(numberControl,false),.25);
  assert.equal(numericStep(numberControl,true),.025);
});

test("vector/color edits preserve other components and enum cycling wraps", () => {
  const vector = { ...numberControl, kind: "vector" as const, schema: { type: "vector" as const, default: { kind: "vector" as const, value: [0, 0, 0] as const } } };
  assert.deepEqual(scrubValue(vector, { kind: "vector", value: [1, 2, 3] }, 1, 10, false, false), { kind: "vector", value: [1, 3, 3] });
  assert.deepEqual(setNumericComponent(vector,{kind:"vector",value:[1,2,3]},1,4),{kind:"vector",value:[1,4,3]});
  const color = { ...numberControl, kind: "color" as const, schema: { type: "color" as const, default: { kind: "color" as const, value: [0, 0, 0, 1] as const } } };
  assert.deepEqual(scrubValue(color, { kind: "color", value: [0, .5, 0, 1] }, 1, 10, false, false), { kind: "color", value: [0, 1, 0, 1] });
  assert.equal(cycleEnum(["a", "b"], "b", 1), "a");
});
