import { defineConfig } from "vite";

// The build is committed to play/ so GitHub Pages serves it at /games/tank-foundry/play/.
export default defineConfig({ base: "./", build: { outDir: "play", emptyOutDir: true } });
