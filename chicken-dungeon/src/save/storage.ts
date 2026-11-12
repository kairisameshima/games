import type { GameState } from "../sim/types.ts";
import { parseSave, serializeGame, type LoadedGame } from "./format.ts";

const SAVE_KEY = "chicken-dungeon:save";
// An unreadable save is moved here instead of deleted, so a format bug never destroys a run outright.
const UNREADABLE_SAVE_KEY = "chicken-dungeon:unreadable-save";

/** Null when there is no save. Throws SaveFormatError when there is one that cannot be read. */
export function loadGame(): LoadedGame | null {
  const text = localStorage.getItem(SAVE_KEY);
  return text === null ? null : parseSave(text);
}

export function storeGame(state: GameState, now: number): void {
  localStorage.setItem(SAVE_KEY, serializeGame(state, now));
}

export function setAsideUnreadableSave(): void {
  const text = localStorage.getItem(SAVE_KEY);
  if (text !== null) localStorage.setItem(UNREADABLE_SAVE_KEY, text);
  localStorage.removeItem(SAVE_KEY);
}
