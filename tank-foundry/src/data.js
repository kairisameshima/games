export const SIM_STEP_SECONDS = 0.05;
export const OFFLINE_STEP_SECONDS = 0.5;
export const OFFLINE_LIMIT_SECONDS = 8 * 60 * 60;
export const SAVE_KEY = "tank-foundry-save-v1";
export const SAVE_VERSION = 3;

export const BATTLE = {
  gateX: 0,
  /** After a capture the army regroups at the start of the next sector, spread over this depth. */
  startX: 6,
  rallyDepth: 10,
  spawnX: 106,
  laneHalfWidth: 7,
  capturePauseSeconds: 3,
  /** Counterattacking armor never pushes past this point, so there is no breach: only attrition. */
  counterattackLimitX: 14,
};

/**
 * Each sector is a fortified position generated from its number: defensive lines with trenches and
 * emplacements, armor held in reserve, and a fortified base whose fall captures the sector.
 */
export const SECTOR = {
  firstLineX: 44,
  lineSpacing: 15,
  baseX: 98,
  maxLines: 3,
  sectorsPerExtraLine: 3,
  /** Reserve armor wakes when the assault gets this close to the first line. */
  reserveTriggerOffset: 10,
  trenchFromSector: 2,
  trenchWidth: 3.2,
  trenchOffset: 5,
  trenchSpeedFactor: 0.35,
  trenchDamageTaken: 1.6,
  emplacementsBase: 2,
  sectorsPerExtraEmplacement: 4,
  maxEmplacementsPerLine: 5,
  reserveBase: 2,
  sectorsPerExtraReserve: 2,
  maxReserve: 10,
  landshipEvery: 5,
  /** Damaged defenses repair themselves, so a factory too weak to finish them stalls instead of failing. */
  repairPerSecond: 0.004,
  reinforceSeconds: 14,
  maxReinforcements: 4,
  captureBonusShare: 0.5,
  growth: { hp: 1.3, damage: 1.2, armor: 1.1, salvage: 1.32 },
};

export const ARTILLERY = {
  baseIntervalSeconds: 4,
  minIntervalSeconds: 1.2,
  intervalDropPerSector: 0.1,
  damageShare: 0.3,
  blastRadius: 3,
  scatter: 2.5,
  minX: 10,
};

export const START = {
  salvage: 30,
  steel: 10,
  /** Hard limit for rendering. The army is meant to settle below it, where production matches losses. */
  maxFrontTanks: 60,
  depotCap: 3,
  powerPerLevel: 10,
  complexityPerUpgrade: 1.05,
};

export const PARTS = ["hull", "turret", "engine"];

export const PART_LABELS = {
  steel: "Steel",
  hull: "Hulls",
  turret: "Turrets",
  engine: "Engines",
};

export const STATIONS = [
  {
    id: "power",
    name: "Power Station",
    blurb: "Coal boilers that drive every machine. Short on power, the whole plant slows down.",
    powerUse: 0,
    baseCost: 18,
    costGrowth: 1.5,
  },
  {
    id: "mill",
    name: "Steel Mill",
    blurb: "Smelts raw steel for the part shops.",
    output: "steel",
    inputs: {},
    cyclesPerSecond: 1.3,
    powerUse: 1,
    baseStorage: 40,
    storagePerLevel: 20,
    baseCost: 10,
    costGrowth: 1.45,
  },
  {
    id: "hull",
    name: "Hull Works",
    blurb: "Presses and welds armor plate into hulls.",
    output: "hull",
    inputs: { steel: 3 },
    cyclesPerSecond: 0.32,
    powerUse: 2,
    baseStorage: 6,
    storagePerLevel: 4,
    baseCost: 14,
    costGrowth: 1.5,
  },
  {
    id: "turret",
    name: "Turret Shop",
    blurb: "Casts turrets and bores gun barrels.",
    output: "turret",
    inputs: { steel: 2 },
    cyclesPerSecond: 0.3,
    powerUse: 2,
    baseStorage: 6,
    storagePerLevel: 4,
    baseCost: 14,
    costGrowth: 1.5,
  },
  {
    id: "engine",
    name: "Engine Plant",
    blurb: "Builds engines and transmissions.",
    output: "engine",
    inputs: { steel: 2 },
    cyclesPerSecond: 0.26,
    powerUse: 2,
    baseStorage: 6,
    storagePerLevel: 4,
    baseCost: 14,
    costGrowth: 1.5,
  },
  {
    id: "assembly",
    name: "Assembly Hall",
    blurb: "Bolts hulls, turrets and engines into finished tanks.",
    powerUse: 3,
    baseCost: 22,
    costGrowth: 1.6,
  },
];

