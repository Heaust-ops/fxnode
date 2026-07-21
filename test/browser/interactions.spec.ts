import { expect,test } from "@playwright/test";

test("worker gestures stay transient and commit exactly one paired event",async({page})=>{
  await page.addInitScript(()=>{const NativeWorker=window.Worker;let moves=0;class TrackedWorker extends NativeWorker{override postMessage(message:unknown,transfer:Transferable[]):void;override postMessage(message:unknown,options?:StructuredSerializeOptions):void;override postMessage(message:unknown,transferOrOptions?:Transferable[]|StructuredSerializeOptions):void{if(typeof message==="object"&&message!==null&&(message as {type?:unknown}).type==="input"&&((message as {event?:{kind?:unknown;phase?:unknown}}).event?.kind==="pointer")&&((message as {event?:{phase?:unknown}}).event?.phase==="move"))moves++;if(Array.isArray(transferOrOptions))super.postMessage(message,transferOrOptions);else super.postMessage(message,transferOrOptions);}}Object.defineProperty(window,"Worker",{value:TrackedWorker});Object.defineProperty(window,"pointerMoveMessages",{get:()=>moves});});
  await page.goto("/example/");await page.evaluate(()=>window.fxnodeExample.ready);
  expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
  await page.evaluate(()=>{const h=window.fxnodeExample;const w=window as typeof window&{gestureEvents:{m:number;s:number}};w.gestureEvents={m:0,s:0};h.api!.onMutations(()=>w.gestureEvents.m++);h.api!.onSnapshots(()=>w.gestureEvents.s++);});
  const canvas=page.locator("#graph"),snapshot=()=>page.evaluate(()=>window.fxnodeExample.api!.snapshot());
  const original=await snapshot();
  // Math header is deterministic: world (-300,170), view origin (600,320).
  await canvas.click({position:{x:380,y:160}});expect((await snapshot()).version).toBe(original.version);expect(await page.evaluate(()=>(window as typeof window & {gestureEvents:{m:number;s:number}}).gestureEvents)).toEqual({m:0,s:0});
  const bounds=await canvas.boundingBox();if(!bounds)throw new Error("canvas bounds missing");await canvas.hover({position:{x:380,y:160}});await page.mouse.down();await page.mouse.move(bounds.x+410,bounds.y+180,{steps:4});expect((await snapshot()).nodes.find(n=>n.id==="math")?.position).toEqual({x:-300,y:170});await page.mouse.up();
  expect((await snapshot()).nodes.find(n=>n.id==="math")?.position).toEqual({x:-270,y:150});expect(await page.evaluate(()=>(window as typeof window & {gestureEvents:{m:number;s:number}}).gestureEvents)).toEqual({m:1,s:1});
  expect(await page.evaluate(()=>(window as typeof window&{pointerMoveMessages:number}).pointerMoveMessages)).toBe(0);
  // G and ordinary drag cancel without mutation; RMB is suppressed by the canvas.
  await canvas.press("g");await page.mouse.move(bounds.x+390,bounds.y+210);await canvas.press("Escape");expect((await snapshot()).version).toBe(1);
  await canvas.hover({position:{x:390,y:180}});await page.mouse.down();await page.mouse.move(bounds.x+430,bounds.y+220);await canvas.press("Escape");await page.mouse.up();await canvas.click({position:{x:30,y:30},button:"right"});expect((await snapshot()).version).toBe(1);
  // Box, MMB, wheel and Home are view/selection-only.
  await canvas.hover({position:{x:20,y:20}});await page.mouse.down();await page.mouse.move(bounds.x+250,bounds.y+300);await page.mouse.up();await canvas.hover({position:{x:30,y:30}});await page.mouse.down({button:"middle"});await page.mouse.move(bounds.x+40,bounds.y+40);await page.mouse.up({button:"middle"});await page.mouse.wheel(0,30);await canvas.press("Home");expect((await snapshot()).version).toBe(1);
});

test("non-isolated hosts retain the ordered pointer message fallback",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,"crossOriginIsolated",{value:false});const NativeWorker=window.Worker;let moves=0;class TrackedWorker extends NativeWorker{override postMessage(message:unknown,transfer:Transferable[]):void;override postMessage(message:unknown,options?:StructuredSerializeOptions):void;override postMessage(message:unknown,transferOrOptions?:Transferable[]|StructuredSerializeOptions):void{if(typeof message==="object"&&message!==null&&(message as {type?:unknown}).type==="input"&&((message as {event?:{kind?:unknown;phase?:unknown}}).event?.kind==="pointer")&&((message as {event?:{phase?:unknown}}).event?.phase==="move"))moves++;if(Array.isArray(transferOrOptions))super.postMessage(message,transferOrOptions);else super.postMessage(message,transferOrOptions);}}Object.defineProperty(window,"Worker",{value:TrackedWorker});Object.defineProperty(window,"pointerMoveMessages",{get:()=>moves});});
  await page.goto("/example/");await page.evaluate(()=>window.fxnodeExample.ready);expect(await page.evaluate(()=>crossOriginIsolated)).toBe(false);
  const canvas=page.locator("#graph"),bounds=await canvas.boundingBox();if(!bounds)throw new Error("canvas bounds missing");await canvas.hover({position:{x:380,y:160}});await page.mouse.down();await page.mouse.move(bounds.x+410,bounds.y+180,{steps:4});await page.mouse.up();
  expect((await page.evaluate(()=>window.fxnodeExample.api!.snapshot())).nodes.find(node=>node.id==="math")?.position).toEqual({x:-270,y:150});
  expect(await page.evaluate(()=>(window as typeof window&{pointerMoveMessages:number}).pointerMoveMessages)).toBeGreaterThan(0);
});

test("wheel input visibly zooms around the pointer without changing graph state",async({page})=>{
  await page.addInitScript(()=>{const NativeWorker=window.Worker;let wheels=0;class TrackedWorker extends NativeWorker{override postMessage(message:unknown,transfer:Transferable[]):void;override postMessage(message:unknown,options?:StructuredSerializeOptions):void;override postMessage(message:unknown,transferOrOptions?:Transferable[]|StructuredSerializeOptions):void{if(typeof message==="object"&&message!==null&&(message as {type?:unknown}).type==="input"&&(message as {event?:{kind?:unknown}}).event?.kind==="wheel")wheels++;if(Array.isArray(transferOrOptions))super.postMessage(message,transferOrOptions);else super.postMessage(message,transferOrOptions);}}Object.defineProperty(window,"Worker",{value:TrackedWorker});Object.defineProperty(window,"wheelMessages",{get:()=>wheels});});
  await page.goto("/example/");await page.evaluate(()=>window.fxnodeExample.ready);const canvas=page.locator("#graph"),before=await canvas.screenshot(),version=(await page.evaluate(()=>window.fxnodeExample.api!.snapshot())).version;
  await canvas.hover({position:{x:400,y:240}});await page.mouse.wheel(0,-240);await expect.poll(()=>page.evaluate(()=>(window as typeof window&{wheelMessages:number}).wheelMessages)).toBe(1);await page.evaluate(()=>window.fxnodeExample.api!.whenRendered());const zoomed=await canvas.screenshot();expect(zoomed.equals(before)).toBe(false);expect((await page.evaluate(()=>window.fxnodeExample.api!.snapshot())).version).toBe(version);
  await page.mouse.wheel(0,240);await page.evaluate(()=>window.fxnodeExample.api!.whenRendered());expect((await canvas.screenshot()).equals(zoomed)).toBe(false);
});
