import assert from "node:assert/strict";
import test from "node:test";
import { BATTLE, RESEARCH, STATIONS } from "../src/data.js";
import { deserializeState, SaveFormatError, serializeState, simulateAway } from "../src/save.js";
import {
  buyResearch,
  canBuyResearch,
  createInitialState,
  deployCap,
  depotCap,
  powerFactor,
  researchCost,
  setAutomation,
  stationRate,
  stationUpgradeCost,
  storageCap,
  tick,
  upgradeStation,
} from "../src/sim.js";

function run(state, seconds, step = 0.05) {
  const events = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += step) tick(state, step, events);
  return events;
}

function enemy(overrides) {
  return {
    id: 900,
    side: "enemy",
    kind: "tankDestroyer",
    x: 80,
    z: 0,
    hp: 1e9,
    maxHp: 1e9,
    armor: 0,
    damage: 0,
    reload: 99,
    range: 30,
    speed: 0,
    penetration: 1,
    regenPerSecond: 0,
    salvage: 1,
    intel: 1,
    cooldown: 99,
    targetId: null,
    moving: false,
    ...overrides,
  };
}

test("crafters never exceed storage or spend steel they do not have", () => {
  const state = createInitialState(0);
  state.stations.mill.level = 30;
  state.stations.power.level = 30;
  for (let second = 0; second < 120; second += 1) {
    run(state, 1);
    assert.ok(state.resources.steel >= 0);
    assert.ok(state.resources.steel <= storageCap(state, "steel"));
    for (const part of ["hull", "turret", "engine"]) assert.ok(state.parts[part] <= storageCap(state, part));
  }
  assert.equal(state.stations.mill.status, "blocked");
});

test("a power shortfall slows every station by the same factor", () => {
  const state = createInitialState(0);
  const fullRate = stationRate(state, "hull");
  state.stations.hull.level = 6;
  const demand = STATIONS.reduce((sum, station) => sum + station.powerUse * state.stations[station.id].level, 0);
  assert.ok(powerFactor(state) < 1);
  assert.equal(powerFactor(state), 10 / demand);
  assert.equal(stationRate(state, "mill"), STATIONS.find((station) => station.id === "mill").cyclesPerSecond * (10 / demand));
  assert.ok(stationRate(state, "hull") < fullRate * 6);
});

test("assembly consumes the recipe of the selected model", () => {
  const state = createInitialState(0);
  state.research.t34 = 1;
  state.production = "t34";
  state.stations.mill.level = 0;
  state.resources.steel = 0;
  state.parts = { hull: 5, turret: 2, engine: 3 };
  state.battle.pause = 1e9;
  const events = run(state, 30);
  assert.equal(events.filter((event) => event.type === "built").length, 2);
  assert.deepEqual(state.parts, { hull: 1, turret: 0, engine: 1 });
  assert.equal(state.stations.assembly.status, "starved");
});

test("assembly stops when the front and the depot are full", () => {
  const state = createInitialState(0);
  state.battle.pause = 1e9;
  state.parts = { hull: 20, turret: 20, engine: 20 };
  state.stations.assembly.level = 20;
  state.stations.power.level = 20;
  run(state, 30);
  assert.equal(state.units.filter((unit) => unit.side === "ally").length, deployCap(state));
  assert.equal(state.depot.length, depotCap(state));
  assert.equal(state.stations.assembly.status, "blocked");
});

test("upgrade costs rise and fail without salvage", () => {
  const state = createInitialState(0);
  state.resources.salvage = 1000;
  const first = stationUpgradeCost(state, "mill");
  assert.ok(upgradeStation(state, "mill"));
  assert.ok(stationUpgradeCost(state, "mill") > first);
  state.resources.salvage = 0;
  assert.equal(upgradeStation(state, "mill"), false);
  assert.equal(state.stations.mill.level, 2);
});

test("blueprints require their prerequisite and switch production to the better model", () => {
  const state = createInitialState(0);
  state.resources.intel = 1e6;
  assert.equal(canBuyResearch(state, "sherman"), false);
  assert.ok(buyResearch(state, "t34"));
  assert.equal(state.production, "t34");
  assert.ok(buyResearch(state, "sherman"));
  assert.equal(state.production, "sherman");
  assert.equal(buyResearch(state, "sherman"), false, "one-time research cannot be bought twice");
});

test("research upgrades tanks already at the front", () => {
  const state = createInitialState(0);
  state.depot.push("stuart");
  state.battle.pause = 1e9;
  run(state, 0.05);
  const tank = state.units.find((unit) => unit.side === "ally");
  const damageBefore = tank.damage;
  state.resources.intel = researchCost(state, "gun");
  assert.ok(buyResearch(state, "gun"));
  assert.ok(tank.damage > damageBefore);
});

