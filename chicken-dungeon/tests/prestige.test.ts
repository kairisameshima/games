import assert from "node:assert/strict";
import test from "node:test";
import { goldenYolksEarned } from "../src/data/ancestry.ts";
import { parseSave, serializeGame } from "../src/save/format.ts";
import { tick } from "../src/sim/game.ts";
import { offlineGold } from "../src/sim/offline.ts";
import { startNextRun } from "../src/sim/prestige.ts";
import { TICKS_PER_SECOND } from "../src/sim/time.ts";
import type { GameEvent, GameState } from "../src/sim/types.ts";
import { createGame, floorStateAt } from "../src/sim/world.ts";

const SEED = 1234;
const MINUTE = 60 * TICKS_PER_SECOND;

function runUntil(state: GameState, limit: number, isDone: () => boolean): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < limit && !isDone(); step++) events.push(...tick(state, []));
  return events;
}

function calmFloorOne(state: GameState): void {
  const floorState = floorStateAt(state, 1);
  floorState.monsters = [];
  floorState.lootPiles = [];
  floorState.wandererCooldownTicks = Number.MAX_SAFE_INTEGER;
}

test("Golden Yolks match the bible's worked examples", () => {
  assert.equal(goldenYolksEarned(10, 5_000, 1), 12);
  assert.equal(goldenYolksEarned(20, 100_000, 2), 27);
  assert.equal(goldenYolksEarned(30, 2_000_000, 3), 44);
  assert.equal(goldenYolksEarned(50, 500_000_000, 5), 86);
});

test("extinction waits for the last egg, then the Rite pays out and the world holds still", () => {
  const state = createGame(SEED, 1);
  state.deepestDepth = 7;
  state.totalGoldBanked = 900;
  state.chickens[0].activity = "dead";
  tick(state, []);
  assert.equal(state.rite, null, "an egg at the coop keeps the run alive");

  state.coopEggs = [];
  tick(state, []);
  assert.deepEqual(state.rite, { trigger: "extinction", deepestDepth: 7, goldBanked: 900, goldenYolksEarned: goldenYolksEarned(7, 900, 0) });
  const frozenTick = state.tick;
  tick(state, [{ type: "send" }]);
  assert.equal(state.tick, frozenTick);
});

test("voluntary prestige opens only once a chicken has reached floor 10", () => {
  const state = createGame(SEED, 1);
  state.deepestDepth = 9;
  tick(state, [{ type: "performRite" }]);
  assert.equal(state.rite, null);
  state.deepestDepth = 10;
  tick(state, [{ type: "performRite" }]);
  assert.deepEqual(state.rite, { trigger: "voluntary", deepestDepth: 10, goldBanked: 0, goldenYolksEarned: goldenYolksEarned(10, 0, 0) });
});

test("the next run keeps the legacy and applies Second Hen, Inheritance, Ancestral Nest, and Bloodline", () => {
  const state = createGame(SEED, 1);
  state.legacy.ancestralRanks = { secondHen: 2, inheritance: 2, ancestralNest: 1, dinnerBell: 0, longNight: 0 };
  state.legacy.rollOfFeathers.push({ run: 1, name: "Henrietta", depth: 3, killer: "cellarRat" });
  state.bankedGold = 5_000;
  state.upgradeLevels.sharperBeaks = 4;
  floorStateAt(state, 1);
  state.rite = { trigger: "voluntary", deepestDepth: 12, goldBanked: 5_000, goldenYolksEarned: 20 };

  const next = startNextRun(state);
  assert.notEqual(next.seed, state.seed);
  assert.equal(next.legacy.run, 2);
  assert.equal(next.legacy.goldenYolks, 20);
  assert.equal(next.legacy.lifetimeGoldenYolks, 20);
  assert.equal(next.legacy.rollOfFeathers.length, 1);
  assert.equal(next.rite, null);
  assert.equal(next.floors.size, 0);
  assert.equal(next.chickens.length, 3, "one hen plus two Second Hen ranks");
  assert.equal(next.bankedGold, 400, "Inheritance rank 2 starts with 100 × 4");
  assert.equal(next.upgradeLevels.nestCraft, 1);
  assert.equal(next.upgradeLevels.sharperBeaks, 0);
  // Bloodline: 1 + 0.02 × 20 lifetime yolks = 1.4 on HP and ATK.
  assert.ok(Math.abs(next.chickens[0].maxHp - 30 * 1.4) < 1e-9);
  assert.ok(Math.abs(next.chickens[0].attack - 5 * 1.4) < 1e-9);
});

