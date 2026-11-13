import { bloodlineMultiplier, LONG_NIGHT_MINUTES_PER_RANK } from "../data/ancestry.ts";
import { TICKS_PER_SECOND } from "./time.ts";
import type { GameState } from "./types.ts";

const RATE_WINDOW_MINUTES = 10;
const RATE_WINDOW_TICKS = RATE_WINDOW_MINUTES * 60 * TICKS_PER_SECOND;
const OFFLINE_EFFICIENCY = 0.5;
const BASE_OFFLINE_CAP_MINUTES = 8 * 60;

/**
 * Banks a returning chicken's pouch with the Bloodline bonus and keeps only the records inside the offline rate
 * window. Returns the gold actually banked.
 */
export function bankPouch(state: GameState, pouchGold: number): number {
  const banked = Math.round(pouchGold * bloodlineMultiplier(state.legacy.lifetimeGoldenYolks));
  state.bankedGold += banked;
  state.totalGoldBanked += banked;
  if (banked > 0) state.bankLog.push({ tick: state.tick, gold: banked });
  const windowStart = state.tick - RATE_WINDOW_TICKS;
  while (state.bankLog.length > 0 && state.bankLog[0].tick <= windowStart) state.bankLog.shift();
  return banked;
}

/**
 * The bible's offline payout: 50% of the gold banked per minute over the last 10 minutes of play, times minutes away,
 * capped at 8 hours plus 4 per Long Night rank. Play minutes are sim minutes, so fast-forwarding does not inflate the
 * rate. The window is always divided by the full 10 minutes, so a single lucky haul early in a session cannot inflate it.
 * Banked gold already carries the Bloodline bonus, so the payout does not apply it again.
 */
export function offlineGold(state: GameState, minutesAway: number): number {
  const windowStart = state.tick - RATE_WINDOW_TICKS;
  const recentGold = state.bankLog.reduce((total, record) => (record.tick > windowStart ? total + record.gold : total), 0);
  const capMinutes = BASE_OFFLINE_CAP_MINUTES + LONG_NIGHT_MINUTES_PER_RANK * state.legacy.ancestralRanks.longNight;
  const cappedMinutes = Math.min(capMinutes, Math.max(0, minutesAway));
  return Math.floor(OFFLINE_EFFICIENCY * (recentGold / RATE_WINDOW_MINUTES) * cappedMinutes);
}

/** Pays offline gold into the bank. It skips the bank log, so offline gold never compounds into the next offline rate. */
export function grantOfflineGold(state: GameState, minutesAway: number): number {
  const earned = offlineGold(state, minutesAway);
  state.bankedGold += earned;
  state.totalGoldBanked += earned;
  return earned;
}
