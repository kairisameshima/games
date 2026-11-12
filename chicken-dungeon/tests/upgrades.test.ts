import assert from "node:assert/strict";
import test from "node:test";
import type { UpgradeId } from "../src/data/upgrades.ts";
import { exploredTileCount } from "../src/sim/explore.ts";
import { tick } from "../src/sim/game.ts";
import type { GameEvent, GameState } from "../src/sim/types.ts";
import { createGame, floorStateAt } from "../src/sim/world.ts";

const SEED = 1234;

function buy(state: GameState, upgrade: UpgradeId, times = 1): GameEvent[] {
  const events: GameEvent[] = [];
  for (let purchase = 0; purchase < times; purchase++) events.push(...tick(state, [{ type: "buyUpgrade", upgrade }]));
  return events;
}

test("each purchase costs round(base × growth^level), so Sharper Beaks runs 10, 12, 13 gold", () => {
  const state = createGame(SEED, 1);
  state.bankedGold = 100;
  buy(state, "sharperBeaks", 3);
  assert.equal(state.bankedGold, 100 - 10 - 12 - 13);
  assert.equal(state.upgradeLevels.sharperBeaks, 3);
  assert.equal(state.chickens[0].attack, 5 * 1.1 ** 3);
});

test("a purchase without enough gold, or past the max level, changes nothing", () => {
  const poor = createGame(SEED, 1);
  poor.bankedGold = 9;
  assert.deepEqual(buy(poor, "sharperBeaks"), []);
  assert.equal(poor.bankedGold, 9);
  assert.equal(poor.upgradeLevels.sharperBeaks, 0);

  const rich = createGame(SEED, 1);
  rich.bankedGold = 1_000_000;
  const events = buy(rich, "lanternOil", 6);
  assert.equal(rich.upgradeLevels.lanternOil, 5);
  assert.equal(events.length, 5);
  const goldAfterMax = rich.bankedGold;
  buy(rich, "lanternOil");
  assert.equal(rich.bankedGold, goldAfterMax);
});

test("Thicker Feathers raises max HP and a hurt hen keeps the same missing HP", () => {
  const state = createGame(SEED, 1);
  const hen = state.chickens[0];
  state.bankedGold = 10;
  hen.hp = 20;
  tick(state, [{ type: "buyUpgrade", upgrade: "thickerFeathers" }]);
  assert.ok(Math.abs(hen.maxHp - 33) < 1e-9);
  // One tick of coop rest also ran: 2% of max HP per second over one 1/20 s tick.
  assert.ok(Math.abs(hen.hp - (23 + 33 * 0.02 / 20)) < 1e-9);
});

test("Brave Heart lowers the flee threshold 2 points a level and stops at 10%", () => {
  const state = createGame(SEED, 1);
  state.bankedGold = 1_000_000;
  buy(state, "braveHeart", 12);
  assert.equal(state.upgradeLevels.braveHeart, 10);
  assert.equal(state.chickens[0].courage, 0.1);
});

test("Lantern Oil lets a hen see more of the floor from the same spot", () => {
  const exploredOnArrival = (lanternLevels: number): number => {
    const state = createGame(SEED, 1);
    state.bankedGold = 1_000_000;
    buy(state, "lanternOil", lanternLevels);
    tick(state, [{ type: "send" }]);
    return exploredTileCount(floorStateAt(state, 1));
  };
  assert.ok(exploredOnArrival(2) > exploredOnArrival(0));
});
