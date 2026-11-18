export interface TownDistrict {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly seed: number;
}

export const TOWN_DISTRICTS: readonly TownDistrict[] = [
  { x: -26, z: -5, yaw: 0.02, seed: 1721 },
  { x: 26, z: -5, yaw: -0.03, seed: 2837 },
  { x: 78, z: -5, yaw: 0.025, seed: 3943 },
  { x: 130, z: -5, yaw: -0.02, seed: 4051 },
  { x: 182, z: -5, yaw: 0.015, seed: 4327 },
  { x: -26, z: 45, yaw: -0.025, seed: 5167 },
  { x: 26, z: 45, yaw: 0.03, seed: 6271 },
  { x: 78, z: 45, yaw: -0.02, seed: 7387 },
  { x: 130, z: 45, yaw: 0.025, seed: 8491 },
  { x: 182, z: 45, yaw: -0.03, seed: 8753 },
  { x: -26, z: 95, yaw: 0.02, seed: 9503 },
  { x: 26, z: 95, yaw: -0.025, seed: 10613 },
  { x: 78, z: 95, yaw: 0.03, seed: 10889 },
  { x: 130, z: 95, yaw: -0.02, seed: 11003 },
  { x: 182, z: 95, yaw: 0.025, seed: 11353 },
  { x: -26, z: 145, yaw: -0.02, seed: 11519 },
  { x: 26, z: 145, yaw: 0.025, seed: 11617 },
  { x: 78, z: 145, yaw: -0.03, seed: 11821 },
  { x: 130, z: 145, yaw: 0, seed: 917531 },
  { x: 182, z: 145, yaw: 0.02, seed: 12011 },
];
// Includes cottage footprints, gardens and the streets around each neighborhood.
export const TOWN_BOUNDS = { minX: -65, maxX: 255, minZ: -60, maxZ: 185 } as const;

export function distanceToTown(x: number, z: number): number {
  return Math.hypot(
    Math.max(TOWN_BOUNDS.minX - x, 0, x - TOWN_BOUNDS.maxX),
    Math.max(TOWN_BOUNDS.minZ - z, 0, z - TOWN_BOUNDS.maxZ),
  );
}
