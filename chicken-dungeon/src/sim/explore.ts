import type { Floor } from "../gen/floor.ts";
import { breadthFirstSearch, isWalkable, pathTo, toIndex, toPoint, type Point } from "../gen/grid.ts";

export interface FloorState {
  floor: Floor;
  /** Tick on which each tile was last inside a chicken's vision. Equal to the current tick means visible now. */
  lastSeenTick: Int32Array;
  /** Distance to stairs up over explored tiles. Built when Recall is cast and shared by every chicken on the floor. */
  exitDistance: Int32Array | null;
}

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

export const VISION_RADIUS = 5;
const UNSEEN = -1;
const SPACING_WEIGHT = 6;
const SPACING_CAP = 6;

export function createFloorState(floor: Floor): FloorState {
  return { floor, lastSeenTick: new Int32Array(floor.side * floor.side).fill(UNSEEN), exitDistance: null };
}

export function isExplored(floorState: FloorState, index: number): boolean {
  return floorState.lastSeenTick[index] !== UNSEEN;
}

export function exploredTileCount(floorState: FloorState): number {
  return floorState.lastSeenTick.reduce((count, seenTick) => (seenTick === UNSEEN ? count : count + 1), 0);
}

export function isFrontier(floorState: FloorState, point: Point): boolean {
  return isFrontierAt(floorState, point.x, point.y);
}

export function revealAround(floorState: FloorState, center: Point, tick: number): void {
  const { floor, lastSeenTick } = floorState;
  for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
    for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
      if (dx * dx + dy * dy > VISION_RADIUS * VISION_RADIUS) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= floor.side || y >= floor.side) continue;
      if (hasLineOfSight(floor, center.x, center.y, x, y)) lastSeenTick[y * floor.side + x] = tick;
    }
  }
}

/**
 * Picks the frontier with the best fan-out score from the bible:
 * `−path_distance + 6 × min(distance to nearest tile claimed by another chicken, 6)`.
 */
export function chooseExploreTarget(floorState: FloorState, origin: Point, claimedTargets: readonly Point[]): ExploreTarget | null {
  const { floor } = floorState;
  const search = breadthFirstSearch(floor, [origin], (index) => isWalkable(floor, index) && isExplored(floorState, index));
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < search.distance.length; index++) {
    const pathDistance = search.distance[index];
    if (pathDistance <= 0) continue;
    const x = index % floor.side;
    const y = (index - x) / floor.side;
    if (!isFrontierAt(floorState, x, y)) continue;
    const score = -pathDistance + SPACING_WEIGHT * Math.min(nearestClaimDistance(x, y, claimedTargets), SPACING_CAP);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  if (bestIndex === -1) return null;
  return { point: toPoint(floor.side, bestIndex), path: pathTo(floor.side, search, bestIndex) };
}

export function pathThroughExplored(floorState: FloorState, from: Point, to: Point): Point[] {
  const { floor } = floorState;
  const search = breadthFirstSearch(floor, [from], (index) => isWalkable(floor, index) && isExplored(floorState, index));
  const targetIndex = toIndex(floor.side, to);
  if (search.distance[targetIndex] < 0) {
    throw new UnreachableTileError(`(${to.x}, ${to.y}) on B${floor.depth} is not reachable through explored tiles`);
  }
  return pathTo(floor.side, search, targetIndex);
}

export function buildExitDistance(floorState: FloorState): Int32Array {
  const { floor } = floorState;
  return breadthFirstSearch(floor, [floor.stairsUp], (index) => isWalkable(floor, index) && isExplored(floorState, index)).distance;
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

/** Bresenham line. Walls block sight past them, but the wall tile itself is visible. */
function hasLineOfSight(floor: Floor, fromX: number, fromY: number, toX: number, toY: number): boolean {
  const deltaX = Math.abs(toX - fromX);
  const deltaY = -Math.abs(toY - fromY);
  const stepX = fromX < toX ? 1 : -1;
  const stepY = fromY < toY ? 1 : -1;
  let error = deltaX + deltaY;
  let x = fromX;
  let y = fromY;
  while (x !== toX || y !== toY) {
    if ((x !== fromX || y !== fromY) && !isWalkable(floor, y * floor.side + x)) return false;
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
