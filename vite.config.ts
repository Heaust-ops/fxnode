import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
    lib: { entry: { index: "src/index.ts", headless: "src/headless.ts" }, formats: ["es"] },
    rollupOptions: { output: { entryFileNames: "[name].js" } },
  },
});
