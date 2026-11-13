import { bloodlineMultiplier, inheritanceGold, noAncestralRanks } from "../data/ancestry.ts";
import { MONSTER_KINDS, monsterAttack, monsterDefense, monsterMaxHp } from "../data/bestiary.ts";
import { RHODE_ISLAND_RED, type BreedStats } from "../data/breeds.ts";
import { WANDERER_INTERVAL_SECONDS } from "../data/nests.ts";
import { noUpgrades } from "../data/upgrades.ts";
import { generateFloor } from "../gen/floor.ts";
import type { Point } from "../gen/grid.ts";
import { populateFloor, type MonsterSpawn } from "../gen/population.ts";
import { createRng, mixSeed } from "../rng.ts";
import { createFloorState, revealAround } from "./explore.ts";
import { chickenStats, incubationTicks } from "./stats.ts";
import { TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, ChickenActivity, Egg, FloorState, GameState, Legacy, Monster } from "./types.ts";

export const COOP_DEPTH = 0;
export const ENTRANCE_DEPTH = 1;
const MONSTER_AGGRO_RADIUS = 4;
const AGITATED_AGGRO_MULTIPLIER = 2;
const AGITATED_ATTACK_MULTIPLIER = 1.2;
// Keeps runtime rolls independent of floor layout and population rolls.
const RUNTIME_RNG_SALT = 0x7a11;
const CHICKEN_NAMES = [
  "Henrietta",
  "Clucksworth",
  "Admiral Pecks",
  "Eggatha",
  "Nugget",
  "Sir Cluckalot",
  "Drumstick",
  "Pip",
  "Margarine",
  "Beakon",
  "Featherstone",
  "Omelette",
];

/** A first run's legacy: no yolks, no ancestral ranks, no fallen. */
export function createLegacy(): Legacy {
  return {
    goldenYolks: 0,
    lifetimeGoldenYolks: 0,
    ancestralRanks: noAncestralRanks(),
    run: 1,
    rollOfFeathers: [],
    autoRecall: { everyMinutes: null, pouchGold: null, flockHpPercent: null },
  };
}

/**
 * Every run starts with its hens at the coop and one egg already incubating there.
 * Inheritance sets the starting gold and Ancestral Nest the starting Nest Craft level.
 */
export function createGame(seed: number, flockSize: number, legacy: Legacy = createLegacy()): GameState {
  const upgradeLevels = noUpgrades();
  upgradeLevels.nestCraft = legacy.ancestralRanks.ancestralNest;
  const state: GameState = {
    seed,
    tick: 0,
    rng: createRng(mixSeed(seed, RUNTIME_RNG_SALT)),
    nextEntityId: 0,
    floors: new Map(),
    chickens: [],
    deepestDepth: 0,
    bankedGold: inheritanceGold(legacy.ancestralRanks.inheritance),
    bankLog: [],
    upgradeLevels,
    broodQuota: 0,
    coopEggs: [],
    yolkMana: 0,
    totalGoldBanked: 0,
    lastSendTick: 0,
    legacy,
    rite: null,
  };
  for (let index = 0; index < flockSize; index++) addChicken(state, 1);
  state.coopEggs.push(createEgg(state, COOP_DEPTH));
  return state;
}

/** The stats a Rhode Island Red gets right now: this run's upgrades and the legacy's Bloodline. */
export function currentChickenStats(state: GameState, statBonus: number): BreedStats {
  return chickenStats(RHODE_ISLAND_RED, state.upgradeLevels, statBonus, bloodlineMultiplier(state.legacy.lifetimeGoldenYolks));
}

/** Floors and their starting monsters, dens, and gold come from the seed, so they are built on first visit. */
export function floorStateAt(state: GameState, depth: number): FloorState {
  const existing = state.floors.get(depth);
  if (existing) return existing;
  const floorState = createFloorState(generateFloor(state.seed, depth), WANDERER_INTERVAL_SECONDS * TICKS_PER_SECOND);
  const population = populateFloor(state.seed, floorState.floor);
  for (const spawn of population.monsters) floorState.monsters.push(spawnMonster(state, spawn, depth, false));
  for (const pile of population.goldPiles) {
    floorState.lootPiles.push({ id: state.nextEntityId++, x: pile.x, y: pile.y, gold: pile.gold, isFeatherPile: false });
  }
  state.floors.set(depth, floorState);
  return floorState;
}