export const TANK_MODELS = [
  {
    id: "stuart",
    name: "M3 Stuart",
    year: 1941,
    role: "Light tank",
    hp: 60,
    armor: 2,
    damage: 9,
    reload: 1.1,
    range: 14,
    speed: 5.2,
    parts: { hull: 1, turret: 1, engine: 1 },
    buildSeconds: 6,
    paint: 0x6b7340,
  },
  {
    id: "t34",
    name: "T-34/76",
    year: 1942,
    role: "Medium tank",
    hp: 150,
    armor: 6,
    damage: 20,
    reload: 1.5,
    range: 16,
    speed: 4.6,
    parts: { hull: 2, turret: 1, engine: 1 },
    buildSeconds: 8,
    paint: 0x4e5b2c,
  },
  {
    id: "sherman",
    name: "M4 Sherman",
    year: 1943,
    role: "Medium tank",
    hp: 260,
    armor: 9,
    damage: 32,
    reload: 1.4,
    range: 17,
    speed: 4.2,
    parts: { hull: 2, turret: 2, engine: 1 },
    buildSeconds: 10,
    paint: 0x5d6438,
  },
  {
    id: "panther",
    name: "Panther",
    year: 1943,
    role: "Medium tank",
    hp: 520,
    armor: 16,
    damage: 70,
    reload: 1.8,
    range: 22,
    speed: 4.0,
    parts: { hull: 3, turret: 2, engine: 2 },
    buildSeconds: 14,
    paint: 0xb79e5e,
  },
  {
    id: "tiger",
    name: "Tiger I",
    year: 1943,
    role: "Heavy tank",
    hp: 1100,
    armor: 26,
    damage: 130,
    reload: 2.0,
    range: 22,
    speed: 3.2,
    parts: { hull: 4, turret: 3, engine: 2 },
    buildSeconds: 18,
    paint: 0x9c8a5c,
  },
  {
    id: "is2",
    name: "IS-2",
    year: 1944,
    role: "Heavy tank",
    hp: 1900,
    armor: 34,
    damage: 290,
    reload: 3.0,
    range: 21,
    speed: 3.3,
    parts: { hull: 5, turret: 3, engine: 3 },
    buildSeconds: 22,
    paint: 0x52602f,
  },
  {
    id: "kingtiger",
    name: "King Tiger",
    year: 1944,
    role: "Heavy tank",
    hp: 3600,
    armor: 52,
    damage: 420,
    reload: 2.4,
    range: 26,
    speed: 2.9,
    parts: { hull: 6, turret: 4, engine: 3 },
    buildSeconds: 28,
    paint: 0x7d7a4a,
  },
  {
    id: "maus",
    name: "Maus",
    year: 1945,
    role: "Super-heavy tank",
    hp: 9500,
    armor: 85,
    damage: 950,
    reload: 3.0,
    range: 25,
    speed: 2.2,
    parts: { hull: 10, turret: 6, engine: 5 },
    buildSeconds: 40,
    paint: 0x6e6a44,
  },
];

/** Stats at sector 1. Structures never move; `range` and `damage` define how far and how hard they reach. */
export const ENEMY_KINDS = {
  armoredCar: { name: "Armored Car", hp: 24, armor: 0, damage: 3, reload: 1.2, range: 11, speed: 4.4, salvage: 3 },
  lightTank: { name: "Light Tank", hp: 46, armor: 2, damage: 5, reload: 1.4, range: 12, speed: 3.8, salvage: 5 },
  mediumTank: { name: "Medium Tank", hp: 95, armor: 5, damage: 9, reload: 1.6, range: 14, speed: 3.4, salvage: 9 },
  tankDestroyer: { name: "Assault Gun", hp: 80, armor: 7, damage: 17, reload: 2.4, range: 18, speed: 3.0, salvage: 11 },
  heavyTank: { name: "Heavy Tank", hp: 230, armor: 12, damage: 19, reload: 2.2, range: 16, speed: 2.6, salvage: 20 },
  landship: { name: "Landship", hp: 700, armor: 6, damage: 22, reload: 2.5, range: 18, speed: 1.5, salvage: 120 },
  pillbox: { name: "Pillbox", hp: 80, armor: 3, damage: 3, reload: 0.8, range: 13, speed: 0, salvage: 8, structure: true },
  atGun: { name: "AT Gun", hp: 45, armor: 1, damage: 12, reload: 2.6, range: 18, speed: 0, salvage: 8, structure: true },
  bunker: { name: "Bunker", hp: 220, armor: 7, damage: 9, reload: 2.0, range: 16, speed: 0, salvage: 18, structure: true },
  hq: { name: "Fortified Base", hp: 420, armor: 5, damage: 9, reload: 2.2, range: 15, speed: 0, salvage: 60, structure: true, base: true },
};

