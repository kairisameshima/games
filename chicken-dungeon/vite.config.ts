import { defineConfig } from "vite";

// The build is committed to play/ so GitHub Pages serves it at /games/chicken-dungeon/play/.
export default defineConfig({ base: "./", build: { outDir: "play", emptyOutDir: true } });
