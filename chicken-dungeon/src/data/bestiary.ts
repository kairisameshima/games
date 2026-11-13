export type MonsterKindId = "cellarRat" | "cellarSpider" | "monsterDen";

export interface SlowOnHit {
  speedMultiplier: number;
  seconds: number;
}

/** A den never moves or bites. It adds one monster from its biome's pool every interval while chickens share its floor. */
export interface Spawner {
  intervalSeconds: number;
  maxLiveSpawns: number;
}

export interface MonsterKind {
  name: string;
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  speed: number;
  goldWeight: number;
  packSize: number;
  slowOnHit: SlowOnHit | null;
  spawner: Spawner | null;
}

export const MONSTER_KINDS: Readonly<Record<MonsterKindId, MonsterKind>> = {
  // Speed matches the Rhode Island Red, so a hen fleeing below Courage can outrun a pack instead of dying in it.
  cellarRat: {
    name: "Cellar Rat",
    baseHp: 8,
    baseAttack: 2,
    baseDefense: 0,
    speed: 2.0,
    goldWeight: 1,
    packSize: 3,
    slowOnHit: null,
    spawner: null,
  },
  cellarSpider: {
    name: "Cellar Spider",
    baseHp: 12,
    baseAttack: 2,
    baseDefense: 1,
    speed: 1.8,
    goldWeight: 1,
    packSize: 1,
    slowOnHit: { speedMultiplier: 0.6, seconds: 3 },
    spawner: null,
  },
  monsterDen: {
    name: "Monster Den",
    baseHp: 20,
    baseAttack: 0,
    baseDefense: 2,
    speed: 0,
    goldWeight: 0,
    packSize: 1,
    slowOnHit: null,
    spawner: { intervalSeconds: 30, maxLiveSpawns: 3 },
  },
};

/** Root Cellar monsters. Every floor uses this pool until the deeper biomes exist. */
export const ROOT_CELLAR_POOL: readonly MonsterKindId[] = ["cellarRat", "cellarSpider"];

/** Gold piles a destroyed den drops, each worth `gold_pile(d)`. */
export const DEN_GOLD_PILES = 5;

const MONSTER_HP_GROWTH = 1.13;
const MONSTER_ATTACK_GROWTH = 1.1;
const FLOORS_PER_DEFENSE_POINT = 4;
const GOLD_GROWTH = 1.16;
const GOLD_PILE_BASE = 5;

export function monsterMaxHp(kind: MonsterKind, depth: number): number {
  return kind.baseHp * MONSTER_HP_GROWTH ** (depth - 1);
}

export function monsterAttack(kind: MonsterKind, depth: number): number {
  return kind.baseAttack * MONSTER_ATTACK_GROWTH ** (depth - 1);
}

export function monsterDefense(kind: MonsterKind, depth: number): number {
  return kind.baseDefense + Math.floor(depth / FLOORS_PER_DEFENSE_POINT);
}

export function goldPileAmount(depth: number): number {
  return Math.round(GOLD_PILE_BASE * GOLD_GROWTH ** (depth - 1));
}

export function monsterGold(kind: MonsterKind, depth: number): number {
  return kind.goldWeight * Math.round(GOLD_GROWTH ** (depth - 1));
}

/** The 1.13 per-floor HP growth, shared by nests and thorn damage so they keep pace with monsters. */
export function depthHpScale(depth: number): number {
  return MONSTER_HP_GROWTH ** (depth - 1);
}
