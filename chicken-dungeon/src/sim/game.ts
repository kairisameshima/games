import { generateFloor } from "../gen/floor.ts";
import { stepDownhill, type Point } from "../gen/grid.ts";
import {
  buildExitDistance,
  chooseExploreTarget,
  createFloorState,
  isFrontier,
  pathThroughExplored,
  revealAround,
  type FloorState,
} from "./explore.ts";

export const TICKS_PER_SECOND = 20;
const TICK_SECONDS = 1 / TICKS_PER_SECOND;
const BASE_SPEED_TILES_PER_SECOND = 2.0;
const RECALL_SPEED_MULTIPLIER = 1.2;
const SNAP_EPSILON = 1e-9;
const COOP_DEPTH = 0;
const ENTRANCE_DEPTH = 1;
const CHICKEN_NAMES = [
  "Henrietta",
  "Clucksworth",
  "Admiral Pecks",
  "Eggatha",
  "Nugget",
  "Sir Cluckalot",
  "Drumstick",
  "Pip",
  "Margarine",
  "Beakon",
  "Featherstone",
  "Omelette",
];

export type ChickenActivity = "home" | "explore" | "descend" | "recalled";

export interface Chicken {
  readonly id: number;
  readonly name: string;
  activity: ChickenActivity;
  /** 0 while at the coop, otherwise the floor number. */
  depth: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  path: Point[];
  target: Point | null;
}

export interface GameState {
  readonly seed: number;
  tick: number;
  floors: Map<number, FloorState>;
  chickens: Chicken[];
  deepestDepth: number;
}

export type Command = { type: "send" } | { type: "recall" };

export type GameEvent = { type: "reachedFloor"; chickenId: number; depth: number } | { type: "returnedHome"; chickenId: number };

export class SimulationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationInvariantError";
  }
}

export function createGame(seed: number, flockSize: number): GameState {
  const chickens = Array.from({ length: flockSize }, (_, id) => createChicken(id));
  return { seed, tick: 0, floors: new Map(), chickens, deepestDepth: 0 };
}

export function floorStateAt(state: GameState, depth: number): FloorState {
  const existing = state.floors.get(depth);
  if (existing) return existing;
  const created = createFloorState(generateFloor(state.seed, depth));
  state.floors.set(depth, created);
  return created;
}

/** The first chicken in the dungeon. The camera follows it. */
export function leadChicken(state: GameState): Chicken | undefined {
  return state.chickens.find((chicken) => chicken.activity !== "home");
}

export function tick(state: GameState, commands: readonly Command[]): GameEvent[] {
  state.tick += 1;
  const events: GameEvent[] = [];
  for (const command of commands) applyCommand(state, command);
  for (const chicken of state.chickens) {
    if (chicken.activity === "home") continue;
    chicken.previousX = chicken.x;
    chicken.previousY = chicken.y;
    advanceChicken(state, chicken, events);
  }
  for (const chicken of state.chickens) {
    if (chicken.activity !== "home") revealAround(floorStateAt(state, chicken.depth), currentTile(chicken), state.tick);
  }
  return events;
}

function createChicken(id: number): Chicken {
  const baseName = CHICKEN_NAMES[id % CHICKEN_NAMES.length];
  const generation = Math.floor(id / CHICKEN_NAMES.length);
  return {
    id,
    name: generation === 0 ? baseName : `${baseName} ${generation + 1}`,
    activity: "home",
    depth: COOP_DEPTH,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    path: [],
    target: null,
  };
}

function applyCommand(state: GameState, command: Command): void {
  switch (command.type) {
    case "send": {
      const entrance = floorStateAt(state, ENTRANCE_DEPTH).floor.stairsUp;
      for (const chicken of state.chickens) {
        if (chicken.activity === "home") placeChicken(state, chicken, ENTRANCE_DEPTH, entrance, "explore");
      }
      return;
    }
    case "recall":
      recallFlock(state);
      return;
  }
}

function recallFlock(state: GameState): void {
  for (const floorState of state.floors.values()) floorState.exitDistance = buildExitDistance(floorState);
  for (const chicken of state.chickens) {
    if (chicken.activity === "home") continue;
    chicken.activity = "recalled";
    chicken.target = null;
    // Finish the step in progress so the chicken is on a tile center before it follows the exit map.
    chicken.path = chicken.path.slice(0, 1);
  }
}

