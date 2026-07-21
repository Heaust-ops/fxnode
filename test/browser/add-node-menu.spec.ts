import { expect,test } from "@playwright/test";

test("right-click DOM menu searches and adds through one worker gesture",async({page})=>{
  await page.goto("/test/browser/index.html");await page.evaluate(()=>window.ready);await page.evaluate(()=>{const events:{mutations:Array<{version:number;cause:string;mutations:readonly unknown[]}>;snapshots:number[]}={mutations:[],snapshots:[]};(window as typeof window&{menuEvents:typeof events}).menuEvents=events;window.api.onMutations(event=>events.mutations.push(event));window.api.onSnapshots(event=>events.snapshots.push(event.version));});
  const canvas=page.locator("#primary");await canvas.click({button:"right",position:{x:40,y:50}});const dialog=page.getByRole("dialog",{name:"Add node"});await expect(dialog).toBeVisible();await expect(page.getByRole("group",{name:"Shader"})).toBeVisible();const search=page.getByRole("combobox",{name:"Search nodes"});await search.fill("noise");await expect(page.getByRole("option",{name:"Noise Texture"})).toBeVisible();await search.press("Enter");await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.api.snapshot().then(snapshot=>snapshot.nodes.length))).toBe(1);const result=await page.evaluate(async()=>({snapshot:await window.api.snapshot(),events:(window as typeof window&{menuEvents:{mutations:Array<{version:number;cause:string;mutations:readonly unknown[]}>;snapshots:number[]}}).menuEvents}));
  expect(result.snapshot.nodes[0]?.typeId).toBe("fxnode.shader.noise-texture");expect(result.snapshot.nodes[0]?.position).toEqual({x:-120,y:40});expect(result.events.mutations).toHaveLength(1);expect(result.events.mutations[0]).toMatchObject({version:1,cause:"gesture"});expect(result.events.mutations[0]?.mutations).toHaveLength(1);expect(result.events.snapshots).toEqual([1]);
  await page.evaluate(()=>window.api.dispatch({type:"node.add",nodeType:"fxnode.shader.value",position:{x:-120,y:40}}));await canvas.press("Delete");expect((await page.evaluate(()=>window.api.snapshot())).nodes.map(node=>node.id)).toEqual([result.snapshot.nodes[0]!.id]);
  await windowUndo(page);await windowUndo(page);await windowUndo(page);expect((await page.evaluate(()=>window.api.snapshot())).nodes).toHaveLength(0);
  await canvas.click({button:"right",position:{x:80,y:80}});await expect(dialog).toBeVisible();await page.evaluate(()=>window.api.destroy());await expect(dialog).toHaveCount(0);
});

test("right-click on a node and Ctrl-RMB never open the add menu",async({page})=>{
  await page.goto("/example/");await page.evaluate(()=>window.fxnodeExample.ready);const canvas=page.locator("#graph"),dialog=page.getByRole("dialog",{name:"Add node"});await canvas.click({button:"right",position:{x:320,y:160}});await expect(dialog).toHaveCount(0);await canvas.hover({position:{x:30,y:30}});await page.keyboard.down("Control");await page.mouse.down({button:"right"});await page.mouse.up({button:"right"});await page.keyboard.up("Control");await expect(dialog).toHaveCount(0);
});

async function windowUndo(page:import("@playwright/test").Page):Promise<void>{await page.evaluate(()=>window.api.undo());}
