import assert from "node:assert/strict";
import test from "node:test";
import { baseScale, clampCenter, FRAME_MARGIN, frameTargets } from "../src/render/camera.ts";

// A 1920 × 1080 device-pixel canvas: base scale 4, so zoom 1 shows 480 × 270 world pixels.
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

function fitsEveryPoint(points: { x: number; y: number }[]): void {
  const { centerX, centerY, scale } = frameTargets(points, CANVAS_WIDTH, CANVAS_HEIGHT);
  const halfWidth = CANVAS_WIDTH / scale / 2;
  const halfHeight = CANVAS_HEIGHT / scale / 2;
  for (const point of points) {
    assert.ok(Math.abs(point.x - centerX) + FRAME_MARGIN <= halfWidth + 1e-9, `x ${point.x} falls outside the frame at scale ${scale}`);
    assert.ok(Math.abs(point.y - centerY) + FRAME_MARGIN <= halfHeight + 1e-9, `y ${point.y} falls outside the frame at scale ${scale}`);
  }
}

test("a lone chicken keeps the full zoom-1 view", () => {
  assert.equal(baseScale(CANVAS_WIDTH, CANVAS_HEIGHT), 4);
  assert.deepEqual(frameTargets([{ x: 300, y: 200 }], CANVAS_WIDTH, CANVAS_HEIGHT), { centerX: 300, centerY: 200, scale: 4 });
});

test("a spread-out flock zooms out to a whole-pixel scale that still fits every chicken", () => {
  const flock = [
    { x: 100, y: 100 },
    { x: 700, y: 180 },
    { x: 400, y: 420 },
  ];
  const { scale } = frameTargets(flock, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.equal(scale, 2);
  fitsEveryPoint(flock);
});

test("a flock wider than one device pixel per art pixel can show goes fractional and still fits", () => {
  const flock = [
    { x: 40, y: 40 },
    { x: 2600, y: 1200 },
  ];
  const { scale } = frameTargets(flock, CANVAS_WIDTH, CANVAS_HEIGHT);
  assert.ok(scale < 1 && scale >= 0.5);
  fitsEveryPoint(flock);
});

test("the view stays inside the floor, and a view wider than the floor centers on it", () => {
  assert.equal(clampCenter(10, 480, 1920), 240);
  assert.equal(clampCenter(1900, 480, 1920), 1680);
  assert.equal(clampCenter(500, 3000, 1920), 960);
});
