import {
  LIFT_BASE_CAPACITY,
  LIFT_BASE_SPEED,
  LIFT_CAPACITY_GROWTH,
  LIFT_SPEED_GROWTH,
  LIFT_STOP_SECONDS,
} from "../data/lift.ts";
import type { GameState, Lift } from "./types.ts";

export function liftCapacity(lift: Lift): number {
  return LIFT_BASE_CAPACITY * LIFT_CAPACITY_GROWTH ** lift.capacityLevel;
}

export function liftSpeed(lift: Lift): number {
  return LIFT_BASE_SPEED * LIFT_SPEED_GROWTH ** lift.speedLevel;
}

/** Gold per second the lift can haul if every open gallery always has ore waiting. */
export function liftThroughput(state: GameState): number {
  const deepest = state.galleries.length;
  const travelSeconds = (2 * deepest) / liftSpeed(state.lift);
  const stopSeconds = LIFT_STOP_SECONDS * (deepest + 1);
  return liftCapacity(state.lift) / (travelSeconds + stopSeconds);
}

function firstStockedGalleryFrom(state: GameState, startIndex: number): number | undefined {
  for (let index = startIndex; index < state.galleries.length; index++) {
    if (state.galleries[index].stockpile > 0) return index;
  }
  return undefined;
}

/** Runs one phase of the lift for up to `seconds`. Returns the seconds it used. */
function advancePhase(state: GameState, seconds: number): number {
  const lift = state.lift;
  switch (lift.phase) {
    case "idle": {
      const target = firstStockedGalleryFrom(state, 0);
      if (target === undefined) return seconds;
      lift.targetGallery = target;
      lift.phase = "descending";
      return 0;
    }
    case "descending": {
      const targetDepth = lift.targetGallery + 1;
      const secondsToArrive = (targetDepth - lift.depth) / liftSpeed(lift);
      if (secondsToArrive > seconds) {
        lift.depth += seconds * liftSpeed(lift);
        return seconds;
      }
      lift.depth = targetDepth;
      lift.phase = "loading";
      lift.stopSecondsLeft = LIFT_STOP_SECONDS;
      return secondsToArrive;
    }
    case "loading": {
      if (lift.stopSecondsLeft > seconds) {
        lift.stopSecondsLeft -= seconds;
        return seconds;
      }
      const gallery = state.galleries[lift.targetGallery];
      const loaded = Math.min(liftCapacity(lift) - lift.cargo, gallery.stockpile);
      gallery.stockpile -= loaded;
      lift.cargo += loaded;
      const next = lift.cargo < liftCapacity(lift) ? firstStockedGalleryFrom(state, lift.targetGallery + 1) : undefined;
      if (next === undefined) {
        lift.phase = "ascending";
      } else {
        lift.targetGallery = next;
        lift.phase = "descending";
      }
      return lift.stopSecondsLeft;
    }
    case "ascending": {
      const secondsToArrive = lift.depth / liftSpeed(lift);
      if (secondsToArrive > seconds) {
        lift.depth -= seconds * liftSpeed(lift);
        return seconds;
      }
      lift.depth = 0;
      lift.phase = "unloading";
      lift.stopSecondsLeft = LIFT_STOP_SECONDS;
      return secondsToArrive;
    }
    case "unloading": {
      if (lift.stopSecondsLeft > seconds) {
        lift.stopSecondsLeft -= seconds;
        return seconds;
      }
      state.gold += lift.cargo;
      state.lifetimeGold += lift.cargo;
      lift.cargo = 0;
      lift.phase = "idle";
      return lift.stopSecondsLeft;
    }
  }
}

export function advanceLift(state: GameState, seconds: number): void {
  let remaining = seconds;
  while (remaining > 0) remaining -= advancePhase(state, remaining);
}
