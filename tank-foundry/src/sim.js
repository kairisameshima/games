import {
  ARTILLERY,
  AUTOMATION,
  BATTLE,
  BLUEPRINTS,
  DOCTRINES,
  ARMOR_POOL,
  EMPLACEMENT_POOL,
  ENEMY_KINDS,
  OFFENSIVE,
  PARTS,
  PRESTIGE,
  SECTOR,
  START,
  STATIONS,
  TANK_MODELS,
} from "./data.js";

export const MODEL_BY_ID = Object.fromEntries(TANK_MODELS.map((model) => [model.id, model]));
export const STATION_BY_ID = Object.fromEntries(STATIONS.map((station) => [station.id, station]));
export const DOCTRINE_BY_ID = Object.fromEntries(DOCTRINES.map((doctrine) => [doctrine.id, doctrine]));
export const BLUEPRINT_BY_MODEL = Object.fromEntries(BLUEPRINTS.map((blueprint) => [blueprint.model, blueprint]));

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
    resources: { salvage: START.salvage, steel: START.steel },
    parts: { hull: 0, turret: 0, engine: 0 },
    stations,
    doctrine: {},
    blueprints: {},
    production: "stuart",
    depot: [],
    units: [],
    nextUnitId: 1,
    battle: {
      sector: 1,
      maxSector: 1,
      progressTime: 0,
      pause: 1,
      active: false,
      trenches: [],
      defensesTotal: 0,
      reinforceTimer: 0,
      artilleryTimer: 0,
    },
    prestige: { medals: 0, count: 0, bestSector: 1 },
    automation: { upgrades: false, timer: 0 },
    stats: { tanksBuilt: 0, tanksLost: 0, tanksCommitted: 0, kills: 0, offensives: 0, salvageEarned: 0 },
  };
}