test("ancestral nodes cost base × 2^rank in Golden Yolks, stop at max rank, and can be bought on the Rite screen", () => {
  const state = createGame(SEED, 1);
  state.legacy.goldenYolks = 100;
  state.rite = { trigger: "extinction", deepestDepth: 1, goldBanked: 0, goldenYolksEarned: 0 };
  for (let purchase = 0; purchase < 4; purchase++) tick(state, [{ type: "buyAncestralNode", node: "secondHen" }]);
  assert.equal(state.legacy.ancestralRanks.secondHen, 3);
  assert.equal(state.legacy.goldenYolks, 100 - 3 - 6 - 12);
});

test("the Dinner Bell recalls the flock once its pouches reach the gold rule, and does nothing while locked", () => {
  const ringsAt = (dinnerBellRank: number): GameEvent[] => {
    const state = createGame(SEED, 1);
    calmFloorOne(state);
    state.legacy.ancestralRanks.dinnerBell = dinnerBellRank;
    tick(state, [{ type: "setAutoRecall", rules: { everyMinutes: null, pouchGold: 30, flockHpPercent: null } }, { type: "send" }]);
    state.chickens[0].pouchGold = 29;
    const quiet = runUntil(state, 5, () => false);
    state.chickens[0].pouchGold = 30;
    return [...quiet, ...runUntil(state, 5, () => false)];
  };
  assert.deepEqual(ringsAt(1).filter((event) => event.type === "autoRecalled"), [{ type: "autoRecalled" }]);
  assert.deepEqual(ringsAt(0).filter((event) => event.type === "autoRecalled"), []);
});

test("Long Night stretches the offline cap by 4 hours a rank", () => {
  const state = createGame(SEED, 1);
  state.tick = 20 * MINUTE;
  state.bankLog = [{ tick: state.tick - MINUTE, gold: 600 }];
  const tenHours = 10 * 60;
  assert.equal(offlineGold(state, tenHours), offlineGold(state, 8 * 60));
  state.legacy.ancestralRanks.longNight = 1;
  assert.equal(offlineGold(state, tenHours), 0.5 * 60 * tenHours);
});

test("Bloodline multiplies the gold a returning hen banks", () => {
  const state = createGame(SEED, 1);
  calmFloorOne(state);
  state.legacy.lifetimeGoldenYolks = 50;
  tick(state, [{ type: "send" }]);
  state.chickens[0].pouchGold = 10;
  tick(state, [{ type: "recall" }]);
  const events = runUntil(state, MINUTE, () => state.chickens[0].activity === "home");
  assert.ok(events.some((event) => event.type === "returnedHome" && event.goldBanked === 20));
  assert.equal(state.bankedGold, 20);
});

test("a save made on the Rite screen restores the legacy and the waiting Rite", () => {
  const state = createGame(SEED, 1);
  state.legacy.goldenYolks = 7;
  state.legacy.ancestralRanks.dinnerBell = 1;
  state.legacy.autoRecall = { everyMinutes: 5, pouchGold: null, flockHpPercent: 40 };
  state.legacy.rollOfFeathers.push({ run: 1, name: "Pip", depth: 2, killer: "cellarSpider" });
  state.rite = { trigger: "extinction", deepestDepth: 2, goldBanked: 33, goldenYolksEarned: 2 };
  const loaded = parseSave(serializeGame(state, 0)).state;
  assert.deepEqual(loaded.legacy, state.legacy);
  assert.deepEqual(loaded.rite, state.rite);
});
