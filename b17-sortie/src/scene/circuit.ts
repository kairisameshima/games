import * as THREE from 'three';
import { monotoneCubic } from './loft';

/**
 * A flight path laid out the way a pilot flies a circuit, from straight legs and turns of constant radius, so that
 * position, heading and bank are exact at every point and the animator can chart a move along it evenly. Distances
 * are along the path; headings are rotation about y, 0 flying +x, decreasing in a turn to starboard.
 */

export type CircuitLeg =
  | { kind: 'straight'; length: number }
  /** `side`: 1 turns to starboard, −1 to port. */
  | { kind: 'turn'; radius: number; angle: number; side: 1 | -1 };

interface PlacedLeg {
  leg: CircuitLeg;
  /** Distance along the path where the leg starts. */
  from: number;
  length: number;
  start: THREE.Vector3;
  heading: number;
}

/** How far the path's slope is measured either side of a point. */
const SLOPE_SAMPLE = 0.5;

/** Unit vector out of the starboard side at `heading`. */
function starboard(heading: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(heading), 0, Math.cos(heading));
}

export class CircuitPath {
  readonly length: number;
  private readonly legs: PlacedLeg[] = [];
  private readonly scratch = new THREE.Vector3();

  /**
   * `start` and `heading` place the path; `heights` are [distance, height] keys the height is interpolated through
   * without overshoot.
   */
  constructor(start: THREE.Vector3, heading: number, legs: CircuitLeg[], private readonly heights: { at: number[]; height: number[] }) {
    let from = 0;
    const position = new THREE.Vector3(start.x, 0, start.z);
    let currentHeading = heading;
    for (const leg of legs) {
      const length = leg.kind === 'straight' ? leg.length : leg.radius * leg.angle;
      this.legs.push({ leg, from, length, start: position.clone(), heading: currentHeading });
      this.flatPoint(this.legs[this.legs.length - 1], length, position);
      if (leg.kind === 'turn') currentHeading -= leg.side * leg.angle;
      from += length;
    }
    this.length = from;
  }

  /** The point `along` the path, written to `out`. */
  point(along: number, out: THREE.Vector3): THREE.Vector3 {
    const placed = this.legAt(along);
    this.flatPoint(placed, THREE.MathUtils.clamp(along - placed.from, 0, placed.length), out);
    return out.setY(this.height(along));
  }

  height(along: number): number {
    return monotoneCubic(this.heights.at, this.heights.height, along);
  }

  /** Climb (positive) or descent per unit flown at `along`. */
  slope(along: number): number {
    return (this.height(along + SLOPE_SAMPLE) - this.height(along - SLOPE_SAMPLE)) / (2 * SLOPE_SAMPLE);
  }

  heading(along: number): number {
    const placed = this.legAt(along);
    const { leg } = placed;
    if (leg.kind === 'straight') return placed.heading;
    return placed.heading - (leg.side * THREE.MathUtils.clamp(along - placed.from, 0, placed.length)) / leg.radius;
  }

  /**
   * Bank at `along`: each turn's steady bank (`bankPerTurnRate` over its radius, at most `maxBank`, starboard wing down
   * positive), rolled in over `ramp` across its start and out across its end.
   */
  bank(along: number, bankPerTurnRate: number, maxBank: number, ramp: number): number {
    let bank = 0;
    for (const { leg, from, length } of this.legs) {
      if (leg.kind !== 'turn') continue;
      const steady = Math.min(bankPerTurnRate / leg.radius, maxBank) * leg.side;
      bank += steady * THREE.MathUtils.smoothstep(along, from - ramp / 2, from + ramp / 2)
        * (1 - THREE.MathUtils.smoothstep(along, from + length - ramp / 2, from + length + ramp / 2));
    }
    return THREE.MathUtils.clamp(bank, -maxBank, maxBank);
  }

  private legAt(along: number): PlacedLeg {
    for (let index = this.legs.length - 1; index >= 0; index--) if (along >= this.legs[index].from) return this.legs[index];
    return this.legs[0];
  }

  /** The point `distance` into a leg, at height 0. */
  private flatPoint(placed: PlacedLeg, distance: number, out: THREE.Vector3): THREE.Vector3 {
    const { leg, start, heading } = placed;
    if (leg.kind === 'straight') return out.set(start.x + Math.cos(heading) * distance, 0, start.z - Math.sin(heading) * distance);
    // Round a centre `radius` out to the turning side.
    const centre = start.clone().addScaledVector(starboard(heading, this.scratch), leg.side * leg.radius);
    starboard(heading - (leg.side * distance) / leg.radius, this.scratch);
    return out.copy(centre).addScaledVector(this.scratch, -leg.side * leg.radius);
  }
}