export function doctrineLevel(state, id) {
  return state.doctrine[id] ?? 0;
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

function pickWeighted(random, pool) {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  return (pool.find((entry) => (roll -= entry.weight) < 0) ?? pool[pool.length - 1]).kind;
}

/**
 * The fortified position for a sector, generated from the sector number alone so the same sector always
 * looks and fights the same. Lines get deeper, wider and tougher as sectors rise.
 */
export function sectorPlan(sector) {
  const random = seededRandom(sector * 7919 + 17);
  const lineCount = Math.min(SECTOR.maxLines, 1 + Math.floor((sector - 1) / SECTOR.sectorsPerExtraLine));
  const emplacementPool = EMPLACEMENT_POOL.filter((entry) => sector >= entry.fromSector);
  const armorPool = ARMOR_POOL.filter((entry) => sector >= entry.fromSector);
  const plan = { trenches: [], emplacements: [], reserve: [], base: { kind: "hq", x: SECTOR.baseX, z: 0 } };
  for (let line = 0; line < lineCount; line += 1) {
    const lineX = SECTOR.firstLineX + line * SECTOR.lineSpacing + (random() - 0.5) * 3;
    if (sector >= SECTOR.trenchFromSector) plan.trenches.push({ x: lineX - SECTOR.trenchOffset, width: SECTOR.trenchWidth });
    const count = Math.min(SECTOR.maxEmplacementsPerLine, SECTOR.emplacementsBase + Math.floor((sector - 1) / SECTOR.sectorsPerExtraEmplacement) + line);
    for (let index = 0; index < count; index += 1) {
      const spread = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
      const z = spread * (BATTLE.laneHalfWidth - 1) + (random() - 0.5) * 1.5;
      plan.emplacements.push({ kind: pickWeighted(random, emplacementPool), x: lineX + (random() - 0.5) * 2, z });
    }
  }
  const reserveCount = Math.min(SECTOR.maxReserve, SECTOR.reserveBase + Math.floor((sector - 1) / SECTOR.sectorsPerExtraReserve));
  for (let index = 0; index < reserveCount; index += 1) {
    plan.reserve.push({ kind: pickWeighted(random, armorPool), x: SECTOR.baseX - 6 - random() * 10, z: (random() * 2 - 1) * (BATTLE.laneHalfWidth - 1) });
  }
  if (sector % SECTOR.landshipEvery === 0) plan.reserve.push({ kind: "landship", x: SECTOR.baseX - 10, z: 0 });
  plan.triggerX = SECTOR.firstLineX - SECTOR.reserveTriggerOffset;
  return plan;
}

export function enemyStats(kindId, sector) {
  const kind = ENEMY_KINDS[kindId];
  const step = sector - 1;
  const growth = SECTOR.growth;
  return {
    hp: kind.hp * growth.hp ** step,
    armor: kind.armor * growth.armor ** step,
    damage: kind.damage * growth.damage ** step,
    reload: kind.reload,
    range: kind.range,
    speed: kind.speed,
    salvage: kind.salvage * growth.salvage ** step,
  };
}

/** Salvage for destroying everything a sector fields at the start, before reinforcements. */
export function sectorValue(state, sector) {
  const plan = sectorPlan(sector);
  let salvage = 0;
  for (const entry of [...plan.emplacements, ...plan.reserve, plan.base]) salvage += enemyStats(entry.kind, sector).salvage;
  return salvage * salvageMultiplier(state);
}

export function trenchAt(state, x) {
  return state.battle.trenches.find((trench) => Math.abs(x - trench.x) <= trench.width / 2) ?? null;
}

export function salvageMultiplier(state) {
  return 1 + 0.2 * doctrineLevel(state, "scavenging");
}

export function tankStats(state, modelId) {
  const model = MODEL_BY_ID[modelId];
  const plating = doctrineLevel(state, "plating");
  return {
    hp: model.hp * 1.15 ** plating,
    armor: model.armor * 1.08 ** plating,
    damage: model.damage * 1.15 ** doctrineLevel(state, "gun"),
    reload: model.reload,
    range: model.range * (1 + 0.05 * doctrineLevel(state, "optics")),
    speed: model.speed * (1 + 0.1 * doctrineLevel(state, "engines")),
    penetration: 1 - 0.07 * doctrineLevel(state, "penetrator"),
    regenPerSecond: 0.005 * doctrineLevel(state, "repair"),
  };
}

export function effectiveDamage(damage, armor) {
  return (damage * damage) / (damage + armor);
}

export function isModelUnlocked(state, modelId) {
  return modelId === TANK_MODELS[0].id || state.blueprints[modelId] === true;
}

/** Blueprints unlock in roster order, so each one needs the model before it. */
export function previousModel(modelId) {
  return TANK_MODELS[TANK_MODELS.findIndex((model) => model.id === modelId) - 1] ?? null;
}

export function canBuyBlueprint(state, modelId) {
  const blueprint = BLUEPRINT_BY_MODEL[modelId];
  if (!blueprint || isModelUnlocked(state, modelId)) return false;
  return isModelUnlocked(state, previousModel(modelId).id) && state.resources.salvage >= blueprint.cost;
}

export function buyBlueprint(state, modelId, events = []) {
  if (!canBuyBlueprint(state, modelId)) return false;
  state.resources.salvage -= BLUEPRINT_BY_MODEL[modelId].cost;
  state.blueprints[modelId] = true;
  state.production = modelId;
  events.push({ type: "blueprint", model: modelId });
  return true;
}

export function unlockedModels(state) {
  return TANK_MODELS.filter((model) => isModelUnlocked(state, model.id));
}

export function deployCap() {
  return START.maxFrontTanks;
}

export function depotCap(state) {
  return START.depotCap + doctrineLevel(state, "warehouses");
}

export function storageCap(state, resourceId) {
  const station = STATIONS.find((entry) => entry.output === resourceId);
  const level = state.stations[station.id].level;
  const base = station.baseStorage + station.storagePerLevel * (level - 1);
  return Math.floor(base * (1 + 0.5 * doctrineLevel(state, "warehouses")));
}

export function powerSupply(state) {
  return START.powerPerLevel * state.stations.power.level * (1 + 0.3 * doctrineLevel(state, "grid"));
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
  if (stationId === "mill") return 1 + 0.25 * doctrineLevel(state, "bessemer");
  if (stationId === "assembly") return 1 + 0.25 * doctrineLevel(state, "jigs");
  return 1 + 0.25 * doctrineLevel(state, "tooling");
}

/**
 * Heavier guns and thicker armor make every tank harder to build, so doctrine
 * keeps pushing the factory to grow instead of letting it idle at the front cap.
 */
export function tankComplexity(state) {
  return START.complexityPerUpgrade ** (doctrineLevel(state, "gun") + doctrineLevel(state, "plating"));
}

/** Cycles per second for crafters, build-seconds of work per second for the assembly hall. */
export function stationRate(state, stationId) {
  const station = STATION_BY_ID[stationId];
  const level = state.stations[stationId].level;
  const base = stationId === "assembly" ? 1 : station.cyclesPerSecond;
  const complexity = stationId === "mill" ? 1 : tankComplexity(state);
  return (base * level * stationResearchMultiplier(state, stationId) * powerFactor(state)) / complexity;
}

/** Relative worth of one tank in an offensive. A Stuart is 1; heavier designs need more parts. */
export function tankValue(modelId) {
  const parts = MODEL_BY_ID[modelId].parts;
  return PARTS.reduce((sum, part) => sum + parts[part], 0) / PARTS.length;
}

export function offensiveCost(state) {
  return OFFENSIVE.baseValue + OFFENSIVE.valuePerSector * state.battle.sector;
}

/**
 * Offensives only retake ground: the target is capped at the best sector ever reached, so pushing the
 * record still takes a factory strong enough to break the position.
 */
export function offensiveTarget(state) {
  return Math.min(state.battle.sector + OFFENSIVE.sectors, state.prestige.bestSector - OFFENSIVE.recordMargin);
}

export function canFallBack(state) {
  return state.battle.sector > 1;
}

/** With no way to lose, a position the factory cannot break would trap the run; falling back frees it. */
export function fallBack(state, events = []) {
  if (!canFallBack(state)) return false;
  const battle = state.battle;
  clearEnemies(state);
  battle.trenches = [];
  battle.active = false;
  battle.pause = BATTLE.capturePauseSeconds;
  battle.sector -= 1;
  events.push({ type: "fallBack", sector: battle.sector });
  return true;
}

export function frontStrength(state) {
  let strength = 0;
  for (const unit of state.units) if (unit.side === "ally") strength += tankValue(unit.kind);
  return strength;
}

export function canLaunchOffensive(state) {
  return offensiveTarget(state) > state.battle.sector && frontStrength(state) >= offensiveCost(state);
}

/** Commits the weakest tanks first until the cost is covered, so the strongest stay to hold the new line. */
function commitTanks(state, cost) {
  const allies = state.units.filter((unit) => unit.side === "ally").sort((a, b) => tankValue(a.kind) - tankValue(b.kind));
  const committed = new Set();
  let paid = 0;
  for (const unit of allies) {
    if (paid >= cost) break;
    committed.add(unit.id);
    paid += tankValue(unit.kind);
  }
  state.units = state.units.filter((unit) => !committed.has(unit.id));
  state.stats.tanksCommitted += committed.size;
  return [...committed];
}

function captureBonus(state, sector) {
  return sectorValue(state, sector) * SECTOR.captureBonusShare;
}

/** What the sectors an offensive skips would have paid if fought one by one, capture bonuses included. */
export function offensiveReward(state) {
  let salvage = 0;
  for (let sector = state.battle.sector; sector < offensiveTarget(state); sector += 1) salvage += sectorValue(state, sector) + captureBonus(state, sector);
  return salvage;
}

/** Any forward movement resets the stall clock; only fought captures raise the run's record. */
function advanceTo(state, sector, fought) {
  const battle = state.battle;
  battle.sector = sector;
  battle.progressTime = state.time;
  if (!fought || sector <= battle.maxSector) return;
  battle.maxSector = sector;
  state.prestige.bestSector = Math.max(state.prestige.bestSector, sector);
}

function clearEnemies(state) {
  for (const unit of state.units) if (unit.side === "enemy") unit.hp = 0;
  state.units = state.units.filter((unit) => unit.hp > 0);
}

/**
 * Commits front-line tanks to break through several sectors at once: their salvage pays out immediately and
 * the factory has to rebuild the army, so a stronger factory turns straight into faster progress.
 */
export function launchOffensive(state, events = []) {
  if (!canLaunchOffensive(state)) return false;
  const battle = state.battle;
  const salvage = offensiveReward(state);
  const fromSector = battle.sector;
  const toSector = offensiveTarget(state);
  const committed = commitTanks(state, offensiveCost(state));
  state.resources.salvage += salvage;
  state.stats.salvageEarned += salvage;
  state.stats.offensives += 1;
  clearEnemies(state);
  battle.active = false;
  battle.pause = BATTLE.capturePauseSeconds;
  advanceTo(state, toSector, false);
  events.push({ type: "offensive", fromSector, toSector, salvage, committed });
  return true;
}

export function medalsForSector(sector) {
  if (sector < PRESTIGE.minSector) return 0;
  return Math.floor(PRESTIGE.medalsAtMinSector * PRESTIGE.medalGrowth ** (sector - PRESTIGE.minSector));
}

export function canPrestige(state) {
  return medalsForSector(state.battle.maxSector) > 0;
}

/** Seconds since the front last moved forward, by capture or offensive. */
export function secondsSinceProgress(state) {
  return state.time - state.battle.progressTime;
}

/**
 * Regroup: everything bought with salvage resets (stations, blueprints and the front).
 * Doctrine, medals, lifetime stats and the auto-upgrade switch carry over.
 */
export function prestige(state, now = Date.now()) {
  if (!canPrestige(state)) return null;
  const next = createInitialState(now);
  next.doctrine = { ...state.doctrine };
  next.prestige = {
    medals: state.prestige.medals + medalsForSector(state.battle.maxSector),
    count: state.prestige.count + 1,
    bestSector: Math.max(state.prestige.bestSector, state.battle.maxSector),
  };
  next.stats = { ...state.stats };
  next.automation.upgrades = state.automation.upgrades && doctrineLevel(state, "requisition") > 0;
  return next;
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

export function doctrineCost(state, id) {
  const doctrine = DOCTRINE_BY_ID[id];
  return Math.ceil(doctrine.cost * doctrine.growth ** doctrineLevel(state, id));
}

export function isDoctrineMaxed(state, id) {
  return doctrineLevel(state, id) >= DOCTRINE_BY_ID[id].max;
}

export function canBuyDoctrine(state, id) {
  return !isDoctrineMaxed(state, id) && state.prestige.medals >= doctrineCost(state, id);
}

export function buyDoctrine(state, id, events = []) {
  if (!canBuyDoctrine(state, id)) return false;
  state.prestige.medals -= doctrineCost(state, id);
  state.doctrine[id] = doctrineLevel(state, id) + 1;
  refreshAllyStats(state);
  events.push({ type: "doctrine", id });
  return true;
}

export function setProduction(state, modelId) {
  if (!isModelUnlocked(state, modelId)) return false;
  state.production = modelId;
  return true;
}

export function setAutoUpgrade(state, enabled) {
  if (enabled && doctrineLevel(state, "requisition") === 0) return false;
  state.automation.upgrades = enabled;
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

function spawnEnemy(state, kindId, x, z, extra = {}) {
  const stats = enemyStats(kindId, state.battle.sector);
  const id = state.nextUnitId++;
  state.units.push({
    id,
    side: "enemy",
    kind: kindId,
    x,
    z,
    hp: stats.hp,
    maxHp: stats.hp,
    armor: stats.armor,
    damage: stats.damage,
    reload: stats.reload,
    range: stats.range,
    speed: stats.speed,
    penetration: 1,
    regenPerSecond: ENEMY_KINDS[kindId].structure ? SECTOR.repairPerSecond : 0,
    salvage: stats.salvage,
    cooldown: stats.reload * 0.5,
    targetId: null,
    moving: false,
    structure: Boolean(ENEMY_KINDS[kindId].structure),
    dormant: false,
    reinforcement: false,
    ...extra,
  });
}

/** Builds the sector's position and moves the army up to its start line. */
function startSector(state, events) {
  const battle = state.battle;
  const plan = sectorPlan(battle.sector);
  battle.trenches = plan.trenches;
  for (const entry of plan.emplacements) spawnEnemy(state, entry.kind, entry.x, entry.z);
  for (const entry of plan.reserve) spawnEnemy(state, entry.kind, entry.x, entry.z, { dormant: true, triggerX: plan.triggerX });
  spawnEnemy(state, plan.base.kind, plan.base.x, plan.base.z);
  battle.defensesTotal = plan.emplacements.length + plan.reserve.length + 1;
  battle.reinforceTimer = SECTOR.reinforceSeconds;
  battle.artilleryTimer = artilleryIntervalSeconds(battle.sector);
  for (const unit of state.units) {
    if (unit.side === "ally") unit.x = Math.min(unit.x, BATTLE.startX + unit.holdBack);
  }
  battle.active = true;
  events.push({ type: "sectorStart", sector: battle.sector });
}

function captureSector(state, events) {
  const battle = state.battle;
  const captured = battle.sector;
  const bonus = captureBonus(state, captured);
  state.resources.salvage += bonus;
  state.stats.salvageEarned += bonus;
  clearEnemies(state);
  battle.trenches = [];
  battle.active = false;
  battle.pause = BATTLE.capturePauseSeconds;
  advanceTo(state, captured + 1, true);
  events.push({ type: "sectorCaptured", sector: captured, bonus });
}

/** While the base stands it keeps feeding armor into the fight, so a stalled assault keeps bleeding tanks. */
function runReinforcements(state, dt) {
  const battle = state.battle;
  battle.reinforceTimer -= dt;
  if (battle.reinforceTimer > 0) return;
  battle.reinforceTimer = SECTOR.reinforceSeconds;
  const alive = state.units.filter((unit) => unit.reinforcement).length;
  if (alive >= SECTOR.maxReinforcements) return;
  const random = seededRandom(state.nextUnitId * 31 + battle.sector);
  const pool = ARMOR_POOL.filter((entry) => battle.sector >= entry.fromSector);
  spawnEnemy(state, pickWeighted(random, pool), BATTLE.spawnX, (random() * 2 - 1) * (BATTLE.laneHalfWidth - 1), { reinforcement: true });
}

function runSector(state, dt, events) {
  const battle = state.battle;
  if (!battle.active) {
    battle.pause -= dt;
    if (battle.pause <= 0) startSector(state, events);
    return;
  }
  // The base is the only win condition, so a running sector without one (for example a save written
  // by an older build) would never end. Treat it as taken.
  if (!state.units.some((unit) => unit.side === "enemy" && ENEMY_KINDS[unit.kind].base)) {
    captureSector(state, events);
    return;
  }
  runReinforcements(state, dt);
}

function killUnit(state, unit, events) {
  if (unit.side === "enemy") {
    const salvage = unit.salvage * salvageMultiplier(state);
    state.resources.salvage += salvage;
    state.stats.salvageEarned += salvage;
    state.stats.kills += 1;
    const base = Boolean(ENEMY_KINDS[unit.kind].base);
    events.push({ type: "kill", id: unit.id, side: "enemy", kind: unit.kind, x: unit.x, z: unit.z, salvage, structure: unit.structure, boss: base });
    if (base) captureSector(state, events);
    return;
  }
  state.stats.tanksLost += 1;
  const model = MODEL_BY_ID[unit.kind];
  const steelCost = model.parts.hull * 3 + model.parts.turret * 2 + model.parts.engine * 2;
  const recovered = steelCost * 0.2 * doctrineLevel(state, "recovery");
  state.resources.steel = Math.min(storageCap(state, "steel"), state.resources.steel + recovered);
  events.push({ type: "kill", id: unit.id, side: "ally", kind: unit.kind, x: unit.x, z: unit.z });
}

/** Allies caught in a trench take extra damage from every source. */
function damageTaken(state, unit, amount) {
  if (unit.side === "ally" && trenchAt(state, unit.x)) return amount * SECTOR.trenchDamageTaken;
  return amount;
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

function wakeReserves(state) {
  let frontX = -Infinity;
  for (const unit of state.units) if (unit.side === "ally") frontX = Math.max(frontX, unit.x);
  for (const unit of state.units) {
    if (unit.dormant && frontX >= unit.triggerX) unit.dormant = false;
  }
}

function moveAlly(state, unit, target, dt) {
  if (target === null) {
    unit.moving = false;
    return;
  }
  // Each tank keeps a slightly different standoff so the line spreads out instead of stacking.
  const stopX = target.x - unit.range * (0.55 + 0.35 * (unit.holdBack / BATTLE.rallyDepth));
  unit.moving = unit.x < stopX;
  if (!unit.moving) return;
  const speed = trenchAt(state, unit.x) ? unit.speed * SECTOR.trenchSpeedFactor : unit.speed;
  unit.x = Math.min(stopX, unit.x + speed * dt);
}

function moveEnemy(unit, dt) {
  unit.moving = !unit.structure && !unit.dormant && unit.x > BATTLE.counterattackLimitX;
  if (unit.moving) unit.x = Math.max(BATTLE.counterattackLimitX, unit.x - unit.speed * dt);
}

function runCombat(state, dt, events) {
  wakeReserves(state);
  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const enemySide = unit.side === "ally" ? "enemy" : "ally";
    const target = frontUnit(state.units, enemySide);
    const direction = unit.side === "ally" ? 1 : -1;
    const distance = target === null ? Infinity : (target.x - unit.x) * direction;
    unit.cooldown = Math.max(0, unit.cooldown - dt);
    unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * unit.regenPerSecond * dt);

    if (target !== null && distance <= unit.range && !unit.dormant) {
      unit.moving = false;
      unit.targetId = target.id;
      if (unit.cooldown <= 0) {
        unit.cooldown = unit.reload;
        const armor = target.armor * unit.penetration;
        target.hp -= damageTaken(state, target, effectiveDamage(unit.damage, armor));
        events.push({ type: "shot", from: unit.id, to: target.id, side: unit.side });
        if (target.hp <= 0) killUnit(state, target, events);
        if (!state.battle.active) break;
      }
      continue;
    }
    unit.targetId = null;
    if (unit.side === "ally") moveAlly(state, unit, target, dt);
    else moveEnemy(unit, dt);
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
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

function runAutomation(state, dt, events) {
  const automation = state.automation;
  if (!automation.upgrades) return;
  automation.timer -= dt;
  if (automation.timer > 0) return;
  automation.timer = AUTOMATION.intervalSeconds;
  const stationId = cheapestStationUpgrade(state);
  if (stationId !== null && upgradeStation(state, stationId)) events.push({ type: "autoUpgrade", station: stationId });
}

export function artilleryIntervalSeconds(sector) {
  return Math.max(ARTILLERY.minIntervalSeconds, ARTILLERY.baseIntervalSeconds - ARTILLERY.intervalDropPerSector * (sector - 1));
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
  battle.artilleryTimer += artilleryIntervalSeconds(battle.sector);
  const exposed = state.units.filter((unit) => unit.side === "ally" && unit.x >= ARTILLERY.minX);
  if (exposed.length === 0) return;
  const random = seededRandom(state.nextUnitId * 977 + Math.floor(state.time * 10));
  const aimed = exposed[Math.floor(random() * exposed.length)];
  const x = aimed.x + (random() * 2 - 1) * ARTILLERY.scatter;
  const z = aimed.z + (random() * 2 - 1) * ARTILLERY.scatter;
  events.push({ type: "artillery", x, z });
  const share = ARTILLERY.damageShare * (1 - 0.08 * doctrineLevel(state, "camouflage"));
  for (const unit of exposed) {
    if (Math.hypot(unit.x - x, unit.z - z) > ARTILLERY.blastRadius) continue;
    unit.hp -= damageTaken(state, unit, unit.maxHp * share);
    if (unit.hp <= 0) killUnit(state, unit, events);
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
}

export function tick(state, dt, events = []) {
  state.time += dt;
  for (const stationId of CRAFTER_IDS) runCrafter(state, stationId, dt, events);
  runAssembly(state, dt, events);
  deployFromDepot(state, events);
  runSector(state, dt, events);
  runArtillery(state, dt, events);
  runCombat(state, dt, events);
  runAutomation(state, dt, events);
  return events;
}

export function alliesAtFront(state) {
  return state.units.filter((unit) => unit.side === "ally").length;
}
