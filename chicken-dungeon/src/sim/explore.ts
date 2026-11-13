import type { Floor } from "../gen/floor.ts";
import { breadthFirstSearch, findPath, isWalkable, pathTo, toIndex, toPoint, type Point, type SearchResult } from "../gen/grid.ts";
import type { FloorState } from "./types.ts";

export interface ExploreTarget {
  point: Point;
  path: Point[];
}

export class UnreachableTileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreachableTileError";
  }
}

export const UNSEEN = -1;
const SPACING_WEIGHT = 6;
const SPACING_CAP = 6;

export function createFloorState(floor: Floor, wandererCooldownTicks: number): FloorState {
  return {
    floor,
    lastSeenTick: new Int32Array(floor.side * floor.side).fill(UNSEEN),
    monsters: [],
    lootPiles: [],
    killedThisExpedition: [],
    nests: [],
    denSites: [],
    wandererCooldownTicks,
  };
}

export function isExplored(floorState: FloorState, index: number): boolean {
  return floorState.lastSeenTick[index] !== UNSEEN;
}

/** Vision is revealed at the end of each tick, so "now" during a tick means seen on this tick or the one before. */
export function isVisibleNow(floorState: FloorState, point: Point, tick: number): boolean {
  return floorState.lastSeenTick[toIndex(floorState.floor.side, point)] >= tick - 1;
}

export function exploredTileCount(floorState: FloorState): number {
  return floorState.lastSeenTick.reduce((count, seenTick) => (seenTick === UNSEEN ? count : count + 1), 0);
}

export function isFrontier(floorState: FloorState, point: Point): boolean {
  return isFrontierAt(floorState, point.x, point.y);
}

export function revealAround(floorState: FloorState, center: Point, tick: number, radius: number): void {
  const { floor, lastSeenTick } = floorState;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= floor.side || y >= floor.side) continue;
      if (hasLineOfSight(floor, center, { x, y })) lastSeenTick[y * floor.side + x] = tick;
    }
  }
}

/** Distances from `origin` over explored walkable tiles. Chickens never path through ground they have not seen. */
export function searchExplored(floorState: FloorState, origin: Point): SearchResult {
  const { floor } = floorState;
  return breadthFirstSearch(floor, [origin], (index) => isWalkable(floor, index) && isExplored(floorState, index));
}

/**
 * Picks the frontier with the best fan-out score from the bible:
 * `−path_distance + 6 × min(distance to nearest tile claimed by another chicken, 6)`.
 */
export function chooseFrontier(floorState: FloorState, search: SearchResult, claimedTargets: readonly Point[]): ExploreTarget | null {
  const { side } = floorState.floor;
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < search.distance.length; index++) {
    const pathDistance = search.distance[index];
    if (pathDistance <= 0) continue;
    const x = index % side;
    const y = (index - x) / side;
    if (!isFrontierAt(floorState, x, y)) continue;
    const score = -pathDistance + SPACING_WEIGHT * Math.min(nearestClaimDistance(x, y, claimedTargets), SPACING_CAP);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  if (bestIndex === -1) return null;
  return { point: toPoint(side, bestIndex), path: pathTo(side, search, bestIndex) };
}

export function pathThroughExplored(floorState: FloorState, from: Point, to: Point): Point[] {
  const { floor } = floorState;
  const path = findPath(floor, from, to, (index) => isWalkable(floor, index) && isExplored(floorState, index));
  if (!path) throw new UnreachableTileError(`(${to.x}, ${to.y}) on B${floor.depth} is not reachable through explored tiles`);
  return path;
}

/** Bresenham line. Walls block sight past them, but the wall tile itself is visible. */
export function hasLineOfSight(floor: Floor, from: Point, to: Point): boolean {
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = -Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = deltaX + deltaY;
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    if ((x !== from.x || y !== from.y) && !isWalkable(floor, y * floor.side + x)) return false;
    const doubledError = 2 * error;
    if (doubledError >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubledError <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
  return true;
}

function isFrontierAt(floorState: FloorState, x: number, y: number): boolean {
  const index = y * floorState.floor.side + x;
  if (!isExplored(floorState, index) || !isWalkable(floorState.floor, index)) return false;
  return (
    isUnexploredAt(floorState, x + 1, y) ||
    isUnexploredAt(floorState, x - 1, y) ||
    isUnexploredAt(floorState, x, y + 1) ||
    isUnexploredAt(floorState, x, y - 1)
  );
}

function isUnexploredAt(floorState: FloorState, x: number, y: number): boolean {
  const { side } = floorState.floor;
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  return !isExplored(floorState, y * side + x);
}

function nearestClaimDistance(x: number, y: number, claimedTargets: readonly Point[]): number {
  let nearest = Infinity;
  for (const claim of claimedTargets) nearest = Math.min(nearest, Math.abs(claim.x - x) + Math.abs(claim.y - y));
  return nearest;
}
