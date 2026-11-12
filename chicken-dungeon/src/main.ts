import "./style.css";
import { DungeonRenderer, VIEW_HEIGHT, VIEW_WIDTH } from "./render/renderer.ts";
import { SaveFormatError } from "./save/format.ts";
import { loadGame, setAsideUnreadableSave, storeGame } from "./save/storage.ts";
import { tick } from "./sim/game.ts";
import { offlineGold } from "./sim/offline.ts";
import { TICKS_PER_SECOND } from "./sim/time.ts";
import type { Command, GameState } from "./sim/types.ts";
import { createGame } from "./sim/world.ts";
import { Hud } from "./ui/hud.ts";

const STARTING_FLOCK_SIZE = 1;
const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME_AT_1X = 5;
const AUTOSAVE_INTERVAL_MS = 10_000;
const MS_PER_MINUTE = 60_000;

const canvas = document.getElementById("dungeon-view");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing #dungeon-view canvas in index.html");
const dungeonCanvas = canvas;
const stage = dungeonCanvas.parentElement;
if (!stage) throw new Error("#dungeon-view needs a parent stage element");
const canvasStage = stage;

const pendingCommands: Command[] = [];
const renderer = new DungeonRenderer(dungeonCanvas);
const hud = new Hud((command) => pendingCommands.push(command), startNewRun);
let state = loadOrStartGame();

let lastFrameTime = performance.now();
let unsimulatedMs = 0;

function newGame(): GameState {
  return createGame(crypto.getRandomValues(new Uint32Array(1))[0], STARTING_FLOCK_SIZE);
}

/** Startup is the boundary for save errors: an unreadable save is set aside and a new run begins. */
function loadOrStartGame(): GameState {
  try {
    const loaded = loadGame();
    if (!loaded) return newGame();
    const minutesAway = (Date.now() - loaded.savedAt) / MS_PER_MINUTE;
    const earned = offlineGold(loaded.state, minutesAway);
    if (earned > 0) {
      // Paid straight into the bank, not the bank log, so offline gold never compounds into the next offline rate.
      loaded.state.bankedGold += earned;
      hud.note(`Away ${Math.round(minutesAway)} min: +${earned} gold.`);
    }
    return loaded.state;
  } catch (error) {
    if (!(error instanceof SaveFormatError)) throw error;
    console.error(error);
    setAsideUnreadableSave();
    hud.note("Your save could not be read. It was set aside and a new run started.");
    return newGame();
  }
}

function startNewRun(): void {
  state = newGame();
  pendingCommands.length = 0;
  storeGame(state, Date.now());
  hud.note("A new hen steps into the coop.");
}

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
window.setInterval(() => storeGame(state, Date.now()), AUTOSAVE_INTERVAL_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") storeGame(state, Date.now());
});
window.addEventListener("pagehide", () => storeGame(state, Date.now()));
fitCanvasToStage();
requestAnimationFrame(runFrame);
