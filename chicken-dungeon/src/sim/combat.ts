import { DEN_GOLD_PILES, goldPileAmount, MONSTER_KINDS, monsterGold, type MonsterKindId } from "../data/bestiary.ts";
import { isWalkable } from "../gen/grid.ts";
import { currentTile } from "./movement.ts";
import { TICKS_PER_SECOND } from "./time.ts";
import type { Chicken, FloorState, GameEvent, GameState, Monster } from "./types.ts";

/** Adjacent tile centers are 1 apart. The slack lets a unit strike while its target is finishing a step. */
export const ATTACK_RANGE = 1.05;
/** The bible gives every breed a 1.0 s base attack interval. Monsters use the same. */
export const ATTACK_INTERVAL_TICKS = TICKS_PER_SECOND;

const DEN_PILE_OFFSETS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** `damage = max(1, ATK × 10 / (10 + DEF_target))` */
export function attackDamage(attack: number, targetDefense: number): number {
  return Math.max(1, (attack * 10) / (10 + targetDefense));
}

/** A pecked raider forgets the nest and turns on the hens. */
export function peck(state: GameState, floorState: FloorState, chicken: Chicken, monster: Monster, events: GameEvent[]): void {
  monster.hp -= attackDamage(chicken.attack, monster.defense);
  monster.raidNestId = null;
  chicken.attackCooldownTicks = ATTACK_INTERVAL_TICKS;
  if (monster.hp > 0) return;
  floorState.monsters.splice(floorState.monsters.indexOf(monster), 1);
  const depth = floorState.floor.depth;
  if (MONSTER_KINDS[monster.kind].spawner) {
    dropDenGold(state, floorState, monster, depth);
    floorState.denSites.push({ x: monster.home.x, y: monster.home.y });
    events.push({ type: "denDestroyed", depth });
    return;
  }
  chicken.pouchGold += monsterGold(MONSTER_KINDS[monster.kind], depth);
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

/** A den's gold lands on the den tile and its open neighbors. Piles stack on the den tile when walls crowd it. */
function dropDenGold(state: GameState, floorState: FloorState, den: Monster, depth: number): void {
  const { floor } = floorState;
  const openTiles = DEN_PILE_OFFSETS.map((offset) => ({ x: den.home.x + offset.x, y: den.home.y + offset.y })).filter((tile) =>
    isWalkable(floor, tile.y * floor.side + tile.x),
  );
  for (let pile = 0; pile < DEN_GOLD_PILES; pile++) {
    const tile = openTiles[pile] ?? den.home;
    floorState.lootPiles.push({ id: state.nextEntityId++, x: tile.x, y: tile.y, gold: goldPileAmount(depth), isFeatherPile: false });
  }
}

/** Death is permanent. The pouch drops as a Feather Pile that any chicken can carry home. Carried eggs break. */
function killChicken(state: GameState, floorState: FloorState, chicken: Chicken, killer: MonsterKindId, events: GameEvent[]): void {
  const tile = currentTile(chicken);
  floorState.lootPiles.push({ id: state.nextEntityId++, x: tile.x, y: tile.y, gold: chicken.pouchGold, isFeatherPile: true });
  events.push({ type: "chickenDied", chickenId: chicken.id, depth: floorState.floor.depth, killer, eggsLost: chicken.carriedEggs.length });
  chicken.hp = 0;
  chicken.pouchGold = 0;
  chicken.carriedEggs = [];
  chicken.activity = "dead";
  chicken.path = [];
  chicken.exploreTarget = null;
  chicken.lootTargetId = null;
  chicken.fightTargetId = null;
  chicken.nestId = null;
  chicken.buildSite = null;
  for (const monster of floorState.monsters) {
    if (monster.targetChickenId === chicken.id) monster.targetChickenId = null;
  }
}
