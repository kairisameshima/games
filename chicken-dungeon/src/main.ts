import "./style.css";
import { DungeonRenderer } from "./render/renderer.ts";
import { SaveFormatError } from "./save/format.ts";
import { loadGame, setAsideUnreadableSave, storeGame } from "./save/storage.ts";
import { tick } from "./sim/game.ts";
import { grantOfflineGold } from "./sim/offline.ts";
import { startNextRun } from "./sim/prestige.ts";
import { TICKS_PER_SECOND } from "./sim/time.ts";
import type { Command, GameState } from "./sim/types.ts";
import { createGame } from "./sim/world.ts";
import { AncestralPanel } from "./ui/ancestral-panel.ts";
import { Hud } from "./ui/hud.ts";
import { RiteOverlay } from "./ui/rite-overlay.ts";
import { UpgradesPanel } from "./ui/upgrades-panel.ts";

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
const enqueue = (command: Command) => pendingCommands.push(command);
const hud = new Hud(enqueue);
const upgradesPanel = new UpgradesPanel(enqueue);
const ancestralPanel = new AncestralPanel(enqueue);
const riteOverlay = new RiteOverlay(beginNextRun);
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
    const earned = loaded.state.rite ? 0 : grantOfflineGold(loaded.state, minutesAway);
    if (earned > 0) hud.note(`Away ${Math.round(minutesAway)} min: +${earned} gold.`);
    return loaded.state;
  } catch (error) {
    if (!(error instanceof SaveFormatError)) throw error;
    console.error(error);
    setAsideUnreadableSave();
    hud.note("Your save could not be read. It was set aside and a new run started.");
    return newGame();
  }
}

function beginNextRun(): void {
  state = startNextRun(state);
  pendingCommands.length = 0;
  storeGame(state, Date.now());
  hud.note(`Run ${state.legacy.run} begins. A new hen steps into the coop.`);
}

/** The canvas fills the stage, and its backing store matches device pixels so zooming out stays sharp. */
function fitCanvasToStage(): void {
  const cssWidth = canvasStage.clientWidth;
  const cssHeight = canvasStage.clientHeight;
  dungeonCanvas.style.width = `${cssWidth}px`;
  dungeonCanvas.style.height = `${cssHeight}px`;
  renderer.resize(Math.round(cssWidth * window.devicePixelRatio), Math.round(cssHeight * window.devicePixelRatio));
}

function runFrame(now: number): void {
  const frameSeconds = (now - lastFrameTime) / 1000;
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
  renderer.draw(state, unsimulatedMs / TICK_MS, frameSeconds);
  hud.update(state);
  upgradesPanel.update(state);
  ancestralPanel.update(state);
  riteOverlay.update(state);
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
