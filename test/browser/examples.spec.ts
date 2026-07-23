import { expect, test, type Page } from "@playwright/test";

const examples = [
  { path: "minimal", nodeId: "value", typeId: "example.minimal.value" },
  { path: "color-balance", nodeId: "color-balance", typeId: "fxnode.compositor.color-balance" },
  { path: "live-composition", nodeId: "live-node", typeId: "example.live.parameter" },
] as const;

function capturePageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

test("gallery links every standalone application and loads its images", async ({ page }) => {
  await page.goto("/examples/");
  await expect(page.locator(".gallery a")).toHaveCount(4);
  expect(
    await page.locator(".gallery a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(["./minimal/", "./color-balance/", "./live-composition/", "./blender/"]);
  await expect(page.locator(".gallery img")).toHaveCount(3);
  expect(
    await page
      .locator(".gallery img")
      .evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
      ),
  ).toBe(true);
});

for (const example of examples) {
  test(`${example.path} renders its known node and cleans up on pagehide`, async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto(`/examples/${example.path}/`);
    await page.evaluate(() => window.fxnodeStandalone.ready);
    const result = await page.evaluate(async ({ nodeId }) => {
      const api = window.fxnodeStandalone.api;
      if (!api) return null;
      const node = (await api.getState()).nodes.find((candidate) => candidate.id === nodeId);
      const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        node: node && { id: node.id, typeId: node.typeId, known: node.known },
        nonEmpty: pixels.some((channel) => channel !== 0),
      };
    }, example);
    expect(result).not.toBeNull();
    expect(result?.node).toEqual({ id: example.nodeId, typeId: example.typeId, known: true });
    expect(result?.nonEmpty).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(await page.evaluate(() => window.fxnodeStandalone.api)).toBeNull();
    expect(errors).toEqual([]);
  });
}

test("live composition migrates the real node and records the graph/history transition", async ({ page }) => {
  const errors = capturePageErrors(page);
  await page.goto("/examples/live-composition/");
  await page.evaluate(() => window.fxnodeStandalone.ready);
  const beforeVersion = await page.evaluate(() => window.fxnodeStandalone.graphVersion);
  expect(beforeVersion).toBeDefined();
  await page.getByRole("button", { name: "Compose version 2" }).click();
  await expect(page.locator("#status")).toContainText("Version 2 committed");
  const result = await page.evaluate(async () => ({
    receipt: window.fxnodeStandalone.lastCompositionReceipt,
    state: await window.fxnodeStandalone.api!.getState(),
  }));
  expect(result.receipt?.status).toBe("committed");
  expect(result.receipt?.graphChanged).toBe(true);
  expect(result.receipt?.historyReset).toBe(true);
  expect(result.receipt?.graphVersion).toBe(beforeVersion! + 1);
  const node = result.state.nodes.find((candidate) => candidate.id === "live-node");
  expect(node?.typeId).toBe("example.live.parameter");
  expect(node?.typeVersion).toBe(2);
  expect(node?.parameters["detail"]).toEqual({ kind: "number", value: 0.5 });
  expect(errors).toEqual([]);
});
