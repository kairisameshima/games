import { MONSTER_KINDS } from "../data/bestiary.ts";
import {
  MAX_NESTS,
  MUTATION_CHANCE,
  MUTATION_STAT_BONUS,
  NEST_BUILD_SECONDS,
  NEST_EGG_CAPACITY,
  NEST_REGEN_FRACTION_PER_SECOND,
  NEST_TIERS,
  nestMaxHp,
  RAID_CHANCE,
  RAID_RADIUS,
  TEARDOWN_SECONDS,
  YOLK_MANA_CAP,
  YOLK_MANA_PER_EGG,
} from "../data/nests.ts";
import type { Floor } from "../gen/floor.ts";
import { toIndex, type Point } from "../gen/grid.ts";
import { rectContains } from "../gen/population.ts";
import { rollChance } from "../rng.ts";
import { searchExplored } from "./explore.ts";
import { currentTile, isOnTileCenter } from "./movement.ts";
import { broodSlotsPerNest, flockCap } from "./stats.ts";
import { TICK_SECONDS, TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, Egg, FloorState, GameEvent, GameState, Monster, Nest } from "./types.ts";
import { addChicken, createEgg, floorStateAt, isAlive, placeChicken, spawnMonster } from "./world.ts";

// A nest on a corridor tile has no room. Treat everything this close as inside its camp.
const CORRIDOR_NEST_RADIUS = 3;

export const NEST_BUILD_TICKS = NEST_BUILD_SECONDS * TICKS_PER_SECOND;

/** True when `point` is in the nest's room. Brooding hens defend only that room. */
export function isInNestRoom(floor: Floor, nest: Nest, point: Point): boolean {
  const room = floor.rooms.find((candidate) => rectContains(candidate, nest));
  return room ? rectContains(room, point) : Math.hypot(point.x - nest.x, point.y - nest.y) <= CORRIDOR_NEST_RADIUS;
}

function brooderCount(state: GameState, nestId: number): number {
  return state.chickens.filter((chicken) => chicken.nestId === nestId && chicken.activity === "brood").length;
}

function totalNests(state: GameState): number {
  let count = 0;
  for (const floorState of state.floors.values()) count += floorState.nests.length;
  return count;
}

/**
 * Keeps the number of brooding and building hens at the Brood Quota. Exploring hens on a tile center join the
 * nearest nest with a free slot on their floor, or else go convert the nearest unclaimed Den Site while fewer than
 * five nests stand. Surplus hens go back to exploring and leave their nest standing.
 */
export function assignBroodingHens(state: GameState): void {
  const nestHens = state.chickens.filter((chicken) => chicken.activity === "brood" || chicken.activity === "build");
  for (const surplus of nestHens.slice(state.broodQuota)) {
    surplus.activity = "explore";
    surplus.nestId = null;
    surplus.buildSite = null;
  }
  let openSpots = state.broodQuota - nestHens.length;
  const slots = broodSlotsPerNest(state.upgradeLevels);
  for (const chicken of state.chickens) {
    if (openSpots <= 0) return;
    if (chicken.activity !== "explore" || !isOnTileCenter(chicken)) continue;
    const floorState = floorStateAt(state, chicken.depth);
    const openNests = floorState.nests.filter((nest) => nest.teardownTicksLeft === null && brooderCount(state, nest.id) < slots);
    const builders = state.chickens.filter((other) => other.activity === "build");
    const claimedSites = builders.map((builder) => builder.buildSite);
    const freeSites =
      totalNests(state) + builders.length < MAX_NESTS
        ? floorState.denSites.filter((site) => !claimedSites.some((claim) => claim && claim.x === site.x && claim.y === site.y))
        : [];
    if (openNests.length === 0 && freeSites.length === 0) continue;

    const search = searchExplored(floorState, currentTile(chicken));
    const distanceTo = (point: Point) => search.distance[toIndex(floorState.floor.side, point)];
    const nest = nearestReachable(openNests, distanceTo);
    if (nest) {
      chicken.activity = "brood";
      chicken.nestId = nest.id;
    } else {
      const site = nearestReachable(freeSites, distanceTo);
      if (!site) continue;
      chicken.activity = "build";
      chicken.buildSite = { x: site.x, y: site.y };
      chicken.taskTicksLeft = NEST_BUILD_TICKS;
    }
    chicken.exploreTarget = null;
    chicken.lootTargetId = null;
    openSpots -= 1;
  }
}

