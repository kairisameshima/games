import {
  ARTILLERY,
  AUTOMATION,
  BATTLE,
  ENEMY_KINDS,
  ENEMY_POOL,
  ENEMY_SCALING,
  PARTS,
  RESEARCH,
  START,
  STATIONS,
  TANK_MODELS,
} from "./data.js";

export const MODEL_BY_ID = Object.fromEntries(TANK_MODELS.map((model) => [model.id, model]));
export const STATION_BY_ID = Object.fromEntries(STATIONS.map((station) => [station.id, station]));
export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((project) => [project.id, project]));

const CRAFTER_IDS = ["mill", "hull", "turret", "engine"];
const MAX_CYCLES_PER_TICK = 10000;

export function createInitialState(now = Date.now()) {
  const stations = {};
  for (const station of STATIONS) {
    stations[station.id] = { level: 1, progress: 0, status: "idle" };
  }
  stations.assembly.building = null;
  return {
    savedAt: now,
    time: 0,
    resources: { salvage: START.salvage, intel: 0, steel: START.steel },
    parts: { hull: 0, turret: 0, engine: 0 },
    stations,
    research: {},
    production: "stuart",
    depot: [],
    units: [],
    nextUnitId: 1,
    battle: {
      wave: 1,
      maxWave: 1,
      queue: [],
      spawnTimer: 0,
      pause: 1,
      active: false,
      autoAdvance: true,
      killsThisWave: 0,
      waveSize: 0,
      elapsed: 0,
      artilleryTimer: 0,
    },
    automation: { upgrades: false, research: false, timer: 0 },
    stats: { tanksBuilt: 0, tanksLost: 0, kills: 0, salvageEarned: 0, intelEarned: 0 },
  };
}

export function researchLevel(state, id) {
  return state.research[id] ?? 0;
}

function seededRandom(seed) {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d) >>> 0;
    value = Math.imul(value ^ (value >>> 12), 0x297a2d39) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    return value / 4294967296;
  };
}

export function isBossWave(wave) {
  return wave % BATTLE.bossEvery === 0;
}

export function waveComposition(wave) {
  const random = seededRandom(wave * 7919 + 17);
  const pool = ENEMY_POOL.filter((entry) => wave >= entry.fromWave);
  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const count = Math.min(
    ENEMY_SCALING.maxCount,
    ENEMY_SCALING.baseCount + Math.floor((wave - 1) / ENEMY_SCALING.wavesPerExtraEnemy),
  );
  const kinds = [];
  for (let index = 0; index < count; index += 1) {
    let roll = random() * totalWeight;
    const picked = pool.find((entry) => (roll -= entry.weight) < 0) ?? pool[pool.length - 1];
    kinds.push(picked.kind);
  }
  if (isBossWave(wave)) {
    kinds.splice(Math.floor(kinds.length / 2), 0, "landship");
  }
  return kinds;
}

export function enemyStats(kindId, wave) {
  const kind = ENEMY_KINDS[kindId];
  const step = wave - 1;
  return {
    hp: kind.hp * ENEMY_SCALING.hpGrowth ** step,
    armor: kind.armor * ENEMY_SCALING.armorGrowth ** step,
    damage: kind.damage * ENEMY_SCALING.damageGrowth ** step,
    reload: kind.reload,
    range: kind.range,
    speed: kind.speed,
    salvage: kind.salvage * ENEMY_SCALING.salvageGrowth ** step,
    intel: kind.intel * ENEMY_SCALING.intelGrowth ** step,
  };
}

export function salvageMultiplier(state) {
  return 1 + 0.2 * researchLevel(state, "scavenging");
}

export function intelMultiplier(state) {
  return 1 + 0.15 * researchLevel(state, "intelligence");
}

export function tankStats(state, modelId) {
  const model = MODEL_BY_ID[modelId];
  const plating = researchLevel(state, "plating");
  return {
    hp: model.hp * 1.15 ** plating,
    armor: model.armor * 1.08 ** plating,
    damage: model.damage * 1.15 ** researchLevel(state, "gun"),
    reload: model.reload,
    range: model.range * (1 + 0.05 * researchLevel(state, "optics")),
    speed: model.speed * (1 + 0.1 * researchLevel(state, "engines")),
    penetration: 1 - 0.07 * researchLevel(state, "penetrator"),
    regenPerSecond: 0.005 * researchLevel(state, "repair"),
  };
}

export function effectiveDamage(damage, armor) {
  return (damage * damage) / (damage + armor);
}

