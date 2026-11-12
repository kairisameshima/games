import "./style.css";
import { DungeonRenderer, VIEW_HEIGHT, VIEW_WIDTH } from "./render/renderer.ts";
import { createGame, tick, TICKS_PER_SECOND, type Command } from "./sim/game.ts";
import { Hud } from "./ui/hud.ts";

const STARTING_FLOCK_SIZE = 1;
const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME_AT_1X = 5;

const canvas = document.getElementById("dungeon-view");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing #dungeon-view canvas in index.html");
const dungeonCanvas = canvas;
const stage = dungeonCanvas.parentElement;
if (!stage) throw new Error("#dungeon-view needs a parent stage element");
const canvasStage = stage;

const state = createGame(crypto.getRandomValues(new Uint32Array(1))[0], STARTING_FLOCK_SIZE);
const pendingCommands: Command[] = [];
const renderer = new DungeonRenderer(dungeonCanvas);
const hud = new Hud((command) => pendingCommands.push(command));

let lastFrameTime = performance.now();
let unsimulatedMs = 0;

function fitCanvasToStage(): void {
  const scale = Math.max(1, Math.floor(Math.min(canvasStage.clientWidth / VIEW_WIDTH, canvasStage.clientHeight / VIEW_HEIGHT)));
  dungeonCanvas.style.width = `${VIEW_WIDTH * scale}px`;
  dungeonCanvas.style.height = `${VIEW_HEIGHT * scale}px`;
}

function runFrame(now: number): void {
  const speed = hud.simulationSpeed;
  unsimulatedMs += (now - lastFrameTime) * speed;
  lastFrameTime = now;
  let ticksRun = 0;
  while (unsimulatedMs >= TICK_MS && ticksRun < MAX_TICKS_PER_FRAME_AT_1X * speed) {
    hud.record(tick(state, pendingCommands.splice(0)), state);
    unsimulatedMs -= TICK_MS;
    ticksRun++;
  }
  // A hidden tab pauses requestAnimationFrame. Drop that backlog instead of fast-forwarding through it.
  // Time away is paid out by the offline progress formula in the bible, not by replaying ticks.
  if (unsimulatedMs >= TICK_MS) unsimulatedMs = 0;
  renderer.draw(state, unsimulatedMs / TICK_MS);
  hud.update(state);
  requestAnimationFrame(runFrame);
}

window.addEventListener("resize", fitCanvasToStage);
fitCanvasToStage();
requestAnimationFrame(runFrame);
