import { MONSTER_KINDS, monsterAttack, monsterDefense, monsterMaxHp } from "../data/bestiary.ts";
import { RHODE_ISLAND_RED } from "../data/breeds.ts";
import { generateFloor } from "../gen/floor.ts";
import type { Point } from "../gen/grid.ts";
import { populateFloor, type MonsterSpawn } from "../gen/population.ts";
import { createFloorState, revealAround } from "./explore.ts";
import type { Chicken, ChickenActivity, FloorState, GameState, Monster } from "./types.ts";

export const COOP_DEPTH = 0;
export const ENTRANCE_DEPTH = 1;
const MONSTER_AGGRO_RADIUS = 4;
const AGITATED_AGGRO_MULTIPLIER = 2;
const AGITATED_ATTACK_MULTIPLIER = 1.2;
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

export function createGame(seed: number, flockSize: number): GameState {
  const chickens = Array.from({ length: flockSize }, (_, id) => createChicken(id));
  return { seed, tick: 0, nextEntityId: 0, floors: new Map(), chickens, deepestDepth: 0, bankedGold: 0 };
}

/** Floors and their starting monsters and gold come from the seed, so they are built on first visit. */
export function floorStateAt(state: GameState, depth: number): FloorState {
  const existing = state.floors.get(depth);
  if (existing) return existing;
  const floorState = createFloorState(generateFloor(state.seed, depth));
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
  };
}

export function isInDungeon(chicken: Chicken): boolean {
  return chicken.activity !== "home" && chicken.activity !== "dead";
}

/** The first living chicken in the dungeon. The camera follows it. */
export function leadChicken(state: GameState): Chicken | undefined {
  return state.chickens.find(isInDungeon);
}

export function placeChicken(state: GameState, chicken: Chicken, depth: number, point: Point, activity: ChickenActivity): void {
  chicken.depth = depth;
  chicken.x = chicken.previousX = point.x;
  chicken.y = chicken.previousY = point.y;
  chicken.path = [];
  chicken.exploreTarget = null;
  chicken.lootTargetId = null;
  chicken.fightTargetId = null;
  chicken.activity = activity;
  state.deepestDepth = Math.max(state.deepestDepth, depth);
  revealAround(floorStateAt(state, depth), point, state.tick);
}

function createChicken(id: number): Chicken {
  const baseName = CHICKEN_NAMES[id % CHICKEN_NAMES.length];
  const generation = Math.floor(id / CHICKEN_NAMES.length);
  return {
    id,
    name: generation === 0 ? baseName : `${baseName} ${generation + 1}`,
    activity: "home",
    depth: COOP_DEPTH,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    path: [],
    hp: RHODE_ISLAND_RED.maxHp,
    maxHp: RHODE_ISLAND_RED.maxHp,
    attack: RHODE_ISLAND_RED.attack,
    defense: RHODE_ISLAND_RED.defense,
    speed: RHODE_ISLAND_RED.speed,
    courage: RHODE_ISLAND_RED.courage,
    attackCooldownTicks: 0,
    slowedUntilTick: 0,
    slowMultiplier: 1,
    pouchGold: 0,
    exploreTarget: null,
    lootTargetId: null,
    fightTargetId: null,
  };
}
