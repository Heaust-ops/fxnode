import test from "node:test";
import assert from "node:assert/strict";
import { addRampMidpoint, addRampStop, DEFAULT_COLOR_RAMP, distributeColorRamp, flipColorRamp, isColorRamp, layoutGraph, materializeNode, migrateColorRamp, moveRampStop, removeRampStop, sampleColorRamp } from "../src/headless.js";

test("Color Ramp migration, validation and stable pure operations",()=>{
  const migrated=migrateColorRamp([{position:0,color:[0,0,0,1]},{position:.5,color:[1,0,0,1]},{position:1,color:[1,1,1,1]}])!;
  assert.deepEqual(migrated.stops.map(s=>s.id),["stop-0","stop-1","stop-2"]);assert.equal(isColorRamp(migrated),true);
  const added=addRampStop(migrated,.25,"worker-1");assert.equal(added.stops.find(s=>s.id==="worker-1")?.color[0],.5);
  assert.equal(addRampMidpoint(migrated,"stop-1","worker-2").stops.find(s=>s.id==="worker-2")?.position,.25);
  assert.deepEqual(moveRampStop(migrated,"stop-0",.75).stops.map(s=>s.id),["stop-1","stop-0","stop-2"]);
  assert.equal(removeRampStop(DEFAULT_COLOR_RAMP,"stop-0"),DEFAULT_COLOR_RAMP);
  assert.deepEqual(distributeColorRamp(migrated).stops.map(s=>s.position),[0,.5,1]);assert.deepEqual(flipColorRamp(migrated).stops.map(s=>s.position),[0,.5,1]);
  assert.deepEqual(sampleColorRamp({...DEFAULT_COLOR_RAMP,interpolation:"constant"},.5),[0,0,0,1]);
});

test("Noise Texture exhaustive Blender 4.5 visibility matrix and immediate height",()=>{
  const dimensions=["1d","2d","3d","4d"],types=["fbm","multifractal","hybrid-multifractal","ridged-multifractal","hetero-terrain"];
  for(const dimension of dimensions)for(const noiseType of types){const base=materializeNode("noise","fxnode.shader.noise-texture");const node={...base,parameters:{...base.parameters,dimensions:{kind:"string" as const,value:dimension},noiseType:{kind:"string" as const,value:noiseType}}};const document={schemaVersion:2 as const,graphId:"g" as never,catalogVersion:2,nodes:{noise:node},links:{},metadata:{}};const layout=layoutGraph(document,{center:{x:0,y:0},zoom:1,viewport:{x:800,y:600},dpr:1});const keys=new Set([...layout.sockets.values()].map(s=>s.id.split(":").at(-1)));assert.equal(keys.has("vector"),dimension!=="1d");assert.equal(keys.has("w"),dimension==="1d"||dimension==="4d");assert.equal(keys.has("offset"),["hybrid-multifractal","ridged-multifractal","hetero-terrain"].includes(noiseType));assert.equal(keys.has("gain"),["hybrid-multifractal","ridged-multifractal"].includes(noiseType));const hasNormalize=layout.controls.has("noise:parameter:normalize");assert.equal(hasNormalize,noiseType==="fbm");assert.ok(layout.nodes.get("noise" as never)!.bounds.height>0);}
});
