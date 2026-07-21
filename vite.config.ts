import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  build: {
    assetsInlineLimit: 0,
    lib: { entry: { index: "src/index.ts", headless: "src/headless.ts" }, formats: ["es"] },
    rollupOptions: { output: { entryFileNames: "[name].js" } },
  },
});