export function isModelUnlocked(state, modelId) {
  if (modelId === TANK_MODELS[0].id) return true;
  const project = RESEARCH.find((entry) => entry.unlocksModel === modelId);
  return project !== undefined && researchLevel(state, project.id) > 0;
}

export function unlockedModels(state) {
  return TANK_MODELS.filter((model) => isModelUnlocked(state, model.id));
}

export function deployCap(state) {
  return START.deployCap + START.deployPerLogistics * researchLevel(state, "logistics");
}

export function depotCap(state) {
  return START.depotCap + researchLevel(state, "warehouses");
}

export function storageCap(state, resourceId) {
  const station = STATIONS.find((entry) => entry.output === resourceId);
  const level = state.stations[station.id].level;
  const base = station.baseStorage + station.storagePerLevel * (level - 1);
  return Math.floor(base * (1 + 0.5 * researchLevel(state, "warehouses")));
}

export function powerSupply(state) {
  return START.powerPerLevel * state.stations.power.level * (1 + 0.3 * researchLevel(state, "grid"));
}

export function powerDemand(state) {
  let demand = 0;
  for (const station of STATIONS) demand += station.powerUse * state.stations[station.id].level;
  return demand;
}

export function powerFactor(state) {
  const demand = powerDemand(state);
  if (demand <= 0) return 1;
  return Math.min(1, powerSupply(state) / demand);
}

function stationResearchMultiplier(state, stationId) {
  if (stationId === "mill") return 1 + 0.25 * researchLevel(state, "bessemer");
  if (stationId === "assembly") return 1 + 0.25 * researchLevel(state, "jigs");
  return 1 + 0.25 * researchLevel(state, "tooling");
}

/**
 * Heavier guns and thicker armor make every tank harder to build, so research
 * keeps pushing the factory to grow instead of letting it idle at the front cap.
 */
export function tankComplexity(state) {
  return START.complexityPerUpgrade ** (researchLevel(state, "gun") + researchLevel(state, "plating"));
}

/** Cycles per second for crafters, build-seconds of work per second for the assembly hall. */
export function stationRate(state, stationId) {
  const station = STATION_BY_ID[stationId];
  const level = state.stations[stationId].level;
  const base = stationId === "assembly" ? 1 : station.cyclesPerSecond;
  const complexity = stationId === "mill" ? 1 : tankComplexity(state);
  return (base * level * stationResearchMultiplier(state, stationId) * powerFactor(state)) / complexity;
}

export function stationUpgradeCost(state, stationId) {
  const station = STATION_BY_ID[stationId];
  return Math.ceil(station.baseCost * station.costGrowth ** (state.stations[stationId].level - 1));
}

export function upgradeStation(state, stationId) {
  const cost = stationUpgradeCost(state, stationId);
  if (state.resources.salvage < cost) return false;
  state.resources.salvage -= cost;
  state.stations[stationId].level += 1;
  return true;
}

export function researchCost(state, id) {
  const project = RESEARCH_BY_ID[id];
  return Math.ceil(project.cost * project.growth ** researchLevel(state, id));
}

export function researchRequirementsMet(state, id) {
  const project = RESEARCH_BY_ID[id];
  return (project.requires ?? []).every((required) => researchLevel(state, required) > 0);
}

export function isResearchMaxed(state, id) {
  return researchLevel(state, id) >= RESEARCH_BY_ID[id].max;
}

export function canBuyResearch(state, id) {
  return researchRequirementsMet(state, id) && !isResearchMaxed(state, id) && state.resources.intel >= researchCost(state, id);
}

export function buyResearch(state, id, events = []) {
  if (!canBuyResearch(state, id)) return false;
  state.resources.intel -= researchCost(state, id);
  state.research[id] = researchLevel(state, id) + 1;
  refreshAllyStats(state);
  const project = RESEARCH_BY_ID[id];
  if (project.unlocksModel) {
    const current = MODEL_BY_ID[state.production];
    const unlocked = MODEL_BY_ID[project.unlocksModel];
    if (TANK_MODELS.indexOf(unlocked) > TANK_MODELS.indexOf(current)) state.production = unlocked.id;
  }
  events.push({ type: "research", id });
  return true;
}

export function setProduction(state, modelId) {
  if (!isModelUnlocked(state, modelId)) return false;
  state.production = modelId;
  return true;
}

export function setAutomation(state, key, enabled) {
  const requiredResearch = key === "upgrades" ? "requisition" : "bureau";
  if (enabled && researchLevel(state, requiredResearch) === 0) return false;
  state.automation[key] = enabled;
  return true;
}