function nearestReachable<T extends Point>(candidates: readonly T[], distanceTo: (point: Point) => number): T | null {
  let nearest: T | null = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = distanceTo(candidate);
    if (distance >= 0 && distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Turns a Den Site into a Straw nest, or the tier Nest Craft has unlocked. Fails when five nests already stand. */
export function buildNest(state: GameState, floorState: FloorState, builder: Chicken, site: Point, events: GameEvent[]): boolean {
  const siteIndex = floorState.denSites.findIndex((candidate) => candidate.x === site.x && candidate.y === site.y);
  if (siteIndex === -1 || totalNests(state) >= MAX_NESTS) return false;
  floorState.denSites.splice(siteIndex, 1);
  const tier = state.upgradeLevels.nestCraft;
  const maxHp = nestMaxHp(NEST_TIERS[tier], floorState.floor.depth);
  const nest: Nest = { id: state.nextEntityId++, x: site.x, y: site.y, hp: maxHp, maxHp, tier, eggs: [], teardownTicksLeft: null };
  floorState.nests.push(nest);
  builder.activity = "brood";
  builder.nestId = nest.id;
  builder.buildSite = null;
  events.push({ type: "nestBuilt", chickenId: builder.id, depth: floorState.floor.depth });
  return true;
}

/** A full nest cannot hold another egg, so the Mancer cracks it for Yolk Mana. */
export function layEggInNest(state: GameState, nest: Nest, depth: number): void {
  if (nest.eggs.length < NEST_EGG_CAPACITY) nest.eggs.push(createEgg(state, depth));
  else crackEgg(state);
}

function crackEgg(state: GameState): void {
  state.yolkMana = Math.min(YOLK_MANA_CAP, state.yolkMana + YOLK_MANA_PER_EGG);
}

/** On Recall, each nest with brooding hens starts a 5 s teardown. Its brooders stop to pack instead of leaving. */
export function startTeardowns(state: GameState): void {
  for (const floorState of state.floors.values()) {
    for (const nest of floorState.nests) {
      const brooders = state.chickens.filter((chicken) => chicken.nestId === nest.id && chicken.activity === "brood");
      if (brooders.length === 0) continue;
      nest.teardownTicksLeft = TEARDOWN_SECONDS * TICKS_PER_SECOND;
      for (const brooder of brooders) brooder.activity = "teardown";
    }
  }
}

export function updateNests(state: GameState, events: GameEvent[]): void {
  for (const floorState of state.floors.values()) {
    for (const nest of [...floorState.nests]) {
      if (nest.teardownTicksLeft !== null) {
        nest.teardownTicksLeft -= 1;
        if (nest.teardownTicksLeft <= 0) strikeCamp(state, floorState, nest, events);
        continue;
      }
      const raided = floorState.monsters.some((monster) => !MONSTER_KINDS[monster.kind].spawner && isInNestRoom(floorState.floor, nest, monster));
      if (!raided) nest.hp = Math.min(nest.maxHp, nest.hp + nest.maxHp * NEST_REGEN_FRACTION_PER_SECOND * TICK_SECONDS);
    }
  }
  incubateAndHatch(state, events);
}

/**
 * Each egg goes into a free carry slot of one of the nest's packing hens. Eggs with nowhere to go are cracked into
 * Yolk Mana. The nest leaves a Den Site behind. If every packer died or fled, the nest stays standing.
 */
function strikeCamp(state: GameState, floorState: FloorState, nest: Nest, events: GameEvent[]): void {
  const packers = state.chickens.filter((chicken) => chicken.nestId === nest.id && chicken.activity === "teardown");
  if (packers.length === 0) {
    nest.teardownTicksLeft = null;
    return;
  }
  let eggsPacked = 0;
  let eggsCracked = 0;
  for (const egg of nest.eggs) {
    const packer = packers.find((candidate) => candidate.carriedEggs.length < candidate.carry);
    if (packer) {
      packer.carriedEggs.push(egg);
      eggsPacked += 1;
    } else {
      crackEgg(state);
      eggsCracked += 1;
    }
  }
  floorState.nests.splice(floorState.nests.indexOf(nest), 1);
  floorState.denSites.push({ x: nest.x, y: nest.y });
  for (const packer of packers) {
    packer.activity = "recalled";
    packer.nestId = null;
  }
  events.push({ type: "campStruck", depth: floorState.floor.depth, eggsPacked, eggsCracked });
}

/** Eggs break, the hens scatter, and the site reverts to an active Monster Den. */
export function damageNest(state: GameState, floorState: FloorState, nest: Nest, damage: number, events: GameEvent[]): void {
  nest.hp -= damage;
  if (nest.hp > 0) return;
  floorState.nests.splice(floorState.nests.indexOf(nest), 1);
  for (const chicken of state.chickens) {
    if (chicken.nestId !== nest.id) continue;
    chicken.nestId = null;
    if (chicken.activity === "brood" || chicken.activity === "teardown") chicken.activity = "explore";
  }
  for (const monster of floorState.monsters) {
    if (monster.raidNestId === nest.id) monster.raidNestId = null;
  }
  floorState.monsters.push(spawnMonster(state, { kind: "monsterDen", x: nest.x, y: nest.y }, floorState.floor.depth, false));
  events.push({ type: "nestDestroyed", depth: floorState.floor.depth, eggsLost: nest.eggs.length });
}

/** A freshly spawned wanderer near a nest has a 50% chance to raid it. A Hidden Ward shrinks "near" to 3 tiles. */
export function rollRaid(state: GameState, floorState: FloorState, monster: Monster): void {
  for (const nest of floorState.nests) {
    const radius = NEST_TIERS[nest.tier].wardRadius ?? RAID_RADIUS;
    if (Math.hypot(monster.x - nest.x, monster.y - nest.y) > radius) continue;
    if (rollChance(state.rng, RAID_CHANCE)) monster.raidNestId = nest.id;
    return;
  }
}

/** Eggs pause while the living flock is at its cap. A hatchling has a 5% chance to mutate with +10% stats. */
function incubateAndHatch(state: GameState, events: GameEvent[]): void {
  const cap = flockCap(state.upgradeLevels);
  let living = state.chickens.filter(isAlive).length;
  const hatchIfReady = (egg: Egg, hatchAt: ((chicken: Chicken) => void) | null): boolean => {
    if (living >= cap) return false;
    egg.incubationTicksLeft -= 1;
    if (egg.incubationTicksLeft > 0) return false;
    const mutated = rollChance(state.rng, MUTATION_CHANCE);
    const chick = addChicken(state, mutated ? MUTATION_STAT_BONUS : 1);
    hatchAt?.(chick);
    living += 1;
    events.push({ type: "chickHatched", chickenId: chick.id, depth: chick.depth, mutated });
    return true;
  };
  state.coopEggs = state.coopEggs.filter((egg) => !hatchIfReady(egg, null));
  for (const [depth, floorState] of state.floors) {
    for (const nest of floorState.nests) {
      nest.eggs = nest.eggs.filter((egg) => !hatchIfReady(egg, (chick) => placeChicken(state, chick, depth, nest, "explore")));
    }
  }
}