/** Agitated monsters come back on Recall: +20% ATK and double aggro radius. */
export function spawnMonster(state: GameState, spawn: MonsterSpawn, depth: number, agitated: boolean): Monster {
  const kind = MONSTER_KINDS[spawn.kind];
  const maxHp = monsterMaxHp(kind, depth);
  return {
    id: state.nextEntityId++,
    kind: spawn.kind,
    x: spawn.x,
    y: spawn.y,
    previousX: spawn.x,
    previousY: spawn.y,
    path: [],
    hp: maxHp,
    maxHp,
    attack: monsterAttack(kind, depth) * (agitated ? AGITATED_ATTACK_MULTIPLIER : 1),
    defense: monsterDefense(kind, depth),
    aggroRadius: MONSTER_AGGRO_RADIUS * (agitated ? AGITATED_AGGRO_MULTIPLIER : 1),
    attackCooldownTicks: 0,
    targetChickenId: null,
    agitated,
    home: { x: spawn.x, y: spawn.y },
    denId: null,
    raidNestId: null,
    spawnCooldownTicks: kind.spawner ? kind.spawner.intervalSeconds * TICKS_PER_SECOND : 0,
  };
}

export function createEgg(state: GameState, laidAtDepth: number): Egg {
  return { id: state.nextEntityId++, laidAtDepth, incubationTicksLeft: incubationTicks(state.upgradeLevels) };
}

/** Adds a chicken at the coop with every current upgrade applied. */
export function addChicken(state: GameState, statBonus: number): Chicken {
  const id = state.chickens.length;
  const baseName = CHICKEN_NAMES[id % CHICKEN_NAMES.length];
  const generation = Math.floor(id / CHICKEN_NAMES.length);
  const stats = currentChickenStats(state, statBonus);
  const chicken: Chicken = {
    id,
    name: generation === 0 ? baseName : `${baseName} ${generation + 1}`,
    activity: "home",
    depth: COOP_DEPTH,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    path: [],
    ...stats,
    hp: stats.maxHp,
    statBonus,
    attackCooldownTicks: 0,
    slowedUntilTick: 0,
    slowMultiplier: 1,
    pouchGold: 0,
    carriedEggs: [],
    exploreTarget: null,
    lootTargetId: null,
    fightTargetId: null,
    nestId: null,
    buildSite: null,
    taskTicksLeft: 0,
    layTicksLeft: Math.round(stats.layIntervalSeconds * TICKS_PER_SECOND),
  };
  state.chickens.push(chicken);
  return chicken;
}

export function isInDungeon(chicken: Chicken): boolean {
  return chicken.activity !== "home" && chicken.activity !== "dead";
}

export function isAlive(chicken: Chicken): boolean {
  return chicken.activity !== "dead";
}

/** Already on the way out: Recall and the Dinner Bell have nothing more to tell these chickens. */
export function isHeadingOut(chicken: Chicken): boolean {
  return chicken.activity === "recalled" || chicken.activity === "flee" || chicken.activity === "teardown";
}

/** The deepest floor with a chicken on it, where the expedition's front line is. The camera watches it. Null with nobody in the dungeon. */
export function frontDepth(state: GameState): number | null {
  const depths = state.chickens.filter(isInDungeon).map((chicken) => chicken.depth);
  return depths.length === 0 ? null : Math.max(...depths);
}

export function placeChicken(state: GameState, chicken: Chicken, depth: number, point: Point, activity: ChickenActivity): void {
  chicken.depth = depth;
  chicken.x = chicken.previousX = point.x;
  chicken.y = chicken.previousY = point.y;
  chicken.path = [];
  chicken.exploreTarget = null;
  chicken.lootTargetId = null;
  chicken.fightTargetId = null;
  chicken.nestId = null;
  chicken.buildSite = null;
  chicken.activity = activity;
  state.deepestDepth = Math.max(state.deepestDepth, depth);
  revealAround(floorStateAt(state, depth), point, state.tick, chicken.vision);
}
