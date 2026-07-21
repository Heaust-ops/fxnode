import { createFxNode } from "../../src/index.js";
const layout={schemaVersion:1,graphId:"browser",catalogVersion:7,nodes:[],links:[],metadata:{}};
window.ready=(async()=>{const primary=document.querySelector<HTMLCanvasElement>("#primary");if(!primary)throw new Error("Primary canvas missing");const api=await createFxNode({canvas:primary,layout});window.api=api;await api.whenRendered();return true;})();