/** Emplacement kinds available from a sector onward, weighted by `weight`. */
export const EMPLACEMENT_POOL = [
  { kind: "pillbox", fromSector: 1, weight: 4 },
  { kind: "atGun", fromSector: 2, weight: 3 },
  { kind: "bunker", fromSector: 3, weight: 3 },
];

/** Armor held in reserve and sent as reinforcements, available from a sector onward. */
export const ARMOR_POOL = [
  { kind: "armoredCar", fromSector: 1, weight: 4 },
  { kind: "lightTank", fromSector: 1, weight: 4 },
  { kind: "mediumTank", fromSector: 3, weight: 3 },
  { kind: "tankDestroyer", fromSector: 4, weight: 2 },
  { kind: "heavyTank", fromSector: 6, weight: 2 },
];

export const DOCTRINE_GROUPS = [
  { id: "military", name: "Military" },
  { id: "industry", name: "Industry" },
];

/** Permanent upgrades bought with medals. They survive every regroup. */
export const DOCTRINES = [
  { id: "gun", group: "military", name: "Gun Caliber", desc: "+15% tank damage per level. Tanks take 5% longer to build.", cost: 1, growth: 1.35, max: 999 },
  { id: "plating", group: "military", name: "Armor Plating", desc: "+15% tank HP and +8% armor per level. Tanks take 5% longer to build.", cost: 1, growth: 1.35, max: 999 },
  { id: "penetrator", group: "military", name: "AP Shells", desc: "Ignore 7% of enemy armor per level.", cost: 3, growth: 1.6, max: 12 },
  { id: "optics", group: "military", name: "Gun Optics", desc: "+5% range per level.", cost: 2, growth: 1.7, max: 10 },
  { id: "engines", group: "military", name: "Engine Tuning", desc: "+10% tank speed per level.", cost: 2, growth: 1.7, max: 10 },
  { id: "repair", group: "military", name: "Field Repair", desc: "Tanks regenerate 0.5% HP per second per level.", cost: 4, growth: 1.75, max: 10 },
  { id: "camouflage", group: "military", name: "Camouflage Nets", desc: "-8% artillery damage per level.", cost: 3, growth: 1.8, max: 8 },
  { id: "bessemer", group: "industry", name: "Bessemer Process", desc: "+25% steel mill output per level.", cost: 1, growth: 1.45, max: 999 },
  { id: "tooling", group: "industry", name: "Machine Tooling", desc: "+25% hull, turret and engine output per level.", cost: 1, growth: 1.45, max: 999 },
  { id: "jigs", group: "industry", name: "Assembly Jigs", desc: "+25% assembly speed per level.", cost: 2, growth: 1.5, max: 999 },
  { id: "grid", group: "industry", name: "Power Grid", desc: "+30% power output per level.", cost: 1, growth: 1.45, max: 999 },
  { id: "warehouses", group: "industry", name: "Warehouses", desc: "+50% storage and +1 depot slot per level.", cost: 2, growth: 1.65, max: 20 },
  { id: "scavenging", group: "industry", name: "Scavenging", desc: "+20% salvage from kills per level.", cost: 2, growth: 1.5, max: 999 },
  { id: "recovery", group: "industry", name: "Recovery Crews", desc: "Each lost tank returns 20% of its steel per level.", cost: 5, growth: 2, max: 5 },
  { id: "requisition", group: "industry", name: "Automated Requisition", desc: "Unlocks auto-upgrading of factory stations.", cost: 8, growth: 1, max: 1 },
];

/** Tank designs bought with salvage. They reset with the factory on every regroup. */
export const BLUEPRINTS = [
  { model: "t34", desc: "Sloped armor and a 76 mm gun.", cost: 250 },
  { model: "sherman", desc: "A reliable 75 mm medium tank.", cost: 2500 },
  { model: "panther", desc: "Long 75 mm gun with a fast, flat shot.", cost: 25000 },
  { model: "tiger", desc: "Thick armor and the 88 mm gun.", cost: 250000 },
  { model: "is2", desc: "A 122 mm gun that cracks heavy armor.", cost: 2.5e6 },
  { model: "kingtiger", desc: "Long 88 mm gun behind sloped heavy armor.", cost: 2.5e7 },
  { model: "maus", desc: "188 tonnes of steel and a 128 mm gun.", cost: 2.5e8 },
];

/** Regrouping resets the factory and front for medals that scale with the run's best sector. */
export const PRESTIGE = {
  minSector: 3,
  medalsAtMinSector: 3,
  medalGrowth: 1.25,
  stallSeconds: 180,
};

/** An offensive commits tanks from the front line to retake sectors up to the best ever captured. */
export const OFFENSIVE = {
  sectors: 2,
  /** Offensives stop this many sectors short of the record, so a young factory is not stranded too deep. */
  recordMargin: 2,
  baseValue: 6,
  valuePerSector: 2,
};

export const AUTOMATION = {
  intervalSeconds: 1,
};
