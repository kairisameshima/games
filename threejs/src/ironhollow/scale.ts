import { DECK_HEIGHT } from "./materials";

// Machinery grows; houses, people, trees and surface texel density remain in metres.
export const MECH_SCALE = 16;
export const MECH_BURIAL_DEPTH = 140;
export const MECH_DECK_HEIGHT = DECK_HEIGHT * MECH_SCALE - MECH_BURIAL_DEPTH;
export const SETTLEMENT_X = 130;
export const SETTLEMENT_Z = 145;
export const SETTLEMENT_FRAME_Y = MECH_DECK_HEIGHT - DECK_HEIGHT;
export const LAKE = {
  x: -10 * MECH_SCALE,
  z: 29 * MECH_SCALE,
  radiusX: 9.6 * MECH_SCALE,
  radiusZ: 5.6 * MECH_SCALE,
  waterLevel: -0.45 * MECH_SCALE,
} as const;
