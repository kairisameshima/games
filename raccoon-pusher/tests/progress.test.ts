import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createWallet, MAX_OFFLINE_SECONDS, offlineEarnings, payoutPerWonCoin } from "../src/economy.ts";
import { createGameState, moveToNextMachine } from "../src/game-state.ts";
import { rollLoot } from "../src/loot.ts";
import { loadGame, SaveFormatError, storeGame } from "../src/save.ts";

/** In-memory localStorage, so save code runs under Node. */
class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

test("moving to the next machine resets the wallet, keeps loot and raises the payout bonus", () => {
  const state = createGameState();
  state.wallet.bag = 5_000;
  state.wallet.upgrades.stickyPaws = 4;
  state.loot.push("geode");
  state.prizeWon = true;
  moveToNextMachine(state);
  assert.deepEqual(state.wallet, createWallet());
  assert.deepEqual(state.loot, ["geode"]);
  assert.equal(state.prizeWon, false);
  assert.equal(payoutPerWonCoin(state.wallet, state.machinesBeaten), 1.5);
});

test("the raccoon cannot move on before the prize falls", () => {
  assert.throws(() => moveToNextMachine(createGameState()));
});

test("offline earnings need an Auto-Dropper, never go negative, and stop at the cap", () => {
  const wallet = createWallet();
  assert.equal(offlineEarnings(wallet, 0, 3_600), 0);
  wallet.upgrades.autoDropper = 1;
  // Bare side walls return 0.65 per coin: a losing machine earns nothing instead of draining the bag.
  assert.equal(offlineEarnings(wallet, 0, 3_600), 0);
  wallet.upgrades.sideWalls = 3;
  wallet.upgrades.stickyPaws = 2;
  const capped = offlineEarnings(wallet, 0, MAX_OFFLINE_SECONDS);
  assert.ok(capped > 0);
  assert.equal(offlineEarnings(wallet, 0, MAX_OFFLINE_SECONDS * 4), capped);
});

test("loot rewards follow their tables and grow with machines beaten", () => {
  assert.equal(rollLoot("geode", 0, () => 0).coins, 3);
  assert.equal(rollLoot("geode", 0, () => 0.95).coins, 120);
  assert.equal(rollLoot("geode", 2, () => 0.95).coins, 360);
  assert.equal(rollLoot("piggy", 0, () => 0).coins, 8);
  assert.equal(rollLoot("piggy", 0, () => 0.999).coins, 30);
  const capsule = rollLoot("capsule", 3, () => 0.999);
  assert.deepEqual([capsule.coins, capsule.bombs], [0, 3]);
});

test("a stored game loads back unchanged", () => {
  const state = createGameState();
  state.wallet.upgrades.sideWalls = 2;
  state.loot.push("piggy", "capsule");
  state.machinesBeaten = 3;
  storeGame(state, 1_000);
  assert.deepEqual(loadGame(), { state, savedAt: 1_000 });
});

test("saves with impossible upgrade levels or unknown loot are rejected", () => {
  const state = createGameState();
  state.wallet.upgrades.sideWalls = 9;
  storeGame(state, 1_000);
  assert.throws(() => loadGame(), SaveFormatError);

  const withBadLoot = JSON.parse(JSON.stringify({ version: 1, savedAt: 1, state: createGameState() }));
  withBadLoot.state.loot = ["golden goose"];
  localStorage.setItem("raccoon-pusher/save", JSON.stringify(withBadLoot));
  assert.throws(() => loadGame(), SaveFormatError);
});
