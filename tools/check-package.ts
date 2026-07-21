import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
run("npm", ["run", "build"], root);
const temporary = mkdtempSync(join(tmpdir(), "fxnode-package-"));
try {
  const json = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], root)) as { files: { path: string }[] }[];
  const files = json[0]?.files.map(item => item.path) ?? [];
  assert(files.includes("dist/index.js") && files.includes("dist/headless.js") && files.includes("dist/index.d.ts") && files.includes("LICENSE") && files.includes("NOTICE.md"));
  assert(!files.some(file => /(^|\/)(\.env|src|test|tools|playwright)(\/|\.|$)/i.test(file)), `forbidden package file: ${files.join(", ")}`);
  const packed = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], root);
  const tarball = join(temporary, (JSON.parse(packed) as { filename: string }[])[0]!.filename);
  const consumer = join(temporary, "consumer");
  run("mkdir", [consumer], temporary);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { fxnode: `file:${tarball}`, typescript: "5.7.2", vite: "6.1.0" } }));
  run("npm", ["install", "--ignore-scripts"], consumer);
  writeFileSync(join(consumer, "headless.mjs"), "import * as fxnode from 'fxnode/headless'; if (!fxnode.createEngine) throw new Error('headless export missing');\n");
  run("node", ["headless.mjs"], consumer);
  writeFileSync(join(consumer, "main.ts"), "import { createFxNode } from 'fxnode'; import { createEngine } from 'fxnode/headless'; void createFxNode; void createEngine;\n");
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, include: ["main.ts"] }));
  run("npx", ["tsc"], consumer);
  writeFileSync(join(consumer, "index.html"), "<script type=module src=/main.ts></script>");
  run("npx", ["vite", "build", "--base", "./"], consumer);
  const output = readdirSync(join(consumer, "dist", "assets"));
  const js = output.filter(file => file.endsWith(".js")).map(file => readFileSync(join(consumer, "dist", "assets", file), "utf8")).join("\n");
  assert(!js.includes('new URL("/assets/'), "worker URL is root-absolute");
  const packageIndex = readFileSync(join(consumer, "node_modules", "fxnode", "dist", "index.js"), "utf8");
  assert(!packageIndex.includes('new URL("/assets/'), "packed worker URL is root-absolute");
  const workerMatch = packageIndex.match(/"assets\/([^"?]*worker[^"?]*\.js)"/);
  assert(workerMatch, "packed package has no package-relative worker URL");
  const packagedAssets = readdirSync(join(consumer, "node_modules", "fxnode", "dist", "assets"));
  assert(packagedAssets.includes(workerMatch[1]!), `worker asset ${workerMatch[1]} does not exist`);
  console.log(`package smoke passed (${files.length} files; worker assets/${workerMatch[1]})`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
