import { expect, test } from "@playwright/test";

test("@visual deterministic example canvas", async ({ page }) => {
  await page.goto("/example/");
  await page.evaluate(() => window.fxnodeExample.ready);
  await page.evaluate(() => window.fxnodeExample.rendered);

  const canvas = page.locator("#graph");
  await expect(canvas).toHaveAttribute("width", "1200");
  await expect(canvas).toHaveAttribute("height", "640");
  const evidence = await canvas.evaluate(element => {
    const context = (element as HTMLCanvasElement).getContext("2d");
    if (!context) throw new Error("Canvas context missing");
    const data = context.getImageData(0, 0, 1200, 640).data;
    let background = 0, nodePixels = 0, linkPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r=data[index], g=data[index+1], b=data[index+2], a=data[index+3];
      if (r===29&&g===31&&b===35&&a===255) background++;
      if (r===53&&g===56&&b===62&&a===255) nodePixels++;
      if ((r===168&&g===168&&b===168)||(r===98&&g===179&&b===79)) linkPixels++;
    }
    return { background, nodePixels, linkPixels };
  });
  expect(evidence.background).toBeGreaterThan(300_000);
  expect(evidence.nodePixels).toBeGreaterThan(20_000);
  expect(evidence.linkPixels).toBeGreaterThan(100);

  const first = await canvas.screenshot();
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);
  await expect(canvas).toHaveScreenshot("phase-4-example.png", { animations: "disabled" });
});
