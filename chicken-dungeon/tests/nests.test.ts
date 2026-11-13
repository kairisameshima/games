import assert from "node:assert/strict";
import test from "node:test";
import { goldPileAmount } from "../src/data/bestiary.ts";
import { NEST_TIERS, nestMaxHp } from "../src/data/nests.ts";
import { isWalkable, type Point } from "../src/gen/grid.ts";
import { rectContains } from "../src/gen/population.ts";
import { tick } from "../src/sim/game.ts";
import { TICKS_PER_SECOND } from "../src/sim/time.ts";
import type { FloorState, GameEvent, GameState, Nest } from "../src/sim/types.ts";
import { createEgg, createGame, floorStateAt, spawnMonster } from "../src/sim/world.ts";

type HatchEvent = Extract<GameEvent, { type: "chickHatched" }>;

const SEED = 1234;
const MINUTE = 60 * TICKS_PER_SECOND;

function runUntil(state: GameState, limit: number, isDone: () => boolean): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < limit && !isDone(); step++) events.push(...tick(state, []));
  return events;
}

function calmFloor(state: GameState, depth: number): FloorState {
  const floorState = floorStateAt(state, depth);
  floorState.monsters = [];
  floorState.lootPiles = [];
  floorState.wandererCooldownTicks = Number.MAX_SAFE_INTEGER;
  return floorState;
}

/** An open tile beside `point`, inside `point`'s room when it has one. */
function neighborInRoom(floorState: FloorState, point: Point): Point {
  const { floor } = floorState;
  const room = floor.rooms.find((candidate) => rectContains(candidate, point));
  const neighbor = [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ].find((tile) => isWalkable(floor, tile.y * floor.side + tile.x) && (!room || rectContains(room, tile)));
  assert.ok(neighbor, `no open neighbor beside (${point.x}, ${point.y})`);
  return neighbor;
}

/** A lone hen with a Den Site beside the entrance and a Brood Quota of 1, run until she has built her nest. */
function henWithNest(nestCraftLevel = 0): { state: GameState; floorState: FloorState; nest: Nest } {
  const state = createGame(SEED, 1);
  state.upgradeLevels.nestCraft = nestCraftLevel;
  const floorState = calmFloor(state, 1);
  floorState.denSites.push(neighborInRoom(floorState, floorState.floor.stairsUp));
  tick(state, [{ type: "setBroodQuota", quota: 1 }, { type: "send" }]);
  runUntil(state, 2 * MINUTE, () => floorState.nests.length > 0);
  const [nest] = floorState.nests;
  assert.ok(nest, "the hen never built her nest");
  return { state, floorState, nest };
}

/** Releases the brooding hen and lets her wander until she is out of the nest's room and well away from it. */
function walkHenAway(state: GameState, nest: Nest): void {
  tick(state, [{ type: "setBroodQuota", quota: 0 }]);
  const hen = state.chickens[0];
  runUntil(state, 5 * MINUTE, () => Math.hypot(hen.x - nest.x, hen.y - nest.y) > 8 && Number.isInteger(hen.x) && Number.isInteger(hen.y));
  assert.ok(Math.hypot(hen.x - nest.x, hen.y - nest.y) > 8, "the hen never left the nest's surroundings");
}

test("destroying a Monster Den leaves a Den Site and five piles of gold", () => {
  const state = createGame(SEED, 1);
  const floorState = calmFloor(state, 1);
  const denTile = neighborInRoom(floorState, floorState.floor.stairsUp);
  floorState.monsters.push(spawnMonster(state, { kind: "monsterDen", ...denTile }, 1, false));
  tick(state, [{ type: "send" }]);
  const events = runUntil(state, MINUTE, () => floorState.monsters.length === 0);

  assert.ok(events.some((event) => event.type === "denDestroyed"));
  assert.deepEqual(floorState.denSites, [denTile]);
  const goldOnFloor = floorState.lootPiles.reduce((total, pile) => total + pile.gold, 0);
  assert.equal(goldOnFloor + state.chickens[0].pouchGold, 5 * goldPileAmount(1), "den gold went missing");
});

test("a brooding hen converts a Den Site, lays on her interval, and the egg hatches a chick on that floor", () => {
  const { state, floorState, nest } = henWithNest();
  const hen = state.chickens[0];
  assert.equal(hen.activity, "brood");
  assert.equal(nest.hp, nestMaxHp(NEST_TIERS[0], 1));

  const events = runUntil(state, 10 * MINUTE, () => state.chickens.some((chicken) => chicken.depth === 1 && chicken !== hen));
  const hatchedHere = events.find((event): event is HatchEvent => event.type === "chickHatched" && event.depth === 1);
  assert.ok(hatchedHere, "no chick hatched in the nest");
  const chick = state.chickens.find((chicken) => chicken.id === hatchedHere.chickenId);
  assert.ok(chick && chick.depth === 1 && chick.activity !== "home");
  assert.ok(floorState.nests.includes(nest));
});

