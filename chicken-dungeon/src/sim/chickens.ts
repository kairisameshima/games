import { findPath, isWalkable, pathTo, toIndex, type Point } from "../gen/grid.ts";
import { ATTACK_RANGE, peck } from "./combat.ts";
import { chooseFrontier, isExplored, isFrontier, isVisibleNow, pathThroughExplored, searchExplored } from "./explore.ts";
import { currentTile, distanceBetween, isOnTileCenter, moveAlongPath, pathEndsAt } from "./movement.ts";
import { TICK_SECONDS, TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, FloorState, GameEvent, GameState, Monster } from "./types.ts";
import { COOP_DEPTH, ENTRANCE_DEPTH, floorStateAt, placeChicken } from "./world.ts";

const AGGRO_RADIUS = 4;
const JOIN_FIGHT_RADIUS = 5;
const RECALL_SPEED_MULTIPLIER = 1.2;
const COOP_HEAL_FRACTION_PER_SECOND = 0.02;

export function restAtCoop(chicken: Chicken): void {
  chicken.hp = Math.min(chicken.maxHp, chicken.hp + (chicken.maxHp * COOP_HEAL_FRACTION_PER_SECOND) / TICKS_PER_SECOND);
}

export function updateChicken(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  chicken.previousX = chicken.x;
  chicken.previousY = chicken.y;
  if (chicken.attackCooldownTicks > 0) chicken.attackCooldownTicks -= 1;
  // Recalled chickens still flee below Courage. Recall does not override self-preservation.
  if (chicken.activity !== "flee" && chicken.hp < chicken.courage * chicken.maxHp) {
    chicken.activity = "flee";
    chicken.exploreTarget = null;
    chicken.lootTargetId = null;
    chicken.fightTargetId = null;
  }

  const floorState = floorStateAt(state, chicken.depth);
  switch (chicken.activity) {
    case "explore":
    case "descend":
      adventure(state, floorState, chicken, events);
      break;
    case "fight":
      fight(state, floorState, chicken);
      break;
    case "flee":
    case "recalled":
      headForExit(state, floorState, chicken, events);
      break;
    case "home":
    case "dead":
      return;
  }
  if (chicken.depth !== COOP_DEPTH && isOnTileCenter(chicken)) collectLoot(floorStateAt(state, chicken.depth), chicken);
}

function adventure(state: GameState, floorState: FloorState, chicken: Chicken, events: GameEvent[]): void {
  const threat = findThreat(state, floorState, chicken);
  if (threat) {
    chicken.activity = "fight";
    chicken.fightTargetId = threat.id;
    chicken.exploreTarget = null;
    chicken.lootTargetId = null;
    fight(state, floorState, chicken);
    return;
  }
  if (isOnTileCenter(chicken)) {
    if (chicken.activity === "explore") planExploration(state, floorState, chicken);
    if (chicken.activity === "descend") {
      const stairs = floorState.floor.stairsDown;
      if (chicken.x === stairs.x && chicken.y === stairs.y) {
        const nextDepth = chicken.depth + 1;
        placeChicken(state, chicken, nextDepth, floorStateAt(state, nextDepth).floor.stairsUp, "explore");
        events.push({ type: "reachedFloor", chickenId: chicken.id, depth: nextDepth });
        return;
      }
      if (!pathEndsAt(chicken, stairs)) chicken.path = pathThroughExplored(floorState, currentTile(chicken), stairs);
    }
  }
  moveAlongPath(chicken, movementSpeed(state, chicken) * TICK_SECONDS);
}

/** Known loot comes first, then the best frontier. With neither left, the floor is done and the chicken descends. */
function planExploration(state: GameState, floorState: FloorState, chicken: Chicken): void {
  if (floorState.lootPiles.some((pile) => pile.id === chicken.lootTargetId)) return;
  chicken.lootTargetId = null;

  const claimedLoot = new Set(state.chickens.filter((other) => other !== chicken).map((other) => other.lootTargetId));
  const knownLoot = floorState.lootPiles.filter(
    (pile) => !claimedLoot.has(pile.id) && isExplored(floorState, toIndex(floorState.floor.side, pile)),
  );
  const frontierStillOpen = chicken.exploreTarget !== null && isFrontier(floorState, chicken.exploreTarget);
  if (knownLoot.length === 0 && frontierStillOpen) return;

  const search = searchExplored(floorState, currentTile(chicken));
  let nearestLootIndex = -1;
  let nearestLootId: number | null = null;
  for (const pile of knownLoot) {
    const index = toIndex(floorState.floor.side, pile);
    const distance = search.distance[index];
    if (distance >= 0 && (nearestLootIndex === -1 || distance < search.distance[nearestLootIndex])) {
      nearestLootIndex = index;
      nearestLootId = pile.id;
    }
  }
  if (nearestLootId !== null) {
    chicken.lootTargetId = nearestLootId;
    chicken.exploreTarget = null;
    chicken.path = pathTo(floorState.floor.side, search, nearestLootIndex);
    return;
  }
  if (frontierStillOpen) return;

  const frontier = chooseFrontier(floorState, search, claimedFrontiers(state, chicken));
  if (frontier) {
    chicken.exploreTarget = frontier.point;
    chicken.path = frontier.path;
    return;
  }
  chicken.activity = "descend";
  chicken.exploreTarget = null;
}

