import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS } from "../src/data/tools.ts";
import { createGame, galleryDigRate, MAX_OFFLINE_SECONDS, newGallery, simulateOffline, tick } from "../src/sim/game.ts";
import { liftCapacity, liftThroughput } from "../src/sim/lift.ts";
import { hireKid, openGallery, toolUpgradeCost, upgradeTool } from "../src/sim/shop.ts";
import type { GameState } from "../src/sim/types.ts";

const STEP_SECONDS = 0.05;

/** A mine whose kids have stopped digging, so only the lift changes gold. */
function idleMine(stockpiles: number[]): GameState {
  const state = createGame();
  state.galleries = stockpiles.map((stockpile) => ({ ...newGallery(), crew: 0, stockpile }));
  return state;
}

function runUntilFirstDelivery(state: GameState): void {
  for (let elapsed = 0; state.gold === 0; elapsed += STEP_SECONDS) {
    assert.ok(elapsed < 60, "lift never delivered");
    tick(state, STEP_SECONDS);
  }
}

test("one lift trip delivers at most its capacity", () => {
  const state = idleMine([1_000]);
  runUntilFirstDelivery(state);
  assert.equal(state.gold, liftCapacity(state.lift));
  assert.equal(state.galleries[0].stockpile, 1_000 - liftCapacity(state.lift));
});

test("a lift trip with room left keeps descending to deeper galleries", () => {
  const state = idleMine([10, 0, 15]);
  runUntilFirstDelivery(state);
  assert.equal(state.gold, 25);
  assert.deepEqual(
    state.galleries.map((gallery) => gallery.stockpile),
    [0, 0, 0],
  );
});

test("earnings settle at the lift throughput when kids out-dig the lift", () => {
  const state = createGame();
  state.galleries[0].crew = 500;
  const seconds = 600;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) tick(state, STEP_SECONDS);
  const expected = liftThroughput(state) * seconds;
  assert.ok(Math.abs(state.gold - expected) / expected < 0.02, `earned ${state.gold}, expected about ${expected}`);
});

test("a tool upgrade costs gold and multiplies the gallery's digging", () => {
  const state = createGame();
  const cost = toolUpgradeCost(state, 0);
  assert.ok(cost !== undefined);
  state.gold = cost;
  const before = galleryDigRate(state, 0);
  assert.equal(upgradeTool(state, 0), true);
  assert.equal(state.gold, 0);
  assert.equal(galleryDigRate(state, 0), before * TOOLS[1].digMultiplier);
});

test("purchases without enough gold change nothing", () => {
  const state = createGame();
  const before = structuredClone(state);
  assert.equal(hireKid(state, 0), false);
  assert.equal(upgradeTool(state, 0), false);
  assert.equal(openGallery(state), false);
  assert.deepEqual(state, before);
});

test("time away past the offline cap earns nothing extra", () => {
  const capped = createGame();
  const overCap = createGame();
  const cappedEarnings = simulateOffline(capped, MAX_OFFLINE_SECONDS);
  assert.ok(cappedEarnings > 0);
  assert.equal(simulateOffline(overCap, MAX_OFFLINE_SECONDS * 3), cappedEarnings);
});
