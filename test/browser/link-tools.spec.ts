import { expect, test } from "@playwright/test";

test("M muting is one paired gesture for bypass nodes and a no-op for generators", async ({ page }) => {
  await page.goto("/example/");
  await page.evaluate(() => window.fxnodeExample.ready);
  const canvas = page.locator("#graph");
  await page.evaluate(() => {
    const api = window.fxnodeExample.api!;
    const state = { mutations: [] as number[], snapshots: [] as number[] };
    (window as typeof window & { muteEvents: typeof state }).muteEvents = state;
    // Subscriber exceptions are deliberately isolated from subsequent listeners.
    api.onMutations(() => { throw new Error("intentional test subscriber"); });
    api.onMutations(event => state.mutations.push(event.version));
    api.onSnapshots(event => state.snapshots.push(event.version));
  });

  // Fixture coordinates use the documented 1200x640 viewport and world origin
  // (600,320). Header centers are stable layout data, not worker introspection.
  await canvas.click({ position: { x: 380, y: 160 } }); // Math (-300,170), width 160
  await canvas.press("m");
  let snapshot = await page.evaluate(() => window.fxnodeExample.api!.snapshot());
  expect(snapshot.nodes.find(node => node.id === "math")?.muted).toBe(true);
  expect(await page.evaluate(() => (window as typeof window & { muteEvents: { mutations: number[]; snapshots: number[] } }).muteEvents)).toEqual({ mutations: [1], snapshots: [1] });

  await canvas.press("m");
  snapshot = await page.evaluate(() => window.fxnodeExample.api!.snapshot());
  expect(snapshot.nodes.find(node => node.id === "math")?.muted).toBe(false);
  expect(await page.evaluate(() => (window as typeof window & { muteEvents: { mutations: number[]; snapshots: number[] } }).muteEvents)).toEqual({ mutations: [1, 2], snapshots: [1, 2] });

  await canvas.click({ position: { x: 580, y: 140 } }); // Noise generator (-100,190)
  await canvas.press("m");
  snapshot = await page.evaluate(() => window.fxnodeExample.api!.snapshot());
  expect(snapshot.nodes.find(node => node.id === "noise")?.muted).toBe(false);
  expect(snapshot.version).toBe(2);
  await canvas.press("Control+z");
  expect((await page.evaluate(() => window.fxnodeExample.api!.snapshot())).nodes.find(node => node.id === "math")?.muted).toBe(true);
});
