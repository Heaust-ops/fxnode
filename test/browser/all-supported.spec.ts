import { expect, test } from "@playwright/test";
test("@visual all supported catalog", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/example/all-supported/");
  await page.waitForFunction(() =>
    Boolean((window as unknown as { fxnodeExample?: { whenRendered?: () => Promise<void> } }).fxnodeExample),
  );
  await page.locator("canvas").press("Home");
  await page.evaluate(async () => {
    await (window as unknown as { fxnodeExample: { whenRendered: () => Promise<void> } }).fxnodeExample.whenRendered();
  });
  await expect(page.locator("canvas")).toHaveScreenshot("all-supported.png", { animations: "disabled" });
});
