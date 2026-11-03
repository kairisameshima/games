import "./style.css";
import { SAVE_KEY, SIM_STEP_SECONDS } from "./data.js";
import { deserializeState, SaveFormatError, serializeState, simulateAway } from "./save.js";
import { World } from "./scene.js";
import { buyBlueprint, buyDoctrine, createInitialState, fallBack, launchOffensive, prestige, setAutoUpgrade, setProduction, tick, upgradeStation } from "./sim.js";
import { UI } from "./ui.js";

const AUTOSAVE_SECONDS = 10;
const UI_REFRESH_SECONDS = 0.2;
const CATCH_UP_THRESHOLD_SECONDS = 2;
const MAX_FRAME_SECONDS = 0.25;
const RATE_WINDOW_SECONDS = 60;
const CLICK_SLOP_PIXELS = 6;

function loadState() {
  const text = localStorage.getItem(SAVE_KEY);
  if (text === null) return { state: createInitialState(), fresh: true };
  try {
    return { state: deserializeState(text), fresh: false };
  } catch (error) {
    if (!(error instanceof SaveFormatError)) throw error;
    console.warn(error.message);
    return { state: createInitialState(), fresh: true };
  }
}

const { state, fresh } = loadState();
const app = document.querySelector("#app");
const canvas = document.querySelector("#world");
const world = new World(canvas, document.querySelector("#labels"));
const pendingEvents = [];
const earnings = [];
let resetting = false;

function save() {
  if (resetting) return;
  try {
    localStorage.setItem(SAVE_KEY, serializeState(state));
    ui.setSaveStatus("Saved", false);
  } catch (error) {
    ui.setSaveStatus("Save failed", true);
    console.error(error);
  }
}

function refresh() {
  const now = state.time;
  earnings.push({ time: now, salvage: state.stats.salvageEarned });
  while (earnings.length > 2 && now - earnings[0].time > RATE_WINDOW_SECONDS) earnings.shift();
  const first = earnings[0];
  const span = Math.max(1, now - first.time);
  const rates = { salvage: ((state.stats.salvageEarned - first.salvage) / span) * 60 };
  ui.update(state, rates);
}

const ui = new UI(app, {
  upgrade(stationId) {
    if (upgradeStation(state, stationId)) refresh();
  },
  buyDoctrine(doctrineId) {
    if (buyDoctrine(state, doctrineId, pendingEvents)) refresh();
  },
  buyBlueprint(modelId) {
    if (buyBlueprint(state, modelId, pendingEvents)) refresh();
  },
  produce(modelId) {
    if (setProduction(state, modelId)) refresh();
  },
  toggleAutoUpgrade(enabled) {
    setAutoUpgrade(state, enabled);
    refresh();
  },
  launchOffensive() {
    if (launchOffensive(state, pendingEvents)) refresh();
  },
  // A regroup replaces the whole run, so the page restarts from the saved next run instead of
  // tearing down every scene object in place.
  prestige() {
    const next = prestige(state);
    if (!next) return;
    resetting = true;
    localStorage.setItem(SAVE_KEY, serializeState(next));
    window.location.reload();
  },
  fallBack() {
    if (fallBack(state, pendingEvents)) refresh();
  },
  setView(name) {
    world.setView(name);
    ui.showMobilePanel("");
  },
  selectStation(stationId) {
    world.selectStation(stationId);
    ui.selectStation(stationId);
  },
  reset() {
    resetting = true;
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  },
});

function catchUp(seconds) {
  const summary = simulateAway(state, seconds);
  if (summary.seconds >= 60) ui.showAwaySummary(summary);
}

const awaySeconds = (Date.now() - state.savedAt) / 1000;
if (!fresh && awaySeconds > CATCH_UP_THRESHOLD_SECONDS) catchUp(awaySeconds);
refresh();
if (fresh) ui.showHelp();

let pointerDown = null;
canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > CLICK_SLOP_PIXELS) return;
  const stationId = world.pickStation(event.clientX, event.clientY);
  world.selectStation(stationId);
  ui.selectStation(stationId);
});
document.querySelector("#labels").addEventListener("click", (event) => {
  const label = event.target.closest("[data-station]");
  if (!label) return;
  world.selectStation(label.dataset.station);
  ui.selectStation(label.dataset.station);
});
window.addEventListener("resize", () => world.resize());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") save();
});
window.addEventListener("pagehide", save);

let lastFrame = performance.now();
let accumulator = 0;
let uiTimer = 0;
let saveTimer = 0;

function frame(now) {
  const realSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  if (realSeconds > CATCH_UP_THRESHOLD_SECONDS) {
    catchUp(realSeconds);
    accumulator = 0;
  } else {
    accumulator += Math.min(realSeconds, MAX_FRAME_SECONDS);
  }
  const frameSeconds = Math.min(realSeconds, MAX_FRAME_SECONDS);
  while (accumulator >= SIM_STEP_SECONDS) {
    tick(state, SIM_STEP_SECONDS, pendingEvents);
    accumulator -= SIM_STEP_SECONDS;
  }
  if (pendingEvents.length > 0) {
    world.applyEvents(pendingEvents);
    ui.handleEvents(pendingEvents);
    pendingEvents.length = 0;
  }
  uiTimer -= frameSeconds;
  if (uiTimer <= 0) {
    uiTimer = UI_REFRESH_SECONDS;
    refresh();
  }
  saveTimer -= frameSeconds;
  if (saveTimer <= 0) {
    saveTimer = AUTOSAVE_SECONDS;
    save();
  }
  world.update(state, frameSeconds, ui.labels);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
