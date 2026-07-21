import { readFileSync,writeFileSync } from "node:fs";
import { BUILTIN_DESCRIPTORS } from "../src/catalog/descriptors.js";
import { CATALOG_VERSION } from "../src/catalog/scope.js";
import { decodeGraphDocument,materializeNode,save } from "../src/core/document.js";
import { graphId,linkId,nodeId,socketId,type GraphDocument,type GraphLink } from "../src/core/types.js";
import { nullRecord } from "../src/core/json.js";
const positions={common:0,shader:-280,geometry:-560,compositor:-840};
const nodes=BUILTIN_DESCRIPTORS.map((descriptor,index)=>{const family=descriptor.family;const peers=BUILTIN_DESCRIPTORS.filter(item=>item.family===family);const node=materializeNode(`all-${descriptor.typeId.replaceAll(".","-")}`,descriptor.typeId,{x:40+peers.indexOf(descriptor)*240,y:positions[family]});if(descriptor.typeId==="fxnode.shader.color-ramp")return{...node,parameters:{ramp:{kind:"json" as const,value:{colorMode:"hsv",interpolation:"ease",hueInterpolation:"far",stops:[{id:"black",position:0,color:[0,0,0,1]},{id:"accent",position:.38,color:[.05,.35,1,1]},{id:"white",position:1,color:[1,1,1,1]}]}}}} as typeof node;if(descriptor.typeId==="fxnode.shader.noise-texture")return{...node,parameters:{...node.parameters,dimensions:{kind:"string" as const,value:"4d"},noiseType:{kind:"string" as const,value:"hybrid-multifractal"}}} as typeof node;return node;});
const byType=(type:string)=>nodes.find(node=>node.typeId===type)!;
const cube=byType("fxnode.geometry.mesh-cube"),position=byType("fxnode.geometry.position"),set=byType("fxnode.geometry.set-position"),transform=byType("fxnode.geometry.transform-geometry"),join=byType("fxnode.geometry.join-geometry");
const make=(id:string,from:typeof cube,fromKey:string,to:typeof join,toKey:string):GraphLink=>({id:linkId(id),fromNodeId:from.id,fromSocketId:socketId(`${from.id}:${fromKey}`),toNodeId:to.id,toSocketId:socketId(`${to.id}:${toKey}`),muted:false,extensions:{}});
const links=[make("all-link-position",position,"position",set,"position"),make("all-link-cube",cube,"mesh",set,"geometry"),make("all-link-set",set,"result",join,"geometry"),make("all-link-transform",transform,"result",join,"geometry")];
const document:GraphDocument={schemaVersion:2,graphId:graphId("all-supported"),catalogVersion:CATALOG_VERSION,nodes:nullRecord(nodes.map(node=>[node.id,node])),links:nullRecord(links.map(link=>[link.id,link])),metadata:nullRecord()};
export const fixture=save(document);
const path=new URL("../example/all-supported/fixture.json",import.meta.url);
if(process.argv.includes("--write"))writeFileSync(path,JSON.stringify(fixture,null,2)+"\n");
else{const actual=JSON.parse(readFileSync(path,"utf8"));const decoded=decodeGraphDocument(actual);if(!decoded.ok)throw new Error(`Fixture decode failed: ${JSON.stringify(decoded.issues)}`);const ids=actual.nodes.map((node:{typeId:string})=>node.typeId),expected=BUILTIN_DESCRIPTORS.length;if(ids.length!==expected||new Set(ids).size!==expected||BUILTIN_DESCRIPTORS.some(item=>!ids.includes(item.typeId)))throw new Error("Fixture must contain each catalog type exactly once");if(JSON.stringify(actual)!==JSON.stringify(fixture))throw new Error("Fixture is not canonical; run generate:all-supported");if(actual.links.filter((link:{toNodeId:string})=>link.toNodeId===join.id).length<2)throw new Error("Join Geometry needs two incoming links");console.log("all-supported fixture verified");}
