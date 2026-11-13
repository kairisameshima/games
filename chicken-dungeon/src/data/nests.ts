import { depthHpScale } from "./bestiary.ts";

export interface NestTier {
  name: string;
  baseHp: number;
  /** Damage per second to each raider next to the nest, before depth scaling. */
  thornDamagePerSecond: number;
  /** Multiplier on damage the nest takes. */
  damageTakenMultiplier: number;
  /** Wanderers only raid when they spawn this close. Null means the normal raid radius. */
  wardRadius: number | null;
}

/** Index is the Nest Craft level. Each tier keeps the effects of the tiers below it. */
export const NEST_TIERS: readonly NestTier[] = [
  { name: "Straw", baseHp: 40, thornDamagePerSecond: 0, damageTakenMultiplier: 1, wardRadius: null },
  { name: "Thorn Hedge", baseHp: 80, thornDamagePerSecond: 3, damageTakenMultiplier: 1, wardRadius: null },
  { name: "Stone Ring", baseHp: 200, thornDamagePerSecond: 3, damageTakenMultiplier: 0.5, wardRadius: null },
  { name: "Hidden Ward", baseHp: 200, thornDamagePerSecond: 3, damageTakenMultiplier: 0.5, wardRadius: 3 },
];

export const MAX_NESTS = 5;
export const BASE_BROOD_SLOTS = 2;
export const NEST_EGG_CAPACITY = 6;
export const NEST_BUILD_SECONDS = 20;
export const TEARDOWN_SECONDS = 5;
export const NEST_REGEN_FRACTION_PER_SECOND = 0.01;
export const RAID_RADIUS = 12;
export const RAID_CHANCE = 0.5;
export const BASE_INCUBATION_SECONDS = 60;
export const BASE_FLOCK_CAP = 4;
export const YOLK_MANA_PER_EGG = 10;
export const YOLK_MANA_CAP = 50;
export const MUTATION_CHANCE = 0.05;
export const MUTATION_STAT_BONUS = 1.1;
export const WANDERER_INTERVAL_SECONDS = 45;

/** `nest_HP(t, d) = nest_HP_base(t) × 1.13^(d − 1)` */
export function nestMaxHp(tier: NestTier, depth: number): number {
  return tier.baseHp * depthHpScale(depth);
}

/** Thorn damage scales like monster HP: `3 × 1.13^(d − 1)` per second. */
export function thornDamagePerSecond(tier: NestTier, depth: number): number {
  return tier.thornDamagePerSecond * depthHpScale(depth);
}
