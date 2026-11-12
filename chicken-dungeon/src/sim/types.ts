import type { MonsterKindId } from "../data/bestiary.ts";
import type { UpgradeId, UpgradeLevels } from "../data/upgrades.ts";
import type { Floor } from "../gen/floor.ts";
import type { Point } from "../gen/grid.ts";
import type { MonsterSpawn } from "../gen/population.ts";

/** Anything that walks tile to tile. Positions are tile coordinates, integers on tile centers. */
export interface Mover {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  path: Point[];
}

export type ChickenActivity = "home" | "explore" | "descend" | "fight" | "flee" | "recalled" | "dead";

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
  attackCooldownTicks: number;
  slowedUntilTick: number;
  slowMultiplier: number;
  /** Uncapped. Banked only when the chicken exits alive. */
  pouchGold: number;
  exploreTarget: Point | null;
  lootTargetId: number | null;
  fightTargetId: number | null;
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
}

export interface LootPile {
  readonly id: number;
  x: number;
  y: number;
  gold: number;
  /** Dropped where a chicken died. Holds that chicken's pouch. */
  isFeatherPile: boolean;
}

export interface FloorState {
  floor: Floor;
  /** Tick on which each tile was last inside a chicken's vision. Equal to the current tick means visible now. */
  lastSeenTick: Int32Array;
  monsters: Monster[];
  lootPiles: LootPile[];
  /** Kills since the last Recall. Recall brings a share of them back. */
  killedThisExpedition: MonsterSpawn[];
}

export interface GameState {
  readonly seed: number;
  tick: number;
  /** Shared id counter for monsters and loot piles. */
  nextEntityId: number;
  floors: Map<number, FloorState>;
  chickens: Chicken[];
  deepestDepth: number;
  bankedGold: number;
  /** Gold banked by returning chickens over the recent window. Drives the offline gold rate. */
  bankLog: BankRecord[];
  upgradeLevels: UpgradeLevels;
}

export interface BankRecord {
  tick: number;
  gold: number;
}

export type Command = { type: "send" } | { type: "recall" } | { type: "buyUpgrade"; upgrade: UpgradeId };

export type GameEvent =
  | { type: "reachedFloor"; chickenId: number; depth: number }
  | { type: "returnedHome"; chickenId: number; goldBanked: number }
  | { type: "chickenDied"; chickenId: number; depth: number; killer: MonsterKindId }
  | { type: "upgradeBought"; upgrade: UpgradeId; level: number };
