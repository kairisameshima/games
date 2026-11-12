import assert from "node:assert/strict";
import test from "node:test";
import { generateFloor, roomCount } from "../src/gen/floor.ts";
import { breadthFirstSearch, isWalkable, toIndex } from "../src/gen/grid.ts";

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