function refreshAllyStats(state) {
  for (const unit of state.units) {
    if (unit.side !== "ally") continue;
    const stats = tankStats(state, unit.kind);
    const fraction = unit.hp / unit.maxHp;
    Object.assign(unit, {
      maxHp: stats.hp,
      hp: stats.hp * fraction,
      armor: stats.armor,
      damage: stats.damage,
      range: stats.range,
      speed: stats.speed,
      penetration: stats.penetration,
      regenPerSecond: stats.regenPerSecond,
    });
  }
}

function stockOf(state, resourceId) {
  return resourceId === "steel" ? state.resources.steel : state.parts[resourceId];
}

function addStock(state, resourceId, amount) {
  if (resourceId === "steel") state.resources.steel += amount;
  else state.parts[resourceId] += amount;
}

function runCrafter(state, stationId, dt, events) {
  const station = STATION_BY_ID[stationId];
  const runtime = state.stations[stationId];
  runtime.progress += stationRate(state, stationId) * dt;
  const ready = Math.min(MAX_CYCLES_PER_TICK, Math.floor(runtime.progress));
  const room = Math.max(0, storageCap(state, station.output) - stockOf(state, station.output));
  let affordable = Infinity;
  for (const [input, amount] of Object.entries(station.inputs)) {
    affordable = Math.min(affordable, Math.floor(stockOf(state, input) / amount));
  }
  const cycles = Math.min(ready, room, affordable);
  if (cycles > 0) {
    for (const [input, amount] of Object.entries(station.inputs)) addStock(state, input, -amount * cycles);
    addStock(state, station.output, cycles);
    runtime.progress -= cycles;
    events.push({ type: "produced", station: stationId, count: cycles });
  }
  if (runtime.progress >= 1) {
    runtime.progress = 1;
    runtime.status = room === 0 ? "blocked" : "starved";
  } else {
    runtime.status = powerFactor(state) < 1 ? "underpowered" : "running";
  }
}

function hasParts(state, model) {
  return PARTS.every((part) => state.parts[part] >= model.parts[part]);
}

function runAssembly(state, dt, events) {
  const runtime = state.stations.assembly;
  let work = stationRate(state, "assembly") * dt;
  for (let guard = 0; guard < MAX_CYCLES_PER_TICK; guard += 1) {
    if (runtime.building === null) {
      const model = MODEL_BY_ID[state.production];
      if (state.depot.length >= depotCap(state)) {
        runtime.status = "blocked";
        return;
      }
      if (!hasParts(state, model)) {
        runtime.status = "starved";
        return;
      }
      for (const part of PARTS) state.parts[part] -= model.parts[part];
      runtime.building = model.id;
      runtime.progress = 0;
    }
    const buildSeconds = MODEL_BY_ID[runtime.building].buildSeconds;
    const needed = buildSeconds - runtime.progress;
    if (work < needed) {
      runtime.progress += work;
      runtime.status = powerFactor(state) < 1 ? "underpowered" : "running";
      return;
    }
    work -= needed;
    state.depot.push(runtime.building);
    state.stats.tanksBuilt += 1;
    events.push({ type: "built", model: runtime.building });
    runtime.building = null;
    runtime.progress = 0;
  }
}

function laneZ(state, unitId) {
  const random = seededRandom(unitId * 131 + Math.floor(state.time));
  return (random() * 2 - 1) * BATTLE.laneHalfWidth;
}

function deployFromDepot(state, events) {
  let allies = state.units.filter((unit) => unit.side === "ally").length;
  while (state.depot.length > 0 && allies < deployCap(state)) {
    const modelId = state.depot.shift();
    const stats = tankStats(state, modelId);
    const id = state.nextUnitId++;
    state.units.push({
      id,
      side: "ally",
      kind: modelId,
      x: BATTLE.gateX,
      z: laneZ(state, id),
      hp: stats.hp,
      maxHp: stats.hp,
      armor: stats.armor,
      damage: stats.damage,
      reload: stats.reload,
      range: stats.range,
      speed: stats.speed,
      penetration: stats.penetration,
      regenPerSecond: stats.regenPerSecond,
      cooldown: 0,
      targetId: null,
      moving: true,
      holdBack: seededRandom(id * 53)() * BATTLE.rallyDepth,
    });
    allies += 1;
    events.push({ type: "deploy", id, model: modelId });
  }
}