test("eggs wait while the flock is at its cap, and Coop Expansion lets them hatch", () => {
  const state = createGame(SEED, 4);
  const [coopEgg] = state.coopEggs;
  const waitingTicks = coopEgg.incubationTicksLeft;
  runUntil(state, 2 * MINUTE, () => false);
  assert.equal(state.chickens.length, 4);
  assert.equal(coopEgg.incubationTicksLeft, waitingTicks);

  state.bankedGold = 50;
  tick(state, [{ type: "buyUpgrade", upgrade: "coopExpansion" }]);
  const events = runUntil(state, 2 * MINUTE, () => state.chickens.length === 5);
  assert.equal(state.chickens.length, 5);
  assert.ok(events.some((event) => event.type === "chickHatched" && event.depth === 0));
});

test("Recall tears camp down: brooders pack eggs into free slots, crack the rest, and carry them home to hatch", () => {
  const { state, floorState, nest } = henWithNest();
  const hen = state.chickens[0];
  nest.eggs = Array.from({ length: 5 }, () => createEgg(state, 1));
  const packedIds = nest.eggs.slice(0, hen.carry).map((egg) => egg.id);

  tick(state, [{ type: "recall" }]);
  assert.equal(hen.activity, "teardown");
  const teardownEvents = runUntil(state, 10 * TICKS_PER_SECOND, () => floorState.nests.length === 0);
  assert.deepEqual(
    teardownEvents.find((event) => event.type === "campStruck"),
    { type: "campStruck", depth: 1, eggsPacked: 3, eggsCracked: 2 },
  );
  assert.equal(state.yolkMana, 20);
  assert.deepEqual(floorState.denSites, [{ x: nest.x, y: nest.y }]);
  assert.deepEqual(hen.carriedEggs.map((egg) => egg.id), packedIds);

  const homeEvents = runUntil(state, MINUTE, () => hen.activity === "home");
  assert.ok(homeEvents.some((event) => event.type === "returnedHome" && event.eggsCarried === 3));
  for (const id of packedIds) assert.ok(state.coopEggs.some((egg) => egg.id === id), `egg ${id} never reached the coop`);
});

test("a raider claws an unguarded nest; a destroyed nest breaks its eggs and becomes a Monster Den again", () => {
  const { state, floorState, nest } = henWithNest();
  nest.eggs = [createEgg(state, 1), createEgg(state, 1)];
  walkHenAway(state, nest);
  nest.hp = 1;
  const raider = spawnMonster(state, { kind: "cellarRat", ...neighborInRoom(floorState, nest) }, 1, false);
  raider.raidNestId = nest.id;
  floorState.monsters.push(raider);

  const events = tick(state, []);
  assert.deepEqual(events.find((event) => event.type === "nestDestroyed"), { type: "nestDestroyed", depth: 1, eggsLost: 2 });
  assert.equal(floorState.nests.length, 0);
  assert.ok(floorState.monsters.some((monster) => monster.kind === "monsterDen" && monster.x === nest.x && monster.y === nest.y));
});

test("a Stone Ring halves raider damage and its thorns hurt the raider", () => {
  const { state, floorState, nest } = henWithNest(2);
  assert.equal(nest.maxHp, 200);
  walkHenAway(state, nest);
  const startHp = nest.hp;
  const raider = spawnMonster(state, { kind: "cellarRat", ...neighborInRoom(floorState, nest) }, 1, false);
  raider.raidNestId = nest.id;
  floorState.monsters.push(raider);

  tick(state, []);
  // A rat bite is max(1, 2 × 10 / 10) = 2, halved by the Stone Ring. Thorns deal 3 per second for one 1/20 s tick.
  assert.equal(nest.hp, startHp - 1);
  assert.ok(Math.abs(raider.hp - (8 - 3 / TICKS_PER_SECOND)) < 1e-9);
});

test("a floor with fewer monsters than rooms gains a wanderer every 45 s until it is full", () => {
  const state = createGame(SEED, 1);
  const floorState = floorStateAt(state, 1);
  floorState.monsters = [];
  const rooms = floorState.floor.rooms.length;
  runUntil(state, 45 * TICKS_PER_SECOND, () => false);
  assert.equal(floorState.monsters.length, 1);
  runUntil(state, (rooms + 3) * 45 * TICKS_PER_SECOND, () => false);
  assert.equal(floorState.monsters.length, rooms);
  for (const monster of floorState.monsters) assert.ok(isWalkable(floorState.floor, monster.y * floorState.floor.side + monster.x));
});

test("a Monster Den keeps at most three of its spawn alive while chickens share its floor", () => {
  const { state, floorState } = henWithNest();
  const den = spawnMonster(state, { kind: "monsterDen", ...floorState.floor.stairsDown }, 1, false);
  floorState.monsters.push(den);
  let mostAlive = 0;
  for (let step = 0; step < 4 * MINUTE; step++) {
    tick(state, []);
    mostAlive = Math.max(mostAlive, floorState.monsters.filter((monster) => monster.denId === den.id).length);
  }
  assert.equal(mostAlive, 3);
});
