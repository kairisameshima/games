import {
  ANCESTRAL_NODES,
  ancestralNodeCost,
  goldenYolksEarned,
  VOLUNTARY_RITE_MIN_DEPTH,
  type AncestralNodeId,
} from "../data/ancestry.ts";
import { mixSeed } from "../rng.ts";
import { TICKS_PER_SECOND } from "./time.ts";
import type { AutoRecallRules, GameEvent, GameState, RiteSummary } from "./types.ts";
import { createGame, isAlive, isHeadingOut, isInDungeon } from "./world.ts";

// Bosses do not exist yet, so the Golden Yolk formula's boss term is always zero.
const BOSSES_KILLED = 0;
const NEXT_RUN_SEED_SALT = 0x2e5d;
const PERCENT = 100;

/** The flock is extinct when no chicken lives and no egg waits in a nest or at the coop. Carried eggs die with their carrier. */
export function isExtinct(state: GameState): boolean {
  if (state.chickens.some(isAlive) || state.coopEggs.length > 0) return false;
  for (const floorState of state.floors.values()) {
    if (floorState.nests.some((nest) => nest.eggs.length > 0)) return false;
  }
  return true;
}

export function beginRite(state: GameState, trigger: RiteSummary["trigger"]): void {
  state.rite = {
    trigger,
    deepestDepth: state.deepestDepth,
    goldBanked: state.totalGoldBanked,
    goldenYolksEarned: goldenYolksEarned(state.deepestDepth, state.totalGoldBanked, BOSSES_KILLED),
  };
}

/** Voluntary prestige opens once a chicken has reached floor 10 this run. */
export function canPerformRite(state: GameState): boolean {
  return state.rite === null && state.deepestDepth >= VOLUNTARY_RITE_MIN_DEPTH;
}

/**
 * Pays out the Rite and starts the next run on a seed derived from this one. Golden Yolks, Bloodline, ancestral
 * ranks, Dinner Bell rules, and the Roll of Feathers carry over. Everything else starts fresh.
 */
export function startNextRun(state: GameState): GameState {
  if (!state.rite) throw new Error("startNextRun needs a finished Rite");
  const { legacy } = state;
  legacy.goldenYolks += state.rite.goldenYolksEarned;
  legacy.lifetimeGoldenYolks += state.rite.goldenYolksEarned;
  legacy.run += 1;
  return createGame(mixSeed(state.seed, NEXT_RUN_SEED_SALT + legacy.run), 1 + legacy.ancestralRanks.secondHen, legacy);
}

/** Spends Golden Yolks on the next rank. A purchase that is no longer affordable or is past the max rank is skipped. */
export function buyAncestralNode(state: GameState, nodeId: AncestralNodeId, events: GameEvent[]): void {
  const node = ANCESTRAL_NODES[nodeId];
  const rank = state.legacy.ancestralRanks[nodeId];
  const cost = ancestralNodeCost(node, rank);
  if (rank >= node.maxRank || state.legacy.goldenYolks < cost) return;
  state.legacy.goldenYolks -= cost;
  state.legacy.ancestralRanks[nodeId] = rank + 1;
  events.push({ type: "ancestralNodeBought", node: nodeId, rank: rank + 1 });
}

/** Dinner Bell rules must be positive numbers or off. Anything else turns that rule off. */
export function sanitizeAutoRecall(rules: AutoRecallRules): AutoRecallRules {
  const positiveOrOff = (value: number | null) => (value !== null && Number.isFinite(value) && value > 0 ? value : null);
  return {
    everyMinutes: positiveOrOff(rules.everyMinutes),
    pouchGold: positiveOrOff(rules.pouchGold),
    flockHpPercent: positiveOrOff(rules.flockHpPercent),
  };
}

/** True when an unlocked Dinner Bell rule says the flock should come home now. */
export function dinnerBellRings(state: GameState): boolean {
  if (state.legacy.ancestralRanks.dinnerBell === 0) return false;
  const deployed = state.chickens.filter(isInDungeon);
  if (deployed.every(isHeadingOut)) return false;
  const rules = state.legacy.autoRecall;
  if (rules.everyMinutes !== null && state.tick - state.lastSendTick >= rules.everyMinutes * 60 * TICKS_PER_SECOND) return true;
  const pouches = deployed.reduce((total, chicken) => total + chicken.pouchGold, 0);
  if (rules.pouchGold !== null && pouches >= rules.pouchGold) return true;
  const hp = deployed.reduce((total, chicken) => total + chicken.hp, 0);
  const maxHp = deployed.reduce((total, chicken) => total + chicken.maxHp, 0);
  return rules.flockHpPercent !== null && (hp / maxHp) * PERCENT < rules.flockHpPercent;
}
