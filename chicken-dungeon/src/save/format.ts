import { MONSTER_KINDS, type MonsterKindId } from "../data/bestiary.ts";
import { generateFloor } from "../gen/floor.ts";
import type { Point } from "../gen/grid.ts";
import type { MonsterSpawn } from "../gen/population.ts";
import { createFloorState, UNSEEN } from "../sim/explore.ts";
import type { BankRecord, Chicken, ChickenActivity, FloorState, GameState, LootPile, Monster } from "../sim/types.ts";

export const SAVE_VERSION = 1;

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveFormatError";
  }
}

export interface LoadedGame {
  state: GameState;
  /** Wall-clock ms when the save was written. Kept outside GameState so the sim never reads a clock. */
  savedAt: number;
}

type JsonObject = Record<string, unknown>;

// Restored explored tiles get this tick. Any value below the save tick reads as "remembered, not visible now".
const REMEMBERED_TICK = 0;
const CHICKEN_ACTIVITIES: readonly ChickenActivity[] = ["home", "explore", "descend", "fight", "flee", "recalled", "dead"];

/**
 * Floor layouts are rebuilt from the seed. Per floor, the save keeps two bitsets: explored tiles and tiles visible
 * on the save tick. Together they reproduce every decision that reads `lastSeenTick`, so a loaded run replays exactly.
 */
export function serializeGame(state: GameState, savedAt: number): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    savedAt,
    game: {
      seed: state.seed,
      tick: state.tick,
      nextEntityId: state.nextEntityId,
      deepestDepth: state.deepestDepth,
      bankedGold: state.bankedGold,
      bankLog: state.bankLog,
      chickens: state.chickens,
      floors: [...state.floors.values()].map((floorState) => ({
        depth: floorState.floor.depth,
        explored: encodeBits(floorState.lastSeenTick, (seenTick) => seenTick !== UNSEEN),
        visible: encodeBits(floorState.lastSeenTick, (seenTick) => seenTick === state.tick),
        monsters: floorState.monsters,
        lootPiles: floorState.lootPiles,
        killedThisExpedition: floorState.killedThisExpedition,
      })),
    },
  });
}

export function parseSave(text: string): LoadedGame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SaveFormatError(`Save is not valid JSON: ${(error as Error).message}`);
  }
  const file = readObject(parsed, "save");
  const version = readNumber(file, "version", "save");
  if (version !== SAVE_VERSION) throw new SaveFormatError(`Save version ${version} is not supported (expected ${SAVE_VERSION})`);
  const game = readObject(file.game, "save.game");
  const seed = readNumber(game, "seed", "game");
  const tick = readNumber(game, "tick", "game");
  const floors = new Map<number, FloorState>();
  readArray(game, "floors", "game").forEach((value, index) => {
    const floorState = readFloor(value, seed, tick, `game.floors[${index}]`);
    floors.set(floorState.floor.depth, floorState);
  });
  return {
    savedAt: readNumber(file, "savedAt", "save"),
    state: {
      seed,
      tick,
      nextEntityId: readNumber(game, "nextEntityId", "game"),
      deepestDepth: readNumber(game, "deepestDepth", "game"),
      bankedGold: readNumber(game, "bankedGold", "game"),
      bankLog: readArray(game, "bankLog", "game").map((value, index) => readBankRecord(value, `game.bankLog[${index}]`)),
      chickens: readArray(game, "chickens", "game").map((value, index) => readChicken(value, `game.chickens[${index}]`)),
      floors,
    },
  };
}

function readFloor(value: unknown, seed: number, tick: number, where: string): FloorState {
  const saved = readObject(value, where);
  const depth = readNumber(saved, "depth", where);
  if (!Number.isInteger(depth) || depth < 1) throw new SaveFormatError(`${where}.depth must be a floor number, got ${depth}`);
  const floorState = createFloorState(generateFloor(seed, depth));
  const tileCount = floorState.lastSeenTick.length;
  const explored = decodeBits(readString(saved, "explored", where), tileCount, `${where}.explored`);
  const visible = decodeBits(readString(saved, "visible", where), tileCount, `${where}.visible`);
  for (let index = 0; index < tileCount; index++) {
    if (visible[index]) floorState.lastSeenTick[index] = tick;
    else if (explored[index]) floorState.lastSeenTick[index] = REMEMBERED_TICK;
  }
  floorState.monsters = readArray(saved, "monsters", where).map((item, index) => readMonster(item, `${where}.monsters[${index}]`));
  floorState.lootPiles = readArray(saved, "lootPiles", where).map((item, index) => readLootPile(item, `${where}.lootPiles[${index}]`));
  floorState.killedThisExpedition = readArray(saved, "killedThisExpedition", where).map((item, index) =>
    readMonsterSpawn(item, `${where}.killedThisExpedition[${index}]`),
  );
  return floorState;
}

