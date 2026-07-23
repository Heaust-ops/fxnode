import { expect, test } from "@playwright/test";
for (const example of ["minimal", "color-balance", "live-composition"])
  test(`${example} documentation image`, async ({ page }) => {
    await page.goto(`/examples/${example}/`);
    await page.evaluate(() => window.fxnodeStandalone.ready);
    await expect(page).toHaveScreenshot(`${example}.png`, { animations: "disabled", fullPage: true });
  });
