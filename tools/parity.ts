import {writeFileSync} from "node:fs";
import {materializeNode,save} from "../src/core/document.js";
import {CATALOG_VERSION,type BuiltinNodeTypeId} from "../src/catalog/scope.js";
import {graphId,linkId,socketId,type GraphDocument} from "../src/core/types.js";
import {nullRecord} from "../src/core/json.js";

const specs:readonly [string,BuiltinNodeTypeId,number,number][]=[
  ["image-texture","fxnode.shader.image-texture",-520,180],["noise-3d","fxnode.shader.noise-texture",-220,180],
  ["noise-4d","fxnode.shader.noise-texture",60,180],["color-ramp","fxnode.shader.color-ramp",350,180],
  ["compositor-image","fxnode.compositor.image",-340,-260],["master","fxnode.compositor.color-balance",20,-260],
];
const nodes=specs.map(([id,type,x,y])=>{const node=materializeNode(id,type,{x,y});if(id==="noise-4d")return{...node,parameters:{...node.parameters,dimensions:{kind:"string" as const,value:"4d"}}};if(id==="master")return{...node,label:"Master Color Grading"};return node;});
const link={id:linkId("compositor-grade"),fromNodeId:nodes[4]!.id,fromSocketId:socketId("compositor-image:image"),toNodeId:nodes[5]!.id,toSocketId:socketId("master:image"),muted:false,extensions:{}};
const document:GraphDocument={schemaVersion:2,graphId:graphId("parity"),catalogVersion:CATALOG_VERSION,nodes:nullRecord(nodes.map(n=>[n.id,n])),links:nullRecord([[link.id,link]]),metadata:nullRecord()};
writeFileSync(new URL("../example/parity/fixture.json",import.meta.url),JSON.stringify(save(document),null,2)+"\n");