function readChicken(value: unknown, where: string): Chicken {
  const saved = readObject(value, where);
  const activity = readString(saved, "activity", where);
  if (!CHICKEN_ACTIVITIES.includes(activity as ChickenActivity)) throw new SaveFormatError(`${where}.activity "${activity}" is unknown`);
  return {
    id: readNumber(saved, "id", where),
    name: readString(saved, "name", where),
    activity: activity as ChickenActivity,
    depth: readNumber(saved, "depth", where),
    ...readMover(saved, where),
    hp: readNumber(saved, "hp", where),
    maxHp: readNumber(saved, "maxHp", where),
    attack: readNumber(saved, "attack", where),
    defense: readNumber(saved, "defense", where),
    speed: readNumber(saved, "speed", where),
    courage: readNumber(saved, "courage", where),
    attackCooldownTicks: readNumber(saved, "attackCooldownTicks", where),
    slowedUntilTick: readNumber(saved, "slowedUntilTick", where),
    slowMultiplier: readNumber(saved, "slowMultiplier", where),
    pouchGold: readNumber(saved, "pouchGold", where),
    exploreTarget: saved.exploreTarget === null ? null : readPoint(saved.exploreTarget, `${where}.exploreTarget`),
    lootTargetId: readNullableNumber(saved, "lootTargetId", where),
    fightTargetId: readNullableNumber(saved, "fightTargetId", where),
  };
}

function readMonster(value: unknown, where: string): Monster {
  const saved = readObject(value, where);
  return {
    id: readNumber(saved, "id", where),
    kind: readMonsterKind(saved, where),
    ...readMover(saved, where),
    hp: readNumber(saved, "hp", where),
    maxHp: readNumber(saved, "maxHp", where),
    attack: readNumber(saved, "attack", where),
    defense: readNumber(saved, "defense", where),
    aggroRadius: readNumber(saved, "aggroRadius", where),
    attackCooldownTicks: readNumber(saved, "attackCooldownTicks", where),
    targetChickenId: readNullableNumber(saved, "targetChickenId", where),
    agitated: readBoolean(saved, "agitated", where),
    home: readPoint(saved.home, `${where}.home`),
  };
}

function readLootPile(value: unknown, where: string): LootPile {
  const saved = readObject(value, where);
  return {
    id: readNumber(saved, "id", where),
    x: readNumber(saved, "x", where),
    y: readNumber(saved, "y", where),
    gold: readNumber(saved, "gold", where),
    isFeatherPile: readBoolean(saved, "isFeatherPile", where),
  };
}

function readMonsterSpawn(value: unknown, where: string): MonsterSpawn {
  const saved = readObject(value, where);
  return { kind: readMonsterKind(saved, where), x: readNumber(saved, "x", where), y: readNumber(saved, "y", where) };
}

function readBankRecord(value: unknown, where: string): BankRecord {
  const saved = readObject(value, where);
  return { tick: readNumber(saved, "tick", where), gold: readNumber(saved, "gold", where) };
}

function readMover(saved: JsonObject, where: string): { x: number; y: number; previousX: number; previousY: number; path: Point[] } {
  return {
    x: readNumber(saved, "x", where),
    y: readNumber(saved, "y", where),
    previousX: readNumber(saved, "previousX", where),
    previousY: readNumber(saved, "previousY", where),
    path: readArray(saved, "path", where).map((step, index) => readPoint(step, `${where}.path[${index}]`)),
  };
}

function readMonsterKind(saved: JsonObject, where: string): MonsterKindId {
  const kind = readString(saved, "kind", where);
  if (!Object.hasOwn(MONSTER_KINDS, kind)) throw new SaveFormatError(`${where}.kind "${kind}" is not a known monster`);
  return kind as MonsterKindId;
}

function readPoint(value: unknown, where: string): Point {
  const saved = readObject(value, where);
  return { x: readNumber(saved, "x", where), y: readNumber(saved, "y", where) };
}

function readObject(value: unknown, where: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SaveFormatError(`${where} must be an object`);
  return value as JsonObject;
}

function readArray(saved: JsonObject, key: string, where: string): unknown[] {
  const value = saved[key];
  if (!Array.isArray(value)) throw new SaveFormatError(`${where}.${key} must be an array`);
  return value;
}

function readNumber(saved: JsonObject, key: string, where: string): number {
  const value = saved[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SaveFormatError(`${where}.${key} must be a finite number`);
  return value;
}

function readNullableNumber(saved: JsonObject, key: string, where: string): number | null {
  return saved[key] === null ? null : readNumber(saved, key, where);
}

function readString(saved: JsonObject, key: string, where: string): string {
  const value = saved[key];
  if (typeof value !== "string") throw new SaveFormatError(`${where}.${key} must be a string`);
  return value;
}

function readBoolean(saved: JsonObject, key: string, where: string): boolean {
  const value = saved[key];
  if (typeof value !== "boolean") throw new SaveFormatError(`${where}.${key} must be a boolean`);
  return value;
}

function encodeBits(values: Int32Array, isSet: (value: number) => boolean): string {
  const bytes = new Uint8Array(Math.ceil(values.length / 8));
  values.forEach((value, index) => {
    if (isSet(value)) bytes[index >> 3] |= 1 << (index & 7);
  });
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBits(encoded: string, bitCount: number, where: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new SaveFormatError(`${where} is not valid base64`);
  }
  if (binary.length !== Math.ceil(bitCount / 8)) throw new SaveFormatError(`${where} holds ${binary.length} bytes, expected ${Math.ceil(bitCount / 8)}`);
  const bits = new Uint8Array(bitCount);
  for (let index = 0; index < bitCount; index++) bits[index] = (binary.charCodeAt(index >> 3) >> (index & 7)) & 1;
  return bits;
}
