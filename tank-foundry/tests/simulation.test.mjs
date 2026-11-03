import assert from "node:assert/strict";
import test from "node:test";
import { BATTLE, SECTOR, STATIONS } from "../src/data.js";
import { deserializeState, SaveFormatError, serializeState, simulateAway } from "../src/save.js";
import {
  buyBlueprint,
  buyDoctrine,
  canBuyBlueprint,
  canFallBack,
  canLaunchOffensive,
  canPrestige,
  createInitialState,
  deployCap,
  depotCap,
  doctrineCost,
  enemyStats,
  fallBack,
  launchOffensive,
  medalsForSector,
  offensiveCost,
  offensiveTarget,
  powerFactor,
  prestige,
  sectorPlan,
  setAutoUpgrade,
  stationRate,
  stationUpgradeCost,
  storageCap,
  tick,
  upgradeStation,
} from "../src/sim.js";

/** A running sector with only the given enemies, so a test controls exactly what the army faces. */
function quietSector(state, enemies) {
  state.battle.active = true;
  state.battle.trenches = [];
  state.battle.reinforceTimer = 1e9;
  state.battle.artilleryTimer = 1e9;
  state.units.push(...enemies, enemy({ id: 999, kind: "hq", x: 500, range: 0 }));
}

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
    cooldown: 99,
    targetId: null,
    moving: false,
    structure: true,
    dormant: false,
    reinforcement: false,
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
  state.blueprints.t34 = true;
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

