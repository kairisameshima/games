import type { MachineSettings } from "./machine.ts";

export type UpgradeId = "sideWalls" | "stickyPaws" | "wideGate" | "autoDropper";

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  /** What the next level does, shown on the shop button. */
  describeNext: (level: number) => string;
  /** Price of the next level, or undefined once the upgrade is maxed out. */
  costOf: (level: number) => number | undefined;
}

/** Side walls by level. The base board leaks about a third of its coins into the gutters; full walls leak none. */
const SIDE_WALL_END_Z_BY_LEVEL = [-1.5, 0, 1.5, 3];
const SIDE_WALL_COSTS = [25, 120, 600];
const GATE_TOLERANCE_BY_LEVEL = [0.4, 0.55, 0.7, 0.85];
const WIDE_GATE_COSTS = [40, 200, 800];
/** Seconds between automatic drops by level; level 0 has no dropper. */
const AUTO_DROP_SECONDS_BY_LEVEL = [undefined, 2, 1.2, 0.8, 0.5];
const AUTO_DROPPER_COSTS = [60, 250, 900, 3_000];
const STICKY_PAWS_BONUS_PER_LEVEL = 0.25;
const STICKY_PAWS_MAX_LEVEL = 8;
const STICKY_PAWS_BASE_COST = 30;
const STICKY_PAWS_COST_GROWTH = 1.9;

export const BOMB_COST = 15;
/** Enough for Side Walls plus Sticky Paws, the pair that first makes the machine pay back more than you feed it. */
export const STARTING_BAG = 60;

export const UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: "sideWalls",
    name: "SIDE WALLS",
    describeNext: () => "Fewer coins lost to the gutters",
    costOf: (level) => SIDE_WALL_COSTS[level],
  },
  {
    id: "stickyPaws",
    name: "STICKY PAWS",
    describeNext: (level) => `Won coins pay x${(1 + (level + 1) * STICKY_PAWS_BONUS_PER_LEVEL).toFixed(2)}`,
    costOf: (level) =>
      level < STICKY_PAWS_MAX_LEVEL ? Math.round(STICKY_PAWS_BASE_COST * STICKY_PAWS_COST_GROWTH ** level) : undefined,
  },
  {
    id: "wideGate",
    name: "WIDE GATE",
    describeNext: () => "Bigger slot gate",
    costOf: (level) => WIDE_GATE_COSTS[level],
  },
  {
    id: "autoDropper",
    name: "AUTO-DROPPER",
    describeNext: (level) => `Drops a coin every ${AUTO_DROP_SECONDS_BY_LEVEL[level + 1]}s`,
    costOf: (level) => AUTO_DROPPER_COSTS[level],
  },
];

export interface Wallet {
  /** Coins on hand. Fractional because Sticky Paws pays partial coins. */
  bag: number;
  upgrades: Record<UpgradeId, number>;
  bombs: number;
}

export function createWallet(): Wallet {
  return { bag: STARTING_BAG, upgrades: { sideWalls: 0, stickyPaws: 0, wideGate: 0, autoDropper: 0 }, bombs: 0 };
}

function upgradeDefinition(id: UpgradeId): UpgradeDefinition {
  const definition = UPGRADES.find((upgrade) => upgrade.id === id);
  if (!definition) throw new Error(`Unknown upgrade ${id}`);
  return definition;
}

export function upgradeCost(wallet: Wallet, id: UpgradeId): number | undefined {
  return upgradeDefinition(id).costOf(wallet.upgrades[id]);
}

export function buyUpgrade(wallet: Wallet, id: UpgradeId): boolean {
  const cost = upgradeCost(wallet, id);
  if (cost === undefined || wallet.bag < cost) return false;
  wallet.bag -= cost;
  wallet.upgrades[id] += 1;
  return true;
}

export function buyBomb(wallet: Wallet): boolean {
  if (wallet.bag < BOMB_COST) return false;
  wallet.bag -= BOMB_COST;
  wallet.bombs += 1;
  return true;
}

export function machineSettings(wallet: Wallet): MachineSettings {
  return {
    sideWallEndZ: SIDE_WALL_END_Z_BY_LEVEL[wallet.upgrades.sideWalls],
    gateTolerance: GATE_TOLERANCE_BY_LEVEL[wallet.upgrades.wideGate],
  };
}

/** Coins added to the bag for each coin pushed over the front edge. */
export function payoutPerWonCoin(wallet: Wallet): number {
  return 1 + wallet.upgrades.stickyPaws * STICKY_PAWS_BONUS_PER_LEVEL;
}

export function autoDropSeconds(wallet: Wallet): number | undefined {
  return AUTO_DROP_SECONDS_BY_LEVEL[wallet.upgrades.autoDropper];
}
