import {createFxNode} from "../../src/index.js";
import fixture from "./fixture.json";
const canvas=document.querySelector("canvas")!;
const fxnode=await createFxNode({canvas,layout:fixture});
window.parityExample=fxnode;
await fxnode.whenRendered();
