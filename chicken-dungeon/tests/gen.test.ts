import assert from "node:assert/strict";
import test from "node:test";
import { MONSTER_KINDS, goldPileAmount } from "../src/data/bestiary.ts";
import { generateFloor, roomCount, type Rect } from "../src/gen/floor.ts";
import { breadthFirstSearch, isWalkable, toIndex, type Point } from "../src/gen/grid.ts";
import { populateFloor } from "../src/gen/population.ts";

const SEEDS = [1, 42, 0xdeadbeef];
const DEPTHS = Array.from({ length: 50 }, (_, index) => index + 1);

test("the same seed and depth rebuild the same floor", () => {
  const first = generateFloor(42, 7);
  const second = generateFloor(42, 7);
  assert.deepEqual(second.tiles, first.tiles);
  assert.deepEqual(second.stairsUp, first.stairsUp);
  assert.deepEqual(second.stairsDown, first.stairsDown);
});

test("different seeds produce different layouts", () => {
  assert.notDeepEqual(generateFloor(1, 3).tiles, generateFloor(2, 3).tiles);
});

test("every walkable tile is reachable from stairs up, so no room is sealed off", () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const floor = generateFloor(seed, depth);
      const search = breadthFirstSearch(floor, [floor.stairsUp], (index) => isWalkable(floor, index));
      for (let index = 0; index < floor.tiles.length; index++) {
        if (isWalkable(floor, index)) assert.ok(search.distance[index] >= 0, `seed ${seed} B${depth}: tile ${index} is sealed off`);
      }
      assert.ok(search.distance[toIndex(floor.side, floor.stairsDown)] > 0, `seed ${seed} B${depth}: stairs down sit on stairs up`);
    }
  }
});

test("room count follows rooms(d) = min(30, 6 + floor(d / 2))", () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) assert.equal(generateFloor(seed, depth).rooms.length, roomCount(depth), `seed ${seed} B${depth}`);
  }
});

function roomOf(rooms: readonly Rect[], point: Point): Rect | undefined {
  return rooms.find((room) => point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height);
}

test("population keeps the entrance room free of monsters and the stairs clear", () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const floor = generateFloor(seed, depth);
      const { monsters, goldPiles } = populateFloor(seed, floor);
      const entranceRoom = roomOf(floor.rooms, floor.stairsUp);
      for (const spawn of [...monsters, ...goldPiles]) {
        assert.ok(isWalkable(floor, toIndex(floor.side, spawn)), `seed ${seed} B${depth}: spawn inside a wall`);
        assert.notDeepEqual({ x: spawn.x, y: spawn.y }, floor.stairsUp);
        assert.notDeepEqual({ x: spawn.x, y: spawn.y }, floor.stairsDown);
      }
      for (const monster of monsters) assert.notEqual(roomOf(floor.rooms, monster), entranceRoom, `seed ${seed} B${depth}: monster in the entrance room`);
    }
  }
});

test("each room holds at most 1 + floor(d / 6) + 1 monster spawns and at most 2 gold piles worth gold_pile(d)", () => {
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const floor = generateFloor(seed, depth);
      const { monsters, goldPiles } = populateFloor(seed, floor);
      for (const room of floor.rooms) {
        const packsInRoom = monsters
          .filter((monster) => roomOf(floor.rooms, monster) === room)
          .reduce((packs, monster) => packs + 1 / MONSTER_KINDS[monster.kind].packSize, 0);
        assert.ok(Math.round(packsInRoom) <= 2 + Math.floor(depth / 6), `seed ${seed} B${depth}: ${packsInRoom} spawns in one room`);
        assert.ok(goldPiles.filter((pile) => roomOf(floor.rooms, pile) === room).length <= 2);
      }
      for (const pile of goldPiles) assert.equal(pile.gold, goldPileAmount(depth));
    }
  }
});
