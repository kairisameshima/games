import { OFFLINE_LIMIT_SECONDS, OFFLINE_STEP_SECONDS, SAVE_VERSION } from "./data.js";
import { createInitialState, tick } from "./sim.js";

export class SaveFormatError extends Error {}

export function serializeState(state, now = Date.now()) {
  return JSON.stringify({ version: SAVE_VERSION, savedAt: now, state });
}

function mergeDefaults(defaults, saved) {
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return saved ?? defaults;
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(saved)) {
    const fallback = defaults[key];
    const isPlainObject = fallback !== null && typeof fallback === "object" && !Array.isArray(fallback);
    merged[key] = isPlainObject ? mergeDefaults(fallback, value) : value;
  }
  return merged;
}

/** Parses a save and fills fields added since it was written. Throws SaveFormatError on unusable data. */
export function deserializeState(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new SaveFormatError(`Save is not valid JSON: ${error.message}`);
  }
  if (payload?.version !== SAVE_VERSION || typeof payload.state !== "object") {
    throw new SaveFormatError(`Unsupported save version ${payload?.version}`);
  }
  const state = mergeDefaults(createInitialState(payload.savedAt), payload.state);
  state.savedAt = payload.savedAt;
  return state;
}

/** Runs the simulation for time spent away and reports what happened. */
export function simulateAway(state, seconds) {
  const simulated = Math.min(seconds, OFFLINE_LIMIT_SECONDS);
  const before = {
    salvage: state.stats.salvageEarned,
    intel: state.stats.intelEarned,
    kills: state.stats.kills,
    built: state.stats.tanksBuilt,
    lost: state.stats.tanksLost,
    maxWave: state.battle.maxWave,
  };
  const events = [];
  for (let elapsed = 0; elapsed < simulated; elapsed += OFFLINE_STEP_SECONDS) {
    tick(state, Math.min(OFFLINE_STEP_SECONDS, simulated - elapsed), events);
    events.length = 0;
  }
  return {
    seconds: simulated,
    salvage: state.stats.salvageEarned - before.salvage,
    intel: state.stats.intelEarned - before.intel,
    kills: state.stats.kills - before.kills,
    built: state.stats.tanksBuilt - before.built,
    lost: state.stats.tanksLost - before.lost,
    wavesGained: state.battle.maxWave - before.maxWave,
  };
}
