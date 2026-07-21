import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_DESCRIPTORS, createEngine, emptyDocument, layoutGraph, materializeNode, nodeId, transition, commandId, socketsCompatible, viewToWorld, worldToView } from "../src/headless.js";
import { applyNodeOrder } from "../src/layout/layout-graph.js";
import { boxNodes, clampResize, compatibleTargets, frameDropCandidate, groupRoots, hitRamp, hitTest, planLink, zoomAt } from "../src/worker/interaction.js";

const transform = { center: { x: 0, y: 0 }, zoom: 2, viewport: { x: 800, y: 600 }, dpr: 1 };
test("world/view transforms round trip with +Y up", () => {
  const point = { x: 17, y: -23 };
  assert.deepEqual(viewToWorld(worldToView(point, transform), transform), point);
  assert.ok(worldToView({ x: 0, y: 1 }, transform).y < worldToView({ x: 0, y: 0 }, transform).y);
});
test("all catalog types lay out deterministically", () => {
  let state = createEngine(emptyDocument());
  for (const [index, descriptor] of BUILTIN_DESCRIPTORS.entries()) {
    const result = transition(state, { commandId: commandId(String(index)), expectedVersion: state.version, source: "api", command: { type: "node.add", nodeId: nodeId(`n${index}`), nodeType: descriptor.typeId, position: { x: index * 10, y: 0 } } });
    assert.notEqual(result.status, "rejected"); if (result.status === "committed") state = result.state;
  }
  const a = layoutGraph(state.document, transform), b = layoutGraph(state.document, transform);
  assert.equal(a.nodes.size, BUILTIN_DESCRIPTORS.length); assert.deepEqual([...a.drawOrder], [...b.drawOrder]);
});
test("expanded, collapsed, reroute and links have pinned geometry", () => {
  const value = materializeNode("value", "fxnode.shader.value", { x: -100, y: 20 });
  const math = materializeNode("math", "fxnode.shader.math", { x: 100, y: 20 });
  const link = { id: "link", fromNodeId: "value", fromSocketId: "value:value", toNodeId: "math", toSocketId: "math:a", extensions: {} };
  const raw = { schemaVersion: 1, graphId: "layout", catalogVersion: 1, nodes: { value, math }, links: { link }, metadata: {} } as unknown as Parameters<typeof layoutGraph>[0];
  const snapshot = layoutGraph(raw, transform);
  assert.equal(snapshot.links.values().next().value?.points.length, 13);
  const valueLayout=snapshot.nodes.get(nodeId("value"))!;
  assert.equal(valueLayout.bounds.width,valueLayout.minimumSize.x);
  assert.ok(valueLayout.bounds.width>=140);
  assert.equal(snapshot.sockets.size, 4);
  assert.equal((snapshot.controls.get("value:parameter:value")?.value as { value: number }).value, 0);
  assert.equal((snapshot.controls.get("math:parameter:operation")?.value as { value: string }).value, "add");
  assert.ok((snapshot.nodes.get(nodeId("math"))?.bounds.height ?? 0) >= 126);
  assert.equal(snapshot.controls.get("math:socket:math:a")?.linked, true, "linked inputs hide controls");
});

