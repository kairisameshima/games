import { fbm } from "../mech-village/noise";
import { LAKE, MECH_SCALE } from "./scale";

const HULL_RADIUS_X = 400;
const HULL_RADIUS_Z = 304;
const SHOULDER_ANGLE = 0.5;
const SHOULDER_TARGET_Y = 51.95;

export function terrainHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const outskirts = Math.min(1, Math.max(0, (radius - 700) / 900));
  const hills = (fbm(x * 0.0012 + 12, z * 0.0012 + 12, 5, 94) - 0.42) * 220;
  const small = (fbm(x * 0.12, z * 0.12, 3, 102) - 0.5) * 0.28;
  const pondRadius = Math.hypot((x - LAKE.x) / (8.7 * MECH_SCALE), (z - LAKE.z) / (4.7 * MECH_SCALE)) + (fbm(x * 0.03, z * 0.03, 2, 19) - 0.5) * 0.07;
  const pond = Math.exp(-pondRadius * pondRadius * 1.5);
  const bank = Math.exp(-(((pondRadius - 1.15) / 0.32) ** 2)) * 0.9 * MECH_SCALE;

  // Irregular berm banking earth up around the buried hull's elliptical footprint; a broad
  // super-gaussian ridge near the rim (r~0.8-1.0) tapers smoothly into the outskirts by r~1.8
  // so the hull stays mostly buried without a uniform circular plinth or steep moat.
  const hullRadius = Math.hypot(x / HULL_RADIUS_X, z / HULL_RADIUS_Z);
  const hullAngle = Math.atan2(z / HULL_RADIUS_Z, x / HULL_RADIUS_X);
  const hullRidge = Math.exp(-((Math.abs(hullRadius - 0.9) / 0.5) ** 1.8));
  const hullVariation = 0.65 + 0.5 * fbm(Math.cos(hullAngle) * 1.6 + 500, Math.sin(hullAngle) * 1.6 + 500, 4, 233);
  const lakeSuppress = Math.min(1, Math.max(0, (pondRadius - 0.6) / 0.6));
  const berm = Math.min(44, hullRidge * hullVariation * 40) * lakeSuppress;

  const base = -0.7 + small + hills * outskirts - pond * 2.1 * MECH_SCALE + bank + berm;

  // A localized earthen access shoulder lets the town's streets reach grade naturally on one
  // flank instead of the village sitting atop an inaccessible rim; it approaches the deck height
  // directly (never above it) and tapers outward by r~1.7, leaving other hull-edge sectors as
  // weathered steel exposed above the lower berm.
  let angleToShoulder = hullAngle - SHOULDER_ANGLE;
  angleToShoulder = Math.atan2(Math.sin(angleToShoulder), Math.cos(angleToShoulder));
  const shoulderGate = Math.exp(-((angleToShoulder / 0.4) ** 2));
  const shoulderRidge = Math.exp(-((Math.abs(hullRadius - 1.0) / 0.45) ** 1.7));
  const shoulderFactor = shoulderGate * shoulderRidge;

  return base + (SHOULDER_TARGET_Y - base) * shoulderFactor;
}
