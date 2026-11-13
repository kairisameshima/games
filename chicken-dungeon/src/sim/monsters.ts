import { MONSTER_KINDS, ROOT_CELLAR_POOL, type Spawner } from "../data/bestiary.ts";
import { NEST_TIERS, thornDamagePerSecond, WANDERER_INTERVAL_SECONDS } from "../data/nests.ts";
import { findPath, isWalkable } from "../gen/grid.ts";
import { nextInt } from "../rng.ts";
import { ATTACK_INTERVAL_TICKS, ATTACK_RANGE, attackDamage, bite } from "./combat.ts";
import { hasLineOfSight } from "./explore.ts";
import { currentTile, distanceBetween, isOnTileCenter, moveAlongPath, pathEndsAt } from "./movement.ts";
import { damageNest, rollRaid } from "./nests.ts";
import { TICK_SECONDS, TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, FloorState, GameEvent, GameState, Monster } from "./types.ts";
import { isInDungeon, spawnMonster } from "./world.ts";

// Wanderers appear out of sight: not on a tile any chicken sees, and at least this far from every chicken.
const WANDERER_MIN_DISTANCE = 8;
const WANDERER_PLACEMENT_TRIES = 20;

/** Monsters act only on floors with chickens. They know the whole floor, so they chase over unexplored ground. */
export function updateMonsters(state: GameState, floorState: FloorState, events: GameEvent[]): void {
  for (const monster of [...floorState.monsters]) {
    monster.previousX = monster.x;
    monster.previousY = monster.y;
    if (monster.attackCooldownTicks > 0) monster.attackCooldownTicks -= 1;
    const kind = MONSTER_KINDS[monster.kind];
    if (kind.spawner) {
      runDen(state, floorState, monster, kind.spawner);
      continue;
    }
    const speed = kind.speed * TICK_SECONDS;
    if (raidNest(state, floorState, monster, speed, events)) continue;

    const target = huntedChicken(state, floorState, monster);
    monster.targetChickenId = target?.id ?? null;
    if (!target) {
      moveAlongPath(monster, speed);
      continue;
    }
    if (distanceBetween(monster, target) <= ATTACK_RANGE) {
      if (monster.attackCooldownTicks === 0) bite(state, floorState, monster, target, events);
      continue;
    }
    const targetTile = currentTile(target);
    if (isOnTileCenter(monster) && !pathEndsAt(monster, targetTile)) {
      monster.path = findPath(floorState.floor, currentTile(monster), targetTile, (index) => isWalkable(floorState.floor, index)) ?? [];
    }
    moveAlongPath(monster, speed);
  }
}

/**
 * Every visited floor gains a wandering monster every 45 s while its monsters number fewer than its rooms.
 * Runs on floors without chickens too, so an abandoned floor slowly refills.
 */
export function spawnWanderers(state: GameState, floorState: FloorState): void {
  floorState.wandererCooldownTicks -= 1;
  if (floorState.wandererCooldownTicks > 0) return;
  floorState.wandererCooldownTicks = WANDERER_INTERVAL_SECONDS * TICKS_PER_SECOND;
  const mobile = floorState.monsters.filter((monster) => !MONSTER_KINDS[monster.kind].spawner).length;
  if (mobile >= floorState.floor.rooms.length) return;
  const { floor } = floorState;
  const chickens = state.chickens.filter((chicken) => chicken.depth === floor.depth && isInDungeon(chicken));
  for (let attempt = 0; attempt < WANDERER_PLACEMENT_TRIES; attempt++) {
    const x = nextInt(state.rng, 0, floor.side - 1);
    const y = nextInt(state.rng, 0, floor.side - 1);
    const index = y * floor.side + x;
    if (!isWalkable(floor, index) || floorState.lastSeenTick[index] === state.tick) continue;
    if (chickens.some((chicken) => Math.hypot(chicken.x - x, chicken.y - y) < WANDERER_MIN_DISTANCE)) continue;
    const kind = ROOT_CELLAR_POOL[nextInt(state.rng, 0, ROOT_CELLAR_POOL.length - 1)];
    const wanderer = spawnMonster(state, { kind, x, y }, floor.depth, false);
    rollRaid(state, floorState, wanderer);
    floorState.monsters.push(wanderer);
    return;
  }
}

function runDen(state: GameState, floorState: FloorState, den: Monster, spawner: Spawner): void {
  if (den.spawnCooldownTicks > 0) {
    den.spawnCooldownTicks -= 1;
    return;
  }
  den.spawnCooldownTicks = spawner.intervalSeconds * TICKS_PER_SECOND;
  const liveSpawns = floorState.monsters.filter((monster) => monster.denId === den.id).length;
  if (liveSpawns >= spawner.maxLiveSpawns) return;
  const kind = ROOT_CELLAR_POOL[nextInt(state.rng, 0, ROOT_CELLAR_POOL.length - 1)];
  const spawned = spawnMonster(state, { kind, x: den.home.x, y: den.home.y }, floorState.floor.depth, false);
  spawned.denId = den.id;
  rollRaid(state, floorState, spawned);
  floorState.monsters.push(spawned);
}

/** Raiders walk to their nest and claw it, taking thorn damage beside it. Returns false when not raiding. */
function raidNest(state: GameState, floorState: FloorState, monster: Monster, speed: number, events: GameEvent[]): boolean {
  if (monster.raidNestId === null) return false;
  const nest = floorState.nests.find((candidate) => candidate.id === monster.raidNestId);
  if (!nest) {
    monster.raidNestId = null;
    return false;
  }
  monster.targetChickenId = null;
  if (Math.hypot(monster.x - nest.x, monster.y - nest.y) <= ATTACK_RANGE) {
    const tier = NEST_TIERS[nest.tier];
    monster.hp -= thornDamagePerSecond(tier, floorState.floor.depth) * TICK_SECONDS;
    if (monster.hp <= 0) {
      floorState.monsters.splice(floorState.monsters.indexOf(monster), 1);
      return true;
    }
    if (monster.attackCooldownTicks === 0) {
      monster.attackCooldownTicks = ATTACK_INTERVAL_TICKS;
      damageNest(state, floorState, nest, attackDamage(monster.attack, 0) * tier.damageTakenMultiplier, events);
    }
    return true;
  }
  if (isOnTileCenter(monster) && !pathEndsAt(monster, nest)) {
    monster.path = findPath(floorState.floor, currentTile(monster), nest, (index) => isWalkable(floorState.floor, index)) ?? [];
  }
  moveAlongPath(monster, speed);
  return true;
}

/** Keeps the current target while it stays on this floor, otherwise picks the nearest chicken in aggro range and sight. */
function huntedChicken(state: GameState, floorState: FloorState, monster: Monster): Chicken | null {
  const depth = floorState.floor.depth;
  const current = state.chickens.find((chicken) => chicken.id === monster.targetChickenId);
  if (current && current.depth === depth && isInDungeon(current)) return current;

  const monsterTile = currentTile(monster);
  let nearest: Chicken | null = null;
  let nearestDistance = Infinity;
  for (const chicken of state.chickens) {
    if (chicken.depth !== depth || !isInDungeon(chicken)) continue;
    const distance = distanceBetween(monster, chicken);
    if (distance > monster.aggroRadius || distance >= nearestDistance) continue;
    if (!hasLineOfSight(floorState.floor, monsterTile, currentTile(chicken))) continue;
    nearest = chicken;
    nearestDistance = distance;
  }
  return nearest;
}
