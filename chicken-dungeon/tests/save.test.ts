import assert from "node:assert/strict";
import test from "node:test";
import { parseSave, SAVE_VERSION, SaveFormatError, serializeGame } from "../src/save/format.ts";
import { exploredTileCount } from "../src/sim/explore.ts";
import { tick } from "../src/sim/game.ts";
import { offlineGold } from "../src/sim/offline.ts";
import { TICKS_PER_SECOND } from "../src/sim/time.ts";
import type { Command, GameState } from "../src/sim/types.ts";
import { createGame } from "../src/sim/world.ts";

const SEED = 1234;
const MINUTE = 60 * TICKS_PER_SECOND;

function play(state: GameState, ticks: number, commandsAt: ReadonlyMap<number, Command>): void {
  for (let step = 0; step < ticks; step++) {
    const command = commandsAt.get(state.tick + 1);
    tick(state, command ? [command] : []);
  }
}

function playedGame(): GameState {
  const state = createGame(SEED, 3);
  tick(state, [{ type: "send" }]);
  play(state, 3000, new Map());
  return state;
}

test("a saved run, once loaded, plays on exactly like the run that was never saved", () => {
  const original = playedGame();
  const loaded = parseSave(serializeGame(original, 1_000)).state;
  const recallSoon = new Map<number, Command>([[original.tick + 400, { type: "recall" }]]);
  play(original, 2400, recallSoon);
  play(loaded, 2400, recallSoon);

  assert.deepEqual(loaded.chickens, original.chickens);
  assert.equal(loaded.bankedGold, original.bankedGold);
  assert.deepEqual(loaded.bankLog, original.bankLog);
  assert.deepEqual([...loaded.floors.keys()], [...original.floors.keys()]);
  for (const [depth, floorState] of original.floors) {
    const loadedFloor = loaded.floors.get(depth);
    assert.ok(loadedFloor);
    assert.deepEqual(loadedFloor.monsters, floorState.monsters);
    assert.deepEqual(loadedFloor.lootPiles, floorState.lootPiles);
    assert.equal(exploredTileCount(loadedFloor), exploredTileCount(floorState));
  }
});

test("the save keeps the wall-clock time it was written", () => {
  assert.equal(parseSave(serializeGame(playedGame(), 1_700_000_000_000)).savedAt, 1_700_000_000_000);
});

test("offline gold pays 50% of the last 10 minutes' banking rate per minute away", () => {
  const state = createGame(SEED, 1);
  state.tick = 20 * MINUTE;
  state.bankLog = [
    { tick: state.tick - 15 * MINUTE, gold: 999 },
    { tick: state.tick - 5 * MINUTE, gold: 400 },
    { tick: state.tick - 1 * MINUTE, gold: 200 },
  ];
  // 600 gold in the window → 60 per minute → half of that for 30 minutes.
  assert.equal(offlineGold(state, 30), 900);
  assert.equal(offlineGold(state, 24 * 60), offlineGold(state, 8 * 60), "time away is capped at 8 hours");
  assert.equal(offlineGold(state, 8 * 60), 14_400);
  assert.equal(offlineGold(state, -5), 0, "a clock set backward pays nothing");
});

/** Corrupts a save of a just-sent flock, whose floor 1 still holds every starting monster. */
function rewriteSave(edit: (file: { version: number; game: Record<string, unknown> }) => void): string {
  const state = createGame(SEED, 3);
  tick(state, [{ type: "send" }]);
  const file = JSON.parse(serializeGame(state, 0));
  edit(file);
  return JSON.stringify(file);
}

test("unreadable saves are rejected with SaveFormatError instead of loading half a run", () => {
  const firstFloor = (file: { game: Record<string, unknown> }) => (file.game.floors as Record<string, unknown>[])[0];
  const brokenSaves: Record<string, string> = {
    "not JSON": "{ chickens: ",
    "newer version": rewriteSave((file) => (file.version = SAVE_VERSION + 1)),
    "missing chickens": rewriteSave((file) => delete file.game.chickens),
    "unknown monster": rewriteSave((file) => ((firstFloor(file).monsters as Record<string, unknown>[])[0].kind = "dragon")),
    "short explored map": rewriteSave((file) => (firstFloor(file).explored = "AAAA")),
    "unknown activity": rewriteSave((file) => ((file.game.chickens as Record<string, unknown>[])[0].activity = "napping")),
  };
  for (const [problem, text] of Object.entries(brokenSaves)) {
    assert.throws(() => parseSave(text), SaveFormatError, problem);
  }
});
