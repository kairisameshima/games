import assert from "node:assert/strict";
import { test } from "node:test";
import { buyBomb, buyUpgrade, createWallet, machineSettings, payoutPerWonCoin, upgradeCost } from "../src/economy.ts";

test("buying an upgrade spends its cost and raises the next price", () => {
  const wallet = createWallet();
  const firstCost = upgradeCost(wallet, "stickyPaws");
  assert.ok(firstCost !== undefined);
  wallet.bag = firstCost;
  assert.equal(buyUpgrade(wallet, "stickyPaws"), true);
  assert.equal(wallet.bag, 0);
  assert.ok((upgradeCost(wallet, "stickyPaws") ?? 0) > firstCost);
  assert.equal(payoutPerWonCoin(wallet), 1.25);
});

test("side walls reach the front edge at max level, and a maxed upgrade cannot be bought", () => {
  const wallet = createWallet();
  wallet.bag = 1_000_000;
  while (upgradeCost(wallet, "sideWalls") !== undefined) assert.equal(buyUpgrade(wallet, "sideWalls"), true);
  const bagAtMax = wallet.bag;
  assert.equal(buyUpgrade(wallet, "sideWalls"), false);
  assert.equal(wallet.bag, bagAtMax);
  assert.equal(machineSettings(wallet).sideWallEndZ, 3);
});

test("purchases without enough coins change nothing", () => {
  const wallet = createWallet();
  wallet.bag = 0;
  const before = structuredClone(wallet);
  assert.equal(buyUpgrade(wallet, "autoDropper"), false);
  assert.equal(buyBomb(wallet), false);
  assert.deepEqual(wallet, before);
});
