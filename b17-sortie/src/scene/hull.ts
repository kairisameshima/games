import * as THREE from 'three';
import { FUSELAGE_STATIONS } from './b17-dimensions';
import { ellipseRing, monotoneCubic } from './loft';

/** Model origin sits at this station, close to the centre of gravity, so attitude changes pivot naturally. */
const REFERENCE_D = 9.0;
export const HULL_RING_POINTS = 64;
export const HULL_EXPONENT = 2.4;

/** Model-space x of a fuselage station `d` (metres aft of the nose tip). */
export const toX = (d: number) => REFERENCE_D - d;

const STATION_D = FUSELAGE_STATIONS.map((station) => station[0]);
const STATION_TOP = FUSELAGE_STATIONS.map((station) => station[1]);
const STATION_BOTTOM = FUSELAGE_STATIONS.map((station) => station[2]);
const STATION_HALF_WIDTH = FUSELAGE_STATIONS.map((station) => station[3]);

export interface HullSection { top: number; bottom: number; halfWidth: number }

export function hullSectionAt(d: number): HullSection {
  return {
    top: monotoneCubic(STATION_D, STATION_TOP, d),
    bottom: monotoneCubic(STATION_D, STATION_BOTTOM, d),
    halfWidth: monotoneCubic(STATION_D, STATION_HALF_WIDTH, d),
  };
}

/** Height of the hull surface at a station and lateral offset, on the upper or lower side. */
export function hullSurfaceHeight(d: number, z: number, upper: boolean): number {
  const section = hullSectionAt(d);
  const middle = (section.top + section.bottom) / 2;
  const halfHeight = (section.top - section.bottom) / 2;
  const lateral = Math.min(Math.abs(z) / section.halfWidth, 0.999);
  // Invert the superellipse: |z/w|^n + |y/h|^n = 1.
  const vertical = (1 - lateral ** HULL_EXPONENT) ** (1 / HULL_EXPONENT);
  return middle + (upper ? vertical : -vertical) * halfHeight;
}

/** Inner half-width of the hull at a station and height: how wide a floor or bulkhead can be there. */
export function hullHalfWidthAtHeight(d: number, y: number): number {
  const section = hullSectionAt(d);
  const middle = (section.top + section.bottom) / 2;
  const halfHeight = (section.top - section.bottom) / 2;
  const vertical = Math.min(Math.abs(y - middle) / halfHeight, 0.999);
  return section.halfWidth * (1 - vertical ** HULL_EXPONENT) ** (1 / HULL_EXPONENT);
}

export function hullRing(d: number, inflate = 0): THREE.Vector3[] {
  const section = hullSectionAt(d);
  return ellipseRing(new THREE.Vector3(toX(d), 0, 0), section.top + inflate, section.bottom - inflate, section.halfWidth + inflate, HULL_RING_POINTS, HULL_EXPONENT);
}
