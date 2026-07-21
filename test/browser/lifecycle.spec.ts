import { expect, test } from "@playwright/test";

test("repeated lifecycle restores attributes and isolates subscribers", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/test/browser/index.html");
  await page.evaluate(() => window.ready);
  const result = await page.evaluate(async () => {
    window.api.destroy();
    const { createFxNode } = await import("../../src/index.js");
    const layout = { schemaVersion: 1, graphId: "lifecycle", catalogVersion: 7, nodes: [], links: [], metadata: {} };
    const canvas = document.querySelector<HTMLCanvasElement>("#primary")!;
    canvas.setAttribute("tabindex", "7"); canvas.style.touchAction = "pan-x";
    let later = 0;
    for (let index = 0; index < 20; index++) {
      const api = await createFxNode({ canvas, layout });
      if (index === 0) {
        api.onMutations(() => { throw new Error("intentional subscriber failure"); });
        api.onMutations(() => later++);
        await api.dispatch({ type: "node.add", nodeType: "fxnode.shader.value", position: { x: 0, y: 0 } });
      }
      const barrier = api.whenRendered(); api.destroy();
      await barrier.catch(error => error);
    }
    return { later, tabIndex: canvas.getAttribute("tabindex"), touchAction: canvas.style.touchAction };
  });
  expect(result).toEqual({ later: 1, tabIndex: "7", touchAction: "pan-x" });
});

test("bad load retains structured issues and returned values are detached", async ({ page }) => {
  await page.goto("/test/browser/index.html"); await page.evaluate(() => window.ready);
  const result = await page.evaluate(async () => {
    let error: { code?: string; issues?: readonly unknown[] } = {};
    try { await window.api.load({ nope: true }); } catch (value) { error = value as typeof error; }
    const saved = await window.api.save(); (saved.nodes as unknown as unknown[]).push({});
    const snapshot = await window.api.snapshot(); (snapshot.nodes as unknown as unknown[]).push({});
    const nextSaved = await window.api.save(); const nextSnapshot = await window.api.snapshot(); window.api.destroy();
    return { code: error.code, issues: error.issues?.length ?? 0, saved: nextSaved.nodes.length, snapshot: nextSnapshot.nodes.length };
  });
  expect(result.code).toBeTruthy(); expect(result.issues).toBeGreaterThan(0);
  expect(result.saved).toBe(0); expect(result.snapshot).toBe(0);
});
