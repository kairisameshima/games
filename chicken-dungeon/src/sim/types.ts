import type { AncestralNodeId, AncestralRanks } from "../data/ancestry.ts";
import type { MonsterKindId } from "../data/bestiary.ts";
import type { UpgradeId, UpgradeLevels } from "../data/upgrades.ts";
import type { Floor } from "../gen/floor.ts";
import type { Point } from "../gen/grid.ts";
import type { MonsterSpawn } from "../gen/population.ts";
import type { Rng } from "../rng.ts";

/** Anything that walks tile to tile. Positions are tile coordinates, integers on tile centers. */
export interface Mover {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  path: Point[];
}

export type ChickenActivity =
  | "home"
  | "explore"
  | "descend"
  | "fight"
  | "flee"
  | "recalled"
  | "build"
  | "brood"
  | "teardown"
  | "dead";

export interface Egg {
  readonly id: number;
  readonly laidAtDepth: number;
  incubationTicksLeft: number;
}

export interface Chicken extends Mover {
  readonly id: number;
  readonly name: string;
  activity: ChickenActivity;
  /** 0 while at the coop, otherwise the floor number. */
  depth: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  courage: number;
  /** Sight radius in tiles. */
  vision: number;
  /** Egg slots. Gold never uses slots. */
  carry: number;
  layIntervalSeconds: number;
  /** 1.1 for a mutated hatchling, otherwise 1. Kept so upgrades re-derive stats without losing it. */
  statBonus: number;
  attackCooldownTicks: number;
  slowedUntilTick: number;
  slowMultiplier: number;
  /** Uncapped. Banked only when the chicken exits alive. */
  pouchGold: number;
  /** Packed during a teardown. They hatch at the coop if this chicken gets home, and break if it dies. */
  carriedEggs: Egg[];
  exploreTarget: Point | null;
  lootTargetId: number | null;
  fightTargetId: number | null;
  /** The nest this chicken broods in, or is tearing down. */
  nestId: number | null;
  /** The Den Site this chicken is converting into a nest. */
  buildSite: Point | null;
  /** Ticks left on the current build. */
  taskTicksLeft: number;
  layTicksLeft: number;
}

export interface Monster extends Mover {
  readonly id: number;
  readonly kind: MonsterKindId;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  aggroRadius: number;
  attackCooldownTicks: number;
  targetChickenId: number | null;
  agitated: boolean;
  home: Point;
  /** The den that spawned this monster, which caps how many it keeps alive. */
  denId: number | null;
  /** A raider goes for this nest and ignores hens until one pecks it. */
  raidNestId: number | null;
  /** Dens only: ticks until the next spawn. */
  spawnCooldownTicks: number;
}

export interface LootPile {
  readonly id: number;
  x: number;
  y: number;
  gold: number;
  /** Dropped where a chicken died. Holds that chicken's pouch. */
  isFeatherPile: boolean;
}

export interface Nest {
  readonly id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Index into NEST_TIERS, fixed when the nest is built. */
  tier: number;
  eggs: Egg[];
  /** Counts down during a Recall teardown, otherwise null. */
  teardownTicksLeft: number | null;
}

export interface FloorState {
  floor: Floor;
  /** Tick on which each tile was last inside a chicken's vision. Equal to the current tick means visible now. */
  lastSeenTick: Int32Array;
  monsters: Monster[];
  lootPiles: LootPile[];
  /** Kills since the last Recall. Recall brings a share of them back. */
  killedThisExpedition: MonsterSpawn[];
  nests: Nest[];
  /** Where dens were destroyed or nests torn down. A hen can convert one into a nest. */
  denSites: Point[];
  wandererCooldownTicks: number;
}

export interface GameState {
  readonly seed: number;
  tick: number;
  /** Runtime rolls: den spawns, wanderer spots, raids, mutations. Floor layouts use their own seeded rolls. */
  rng: Rng;
  /** Shared id counter for monsters, loot piles, nests, and eggs. */
  nextEntityId: number;
  floors: Map<number, FloorState>;
  chickens: Chicken[];
  deepestDepth: number;
  bankedGold: number;
  /** Gold banked by returning chickens over the recent window. Drives the offline gold rate. */
  bankLog: BankRecord[];
  upgradeLevels: UpgradeLevels;
  /** How many hens should brood in nests. */
  broodQuota: number;
  /** Eggs carried home, incubating at the coop. */
  coopEggs: Egg[];
  yolkMana: number;
  /** All gold banked this run, offline gold included. Feeds the Golden Yolk formula. */
  totalGoldBanked: number;
  /** The tick of the last Send, for the Dinner Bell's timer rule. */
  lastSendTick: number;
  /** Everything that survives prestige. */
  legacy: Legacy;
  /** Set when the run has ended and the Rite screen is waiting. The sim stops until the next run begins. */
  rite: RiteSummary | null;
}

export interface FallenChicken {
  run: number;
  name: string;
  depth: number;
  killer: MonsterKindId;
}

/** Dinner Bell rules. Null turns a rule off. The first rule met recalls the flock. */
export interface AutoRecallRules {
  everyMinutes: number | null;
  pouchGold: number | null;
  flockHpPercent: number | null;
}

export interface Legacy {
  /** Unspent Golden Yolks. */
  goldenYolks: number;
  /** Every Golden Yolk ever earned. Sets the Bloodline multiplier and is never spent. */
  lifetimeGoldenYolks: number;
  ancestralRanks: AncestralRanks;
  /** The current run, starting at 1. */
  run: number;
  rollOfFeathers: FallenChicken[];
  autoRecall: AutoRecallRules;
}

export interface RiteSummary {
  trigger: "extinction" | "voluntary";
  deepestDepth: number;
  goldBanked: number;
  goldenYolksEarned: number;
}

export interface BankRecord {
  tick: number;
  gold: number;
}

export type Command =
  | { type: "send" }
  | { type: "recall" }
  | { type: "buyUpgrade"; upgrade: UpgradeId }
  | { type: "setBroodQuota"; quota: number }
  | { type: "buyAncestralNode"; node: AncestralNodeId }
  | { type: "setAutoRecall"; rules: AutoRecallRules }
  | { type: "performRite" };

export type GameEvent =
  | { type: "reachedFloor"; chickenId: number; depth: number }
  | { type: "returnedHome"; chickenId: number; goldBanked: number; eggsCarried: number }
  | { type: "chickenDied"; chickenId: number; depth: number; killer: MonsterKindId; eggsLost: number }
  | { type: "upgradeBought"; upgrade: UpgradeId; level: number }
  | { type: "denDestroyed"; depth: number }
  | { type: "nestBuilt"; chickenId: number; depth: number }
  | { type: "nestDestroyed"; depth: number; eggsLost: number }
  | { type: "campStruck"; depth: number; eggsPacked: number; eggsCracked: number }
  | { type: "chickHatched"; chickenId: number; depth: number; mutated: boolean }
  | { type: "ancestralNodeBought"; node: AncestralNodeId; rank: number }
  | { type: "autoRecalled" };
