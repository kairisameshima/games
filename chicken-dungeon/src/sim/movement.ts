import type { Point } from "../gen/grid.ts";
import type { Mover } from "./types.ts";

const SNAP_EPSILON = 1e-9;

/**
 * Movers only change course on tile centers. A mover that switches goals mid-step finishes the step first,
 * so paths always run along the grid and never clip wall corners.
 */
export function isOnTileCenter(mover: Mover): boolean {
  return Number.isInteger(mover.x) && Number.isInteger(mover.y);
}

export function currentTile(mover: Mover): Point {
  return { x: Math.round(mover.x), y: Math.round(mover.y) };
}

export function pathEndsAt(mover: Mover, point: Point): boolean {
  const last = mover.path.at(-1);
  return last !== undefined && last.x === point.x && last.y === point.y;
}

export function distanceBetween(first: Mover, second: Mover): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

/** Moves toward the next waypoint and stops on it, so every course change happens on a tile center. */
export function moveAlongPath(mover: Mover, distanceBudget: number): void {
  if (mover.path.length === 0) return;
  const next = mover.path[0];
  const deltaX = next.x - mover.x;
  const deltaY = next.y - mover.y;
  const remaining = Math.hypot(deltaX, deltaY);
  if (remaining <= distanceBudget + SNAP_EPSILON) {
    mover.x = next.x;
    mover.y = next.y;
    mover.path.shift();
    return;
  }
  mover.x += (deltaX / remaining) * distanceBudget;
  mover.y += (deltaY / remaining) * distanceBudget;
}
