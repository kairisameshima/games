import {
  LIFT_CAPACITY_BASE_COST,
  LIFT_CAPACITY_COST_GROWTH,
  LIFT_MAX_SPEED_LEVEL,
  LIFT_SPEED_BASE_COST,
  LIFT_SPEED_COST_GROWTH,
} from "../data/lift.ts";
import { TOOLS } from "../data/tools.ts";
import { HIRE_COST_GROWTH, TOOL_COST_GROWTH, ZONES } from "../data/zones.ts";
import { newGallery } from "./game.ts";
import type { GameState } from "./types.ts";

// Costs of capped purchases (tools, galleries, lift speed) are undefined once maxed out.

export function hireCost(state: GameState, galleryIndex: number): number {
  return Math.ceil(ZONES[galleryIndex].hireBaseCost * HIRE_COST_GROWTH ** (state.galleries[galleryIndex].crew - 1));
}

export function toolUpgradeCost(state: GameState, galleryIndex: number): number | undefined {
  const tier = state.galleries[galleryIndex].toolTier;
  if (tier + 1 >= TOOLS.length) return undefined;
  return ZONES[galleryIndex].toolBaseCost * TOOL_COST_GROWTH ** tier;
}

export function openGalleryCost(state: GameState): number | undefined {
  return ZONES[state.galleries.length]?.openCost;
}

export function liftCapacityCost(state: GameState): number {
  return Math.ceil(LIFT_CAPACITY_BASE_COST * LIFT_CAPACITY_COST_GROWTH ** state.lift.capacityLevel);
}

export function liftSpeedCost(state: GameState): number | undefined {
  if (state.lift.speedLevel >= LIFT_MAX_SPEED_LEVEL) return undefined;
  return Math.ceil(LIFT_SPEED_BASE_COST * LIFT_SPEED_COST_GROWTH ** state.lift.speedLevel);
}

function spend(state: GameState, cost: number | undefined): boolean {
  if (cost === undefined || state.gold < cost) return false;
  state.gold -= cost;
  return true;
}

export function hireKid(state: GameState, galleryIndex: number): boolean {
  if (!spend(state, hireCost(state, galleryIndex))) return false;
  state.galleries[galleryIndex].crew += 1;
  return true;
}

export function upgradeTool(state: GameState, galleryIndex: number): boolean {
  if (!spend(state, toolUpgradeCost(state, galleryIndex))) return false;
  state.galleries[galleryIndex].toolTier += 1;
  return true;
}

export function openGallery(state: GameState): boolean {
  if (!spend(state, openGalleryCost(state))) return false;
  state.galleries.push(newGallery());
  return true;
}

export function upgradeLiftCapacity(state: GameState): boolean {
  if (!spend(state, liftCapacityCost(state))) return false;
  state.lift.capacityLevel += 1;
  return true;
}

export function upgradeLiftSpeed(state: GameState): boolean {
  if (!spend(state, liftSpeedCost(state))) return false;
  state.lift.speedLevel += 1;
  return true;
}