function claimedFrontiers(state: GameState, chicken: Chicken): Point[] {
  const claims: Point[] = [];
  for (const other of state.chickens) {
    if (other !== chicken && other.depth === chicken.depth && other.activity === "explore" && other.exploreTarget) claims.push(other.exploreTarget);
  }
  return claims;
}

/** The nearest visible monster within aggro radius, or the target of an ally fighting nearby. */
function findThreat(state: GameState, floorState: FloorState, chicken: Chicken): Monster | null {
  let nearest: Monster | null = null;
  let nearestDistance = Infinity;
  for (const monster of floorState.monsters) {
    const distance = distanceBetween(chicken, monster);
    if (distance > AGGRO_RADIUS || distance >= nearestDistance) continue;
    if (!isVisibleNow(floorState, currentTile(monster), state.tick)) continue;
    nearest = monster;
    nearestDistance = distance;
  }
  if (nearest) return nearest;
  for (const ally of state.chickens) {
    if (ally === chicken || ally.activity !== "fight" || ally.depth !== chicken.depth) continue;
    if (distanceBetween(ally, chicken) > JOIN_FIGHT_RADIUS) continue;
    const allyTarget = floorState.monsters.find((monster) => monster.id === ally.fightTargetId);
    if (allyTarget) return allyTarget;
  }
  return null;
}

function fight(state: GameState, floorState: FloorState, chicken: Chicken): void {
  const target = floorState.monsters.find((monster) => monster.id === chicken.fightTargetId) ?? findThreat(state, floorState, chicken);
  if (!target) {
    chicken.activity = "explore";
    chicken.fightTargetId = null;
    moveAlongPath(chicken, movementSpeed(state, chicken) * TICK_SECONDS);
    return;
  }
  chicken.fightTargetId = target.id;
  if (distanceBetween(chicken, target) <= ATTACK_RANGE) {
    if (chicken.attackCooldownTicks === 0) peck(floorState, chicken, target);
    return;
  }
  // Two units of equal speed that both chase each other's last tile mirror each other forever.
  // When the target is already coming, wait for it on a tile center instead of meeting halfway.
  if (target.targetChickenId === chicken.id && isOnTileCenter(chicken)) return;
  const targetTile = currentTile(target);
  if (isOnTileCenter(chicken) && !pathEndsAt(chicken, targetTile)) {
    chicken.path = findPath(floorState.floor, currentTile(chicken), targetTile, (index) => isWalkable(floorState.floor, index)) ?? [];
  }
  moveAlongPath(chicken, movementSpeed(state, chicken) * TICK_SECONDS);
}

/** Fleeing chickens never fight. Recalled chickens stand and fight only what is biting them. */
function headForExit(state: GameState, floorState: FloorState, chicken: Chicken, events: GameEvent[]): void {
  if (chicken.activity === "recalled") {
    const attacker = floorState.monsters.find(
      (monster) => monster.targetChickenId === chicken.id && distanceBetween(monster, chicken) <= ATTACK_RANGE,
    );
    if (attacker) {
      if (chicken.attackCooldownTicks === 0) peck(floorState, chicken, attacker);
      return;
    }
  }
  const stairs = floorState.floor.stairsUp;
  if (isOnTileCenter(chicken)) {
    if (chicken.x === stairs.x && chicken.y === stairs.y) {
      climbOut(state, chicken, events);
      return;
    }
    if (!pathEndsAt(chicken, stairs)) chicken.path = pathThroughExplored(floorState, currentTile(chicken), stairs);
  }
  moveAlongPath(chicken, movementSpeed(state, chicken) * TICK_SECONDS);
}

function climbOut(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  if (chicken.depth !== ENTRANCE_DEPTH) {
    const aboveDepth = chicken.depth - 1;
    placeChicken(state, chicken, aboveDepth, floorStateAt(state, aboveDepth).floor.stairsDown, chicken.activity);
    return;
  }
  state.bankedGold += chicken.pouchGold;
  events.push({ type: "returnedHome", chickenId: chicken.id, goldBanked: chicken.pouchGold });
  chicken.pouchGold = 0;
  chicken.activity = "home";
  chicken.depth = COOP_DEPTH;
  chicken.path = [];
}

function collectLoot(floorState: FloorState, chicken: Chicken): void {
  for (let index = floorState.lootPiles.length - 1; index >= 0; index--) {
    const pile = floorState.lootPiles[index];
    if (pile.x !== chicken.x || pile.y !== chicken.y) continue;
    chicken.pouchGold += pile.gold;
    floorState.lootPiles.splice(index, 1);
  }
}

function movementSpeed(state: GameState, chicken: Chicken): number {
  const slow = state.tick < chicken.slowedUntilTick ? chicken.slowMultiplier : 1;
  return chicken.speed * slow * (chicken.activity === "recalled" ? RECALL_SPEED_MULTIPLIER : 1);
}
