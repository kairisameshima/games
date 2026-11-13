import type { Point } from "../gen/grid.ts";

/** Where the camera looks: a center in world pixels and how many device pixels each world pixel covers. */
export interface Framing {
  centerX: number;
  centerY: number;
  scale: number;
}

/** The view at zoom 1, in world pixels. Wider or taller stages show more around it. */
export const BASE_VIEW_WIDTH = 480;
export const BASE_VIEW_HEIGHT = 270;
/** Empty space kept around the outermost chickens, in world pixels: two tiles plus half a sprite. */
export const FRAME_MARGIN = 40;
// Below half a device pixel per art pixel, chickens shrink to specks. The view stops zooming out there.
const MIN_SCALE = 0.5;

/** Device pixels per world pixel at zoom 1: the largest whole number that still fits the 480 × 270 view. */
export function baseScale(canvasWidth: number, canvasHeight: number): number {
  return Math.max(1, Math.floor(Math.min(canvasWidth / BASE_VIEW_WIDTH, canvasHeight / BASE_VIEW_HEIGHT)));
}

/**
 * The framing that fits every point with a margin. The scale settles on whole device pixels per art pixel so pixel
 * art stays crisp, never zooms in past the base scale, and drops below 1 only when the spread needs it.
 */
export function frameTargets(points: readonly Point[], canvasWidth: number, canvasHeight: number): Framing {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const neededWidth = maxX - minX + 2 * FRAME_MARGIN;
  const neededHeight = maxY - minY + 2 * FRAME_MARGIN;
  const fit = Math.min(canvasWidth / neededWidth, canvasHeight / neededHeight);
  const base = baseScale(canvasWidth, canvasHeight);
  const scale = fit >= base ? base : fit >= 1 ? Math.floor(fit) : Math.max(MIN_SCALE, fit);
  return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, scale };
}

/** Keeps the view inside the floor. A view wider than the floor centers on it. */
export function clampCenter(center: number, viewSize: number, floorSize: number): number {
  if (viewSize >= floorSize) return floorSize / 2;
  return Math.min(floorSize - viewSize / 2, Math.max(viewSize / 2, center));
}

/** Frame-rate independent exponential easing: `rate` is how many e-foldings per second. */
export function easeToward(current: number, target: number, deltaSeconds: number, rate: number): number {
  return target + (current - target) * Math.exp(-rate * deltaSeconds);
}
