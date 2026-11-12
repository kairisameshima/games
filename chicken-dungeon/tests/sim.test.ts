import assert from "node:assert/strict";
import test from "node:test";
import { exploredTileCount } from "../src/sim/explore.ts";
import { createGame, floorStateAt, tick, TICKS_PER_SECOND, type GameEvent, type GameState } from "../src/sim/game.ts";

const SEED = 1234;
const TEN_MINUTES = 10 * 60 * TICKS_PER_SECOND;

function sendFlock(state: GameState): void {
  tick(state, [{ type: "send" }]);
}

function runTicks(state: GameState, count: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < count; step++) events.push(...tick(state, []));
  return events;
}

function runUntil(state: GameState, limit: number, isDone: () => boolean): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < limit && !isDone(); step++) events.push(...tick(state, []));
  return events;
}

test("the same seed and commands replay to the same state", () => {
  const first = createGame(SEED, 3);
  const second = createGame(SEED, 3);
  sendFlock(first);
  sendFlock(second);
  runTicks(first, 3000);
  runTicks(second, 3000);
  assert.deepEqual(second.chickens, first.chickens);
  assert.equal(exploredTileCount(floorStateAt(second, 1)), exploredTileCount(floorStateAt(first, 1)));
});

test("a lone hen explores floor 1 and takes the stairs down", () => {
  const state = createGame(SEED, 1);
  sendFlock(state);
  const events = runUntil(state, TEN_MINUTES, () => state.deepestDepth >= 2);
  assert.equal(state.chickens[0].depth, 2);
  assert.deepEqual(events.at(-1), { type: "reachedFloor", chickenId: 0, depth: 2 });
});

function ticksToFinishFloorOne(flockSize: number, seed: number): number {
  const state = createGame(seed, flockSize);
  sendFlock(state);
  const finished = () => state.chickens.some((chicken) => chicken.activity === "descend" || chicken.depth > 1);
  runUntil(state, TEN_MINUTES, finished);
  assert.ok(finished(), `seed ${seed}: a flock of ${flockSize} never finished floor 1`);
  return state.tick;
}

test("a fanned-out flock of three finishes exploring floor 1 well before a lone hen", () => {
  for (const seed of [SEED, 7, 99]) {
    const soloTicks = ticksToFinishFloorOne(1, seed);
    const flockTicks = ticksToFinishFloorOne(3, seed);
    assert.ok(flockTicks < soloTicks * 0.7, `seed ${seed}: flock took ${flockTicks} ticks, lone hen ${soloTicks}`);
  }
});

test("recall brings every chicken home from below floor 1", () => {
  const state = createGame(SEED, 3);
  sendFlock(state);
  runUntil(state, TEN_MINUTES, () => state.deepestDepth >= 2);
  assert.equal(state.deepestDepth, 2, "the flock never reached floor 2");

  tick(state, [{ type: "recall" }]);
  assert.ok(state.chickens.every((chicken) => chicken.activity === "recalled"));
  const events = runUntil(state, TEN_MINUTES, () => state.chickens.every((chicken) => chicken.activity === "home"));

  assert.ok(state.chickens.every((chicken) => chicken.activity === "home" && chicken.depth === 0));
  const returnedIds = events.filter((event) => event.type === "returnedHome").map((event) => event.chickenId);
  assert.deepEqual(returnedIds.sort(), [0, 1, 2]);
});

test("a recalled flock can be sent again and resumes exploring floor 1", () => {
  const state = createGame(SEED, 1);
  sendFlock(state);
  runTicks(state, 30 * TICKS_PER_SECOND);
  const exploredBeforeRecall = exploredTileCount(floorStateAt(state, 1));
  tick(state, [{ type: "recall" }]);
  runUntil(state, TEN_MINUTES, () => state.chickens[0].activity === "home");

  sendFlock(state);
  runTicks(state, 30 * TICKS_PER_SECOND);
  assert.notEqual(state.chickens[0].activity, "home");
  assert.ok(exploredTileCount(floorStateAt(state, 1)) > exploredBeforeRecall);
});
