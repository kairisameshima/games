import type { BreedStats } from "../data/breeds.ts";
import { BASE_BROOD_SLOTS, BASE_FLOCK_CAP, BASE_INCUBATION_SECONDS } from "../data/nests.ts";
import type { UpgradeLevels } from "../data/upgrades.ts";
import { TICKS_PER_SECOND } from "./time.ts";

const ATTACK_GROWTH_PER_LEVEL = 1.1;
const HP_GROWTH_PER_LEVEL = 1.1;
const DEFENSE_PER_LEVEL = 1;
const SPEED_BONUS_PER_LEVEL = 0.03;
const COURAGE_DROP_PER_LEVEL = 0.02;
const COURAGE_FLOOR = 0.1;
const VISION_PER_LEVEL = 1;
const CARRY_PER_LEVEL = 1;
const LAY_INTERVAL_FACTOR_PER_LEVEL = 0.94;
const INCUBATION_FACTOR_PER_LEVEL = 0.92;
const FLOCK_CAP_PER_LEVEL = 2;
const BROOD_SLOTS_PER_LEVEL = 1;

/**
 * A chicken's stats are its breed's base stats with every global upgrade applied.
 * `statBonus` is the mutation bonus, which lifts HP, ATK, DEF, and speed.
 */
export function chickenStats(breed: BreedStats, levels: UpgradeLevels, statBonus: number): BreedStats {
  return {
    maxHp: breed.maxHp * HP_GROWTH_PER_LEVEL ** levels.thickerFeathers * statBonus,
    attack: breed.attack * ATTACK_GROWTH_PER_LEVEL ** levels.sharperBeaks * statBonus,
    defense: (breed.defense + DEFENSE_PER_LEVEL * levels.hardenedComb) * statBonus,
    speed: breed.speed * (1 + SPEED_BONUS_PER_LEVEL * levels.quickFeet) * statBonus,
    courage: Math.max(COURAGE_FLOOR, breed.courage - COURAGE_DROP_PER_LEVEL * levels.braveHeart),
    vision: breed.vision + VISION_PER_LEVEL * levels.lanternOil,
    carry: breed.carry + CARRY_PER_LEVEL * levels.biggerCrop,
    layIntervalSeconds: breed.layIntervalSeconds * LAY_INTERVAL_FACTOR_PER_LEVEL ** levels.layingMash,
  };
}

export function flockCap(levels: UpgradeLevels): number {
  return BASE_FLOCK_CAP + FLOCK_CAP_PER_LEVEL * levels.coopExpansion;
}

export function broodSlotsPerNest(levels: UpgradeLevels): number {
  return BASE_BROOD_SLOTS + BROOD_SLOTS_PER_LEVEL * levels.biggerNests;
}

export function incubationTicks(levels: UpgradeLevels): number {
  return Math.round(BASE_INCUBATION_SECONDS * INCUBATION_FACTOR_PER_LEVEL ** levels.warmStraw * TICKS_PER_SECOND);
}