test("allies advance on an enemy that out-ranges them instead of waiting at the rally line", () => {
  const state = createInitialState(0);
  state.battle.active = true;
  state.battle.queue = [];
  state.battle.elapsed = 0;
  state.depot.push("stuart");
  state.units.push(enemy({ x: BATTLE.rallyX + 18 }));
  run(state, 20);
  const tank = state.units.find((unit) => unit.side === "ally");
  assert.ok(tank.x > BATTLE.rallyX, `tank held at ${tank.x}`);
  assert.equal(tank.targetId, 900);
});

test("enemy artillery wears down tanks that no enemy is shooting at", () => {
  const state = createInitialState(0);
  state.battle.active = true;
  state.battle.queue = [];
  state.battle.elapsed = 0;
  state.battle.artilleryTimer = 0;
  state.depot.push("stuart", "stuart", "stuart");
  state.units.push(enemy({ x: 100, range: 0 }));
  const events = run(state, 60);
  assert.ok(events.some((event) => event.type === "artillery"));
  const hurt = state.units.some((unit) => unit.side === "ally" && unit.hp < unit.maxHp);
  assert.ok(hurt || state.stats.tanksLost > 0);
});

test("an enemy reaching the gate pushes the front back one wave", () => {
  const state = createInitialState(0);
  state.battle.wave = 7;
  state.battle.maxWave = 7;
  state.battle.active = true;
  state.battle.queue = [];
  state.battle.elapsed = 0;
  state.units.push(enemy({ x: BATTLE.breachX + 0.5, speed: 5, moving: true, range: 1 }));
  const events = run(state, 0.2);
  assert.equal(state.battle.wave, 6);
  assert.equal(state.battle.maxWave, 7);
  assert.ok(events.some((event) => event.type === "retreat" && event.reason === "breach"));
  assert.ok(state.units.every((unit) => unit.side !== "enemy"));
});

test("a wave that is not cleared in time stalls and falls back", () => {
  const state = createInitialState(0);
  state.battle.wave = 3;
  state.battle.active = true;
  state.battle.queue = [];
  state.battle.elapsed = 0;
  state.units.push(enemy({ x: 90 }));
  const events = run(state, BATTLE.waveTimeLimitSeconds + 1);
  assert.equal(state.battle.wave, 2);
  assert.ok(events.some((event) => event.type === "retreat" && event.reason === "stalled"));
});

test("automation needs its research before it can be switched on", () => {
  const state = createInitialState(0);
  assert.equal(setAutomation(state, "upgrades", true), false);
  state.research.requisition = 1;
  assert.ok(setAutomation(state, "upgrades", true));
  state.resources.salvage = 1e6;
  run(state, 5);
  const levels = STATIONS.reduce((sum, station) => sum + state.stations[station.id].level, 0);
  assert.ok(levels > STATIONS.length);
});

test("an idle factory clears early waves on its own", () => {
  const state = createInitialState(0);
  run(state, 10 * 60, 0.1);
  assert.ok(state.battle.maxWave >= 4, `reached wave ${state.battle.maxWave}`);
  assert.ok(state.stats.kills > 0);
  assert.ok(state.resources.salvage > 0);
});

test("research spending keeps the front moving past the first boss", () => {
  const state = createInitialState(0);
  const military = RESEARCH.filter((project) => !project.unlocksModel && project.max > 1);
  for (let minute = 0; minute < 40; minute += 1) {
    run(state, 60, 0.1);
    if (canBuyResearch(state, "t34")) buyResearch(state, "t34");
    if (canBuyResearch(state, "sherman")) buyResearch(state, "sherman");
    for (const project of military) while (state.resources.intel > researchCost(state, project.id) * 3 && buyResearch(state, project.id));
    for (const station of STATIONS) while (upgradeStation(state, station.id));
  }
  assert.ok(state.battle.maxWave > BATTLE.bossEvery, `stuck at wave ${state.battle.maxWave}`);
});

test("saves round-trip and fill in fields added later", () => {
  const state = createInitialState(0);
  run(state, 30);
  const text = serializeState(state, 1234);
  const restored = deserializeState(text);
  assert.equal(restored.savedAt, 1234);
  assert.deepEqual(restored.stations, state.stations);
  const payload = JSON.parse(text);
  delete payload.state.automation;
  const upgraded = deserializeState(JSON.stringify(payload));
  assert.deepEqual(upgraded.automation, { upgrades: false, research: false, timer: 0 });
  assert.throws(() => deserializeState("{nope"), SaveFormatError);
  assert.throws(() => deserializeState(JSON.stringify({ version: 999, state: {} })), SaveFormatError);
});

test("time away is simulated and capped", () => {
  const state = createInitialState(0);
  const summary = simulateAway(state, 20 * 60 * 60);
  assert.equal(summary.seconds, 8 * 60 * 60);
  assert.ok(summary.built > 0);
  assert.ok(summary.kills > 0);
});
