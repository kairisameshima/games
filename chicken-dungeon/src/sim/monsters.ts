import { MONSTER_KINDS } from "../data/bestiary.ts";
import { findPath, isWalkable } from "../gen/grid.ts";
import { ATTACK_RANGE, bite } from "./combat.ts";
import { hasLineOfSight } from "./explore.ts";
import { currentTile, distanceBetween, isOnTileCenter, moveAlongPath, pathEndsAt } from "./movement.ts";
import { TICK_SECONDS } from "./time.ts";
import type { Chicken, FloorState, GameEvent, GameState, Monster } from "./types.ts";
import { isInDungeon } from "./world.ts";

/** Monsters act only on floors with chickens. They know the whole floor, so they chase over unexplored ground. */
export function updateMonsters(state: GameState, floorState: FloorState, events: GameEvent[]): void {
  for (const monster of floorState.monsters) {
    monster.previousX = monster.x;
    monster.previousY = monster.y;
    if (monster.attackCooldownTicks > 0) monster.attackCooldownTicks -= 1;
    const target = huntedChicken(state, floorState, monster);
    monster.targetChickenId = target?.id ?? null;
    const speed = MONSTER_KINDS[monster.kind].speed * TICK_SECONDS;
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