test("frames have labelled fitted bounds around parent-local children", () => {
  const frame = { ...materializeNode("frame", "fxnode.common.frame", { x: -200, y: 200 }), label: "Surface Controls", size: { x: 100, y: 100 } };
  const child = { ...materializeNode("child", "fxnode.shader.value", { x: 30, y: -50 }), parentId: "frame" };
  const raw = { schemaVersion: 1, graphId: "frame-layout", catalogVersion: 1, nodes: { frame, child }, links: {}, metadata: {} } as unknown as Parameters<typeof layoutGraph>[0];
  const snapshot = layoutGraph(raw, transform), frameLayout = snapshot.nodes.get(nodeId("frame"))!, childLayout = snapshot.nodes.get(nodeId("child"))!;
  assert.equal(frameLayout.label, "Surface Controls");
  assert.ok(frameLayout.bounds.x <= childLayout.bounds.x - 30);
  assert.ok(frameLayout.bounds.x + frameLayout.bounds.width >= childLayout.bounds.x + childLayout.bounds.width + 30);
  assert.ok(frameLayout.bounds.y >= childLayout.bounds.y + 30);
  assert.ok(frameLayout.bounds.y - frameLayout.bounds.height <= childLayout.bounds.y - childLayout.bounds.height - 30);
});
test("socket compatibility does not treat accepts any as wildcard",()=>{
  const output={direction:"output" as const,dataType:"float" as const};
  assert.equal(socketsCompatible(output,{direction:"input",dataType:"vector",accepts:["any"]}),false);
  assert.equal(socketsCompatible(output,{direction:"input",dataType:"any",accepts:[]}),true);
});
test("wheel zoom preserves world point and group roots omit selected descendants",()=>{
  const cursor={x:123,y:234}, before=viewToWorld(cursor,transform), next=zoomAt(transform,cursor,120), after=viewToWorld(cursor,{...transform,...next});assert.ok(Math.abs(before.x-after.x)<1e-9);assert.ok(Math.abs(before.y-after.y)<1e-9);
  const frame={...materializeNode("f","fxnode.common.frame",{x:0,y:0})}, child={...materializeNode("c","fxnode.shader.value",{x:10,y:-10}),parentId:nodeId("f")};
  const doc={schemaVersion:1,graphId:"g",catalogVersion:1,nodes:{f:frame,c:child},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0];
  assert.deepEqual(groupRoots(new Set([nodeId("f"),nodeId("c")]),layoutGraph(doc,transform)),[nodeId("f")]);
});
test("transient node order controls overlapping paint and hit order",()=>{
  const a=materializeNode("a","fxnode.shader.value",{x:0,y:0}),b=materializeNode("b","fxnode.shader.value",{x:0,y:0}),doc={schemaVersion:1,graphId:"z",catalogVersion:1,nodes:{a,b},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0];
  const original=layoutGraph(doc,{...transform,zoom:1}),raised=applyNodeOrder(original,[nodeId("b"),nodeId("a")]),point=worldToView({x:20,y:-20},raised.transform);
  assert.deepEqual(raised.drawOrder.slice(-2),[nodeId("b"),nodeId("a")]);assert.deepEqual(hitTest(raised,point),{kind:"node",id:nodeId("a")});
});
test("reroute core starts links while its outer halo selects the node",()=>{
  const reroute=materializeNode("r","fxnode.common.reroute",{x:0,y:0}),doc={schemaVersion:1,graphId:"reroute",catalogVersion:1,nodes:{r:reroute},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,{...transform,zoom:1}),node=layout.nodes.get(nodeId("r"))!,center=worldToView({x:node.bounds.x+5,y:node.bounds.y-5},layout.transform);
  assert.equal(hitTest(layout,center,"output").kind,"socket");assert.deepEqual(hitTest(layout,{x:center.x+11,y:center.y}),{kind:"node",id:nodeId("r")});
});
test("interaction helpers hit sampled links, box nodes, plan replacement and clamp resize",()=>{
  const value=materializeNode("v","fxnode.shader.value",{x:-100,y:50}),math=materializeNode("m","fxnode.shader.math",{x:100,y:50});
  const old={id:"old",fromNodeId:"v",fromSocketId:"v:value",toNodeId:"m",toSocketId:"m:a",extensions:{}};
  const doc={schemaVersion:1,graphId:"i",catalogVersion:1,nodes:{v:value,m:math},links:{old},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,{...transform,zoom:1});
  const link=layout.links.values().next().value!,mid=worldToView(link.points[6]!,layout.transform);assert.deepEqual(hitTest(layout,mid),{kind:"link",id:"old"});
  const v=layout.nodes.get(nodeId("v"))!;assert.deepEqual(boxNodes(layout,worldToView({x:v.bounds.x-1,y:v.bounds.y+1},layout.transform),worldToView({x:v.bounds.x+v.bounds.width+1,y:v.bounds.y-v.bounds.height-1},layout.transform)),[nodeId("v")]);
  assert.equal(compatibleTargets(layout,"v:value" as never).some(s=>s.id==="m:a"),true);assert.equal(planLink(layout,"v:value" as never,"m:a" as never)?.type,"link.replace");
  assert.deepEqual(clampResize(layout,nodeId("m"),{x:10000,y:10000}),{x:700,y:layout.nodes.get(nodeId("m"))!.minimumSize.y});
});
test("frame drop picks containing frame and rejects self",()=>{const frame=materializeNode("f","fxnode.common.frame",{x:-200,y:200}),node=materializeNode("n","fxnode.shader.value",{x:0,y:0});const doc={schemaVersion:1,graphId:"d",catalogVersion:1,nodes:{f:frame,n:node},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,transform);assert.equal(frameDropCandidate(layout,nodeId("n"),{x:-100,y:100}),nodeId("f"));assert.equal(frameDropCandidate(layout,nodeId("f"),{x:-100,y:100}),undefined);});
test("Color Ramp authoritative bounds resolve every interaction region",()=>{const node=materializeNode("r","fxnode.shader.color-ramp",{x:0,y:0}),doc={schemaVersion:1,graphId:"r",catalogVersion:1,nodes:{r:node},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,{...transform,zoom:1}),control=layout.controls.get("r:parameter:ramp")!,b=control.rampBounds!,center=(r:typeof b.toolbar)=>({x:r.x+r.width/2,y:r.y-r.height/2});assert.equal(hitRamp(control,{x:b.toolbar.x+1,y:b.toolbar.y-10})?.target,"add");assert.equal(hitRamp(control,{x:b.toolbar.x+b.toolbar.width*.18,y:b.toolbar.y-10})?.target,"remove");assert.equal(hitRamp(control,{x:b.toolbar.x+b.toolbar.width*.4,y:b.toolbar.y-10})?.target,"flip");assert.equal(hitRamp(control,{x:b.toolbar.x+b.toolbar.width*.8,y:b.toolbar.y-10})?.target,"distribute");assert.equal(hitRamp(control,center(b.mode))?.target,"mode");assert.equal(hitRamp(control,center(b.interpolation))?.target,"interpolation");assert.equal(hitRamp(control,center(b.hue))?.target,"hue");assert.equal(hitRamp(control,center(b.gradient))?.target,"gradient");assert.equal(hitRamp(control,center(b.selector))?.target,"selector");assert.equal(hitRamp(control,center(b.position))?.target,"position");assert.equal(hitRamp(control,{x:b.color.x+1,y:b.color.y-10})?.target,"swatch");assert.equal(hitRamp(control,{x:b.color.x+b.color.width*.9,y:b.color.y-10})?.target,"a");});

