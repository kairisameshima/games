import type { BreedStats } from "../data/breeds.ts";
import type { UpgradeLevels } from "../data/upgrades.ts";

const ATTACK_GROWTH_PER_LEVEL = 1.1;
const HP_GROWTH_PER_LEVEL = 1.1;
const DEFENSE_PER_LEVEL = 1;
const SPEED_BONUS_PER_LEVEL = 0.03;
const COURAGE_DROP_PER_LEVEL = 0.02;
const COURAGE_FLOOR = 0.1;
const VISION_PER_LEVEL = 1;

/** A chicken's stats are its breed's base stats with every global upgrade applied. */
export function chickenStats(breed: BreedStats, levels: UpgradeLevels): BreedStats {
  return {
    maxHp: breed.maxHp * HP_GROWTH_PER_LEVEL ** levels.thickerFeathers,
    attack: breed.attack * ATTACK_GROWTH_PER_LEVEL ** levels.sharperBeaks,
    defense: breed.defense + DEFENSE_PER_LEVEL * levels.hardenedComb,
    speed: breed.speed * (1 + SPEED_BONUS_PER_LEVEL * levels.quickFeet),
    courage: Math.max(COURAGE_FLOOR, breed.courage - COURAGE_DROP_PER_LEVEL * levels.braveHeart),
    vision: breed.vision + VISION_PER_LEVEL * levels.lanternOil,
  };
}
