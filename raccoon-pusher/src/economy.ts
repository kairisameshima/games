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
/** Every machine beaten adds this much to the payout multiplier, for good. */
const LEGACY_BONUS_PER_MACHINE = 0.5;
/**
 * Coins that come back per coin dropped, by side wall level, measured in a headless run of the machine at steady
 * state. Offline earnings use these instead of simulating physics.
 */
const SIDE_WALL_RETURN_BY_LEVEL = [0.65, 0.84, 0.98, 1.05];
/** Time away past this earns nothing, so a week-old tab is not a jackpot. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

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

/** Permanent payout multiplier from grand prizes won. */
export function legacyMultiplier(machinesBeaten: number): number {
  return 1 + machinesBeaten * LEGACY_BONUS_PER_MACHINE;
}

/** Coins added to the bag for each coin pushed over the front edge, including the bonus from beaten machines. */
export function payoutPerWonCoin(wallet: Wallet, machinesBeaten: number): number {
  return (1 + wallet.upgrades.stickyPaws * STICKY_PAWS_BONUS_PER_LEVEL) * legacyMultiplier(machinesBeaten);
}

export function autoDropSeconds(wallet: Wallet): number | undefined {
  return AUTO_DROP_SECONDS_BY_LEVEL[wallet.upgrades.autoDropper];
}

/**
 * Coins the Auto-Dropper nets while the player is away: each drop costs a coin and returns the measured share,
 * times the payout multiplier. A machine that loses coins on balance earns nothing rather than draining the bag.
 */
export function offlineEarnings(wallet: Wallet, machinesBeaten: number, secondsAway: number): number {
  const interval = autoDropSeconds(wallet);
  if (interval === undefined) return 0;
  const drops = Math.floor(Math.min(secondsAway, MAX_OFFLINE_SECONDS) / interval);
  const netPerDrop = SIDE_WALL_RETURN_BY_LEVEL[wallet.upgrades.sideWalls] * payoutPerWonCoin(wallet, machinesBeaten) - 1;
  return Math.max(0, Math.floor(drops * netPerDrop));
}
