import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("browser entry does not import the engine runtime", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /headless|engine\/engine|core\/document/);
  assert.match(source, /browser\/client/);
});

test("example server explicitly loads the repository Vite config", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: { example?: string };
  };
  assert.match(packageJson.scripts?.example ?? "", /vite\s+--config\s+vite\.config\.ts\s+example(?:\s|$)/);
});
