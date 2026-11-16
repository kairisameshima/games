import { TOOLS } from "../data/tools.ts";
import { ZONES } from "../data/zones.ts";
import type { Gallery, GameState, LiftPhase } from "../sim/types.ts";

const SAVE_KEY = "yearn-for-the-mines/save";
const SAVE_VERSION = 1;
const LIFT_PHASES: readonly LiftPhase[] = ["idle", "descending", "loading", "ascending", "unloading"];

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveFormatError";
  }
}

export interface LoadedGame {
  state: GameState;
  /** Wall-clock ms when the save was written. */
  savedAt: number;
}

type JsonObject = Record<string, unknown>;

function readObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SaveFormatError(`${path} is not an object`);
  return value as JsonObject;
}

function readNumber(object: JsonObject, key: string, path: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new SaveFormatError(`${path}.${key} is not a non-negative number`);
  return value;
}

function readGallery(value: unknown, path: string): Gallery {
  const object = readObject(value, path);
  const toolTier = readNumber(object, "toolTier", path);
  if (!Number.isInteger(toolTier) || toolTier >= TOOLS.length) throw new SaveFormatError(`${path}.toolTier is out of range`);
  return { crew: readNumber(object, "crew", path), toolTier, stockpile: readNumber(object, "stockpile", path) };
}

function readState(value: unknown): GameState {
  const object = readObject(value, "state");
  const galleries = object.galleries;
  if (!Array.isArray(galleries) || galleries.length === 0 || galleries.length > ZONES.length) {
    throw new SaveFormatError("state.galleries has the wrong length");
  }
  const lift = readObject(object.lift, "state.lift");
  const phase = lift.phase;
  if (!LIFT_PHASES.includes(phase as LiftPhase)) throw new SaveFormatError("state.lift.phase is unknown");
  const targetGallery = readNumber(lift, "targetGallery", "state.lift");
  if (targetGallery >= galleries.length) throw new SaveFormatError("state.lift.targetGallery is out of range");
  return {
    gold: readNumber(object, "gold", "state"),
    lifetimeGold: readNumber(object, "lifetimeGold", "state"),
    galleries: galleries.map((gallery, index) => readGallery(gallery, `state.galleries[${index}]`)),
    lift: {
      capacityLevel: readNumber(lift, "capacityLevel", "state.lift"),
      speedLevel: readNumber(lift, "speedLevel", "state.lift"),
      phase: phase as LiftPhase,
      depth: readNumber(lift, "depth", "state.lift"),
      targetGallery,
      cargo: readNumber(lift, "cargo", "state.lift"),
      stopSecondsLeft: readNumber(lift, "stopSecondsLeft", "state.lift"),
    },
  };
}

/** Returns undefined when there is no save. Throws SaveFormatError when the save cannot be read. */
export function loadGame(): LoadedGame | undefined {
  const text = localStorage.getItem(SAVE_KEY);
  if (text === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveFormatError("save is not valid JSON");
  }
  const envelope = readObject(parsed, "save");
  if (envelope.version !== SAVE_VERSION) throw new SaveFormatError(`save version ${String(envelope.version)} is not ${SAVE_VERSION}`);
  return { state: readState(envelope.state), savedAt: readNumber(envelope, "savedAt", "save") };
}

export function storeGame(state: GameState, savedAt: number): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt, state }));
}

/** Keeps an unreadable save under a side key so a new game does not destroy it. */
export function setAsideUnreadableSave(): void {
  const text = localStorage.getItem(SAVE_KEY);
  if (text !== null) localStorage.setItem(`${SAVE_KEY}/unreadable-${Date.now()}`, text);
  localStorage.removeItem(SAVE_KEY);
}
