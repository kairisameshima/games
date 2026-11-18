import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        mechVillage: resolve(import.meta.dirname, "mech-village/index.html"),
        ironhollow: resolve(import.meta.dirname, "ironhollow/index.html"),
        shipOfTheLine: resolve(import.meta.dirname, "ship-of-the-line/index.html"),
        shipOfTheLineAnimations: resolve(import.meta.dirname, "ship-of-the-line/animations/index.html"),
      },
    },
  },
});
