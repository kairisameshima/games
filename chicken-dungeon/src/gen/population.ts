import { goldPileAmount, MONSTER_KINDS, ROOT_CELLAR_POOL, type MonsterKindId } from "../data/bestiary.ts";
import { createRng, mixSeed, nextInt, rollChance, type Rng } from "../rng.ts";
import type { Floor, Rect } from "./floor.ts";
import type { Point } from "./grid.ts";

export interface MonsterSpawn {
  kind: MonsterKindId;
  x: number;
  y: number;
}

export interface GoldSpawn {
  x: number;
  y: number;
  gold: number;
}

export interface FloorPopulation {
  monsters: MonsterSpawn[];
  goldPiles: GoldSpawn[];
}

// Keeps population rolls independent of layout rolls, so tuning one never reshuffles the other.
const POPULATION_SALT = 0x51ed;
const FLOORS_PER_EXTRA_SPAWN = 6;
const MAX_GOLD_PILES_PER_ROOM = 2;
const DEN_CHANCE_PER_ROOM = 0.08;

/**
 * Places monsters with `monsters_per_room(d) = 1 + floor(d / 6) + random_int(-1, 1)` and 0 to 2 gold piles per room.
 * The stairs-up room gets no monsters, so chickens never arrive into a fight.
 * Each other room has an 8% chance of a Monster Den, and every floor gets at least one, so the flock can always nest.
 */
export function populateFloor(runSeed: number, floor: Floor): FloorPopulation {
  const rng = createRng(mixSeed(mixSeed(runSeed, floor.depth), POPULATION_SALT));
  const monsters: MonsterSpawn[] = [];
  const goldPiles: GoldSpawn[] = [];
  for (const room of floor.rooms) {
    if (!rectContains(room, floor.stairsUp)) {
      const spawnCount = Math.max(0, 1 + Math.floor(floor.depth / FLOORS_PER_EXTRA_SPAWN) + nextInt(rng, -1, 1));
      for (let spawn = 0; spawn < spawnCount; spawn++) {
        const kind = ROOT_CELLAR_POOL[nextInt(rng, 0, ROOT_CELLAR_POOL.length - 1)];
        for (let member = 0; member < MONSTER_KINDS[kind].packSize; member++) {
          monsters.push({ kind, ...randomOpenTile(rng, room, floor) });
        }
      }
    }
    const pileCount = nextInt(rng, 0, MAX_GOLD_PILES_PER_ROOM);
    for (let pile = 0; pile < pileCount; pile++) goldPiles.push({ ...randomOpenTile(rng, room, floor), gold: goldPileAmount(floor.depth) });
  }

  const denRooms = floor.rooms.filter((room) => !rectContains(room, floor.stairsUp));
  const rolledDenRooms = denRooms.filter(() => rollChance(rng, DEN_CHANCE_PER_ROOM));
  const chosenDenRooms = rolledDenRooms.length > 0 ? rolledDenRooms : [denRooms[nextInt(rng, 0, denRooms.length - 1)]];
  for (const room of chosenDenRooms) monsters.push({ kind: "monsterDen", ...randomOpenTile(rng, room, floor) });
  return { monsters, goldPiles };
}

export function rectContains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function randomOpenTile(rng: Rng, room: Rect, floor: Floor): Point {
  for (;;) {
    const tile = { x: nextInt(rng, room.x, room.x + room.width - 1), y: nextInt(rng, room.y, room.y + room.height - 1) };
    const onStairs = (tile.x === floor.stairsUp.x && tile.y === floor.stairsUp.y) || (tile.x === floor.stairsDown.x && tile.y === floor.stairsDown.y);
    if (!onStairs) return tile;
  }
}
