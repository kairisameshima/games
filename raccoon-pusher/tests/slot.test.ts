import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SPIN_STOCK, PAIR_PAYOUT, payoutFor, REEL_STOP_SECONDS, SLOT_SYMBOLS, SlotReels } from "../src/slot.ts";

const RACCOON = SLOT_SYMBOLS.findIndex((symbol) => symbol.glyph === "🦝");
const CHERRY = SLOT_SYMBOLS.findIndex((symbol) => symbol.glyph === "🍒");
const BELL = SLOT_SYMBOLS.findIndex((symbol) => symbol.glyph === "🔔");
const STEP_SECONDS = 1 / 60;

/** A random source that always lands on the given symbol. */
function alwaysRoll(symbol: number): () => number {
  const totalWeight = SLOT_SYMBOLS.reduce((sum, entry) => sum + entry.weight, 0);
  const weightBefore = SLOT_SYMBOLS.slice(0, symbol).reduce((sum, entry) => sum + entry.weight, 0);
  return () => (weightBefore + 0.5) / totalWeight;
}

function runUntilSpinEnds(slot: SlotReels, random: () => number) {
  for (let elapsed = 0; elapsed < 10; elapsed += STEP_SECONDS) {
    const result = slot.update(STEP_SECONDS, random);
    if (result) return result;
  }
  assert.fail("spin never finished");
}

test("three of a kind pays that symbol's triplet payout", () => {
  assert.equal(payoutFor([RACCOON, RACCOON, RACCOON]), SLOT_SYMBOLS[RACCOON].tripletPayout);
});

test("a pair on the first two reels pays the pair payout; other mixes pay nothing", () => {
  assert.equal(payoutFor([CHERRY, CHERRY, BELL]), PAIR_PAYOUT);
  assert.equal(payoutFor([CHERRY, BELL, CHERRY]), 0);
});

test("a spin reveals its result only after the last reel stops", () => {
  const slot = new SlotReels();
  slot.addStock(1);
  const result = runUntilSpinEnds(slot, alwaysRoll(RACCOON));
  assert.deepEqual(result, { reels: [RACCOON, RACCOON, RACCOON], payout: SLOT_SYMBOLS[RACCOON].tripletPayout });
  assert.equal(slot.stock, 0);
});

test("reels stop left to right", () => {
  const slot = new SlotReels();
  slot.addStock(1);
  slot.update(STEP_SECONDS, alwaysRoll(BELL));
  let elapsed = 0;
  while (elapsed < REEL_STOP_SECONDS[0] + STEP_SECONDS) {
    slot.update(STEP_SECONDS, alwaysRoll(BELL));
    elapsed += STEP_SECONDS;
  }
  assert.equal(slot.isReelSpinning(0), false);
  assert.equal(slot.isReelSpinning(2), true);
});

test("gate hits past the stock limit are lost", () => {
  const slot = new SlotReels();
  slot.addStock(MAX_SPIN_STOCK + 3);
  assert.equal(slot.stock, MAX_SPIN_STOCK);
});
