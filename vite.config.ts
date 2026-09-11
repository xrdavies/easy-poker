import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "client"),
  publicDir: false,
  resolve: {
    alias: {
      "@xrdavies/2d-engine": path.resolve(root, "../2d-engine"),
    },
  },
  build: {
    outDir: path.join(root, "public"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: path.join(root, "client/index.html"),
      output: {
        entryFileNames: "js/game.js",
        chunkFileNames: "js/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 5173,
  },
});
