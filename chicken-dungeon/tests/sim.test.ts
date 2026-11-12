import assert from "node:assert/strict";
import test from "node:test";
import { MONSTER_KINDS, monsterAttack, monsterGold } from "../src/data/bestiary.ts";
import { exploredTileCount } from "../src/sim/explore.ts";
import { tick } from "../src/sim/game.ts";
import { TICKS_PER_SECOND } from "../src/sim/time.ts";
import type { Chicken, GameEvent, GameState } from "../src/sim/types.ts";
import { createGame, floorStateAt, spawnMonster } from "../src/sim/world.ts";

const SEED = 1234;
const TEN_MINUTES = 10 * 60 * TICKS_PER_SECOND;

function sendFlock(state: GameState): GameEvent[] {
  return tick(state, [{ type: "send" }]);
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

function clearMonsters(state: GameState, depths: readonly number[]): void {
  for (const depth of depths) floorStateAt(state, depth).monsters = [];
}

/** Lets a chicken explore a monster-free floor 1 until it is well away from the stairs, so fleeing takes real walking. */
function walkAwayFromEntrance(state: GameState, chicken: Chicken): void {
  const entrance = floorStateAt(state, 1).floor.stairsUp;
  runUntil(state, TEN_MINUTES, () => Math.abs(chicken.x - entrance.x) + Math.abs(chicken.y - entrance.y) >= 6 && Number.isInteger(chicken.x) && Number.isInteger(chicken.y));
}

test("the same seed and commands replay to the same state, monsters and gold included", () => {
  const first = createGame(SEED, 3);
  const second = createGame(SEED, 3);
  sendFlock(first);
  sendFlock(second);
  runTicks(first, 3000);
  runTicks(second, 3000);
  assert.deepEqual(second.chickens, first.chickens);
  assert.deepEqual(floorStateAt(second, 1).monsters, floorStateAt(first, 1).monsters);
  assert.deepEqual(floorStateAt(second, 1).lootPiles, floorStateAt(first, 1).lootPiles);
});

test("a lone hen on a monster-free floor picks up every gold pile before taking the stairs down", () => {
  const state = createGame(SEED, 1);
  clearMonsters(state, [1, 2]);
  const floorGold = floorStateAt(state, 1).lootPiles.reduce((total, pile) => total + pile.gold, 0);
  assert.ok(floorGold > 0, "seed has no gold on floor 1");
  sendFlock(state);
  const events = runUntil(state, TEN_MINUTES, () => state.deepestDepth >= 2);
  assert.deepEqual(events.at(-1), { type: "reachedFloor", chickenId: 0, depth: 2 });
  assert.equal(state.chickens[0].pouchGold, floorGold);
  assert.equal(floorStateAt(state, 1).lootPiles.length, 0);
});

function ticksToFinishFloorOne(flockSize: number, seed: number): number {
  const state = createGame(seed, flockSize);
  clearMonsters(state, [1]);
  // Gold detours add noise. This test is about how fast the flock uncovers the floor.
  floorStateAt(state, 1).lootPiles = [];
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

test("gold stays in pouches until Recall brings the flock home from floor 2, then all of it is banked", () => {
  const state = createGame(SEED, 3);
  clearMonsters(state, [1, 2]);
  sendFlock(state);
  runUntil(state, TEN_MINUTES, () => state.deepestDepth >= 2);
  assert.equal(state.deepestDepth, 2, "the flock never reached floor 2");
  const carriedAtRecall = state.chickens.reduce((total, chicken) => total + chicken.pouchGold, 0);
  assert.ok(carriedAtRecall > 0);
  assert.equal(state.bankedGold, 0);

  tick(state, [{ type: "recall" }]);
  assert.ok(state.chickens.every((chicken) => chicken.activity === "recalled"));
  const events = runUntil(state, TEN_MINUTES, () => state.chickens.every((chicken) => chicken.activity === "home"));

  assert.ok(state.chickens.every((chicken) => chicken.activity === "home" && chicken.depth === 0 && chicken.pouchGold === 0));
  const homecomings = events.filter((event) => event.type === "returnedHome");
  assert.deepEqual(homecomings.map((event) => event.chickenId).sort(), [0, 1, 2]);
  assert.equal(homecomings.reduce((total, event) => total + event.goldBanked, 0), state.bankedGold);
  assert.ok(state.bankedGold >= carriedAtRecall);
});

test("a recalled flock can be sent again and resumes exploring floor 1", () => {
  const state = createGame(SEED, 1);
  clearMonsters(state, [1]);
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

test("a hen kills a cellar rat beside the entrance and pockets its gold, unbanked", () => {
  const state = createGame(SEED, 1);
  const floorState = floorStateAt(state, 1);
  floorState.monsters = [];
  floorState.lootPiles = [];
  const entrance = floorState.floor.stairsUp;
  const neighbor = [
    { x: entrance.x + 1, y: entrance.y },
    { x: entrance.x - 1, y: entrance.y },
    { x: entrance.x, y: entrance.y + 1 },
    { x: entrance.x, y: entrance.y - 1 },
  ].find((point) => floorState.floor.tiles[point.y * floorState.floor.side + point.x] !== 0);
  assert.ok(neighbor, "entrance has no open neighbor");
  floorState.monsters.push(spawnMonster(state, { kind: "cellarRat", ...neighbor }, 1, false));

  sendFlock(state);
  runUntil(state, 10 * TICKS_PER_SECOND, () => floorState.monsters.length === 0);

  const hen = state.chickens[0];
  assert.equal(floorState.monsters.length, 0);
  assert.equal(hen.pouchGold, monsterGold(MONSTER_KINDS.cellarRat, 1));
  assert.equal(state.bankedGold, 0);
  assert.ok(hen.hp < hen.maxHp, "the rat never landed a bite");
  assert.deepEqual(floorState.killedThisExpedition, [{ kind: "cellarRat", ...neighbor }]);
});

test("a hen below Courage runs and never pecks, even at a monster biting her", () => {
  const state = createGame(SEED, 1);
  clearMonsters(state, [1]);
  sendFlock(state);
  const hen = state.chickens[0];
  walkAwayFromEntrance(state, hen);
  const floorState = floorStateAt(state, 1);
  const spider = spawnMonster(state, { kind: "cellarSpider", x: hen.x, y: hen.y }, 1, false);
  floorState.monsters.push(spider);
  hen.hp = hen.courage * hen.maxHp - 1;

  const activities = new Set<string>();
  for (let step = 0; step < TEN_MINUTES && hen.activity !== "home" && hen.activity !== "dead"; step++) {
    tick(state, []);
    activities.add(hen.activity);
  }
  assert.ok(!activities.has("fight"));
  assert.equal(spider.hp, spider.maxHp);
});

test("a dead chicken's pouch drops as a Feather Pile that a flockmate carries home", () => {
  const state = createGame(SEED, 2);
  clearMonsters(state, [1]);
  sendFlock(state);
  const [victim, survivor] = state.chickens;
  walkAwayFromEntrance(state, victim);
  const floorState = floorStateAt(state, 1);
  floorState.lootPiles = [];
  const deathTile = { x: victim.x, y: victim.y };
  victim.pouchGold = 50;
  victim.hp = 1;
  const rat = spawnMonster(state, { kind: "cellarRat", ...deathTile }, 1, false);
  // Both hens can stand on the same tile. Point the rat at the victim so the test does not depend on that.
  rat.targetChickenId = victim.id;
  floorState.monsters.push(rat);

  const deathEvents = tick(state, []);
  assert.deepEqual(deathEvents, [{ type: "chickenDied", chickenId: victim.id, depth: 1, killer: "cellarRat" }]);
  assert.equal(victim.activity, "dead");
  const featherPile = floorState.lootPiles.find((pile) => pile.isFeatherPile);
  assert.deepEqual(featherPile && { x: featherPile.x, y: featherPile.y, gold: featherPile.gold }, { ...deathTile, gold: 50 });

  runUntil(state, TEN_MINUTES, () => !floorState.lootPiles.some((pile) => pile.isFeatherPile));
  assert.ok(survivor.pouchGold >= 50, "the survivor never picked up the Feather Pile");
  tick(state, [{ type: "recall" }]);
  runUntil(state, TEN_MINUTES, () => survivor.activity === "home" || survivor.activity === "dead");
  assert.equal(survivor.activity, "home");
  assert.ok(state.bankedGold >= 50);
});

test("Recall brings back 25% of this expedition's kills as Agitated monsters", () => {
  const state = createGame(SEED, 1);
  const floorState = floorStateAt(state, 1);
  floorState.monsters = [];
  floorState.killedThisExpedition = Array.from({ length: 8 }, () => ({ kind: "cellarRat" as const, ...floorState.floor.stairsDown }));
  sendFlock(state);

  tick(state, [{ type: "recall" }]);

  assert.equal(floorState.monsters.length, 2);
  for (const monster of floorState.monsters) {
    assert.equal(monster.agitated, true);
    assert.equal(monster.attack, monsterAttack(MONSTER_KINDS.cellarRat, 1) * 1.2);
    assert.equal(monster.aggroRadius, 8);
  }
});

test("fights between equal-speed hens and rats always end instead of chasing in parallel forever", () => {
  const longestAllowedFight = 30 * TICKS_PER_SECOND;
  // Seeds 3 and 77 used to stall: hen and rat mirrored each other down neighboring corridors.
  for (const seed of [3, 77, SEED]) {
    const state = createGame(seed, 1);
    sendFlock(state);
    const hen = state.chickens[0];
    let fightTicks = 0;
    for (let step = 0; step < TEN_MINUTES && hen.activity !== "home" && hen.activity !== "dead"; step++) {
      tick(state, []);
      fightTicks = hen.activity === "fight" ? fightTicks + 1 : 0;
      assert.ok(fightTicks <= longestAllowedFight, `seed ${seed}: fight still running at tick ${state.tick}`);
    }
  }
});