test("assembly stops only when the front is at its hard limit and the depot is full", () => {
  const state = createInitialState(0);
  state.battle.pause = 1e9;
  state.parts = { hull: 20, turret: 20, engine: 20 };
  state.stations.assembly.level = 200;
  state.stations.power.level = 400;
  state.parts = { hull: 200, turret: 200, engine: 200 };
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

test("blueprints cost salvage, unlock in order and switch production to the new model", () => {
  const state = createInitialState(0);
  state.resources.salvage = 1e7;
  assert.equal(canBuyBlueprint(state, "sherman"), false);
  assert.ok(buyBlueprint(state, "t34"));
  assert.equal(state.production, "t34");
  assert.ok(buyBlueprint(state, "sherman"));
  assert.equal(state.production, "sherman");
  assert.equal(buyBlueprint(state, "sherman"), false, "a blueprint cannot be bought twice");
  assert.ok(state.resources.salvage < 1e7);
});

test("doctrine costs medals and upgrades tanks already at the front", () => {
  const state = createInitialState(0);
  state.depot.push("stuart");
  state.battle.pause = 1e9;
  run(state, 0.05);
  const tank = state.units.find((unit) => unit.side === "ally");
  const damageBefore = tank.damage;
  assert.equal(buyDoctrine(state, "gun"), false, "no medals before the first regroup");
  state.prestige.medals = doctrineCost(state, "gun");
  assert.ok(buyDoctrine(state, "gun"));
  assert.equal(state.prestige.medals, 0);
  assert.ok(tank.damage > damageBefore);
});

test("regrouping resets everything bought with salvage and keeps doctrine", () => {
  const state = createInitialState(0);
  assert.equal(canPrestige(state), false);
  state.battle.maxSector = 8;
  state.battle.sector = 8;
  state.stations.mill.level = 30;
  state.blueprints.t34 = true;
  state.production = "t34";
  state.resources.salvage = 5000;
  state.doctrine.gun = 4;
  state.prestige.medals = 2;
  state.prestige.bestSector = 8;
  state.stats.kills = 99;
  const next = prestige(state, 0);
  assert.equal(next.battle.sector, 1);
  assert.equal(next.stations.mill.level, 1);
  assert.equal(next.production, "stuart");
  assert.deepEqual(next.blueprints, {});
  assert.ok(next.resources.salvage < 5000);
  assert.equal(next.doctrine.gun, 4);
  assert.equal(next.prestige.medals, 2 + medalsForSector(8));
  assert.equal(next.prestige.count, 1);
  assert.equal(next.prestige.bestSector, 8);
  assert.equal(next.stats.kills, 99);
  assert.ok(medalsForSector(12) > medalsForSector(8), "pushing further pays more");
});

test("offensives commit front tanks and stop short of the record", () => {
  const state = createInitialState(0);
  state.battle.sector = 3;
  state.prestige.bestSector = 12;
  for (let index = 0; index < 20; index += 1) state.depot.push("stuart");
  state.battle.pause = 1e9;
  run(state, 0.05);
  const cost = offensiveCost(state);
  const before = state.units.length;
  const salvageBefore = state.resources.salvage;
  assert.ok(canLaunchOffensive(state));
  assert.ok(launchOffensive(state));
  assert.equal(state.battle.sector, 5);
  assert.equal(state.battle.maxSector, 1, "skipped sectors do not count toward medals");
  assert.ok(before - state.units.length >= cost, "a Stuart is worth one unit of offensive strength");
  assert.ok(state.resources.salvage > salvageBefore);
  state.battle.sector = 10;
  assert.equal(offensiveTarget(state), 10, "offensives stop two sectors short of the record");
  assert.equal(canLaunchOffensive(state), false);
});

test("sectors are generated from their number and grow deeper and tougher", () => {
  assert.deepEqual(sectorPlan(7), sectorPlan(7));
  const early = sectorPlan(1);
  const late = sectorPlan(12);
  assert.equal(early.trenches.length, 0, "the first sector has no trenches");
  assert.ok(late.trenches.length > 0);
  assert.ok(late.emplacements.length > early.emplacements.length);
  assert.ok(late.reserve.length > early.reserve.length);
  assert.ok(enemyStats("bunker", 12).hp > enemyStats("bunker", 1).hp);
  assert.ok(late.emplacements.every((entry) => entry.x < SECTOR.baseX), "the base is always the deepest objective");
});

test("allies advance into range of a position that out-ranges them", () => {
  const state = createInitialState(0);
  state.depot.push("stuart");
  quietSector(state, [enemy({ x: 80, range: 30 })]);
  run(state, 30);
  const tank = state.units.find((unit) => unit.side === "ally");
  assert.ok(tank.x > 60, `tank held at ${tank.x}`);
  assert.equal(tank.targetId, 900);
});

test("trenches slow tanks and expose them to extra damage", () => {
  const open = createInitialState(0);
  const trenched = createInitialState(0);
  for (const state of [open, trenched]) {
    state.depot.push("stuart");
    quietSector(state, [enemy({ x: 90 })]);
  }
  trenched.battle.trenches = [{ x: 20, width: 40 }];
  run(open, 3);
  run(trenched, 3);
  const openTank = open.units.find((unit) => unit.side === "ally");
  const trenchTank = trenched.units.find((unit) => unit.side === "ally");
  assert.ok(trenchTank.x < openTank.x * 0.5, `trench ${trenchTank.x} vs open ${openTank.x}`);
  for (const state of [open, trenched]) {
    state.units.push(enemy({ id: 901, x: 20, range: 40, damage: 20, reload: 1, cooldown: 0, hp: 1e9 }));
    state.units.find((unit) => unit.side === "ally").regenPerSecond = 0;
  }
  run(open, 0.05);
  run(trenched, 0.05);
  const openLoss = openTank.maxHp - openTank.hp;
  const trenchLoss = trenchTank.maxHp - trenchTank.hp;
  assert.ok(trenchLoss > openLoss * 1.5, `trench ${trenchLoss} vs open ${openLoss}`);
});

test("reserve armor waits until the assault nears the first line", () => {
  const state = createInitialState(0);
  quietSector(state, [enemy({ id: 901, kind: "lightTank", x: 95, speed: 4, structure: false, dormant: true, triggerX: 30, range: 5 })]);
  run(state, 2);
  const reserve = state.units.find((unit) => unit.id === 901);
  assert.equal(reserve.x, 95, "no assault in sight, the reserve holds");
  state.depot.push("stuart");
  run(state, 12);
  assert.equal(reserve.dormant, false);
  assert.ok(reserve.x < 95);
});

test("destroying the fortified base captures the sector and the next one is generated", () => {
  const state = createInitialState(0);
  state.battle.pause = 0;
  const events = run(state, 0.1);
  assert.ok(events.some((event) => event.type === "sectorStart"));
  const base = state.units.find((unit) => unit.kind === "hq");
  assert.ok(base);
  state.units = [base];
  base.hp = 0.01;
  const ally = { ...enemy({ id: 950, side: "ally", kind: "stuart", x: base.x - 5, z: 0, damage: 50, reload: 0.1, cooldown: 0, range: 30, structure: false, hp: 100, maxHp: 100 }), holdBack: 0 };
  state.units.push(ally);
  const captureEvents = run(state, 0.2);
  assert.ok(captureEvents.some((event) => event.type === "sectorCaptured" && event.sector === 1));
  assert.equal(state.battle.sector, 2);
  assert.equal(state.battle.maxSector, 2);
  assert.ok(state.units.every((unit) => unit.side !== "enemy"), "the garrison falls with its base");
  run(state, BATTLE.capturePauseSeconds + 0.5);
  assert.ok(state.units.some((unit) => unit.kind === "hq"), "the next sector is built");
});

test("a running sector with no base is treated as captured", () => {
  const state = createInitialState(0);
  state.battle.active = true;
  state.units.push(enemy({ kind: "pillbox" }));
  const events = run(state, 0.1);
  assert.ok(events.some((event) => event.type === "sectorCaptured" && event.sector === 1));
  assert.equal(state.battle.sector, 2);
});

test("a stalled assault can fall back one sector", () => {
  const state = createInitialState(0);
  assert.equal(canFallBack(state), false);
  state.battle.sector = 4;
  state.battle.maxSector = 4;
  quietSector(state, [enemy({})]);
  assert.ok(fallBack(state));
  assert.equal(state.battle.sector, 3);
  assert.equal(state.battle.maxSector, 4, "falling back keeps the record");
  assert.ok(state.units.every((unit) => unit.side !== "enemy"));
});

test("enemy artillery wears down tanks that no enemy is shooting at", () => {
  const state = createInitialState(0);
  state.depot.push("stuart", "stuart", "stuart");
  quietSector(state, [enemy({ x: 100, range: 0 })]);
  state.battle.artilleryTimer = 0;
  const events = run(state, 60);
  assert.ok(events.some((event) => event.type === "artillery"));
  const hurt = state.units.some((unit) => unit.side === "ally" && unit.hp < unit.maxHp);
  assert.ok(hurt || state.stats.tanksLost > 0);
});



test("auto-upgrade needs its doctrine before it can be switched on", () => {
  const state = createInitialState(0);
  assert.equal(setAutoUpgrade(state, true), false);
  state.doctrine.requisition = 1;
  assert.ok(setAutoUpgrade(state, true));
  state.resources.salvage = 1e6;
  run(state, 5);
  const levels = STATIONS.reduce((sum, station) => sum + state.stations[station.id].level, 0);
  assert.ok(levels > STATIONS.length);
});

test("an idle factory captures the first sectors on its own", () => {
  const state = createInitialState(0);
  run(state, 10 * 60, 0.1);
  assert.ok(state.battle.maxSector >= 2, `reached sector ${state.battle.maxSector}`);
  assert.ok(state.stats.kills > 0);
  assert.ok(state.resources.salvage > 0);
});

test("a first run that grows the factory reaches its first regroup", () => {
  const state = createInitialState(0);
  for (let minute = 0; minute < 20; minute += 1) {
    run(state, 60, 0.1);
    buyBlueprint(state, "t34");
    buyBlueprint(state, "sherman");
    for (let step = 0; step < 20; step += 1) {
      const cheapest = STATIONS.map((station) => station.id).sort((a, b) => stationUpgradeCost(state, a) - stationUpgradeCost(state, b))[0];
      if (!upgradeStation(state, powerFactor(state) < 1 ? "power" : cheapest)) break;
    }
  }
  assert.ok(canPrestige(state), `stuck at sector ${state.battle.maxSector}`);
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
  assert.deepEqual(upgraded.automation, { upgrades: false, timer: 0 });
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
