import { UPGRADES, type UpgradeId, type Wallet } from "./economy.ts";
import type { GameState } from "./game-state.ts";
import { ITEM_KINDS, type ItemKind } from "./machine.ts";

const SAVE_KEY = "raccoon-pusher/save";
const SAVE_VERSION = 1;

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveFormatError";
  }
}

export interface LoadedGame {
  state: GameState;
  /** Wall-clock ms when the save was written. */
  savedAt: number;
}

type JsonObject = Record<string, unknown>;

function readObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SaveFormatError(`${path} is not an object`);
  return value as JsonObject;
}

function readCount(object: JsonObject, key: string, path: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new SaveFormatError(`${path}.${key} is not a non-negative number`);
  return value;
}

function readWallet(value: unknown): Wallet {
  const object = readObject(value, "wallet");
  const upgradesObject = readObject(object.upgrades, "wallet.upgrades");
  const upgrades = {} as Record<UpgradeId, number>;
  for (const upgrade of UPGRADES) {
    const level = readCount(upgradesObject, upgrade.id, "wallet.upgrades");
    if (!Number.isInteger(level)) throw new SaveFormatError(`wallet.upgrades.${upgrade.id} is not a whole level`);
    // A level is reachable only if the level below it could be bought.
    if (level > 0 && upgrade.costOf(level - 1) === undefined) throw new SaveFormatError(`wallet.upgrades.${upgrade.id} is past its maximum`);
    upgrades[upgrade.id] = level;
  }
  return { bag: readCount(object, "bag", "wallet"), upgrades, bombs: readCount(object, "bombs", "wallet") };
}

function readLoot(value: unknown): ItemKind[] {
  if (!Array.isArray(value)) throw new SaveFormatError("loot is not a list");
  return value.map((item, index) => {
    if (!ITEM_KINDS.includes(item as ItemKind)) throw new SaveFormatError(`loot[${index}] is not a known item`);
    return item as ItemKind;
  });
}

function readState(value: unknown): GameState {
  const object = readObject(value, "state");
  if (typeof object.prizeWon !== "boolean") throw new SaveFormatError("state.prizeWon is not true or false");
  return {
    wallet: readWallet(object.wallet),
    machinesBeaten: readCount(object, "machinesBeaten", "state"),
    prizeWon: object.prizeWon,
    loot: readLoot(object.loot),
    won: readCount(object, "won", "state"),
    lost: readCount(object, "lost", "state"),
  };
}

/** Returns undefined when there is no save. Throws SaveFormatError when the save cannot be read. */
export function loadGame(): LoadedGame | undefined {
  const text = localStorage.getItem(SAVE_KEY);
  if (text === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveFormatError("save is not valid JSON");
  }
  const envelope = readObject(parsed, "save");
  if (envelope.version !== SAVE_VERSION) throw new SaveFormatError(`save version ${String(envelope.version)} is not ${SAVE_VERSION}`);
  return { state: readState(envelope.state), savedAt: readCount(envelope, "savedAt", "save") };
}

export function storeGame(state: GameState, savedAt: number): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt, state }));
}

/** Keeps an unreadable save under a side key so a new game does not destroy it. */
export function setAsideUnreadableSave(): void {
  const text = localStorage.getItem(SAVE_KEY);
  if (text !== null) localStorage.setItem(`${SAVE_KEY}/unreadable-${Date.now()}`, text);
  localStorage.removeItem(SAVE_KEY);
}