function spawnEnemy(state, kindId) {
  const wave = state.battle.wave;
  const stats = enemyStats(kindId, wave);
  const id = state.nextUnitId++;
  state.units.push({
    id,
    side: "enemy",
    kind: kindId,
    x: BATTLE.spawnX,
    z: ENEMY_KINDS[kindId].boss ? 0 : laneZ(state, id),
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    damage: stats.damage,
    reload: stats.reload,
    range: stats.range,
    speed: stats.speed,
    penetration: 1,
    regenPerSecond: 0,
    salvage: stats.salvage,
    intel: stats.intel,
    cooldown: stats.reload * 0.5,
    targetId: null,
    moving: true,
  });
}

function startWave(state) {
  const battle = state.battle;
  battle.queue = waveComposition(battle.wave);
  battle.waveSize = battle.queue.length;
  battle.killsThisWave = 0;
  battle.spawnTimer = 0;
  battle.elapsed = 0;
  battle.artilleryTimer = artilleryIntervalSeconds(battle.wave);
  battle.active = true;
}

function runWaves(state, dt, events) {
  const battle = state.battle;
  if (!battle.active) {
    battle.pause -= dt;
    if (battle.pause <= 0) startWave(state);
    return;
  }
  battle.elapsed += dt;
  if (battle.elapsed > BATTLE.waveTimeLimitSeconds) {
    retreat(state, events, "stalled");
    return;
  }
  battle.spawnTimer -= dt;
  while (battle.queue.length > 0 && battle.spawnTimer <= 0) {
    spawnEnemy(state, battle.queue.shift());
    battle.spawnTimer += BATTLE.spawnIntervalSeconds;
  }
  const enemiesLeft = state.units.some((unit) => unit.side === "enemy");
  if (battle.queue.length > 0 || enemiesLeft) return;

  const clearedWave = battle.wave;
  const bonus = enemyStats("lightTank", clearedWave).salvage * ENEMY_SCALING.clearBonusKills * salvageMultiplier(state);
  state.resources.salvage += bonus;
  state.stats.salvageEarned += bonus;
  if (battle.autoAdvance) battle.wave += 1;
  battle.maxWave = Math.max(battle.maxWave, battle.wave);
  battle.active = false;
  battle.pause = BATTLE.clearPauseSeconds;
  events.push({ type: "waveClear", wave: clearedWave, bonus });
}

function retreat(state, events, reason) {
  const battle = state.battle;
  state.units = state.units.filter((unit) => unit.side !== "enemy");
  battle.queue = [];
  battle.active = false;
  battle.pause = BATTLE.retreatPauseSeconds;
  const lostWave = battle.wave;
  battle.wave = Math.max(1, battle.wave - 1);
  events.push({ type: "retreat", reason, wave: lostWave });
}

function killUnit(state, unit, events) {
  if (unit.side === "enemy") {
    const salvage = unit.salvage * salvageMultiplier(state);
    const intel = unit.intel * intelMultiplier(state);
    state.resources.salvage += salvage;
    state.resources.intel += intel;
    state.stats.salvageEarned += salvage;
    state.stats.intelEarned += intel;
    state.stats.kills += 1;
    state.battle.killsThisWave += 1;
    events.push({ type: "kill", id: unit.id, side: "enemy", kind: unit.kind, x: unit.x, z: unit.z, salvage, intel, boss: Boolean(ENEMY_KINDS[unit.kind].boss) });
    return;
  }
  state.stats.tanksLost += 1;
  const model = MODEL_BY_ID[unit.kind];
  const steelCost = model.parts.hull * 3 + model.parts.turret * 2 + model.parts.engine * 2;
  const recovered = steelCost * 0.2 * researchLevel(state, "recovery");
  state.resources.steel = Math.min(storageCap(state, "steel"), state.resources.steel + recovered);
  events.push({ type: "kill", id: unit.id, side: "ally", kind: unit.kind, x: unit.x, z: unit.z });
}

function frontUnit(units, side) {
  let best = null;
  for (const unit of units) {
    if (unit.side !== side || unit.hp <= 0) continue;
    if (best === null) best = unit;
    else if (side === "ally" ? unit.x > best.x : unit.x < best.x) best = unit;
  }
  return best;
}

