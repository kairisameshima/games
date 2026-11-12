import { TICKS_PER_SECOND } from "./time.ts";
import type { GameState } from "./types.ts";

const RATE_WINDOW_MINUTES = 10;
const RATE_WINDOW_TICKS = RATE_WINDOW_MINUTES * 60 * TICKS_PER_SECOND;
const OFFLINE_EFFICIENCY = 0.5;
const OFFLINE_CAP_MINUTES = 8 * 60;

/** Banks gold and keeps only the records inside the offline rate window. */
export function recordBanking(state: GameState, gold: number): void {
  state.bankedGold += gold;
  if (gold > 0) state.bankLog.push({ tick: state.tick, gold });
  const windowStart = state.tick - RATE_WINDOW_TICKS;
  while (state.bankLog.length > 0 && state.bankLog[0].tick <= windowStart) state.bankLog.shift();
}

/**
 * The bible's offline payout: 50% of the gold banked per minute over the last 10 minutes of play, times minutes away,
 * capped at 8 hours. Play minutes are sim minutes, so fast-forwarding does not inflate the rate. The window is always
 * divided by the full 10 minutes, so a single lucky haul early in a session cannot inflate it either.
 */
export function offlineGold(state: GameState, minutesAway: number): number {
  const windowStart = state.tick - RATE_WINDOW_TICKS;
  const recentGold = state.bankLog.reduce((total, record) => (record.tick > windowStart ? total + record.gold : total), 0);
  const cappedMinutes = Math.min(OFFLINE_CAP_MINUTES, Math.max(0, minutesAway));
  return Math.floor(OFFLINE_EFFICIENCY * (recentGold / RATE_WINDOW_MINUTES) * cappedMinutes);
}
