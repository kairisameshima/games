import * as THREE from 'three';
import type { FootTarget, HandTarget, Pose, Side } from '../crew/skeleton';

/**
 * Pose authoring in aircraft (or turret) space. A figure's facing is a yaw about +y: 0 faces forward (+x), π/2 faces
 * port (−z), −π/2 starboard (+z), π aft.
 */

export const FACING = { forward: 0, port: Math.PI / 2, starboard: -Math.PI / 2, aft: Math.PI } as const;

/** Unit vectors of a figure facing `yaw`: forward, its right, and up. */
export function axes(yaw: number): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const forward = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3(0, 1, 0);
  return { forward, right: new THREE.Vector3().crossVectors(forward, up), up };
}

/**
 * Hand closed round a vertical handle (gun spade grips, turret hand grips, the rim of a control wheel at 9 and 3):
 * palm toward the figure's midline, fingers wrapping forward round the handle.
 */
export function verticalGrip(grip: THREE.Vector3, side: Side, yaw: number, options: { curl?: number; inward?: number; elbowOut?: number } = {}): HandTarget {
  const { forward, right, up } = axes(yaw);
  const s = side === 'right' ? 1 : -1;
  const inward = options.inward ?? 0;
  const palm = right.clone().multiplyScalar(-s).addScaledVector(forward, -inward).normalize();
  const fingers = forward.clone().addScaledVector(right, s * inward).normalize();
  return {
    grip: grip.clone(), fingers, palm, curl: options.curl ?? 0.85,
    elbowPole: right.clone().multiplyScalar(s * (options.elbowOut ?? 0.6)).addScaledVector(up, -1).normalize(),
  };
}

/** Hand resting palm-down: on a chart, a Morse key, throttle knobs. */
export function palmDown(grip: THREE.Vector3, side: Side, yaw: number, options: { curl?: number; splay?: number; fingerDrop?: number } = {}): HandTarget {
  const { forward, right, up } = axes(yaw);
  const s = side === 'right' ? 1 : -1;
  const fingers = forward.clone().addScaledVector(right, -s * (options.splay ?? 0.25)).addScaledVector(up, -(options.fingerDrop ?? 0.15)).normalize();
  return {
    grip: grip.clone(), fingers, palm: up.clone().negate(), curl: options.curl ?? 0.35,
    elbowPole: right.clone().multiplyScalar(s * 0.7).addScaledVector(up, -1).addScaledVector(forward, -0.3).normalize(),
  };
}

/** Fingertips on a small knob facing the figure (bombsight knobs, radio tuning). */
export function knobGrip(grip: THREE.Vector3, side: Side, yaw: number, palmToward: THREE.Vector3, curl = 0.7): HandTarget {
  const { forward, right, up } = axes(yaw);
  const s = side === 'right' ? 1 : -1;
  return {
    grip: grip.clone(), fingers: forward.clone().addScaledVector(up, 0.25).normalize(), palm: palmToward.clone().normalize(), curl,
    elbowPole: right.clone().multiplyScalar(s * 0.8).addScaledVector(up, -1).normalize(),
  };
}

/** Foot planted flat. `ankle` is the ankle joint; the sole sits 7.5 cm below it. */
export function plantedFoot(ankle: THREE.Vector3, yaw: number, options: { toeOut?: number; kneeForward?: number; sole?: THREE.Vector3 } = {}): FootTarget {
  const { forward, up } = axes(yaw);
  const toes = forward.clone().applyAxisAngle(up, options.toeOut ?? 0);
  return { ankle: ankle.clone(), toes, sole: options.sole ?? up.clone(), kneePole: forward.clone().multiplyScalar(options.kneeForward ?? 1).addScaledVector(up, 0.2).normalize() };
}

export interface PoseOptions {
  pelvis: THREE.Vector3;
  yaw: number;
  /** Pelvis tilt back (seated, reclined) in radians. */
  pelvisTilt?: number;
  pelvisRoll?: number;
  spineBend?: number;
  spineTwist?: number;
  spineSide?: number;
  headYaw?: number;
  headPitch?: number;
  hands: Record<Side, HandTarget>;
  feet: Record<Side, FootTarget>;
}

export function pose(options: PoseOptions): Pose {
  return {
    pelvis: options.pelvis.clone(),
    // Order: yaw to face, then tilt about the figure's lateral axis (z), then roll about its forward axis.
    pelvisRotation: new THREE.Euler(options.pelvisRoll ?? 0, options.yaw, options.pelvisTilt ?? 0, 'YZX'),
    spineBend: options.spineBend ?? 0,
    spineTwist: options.spineTwist ?? 0,
    spineSide: options.spineSide ?? 0,
    headYaw: options.headYaw ?? 0,
    headPitch: options.headPitch ?? 0,
    hands: options.hands,
    feet: options.feet,
  };
}

/** Seated pelvis above a cushion: hip joints sit about 9 cm above the cushion and slightly behind its centre. */
export function seatedPelvis(cushion: THREE.Vector3, yaw: number): THREE.Vector3 {
  const { forward } = axes(yaw);
  return cushion.clone().add(new THREE.Vector3(0, 0.1, 0)).addScaledVector(forward, -0.03);
}