function runCombat(state, dt, events) {
  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const enemySide = unit.side === "ally" ? "enemy" : "ally";
    const target = frontUnit(state.units, enemySide);
    const direction = unit.side === "ally" ? 1 : -1;
    const distance = target === null ? Infinity : (target.x - unit.x) * direction;
    unit.cooldown = Math.max(0, unit.cooldown - dt);
    unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * unit.regenPerSecond * dt);

    if (target !== null && distance <= unit.range) {
      unit.moving = false;
      unit.targetId = target.id;
      if (unit.cooldown <= 0) {
        unit.cooldown = unit.reload;
        const armor = target.armor * unit.penetration;
        target.hp -= effectiveDamage(unit.damage, armor);
        events.push({ type: "shot", from: unit.id, to: target.id, side: unit.side });
        if (target.hp <= 0) killUnit(state, target, events);
      }
      continue;
    }
    unit.targetId = null;
    if (unit.side === "ally") {
      // Hold at the rally line, but close in on enemies that stopped to fire from beyond our range.
      const engaging = target !== null && !target.moving;
      const rallyX = BATTLE.rallyX - unit.holdBack;
      const stopX = engaging ? target.x - unit.range * (0.9 - unit.holdBack / (BATTLE.rallyDepth * 4)) : Math.min(rallyX, target === null ? rallyX : target.x - unit.range);
      unit.moving = unit.x < stopX;
      if (unit.moving) unit.x = Math.min(stopX, unit.x + unit.speed * dt);
    } else {
      unit.moving = true;
      unit.x -= unit.speed * dt;
    }
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
  if (state.units.some((unit) => unit.side === "enemy" && unit.x <= BATTLE.breachX)) retreat(state, events, "breach");
}

function cheapestStationUpgrade(state) {
  if (powerFactor(state) < 1) return "power";
  let bestId = null;
  let bestCost = Infinity;
  for (const station of STATIONS) {
    const cost = stationUpgradeCost(state, station.id);
    if (cost < bestCost) {
      bestCost = cost;
      bestId = station.id;
    }
  }
  return bestId;
}

function cheapestResearch(state) {
  let bestId = null;
  let bestCost = Infinity;
  for (const project of RESEARCH) {
    if (!researchRequirementsMet(state, project.id) || isResearchMaxed(state, project.id)) continue;
    const cost = researchCost(state, project.id);
    if (cost < bestCost) {
      bestCost = cost;
      bestId = project.id;
    }
  }
  return bestId;
}

function runAutomation(state, dt, events) {
  const automation = state.automation;
  if (!automation.upgrades && !automation.research) return;
  automation.timer -= dt;
  if (automation.timer > 0) return;
  automation.timer = AUTOMATION.intervalSeconds;
  if (automation.upgrades) {
    const stationId = cheapestStationUpgrade(state);
    if (stationId !== null && upgradeStation(state, stationId)) events.push({ type: "autoUpgrade", station: stationId });
  }
  if (automation.research) {
    const projectId = cheapestResearch(state);
    if (projectId !== null) buyResearch(state, projectId, events);
  }
}

export function artilleryIntervalSeconds(wave) {
  return Math.max(ARTILLERY.minIntervalSeconds, ARTILLERY.baseIntervalSeconds - ARTILLERY.intervalDropPerWave * (wave - 1));
}

/**
 * Shells deal a share of max HP, so losses never stop no matter how strong the tanks get.
 * This keeps factory throughput relevant at every stage.
 */
function runArtillery(state, dt, events) {
  const battle = state.battle;
  if (!battle.active) return;
  battle.artilleryTimer -= dt;
  if (battle.artilleryTimer > 0) return;
  battle.artilleryTimer += artilleryIntervalSeconds(battle.wave);
  const exposed = state.units.filter((unit) => unit.side === "ally" && unit.x >= ARTILLERY.minX);
  if (exposed.length === 0) return;
  const random = seededRandom(state.nextUnitId * 977 + Math.floor(state.time * 10));
  const aimed = exposed[Math.floor(random() * exposed.length)];
  const x = aimed.x + (random() * 2 - 1) * ARTILLERY.scatter;
  const z = aimed.z + (random() * 2 - 1) * ARTILLERY.scatter;
  events.push({ type: "artillery", x, z });
  const share = ARTILLERY.damageShare * (1 - 0.08 * researchLevel(state, "camouflage"));
  for (const unit of exposed) {
    if (Math.hypot(unit.x - x, unit.z - z) > ARTILLERY.blastRadius) continue;
    unit.hp -= unit.maxHp * share;
    if (unit.hp <= 0) killUnit(state, unit, events);
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
}

export function tick(state, dt, events = []) {
  state.time += dt;
  for (const stationId of CRAFTER_IDS) runCrafter(state, stationId, dt, events);
  runAssembly(state, dt, events);
  deployFromDepot(state, events);
  runWaves(state, dt, events);
  runArtillery(state, dt, events);
  runCombat(state, dt, events);
  runAutomation(state, dt, events);
  return events;
}

export function alliesAtFront(state) {
  return state.units.filter((unit) => unit.side === "ally").length;
}
