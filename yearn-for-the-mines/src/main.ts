import "./style.css";
import { loadGameArt } from "./render/assets.ts";
import { MineRenderer } from "./render/renderer.ts";
import { loadGame, SaveFormatError, setAsideUnreadableSave, storeGame } from "./save/storage.ts";
import { createGame, simulateOffline, tick } from "./sim/game.ts";
import type { GameState } from "./sim/types.ts";
import { formatGold } from "./ui/format.ts";
import { ShopPanel } from "./ui/shop-panel.ts";

const AUTOSAVE_INTERVAL_MS = 10_000;
const PANEL_REFRESH_MS = 200;
const NOTE_VISIBLE_MS = 6_000;
/** Longer frames (a stalled tab) are capped so the lift never skips a stop on screen. */
const MAX_FRAME_SECONDS = 0.25;
const KEYBOARD_SCROLL_PIXELS = 24;
const MS_PER_SECOND = 1_000;

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html is missing #${id}`);
  return element;
}

const canvas = requireElement("mine-view", HTMLCanvasElement);
const stage = requireElement("stage", HTMLElement);
const note = requireElement("note", HTMLParagraphElement);
let noteTimer: number | undefined;

function showNote(text: string): void {
  note.textContent = text;
  note.hidden = false;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (note.hidden = true), NOTE_VISIBLE_MS);
}

function payForTimeAway(state: GameState, millisecondsAway: number): void {
  const earned = simulateOffline(state, millisecondsAway / MS_PER_SECOND);
  if (earned >= 1) showNote(`While you were away, the kids hauled up ${formatGold(earned)}.`);
}

/** Startup is the boundary for save errors: an unreadable save is set aside and a new mine opens. */
function loadOrStartGame(): GameState {
  try {
    const loaded = loadGame();
    if (!loaded) return createGame();
    payForTimeAway(loaded.state, Date.now() - loaded.savedAt);
    return loaded.state;
  } catch (error) {
    if (!(error instanceof SaveFormatError)) throw error;
    console.error(error);
    setAsideUnreadableSave();
    showNote("Your save could not be read. It was set aside and a new mine opened.");
    return createGame();
  }
}

async function main(): Promise<void> {
  const renderer = new MineRenderer(canvas, await loadGameArt());
  const state = loadOrStartGame();
  const save = () => storeGame(state, Date.now());
  const panel = new ShopPanel(() => state, save);

  const fitCanvas = () => renderer.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio);
  new ResizeObserver(fitCanvas).observe(stage);
  fitCanvas();

  const gamePixels = (cssPixels: number) => cssPixels / renderer.cssPixelsPerGamePixel(window.devicePixelRatio);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      renderer.scrollBy(gamePixels(event.deltaY));
    },
    { passive: false },
  );
  let dragLastY: number | undefined;
  canvas.addEventListener("pointerdown", (event) => {
    dragLastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => (dragLastY = undefined));
  canvas.addEventListener("pointercancel", () => (dragLastY = undefined));
  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    renderer.setPointer(((event.clientX - bounds.left) / bounds.width) * 2 - 1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    if (dragLastY === undefined) return;
    renderer.scrollBy(gamePixels(dragLastY - event.clientY));
    dragLastY = event.clientY;
  });
  canvas.addEventListener("pointerleave", () => renderer.setPointer(0, 0));
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") renderer.scrollBy(KEYBOARD_SCROLL_PIXELS);
    if (event.key === "ArrowUp") renderer.scrollBy(-KEYBOARD_SCROLL_PIXELS);
  });

  // Browsers pause animation frames in hidden tabs, so hidden time is paid out like time away.
  let hiddenAt: number | undefined;
  let lastFrameTime = performance.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      save();
      return;
    }
    if (hiddenAt !== undefined) payForTimeAway(state, Date.now() - hiddenAt);
    hiddenAt = undefined;
    lastFrameTime = performance.now();
  });
  window.addEventListener("pagehide", save);
  window.setInterval(save, AUTOSAVE_INTERVAL_MS);
  window.setInterval(() => panel.update(), PANEL_REFRESH_MS);
  panel.update();

  const runFrame = (now: number) => {
    const frameSeconds = Math.min((now - lastFrameTime) / MS_PER_SECOND, MAX_FRAME_SECONDS);
    lastFrameTime = now;
    tick(state, frameSeconds);
    renderer.draw(state, now / MS_PER_SECOND, frameSeconds);
    requestAnimationFrame(runFrame);
  };
  requestAnimationFrame(runFrame);
}

void main();
