import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Every package here is a devDependency, so electron-vite bundles it instead of expecting it in
// node_modules at runtime. That includes the TypeScript-source workspace packages.

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { "@": resolve("src/renderer/src") },
    },
    plugins: [react(), tailwindcss()],
    // The app, and the small update window (main/update-window.ts), which loads none of it.
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          update: resolve("src/renderer/update.html"),
        },
      },
    },
  },
});