test("Color Balance owns three disjoint Blender-style grading wheels",()=>{
  const node=materializeNode("balance","fxnode.compositor.color-balance",{x:0,y:0}),doc={schemaVersion:1,graphId:"balance",catalogVersion:1,nodes:{balance:node},links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,{...transform,zoom:1}),placed=layout.nodes.get(nodeId("balance"))!,row=placed.rows.find(item=>item.kind==="grading-wheels");
  assert.ok(row&&row.kind==="grading-wheels");assert.deepEqual(row.wheels.map(wheel=>wheel.label),["Lift","Gamma","Gain"]);assert.ok(placed.minimumSize.x>=400);assert.equal(row.units,7);
  for(const wheel of row.wheels){const color=layout.controls.get(wheel.colorControlId)!,scalar=layout.controls.get(wheel.scalarControlId)!,bounds=color.colorWheelBounds!;assert.equal(bounds.plane.width,bounds.plane.height);assert.ok(bounds.lightness.x>=bounds.plane.x+bounds.plane.width);for(const [region,rect] of Object.entries(bounds) as ["plane"|"lightness",typeof bounds.plane][])assert.deepEqual(hitTest(layout,worldToView({x:rect.x+rect.width/2,y:rect.y-rect.height/2},layout.transform)),{kind:"color-wheel",id:color.id,region});assert.equal(hitTest(layout,worldToView({x:scalar.bounds.x+scalar.bounds.width/2,y:scalar.bounds.y-scalar.bounds.height/2},layout.transform)).kind,"control");}
  for(let i=1;i<row.wheels.length;i++){const prior=layout.controls.get(row.wheels[i-1]!.colorControlId)!.bounds,next=layout.controls.get(row.wheels[i]!.colorControlId)!.bounds;assert.ok(next.x>=prior.x+prior.width);}
});

test("compound and component controls have bounded, disjoint layout cells",()=>{
  const types=[["r","fxnode.shader.color-ramp"],["i","fxnode.shader.image-texture"],["g","fxnode.compositor.color-balance"]] as const;
  const nodes=Object.fromEntries(types.map(([id,type],index)=>[id,materializeNode(id,type,{x:index*500,y:0})]));
  const doc={schemaVersion:1,graphId:"cells",catalogVersion:1,nodes,links:{},metadata:{}} as unknown as Parameters<typeof layoutGraph>[0],layout=layoutGraph(doc,transform);
  const inside=(outer:{x:number;y:number;width:number;height:number},inner:{x:number;y:number;width:number;height:number})=>inner.x>=outer.x&&inner.x+inner.width<=outer.x+outer.width&&inner.y<=outer.y&&inner.y-inner.height>=outer.y-outer.height;
  for(const control of layout.controls.values()){
    const node=layout.nodes.get(control.nodeId)!;assert.ok(inside(node.bounds,control.bounds),`${control.id} is inside its node`);
    for(let index=1;index<control.subfields.length;index++)assert.ok(control.subfields[index]!.bounds.x-(control.subfields[index-1]!.bounds.x+control.subfields[index-1]!.bounds.width)>=2,"component gutter");
  }
  const ramp=layout.controls.get("r:parameter:ramp")!,rampRow=layout.nodes.get(nodeId("r"))!.rows.find(row=>row.kind==="control")!;
  for(const row of layout.nodes.get(nodeId("r"))!.rows.filter(row=>row.kind==="socket"))assert.ok(row.bounds.y-row.bounds.height>=rampRow.bounds.y||rampRow.bounds.y-rampRow.bounds.height>=row.bounds.y,"ramp and sockets disjoint");
  const ordinary=[layout.controls.get("i:parameter:interpolation")!,layout.controls.get("i:parameter:projection")!,layout.controls.get("g:socket:g:factor")!];
  assert.ok(ordinary.every(control=>control.bounds.height===18));assert.ok(ordinary.every(control=>Math.abs((control.bounds.x-layout.nodes.get(control.nodeId)!.bounds.x)/layout.nodes.get(control.nodeId)!.bounds.width-.42)<1e-9));
});
