import { defineConfig } from "vite";

// The build goes to play/ so GitHub Pages serves it at /games/raccoon-pusher/play/.
export default defineConfig({ base: "./", build: { outDir: "play", emptyOutDir: true } });
