import { TOOLS } from "../data/tools.ts";
import { KID_DIG_RATE, ZONES } from "../data/zones.ts";
import { advanceLift } from "./lift.ts";
import type { Gallery, GameState } from "./types.ts";

/** Away time past this earns nothing, so a week-old tab is not a jackpot. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
const OFFLINE_STEP_SECONDS = 1;

export function newGallery(): Gallery {
  return { crew: 1, toolTier: 0, stockpile: 0 };
}

export function createGame(): GameState {
  return {
    gold: 0,
    lifetimeGold: 0,
    galleries: [newGallery()],
    lift: { capacityLevel: 0, speedLevel: 0, phase: "idle", depth: 0, targetGallery: 0, cargo: 0, stopSecondsLeft: 0 },
  };
}

/** Gold worth of ore a gallery digs per second. */
export function galleryDigRate(state: GameState, galleryIndex: number): number {
  const gallery = state.galleries[galleryIndex];
  return gallery.crew * KID_DIG_RATE * TOOLS[gallery.toolTier].digMultiplier * ZONES[galleryIndex].oreValue;
}

export function totalDigRate(state: GameState): number {
  return state.galleries.reduce((sum, _gallery, index) => sum + galleryDigRate(state, index), 0);
}

export function tick(state: GameState, seconds: number): void {
  state.galleries.forEach((gallery, index) => {
    gallery.stockpile += galleryDigRate(state, index) * seconds;
  });
  advanceLift(state, seconds);
}

/** Runs the mine for the time the player was away. Returns the gold earned. */
export function simulateOffline(state: GameState, secondsAway: number): number {
  const goldBefore = state.gold;
  let remaining = Math.min(secondsAway, MAX_OFFLINE_SECONDS);
  while (remaining > 0) {
    const step = Math.min(OFFLINE_STEP_SECONDS, remaining);
    tick(state, step);
    remaining -= step;
  }
  return state.gold - goldBefore;
}
