export type UpgradeId =
  | "sharperBeaks"
  | "thickerFeathers"
  | "hardenedComb"
  | "quickFeet"
  | "braveHeart"
  | "lanternOil"
  | "biggerCrop"
  | "coopExpansion"
  | "warmStraw"
  | "layingMash"
  | "biggerNests"
  | "nestCraft";

export type UpgradeLevels = Record<UpgradeId, number>;

export interface Upgrade {
  name: string;
  effect: string;
  baseCost: number;
  growth: number;
  /** Null means uncapped. */
  maxLevel: number | null;
}

/** Global upgrades from the bible's table. Insertion order is the order the coop panel lists them. */
export const UPGRADES: Readonly<Record<UpgradeId, Upgrade>> = {
  sharperBeaks: { name: "Sharper Beaks", effect: "ATK ×1.10", baseCost: 10, growth: 1.15, maxLevel: null },
  thickerFeathers: { name: "Thicker Feathers", effect: "HP ×1.10", baseCost: 10, growth: 1.15, maxLevel: null },
  hardenedComb: { name: "Hardened Comb", effect: "DEF +1", baseCost: 25, growth: 1.2, maxLevel: 50 },
  quickFeet: { name: "Quick Feet", effect: "Speed +3%", baseCost: 40, growth: 1.25, maxLevel: 25 },
  braveHeart: { name: "Brave Heart", effect: "Flee 2% later", baseCost: 60, growth: 1.3, maxLevel: 10 },
  lanternOil: { name: "Lantern Oil", effect: "Vision +1", baseCost: 80, growth: 1.5, maxLevel: 5 },
  biggerCrop: { name: "Bigger Crop", effect: "Carry +1 egg", baseCost: 100, growth: 1.6, maxLevel: 6 },
  coopExpansion: { name: "Coop Expansion", effect: "Flock cap +2", baseCost: 50, growth: 1.45, maxLevel: 20 },
  warmStraw: { name: "Warm Straw", effect: "Hatch 8% faster", baseCost: 30, growth: 1.25, maxLevel: 15 },
  layingMash: { name: "Laying Mash", effect: "Lay 6% faster", baseCost: 30, growth: 1.25, maxLevel: 15 },
  biggerNests: { name: "Bigger Nests", effect: "+1 brood slot", baseCost: 200, growth: 2.5, maxLevel: 3 },
  nestCraft: { name: "Nest Craft", effect: "Next nest tier", baseCost: 100, growth: 10, maxLevel: 3 },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function noUpgrades(): UpgradeLevels {
  return {
    sharperBeaks: 0,
    thickerFeathers: 0,
    hardenedComb: 0,
    quickFeet: 0,
    braveHeart: 0,
    lanternOil: 0,
    biggerCrop: 0,
    coopExpansion: 0,
    warmStraw: 0,
    layingMash: 0,
    biggerNests: 0,
    nestCraft: 0,
  };
}

/** `upgrade_cost(L) = base_cost × growth^L`, rounded to whole gold. `level` is the current level, starting at 0. */
export function upgradeCost(upgrade: Upgrade, level: number): number {
  return Math.round(upgrade.baseCost * upgrade.growth ** level);
}
