export type AncestralNodeId = "secondHen" | "inheritance" | "ancestralNest" | "dinnerBell" | "longNight";

export type AncestralRanks = Record<AncestralNodeId, number>;

export interface AncestralNode {
  name: string;
  effect: string;
  baseCost: number;
  maxRank: number;
}

/**
 * The Ancestral Coop nodes that act on systems the game has. Deep Roost, Silkie and Cemani Bloodlines, Bone Hens,
 * Familiar Instinct, and Heirloom wait for Roosts, breeds, spells, and items.
 */
export const ANCESTRAL_NODES: Readonly<Record<AncestralNodeId, AncestralNode>> = {
  secondHen: { name: "Second Hen", effect: "+1 starting hen", baseCost: 3, maxRank: 3 },
  inheritance: { name: "Inheritance", effect: "Starting gold", baseCost: 2, maxRank: 5 },
  ancestralNest: { name: "Ancestral Nest", effect: "Start with Nest Craft", baseCost: 4, maxRank: 3 },
  dinnerBell: { name: "Dinner Bell", effect: "Auto-recall rules", baseCost: 4, maxRank: 1 },
  longNight: { name: "Long Night", effect: "Offline cap +4 h", baseCost: 3, maxRank: 3 },
};

export const ANCESTRAL_NODE_IDS = Object.keys(ANCESTRAL_NODES) as AncestralNodeId[];

export const VOLUNTARY_RITE_MIN_DEPTH = 10;
export const LONG_NIGHT_MINUTES_PER_RANK = 4 * 60;

const BLOODLINE_BONUS_PER_YOLK = 0.02;
const DEPTH_YOLK_WEIGHT = 2;
const DEPTH_YOLK_DIVISOR = 5;
const DEPTH_YOLK_EXPONENT = 1.5;
const BOSS_YOLK_WEIGHT = 3;
const INHERITANCE_BASE_GOLD = 100;
const INHERITANCE_GROWTH = 4;

export function noAncestralRanks(): AncestralRanks {
  return { secondHen: 0, inheritance: 0, ancestralNest: 0, dinnerBell: 0, longNight: 0 };
}

/** `node_cost(rank) = base_cost × 2^rank`, where `rank` is the current rank, starting at 0. */
export function ancestralNodeCost(node: AncestralNode, rank: number): number {
  return node.baseCost * 2 ** rank;
}

/** `golden_yolks = floor(2 × (D_max / 5)^1.5 + log10(1 + G_total) + 3 × B)` */
export function goldenYolksEarned(deepestDepth: number, goldBanked: number, bossesKilled: number): number {
  return Math.floor(
    DEPTH_YOLK_WEIGHT * (deepestDepth / DEPTH_YOLK_DIVISOR) ** DEPTH_YOLK_EXPONENT + Math.log10(1 + goldBanked) + BOSS_YOLK_WEIGHT * bossesKilled,
  );
}

/** `bloodline_multiplier = 1 + 0.02 × lifetime_golden_yolks`, applied to chicken HP, ATK, and all gold income. */
export function bloodlineMultiplier(lifetimeGoldenYolks: number): number {
  return 1 + BLOODLINE_BONUS_PER_YOLK * lifetimeGoldenYolks;
}

/** Rank 1 starts a run with 100 gold, and each further rank multiplies it by 4. Rank 0 starts with none. */
export function inheritanceGold(rank: number): number {
  return rank === 0 ? 0 : INHERITANCE_BASE_GOLD * INHERITANCE_GROWTH ** (rank - 1);
}
