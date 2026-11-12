import { MONSTER_KINDS, monsterGold, type MonsterKindId } from "../data/bestiary.ts";
import { currentTile } from "./movement.ts";
import { TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, FloorState, GameEvent, GameState, Monster } from "./types.ts";

/** Adjacent tile centers are 1 apart. The slack lets a unit strike while its target is finishing a step. */
export const ATTACK_RANGE = 1.05;
/** The bible gives every breed a 1.0 s base attack interval. Monsters use the same. */
export const ATTACK_INTERVAL_TICKS = TICKS_PER_SECOND;

/** `damage = max(1, ATK × 10 / (10 + DEF_target))` */
export function attackDamage(attack: number, targetDefense: number): number {
  return Math.max(1, (attack * 10) / (10 + targetDefense));
}

export function peck(floorState: FloorState, chicken: Chicken, monster: Monster): void {
  monster.hp -= attackDamage(chicken.attack, monster.defense);
  chicken.attackCooldownTicks = ATTACK_INTERVAL_TICKS;
  if (monster.hp > 0) return;
  floorState.monsters.splice(floorState.monsters.indexOf(monster), 1);
  chicken.pouchGold += monsterGold(MONSTER_KINDS[monster.kind], floorState.floor.depth);
  floorState.killedThisExpedition.push({ kind: monster.kind, x: monster.home.x, y: monster.home.y });
}

export function bite(state: GameState, floorState: FloorState, monster: Monster, chicken: Chicken, events: GameEvent[]): void {
  const kind = MONSTER_KINDS[monster.kind];
  chicken.hp -= attackDamage(monster.attack, chicken.defense);
  monster.attackCooldownTicks = ATTACK_INTERVAL_TICKS;
  if (kind.slowOnHit) {
    chicken.slowMultiplier = kind.slowOnHit.speedMultiplier;
    chicken.slowedUntilTick = state.tick + kind.slowOnHit.seconds * TICKS_PER_SECOND;
  }
  if (chicken.hp <= 0) killChicken(state, floorState, chicken, monster.kind, events);
}

/** Death is permanent. The pouch drops as a Feather Pile that any chicken can carry home. */
function killChicken(state: GameState, floorState: FloorState, chicken: Chicken, killer: MonsterKindId, events: GameEvent[]): void {
  const tile = currentTile(chicken);
  floorState.lootPiles.push({ id: state.nextEntityId++, x: tile.x, y: tile.y, gold: chicken.pouchGold, isFeatherPile: true });
  events.push({ type: "chickenDied", chickenId: chicken.id, depth: floorState.floor.depth, killer });
  chicken.hp = 0;
  chicken.pouchGold = 0;
  chicken.activity = "dead";
  chicken.path = [];
  chicken.exploreTarget = null;
  chicken.lootTargetId = null;
  chicken.fightTargetId = null;
  for (const monster of floorState.monsters) {
    if (monster.targetChickenId === chicken.id) monster.targetChickenId = null;
  }
}