function placeChicken(state: GameState, chicken: Chicken, depth: number, point: Point, activity: ChickenActivity): void {
  chicken.depth = depth;
  chicken.x = chicken.previousX = point.x;
  chicken.y = chicken.previousY = point.y;
  chicken.path = [];
  chicken.target = null;
  chicken.activity = activity;
  state.deepestDepth = Math.max(state.deepestDepth, depth);
  revealAround(floorStateAt(state, depth), point, state.tick);
}

function advanceChicken(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  const isOnTileCenter = Number.isInteger(chicken.x) && Number.isInteger(chicken.y);
  if (chicken.path.length === 0 || isOnTileCenter) decideNextStep(state, chicken, events);
  if (chicken.activity === "home") return;
  const speed = BASE_SPEED_TILES_PER_SECOND * (chicken.activity === "recalled" ? RECALL_SPEED_MULTIPLIER : 1);
  moveAlongPath(chicken, speed * TICK_SECONDS);
}

function decideNextStep(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  const floorState = floorStateAt(state, chicken.depth);
  switch (chicken.activity) {
    case "explore":
      if (chicken.target === null || !isFrontier(floorState, chicken.target)) planExploration(state, floorState, chicken);
      return;
    case "descend":
      if (chicken.path.length === 0) descend(state, chicken, events);
      return;
    case "recalled":
      if (chicken.path.length === 0) stepTowardExit(state, floorState, chicken, events);
      return;
    case "home":
      return;
  }
}

function planExploration(state: GameState, floorState: FloorState, chicken: Chicken): void {
  const origin = currentTile(chicken);
  const choice = chooseExploreTarget(floorState, origin, claimedTargets(state, chicken));
  if (choice) {
    chicken.target = choice.point;
    chicken.path = choice.path;
    return;
  }
  chicken.activity = "descend";
  chicken.target = null;
  chicken.path = pathThroughExplored(floorState, origin, floorState.floor.stairsDown);
}

function claimedTargets(state: GameState, chicken: Chicken): Point[] {
  const claims: Point[] = [];
  for (const other of state.chickens) {
    if (other !== chicken && other.depth === chicken.depth && other.activity === "explore" && other.target) claims.push(other.target);
  }
  return claims;
}

function descend(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  const nextDepth = chicken.depth + 1;
  placeChicken(state, chicken, nextDepth, floorStateAt(state, nextDepth).floor.stairsUp, "explore");
  events.push({ type: "reachedFloor", chickenId: chicken.id, depth: nextDepth });
}

function stepTowardExit(state: GameState, floorState: FloorState, chicken: Chicken, events: GameEvent[]): void {
  const { floor, exitDistance } = floorState;
  const tile = currentTile(chicken);
  if (tile.x === floor.stairsUp.x && tile.y === floor.stairsUp.y) {
    climbOut(state, chicken, events);
    return;
  }
  if (!exitDistance) throw new SimulationInvariantError(`B${chicken.depth} has no exit map during a recall`);
  const next = stepDownhill(floor.side, exitDistance, tile);
  if (!next) throw new SimulationInvariantError(`${chicken.name} at (${tile.x}, ${tile.y}) on B${chicken.depth} is off the explored map`);
  chicken.path = [next];
}

function climbOut(state: GameState, chicken: Chicken, events: GameEvent[]): void {
  if (chicken.depth === ENTRANCE_DEPTH) {
    chicken.activity = "home";
    chicken.depth = COOP_DEPTH;
    chicken.path = [];
    chicken.target = null;
    events.push({ type: "returnedHome", chickenId: chicken.id });
    return;
  }
  const aboveDepth = chicken.depth - 1;
  placeChicken(state, chicken, aboveDepth, floorStateAt(state, aboveDepth).floor.stairsDown, "recalled");
}

/** Moves toward the next waypoint and stops on it, so every decision is made on a tile center. */
function moveAlongPath(chicken: Chicken, distanceBudget: number): void {
  if (chicken.path.length === 0) return;
  const next = chicken.path[0];
  const deltaX = next.x - chicken.x;
  const deltaY = next.y - chicken.y;
  const remaining = Math.hypot(deltaX, deltaY);
  if (remaining <= distanceBudget + SNAP_EPSILON) {
    chicken.x = next.x;
    chicken.y = next.y;
    chicken.path.shift();
    return;
  }
  chicken.x += (deltaX / remaining) * distanceBudget;
  chicken.y += (deltaY / remaining) * distanceBudget;
}

function currentTile(chicken: Chicken): Point {
  return { x: Math.round(chicken.x), y: Math.round(chicken.y) };
}
