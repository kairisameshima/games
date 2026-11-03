import * as THREE from 'three';

/**
 * Body proportions for a 1.75 m airman (50th-percentile 1943 US Army aircrew), in metres. Segment lengths are joint to
 * joint; widths are half-widths of the skeleton, not of the clothed body.
 */
export const ANTHROPOMETRY = {
  pelvisToLumbar: 0.12,
  lumbarToChest: 0.2,
  chestToNeck: 0.17,
  neckToHeadPivot: 0.09,
  headPivotToCentre: 0.07,
  hipHalfWidth: 0.09,
  hipDrop: 0.04,
  shoulderHalfWidth: 0.185,
  shoulderDrop: 0.05,
  thigh: 0.435,
  shin: 0.42,
  ankleHeight: 0.075,
  footLength: 0.26,
  heelBehindAnkle: 0.06,
  upperArm: 0.305,
  forearm: 0.265,
  palm: 0.1,
} as const;

export type Side = 'left' | 'right';

/** Where a hand should be and how it should hold whatever is there. */
export interface HandTarget {
  /** Centre of the grip, in figure space. */
  grip: THREE.Vector3;
  /** Direction the fingers point when open, before curling (roughly along the forearm). */
  fingers: THREE.Vector3;
  /** Direction the palm faces. */
  palm: THREE.Vector3;
  /** 0 open and flat, 1 a closed fist round a 3 cm handle. */
  curl: number;
  /** Which way the elbow should bend out to. */
  elbowPole: THREE.Vector3;
}

export interface FootTarget {
  /** Ankle joint position. */
  ankle: THREE.Vector3;
  /** Direction the toes point. */
  toes: THREE.Vector3;
  /** Sole normal (up for flat on the floor). */
  sole: THREE.Vector3;
  kneePole: THREE.Vector3;
}

export interface Pose {
  /** Pelvis centre in figure space. */
  pelvis: THREE.Vector3;
  /** Pelvis orientation: x forward, y up the spine, z to the figure's right. */
  pelvisRotation: THREE.Euler;
  /** Forward bend of the lumbar and thoracic spine, radians. */
  spineBend: number;
  /** Twist of the chest about the spine (positive turns the chest to the figure's left). */
  spineTwist: number;
  /** Lean to the side (positive leans to the figure's right). */
  spineSide: number;
  headYaw: number;
  headPitch: number;
  hands: Record<Side, HandTarget>;
  feet: Record<Side, FootTarget>;
}

export interface Joint { position: THREE.Vector3; frame: THREE.Matrix4 }

export interface Skeleton {
  pelvis: Joint;
  lumbar: Joint;
  chest: Joint;
  neck: Joint;
  head: Joint;
  hip: Record<Side, THREE.Vector3>;
  knee: Record<Side, THREE.Vector3>;
  ankle: Record<Side, THREE.Vector3>;
  /** Ball of the foot and toe tip, along the sole. */
  ball: Record<Side, THREE.Vector3>;
  toe: Record<Side, THREE.Vector3>;
  heel: Record<Side, THREE.Vector3>;
  footFrame: Record<Side, THREE.Matrix4>;
  shoulder: Record<Side, THREE.Vector3>;
  elbow: Record<Side, THREE.Vector3>;
  wrist: Record<Side, THREE.Vector3>;
  /** Hand frame: x along the fingers, y out of the back of the hand, z across the knuckles toward the thumb side... */
  handFrame: Record<Side, THREE.Matrix4>;
  hand: Record<Side, HandTarget>;
}

const sideSign = (side: Side) => (side === 'right' ? 1 : -1);

function frameFrom(origin: THREE.Vector3, rotation: THREE.Quaternion): Joint {
  return { position: origin.clone(), frame: new THREE.Matrix4().makeRotationFromQuaternion(rotation) };
}

function offset(joint: Joint, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(joint.frame).add(joint.position);
}

/**
 * Two-bone inverse kinematics: places the middle joint so the chain root → middle → end has the given bone lengths,
 * bending toward `pole`. Unreachable targets are clamped onto the reachable shell along the root→target line.
 */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, upper: number, lower: number, pole: THREE.Vector3): { middle: THREE.Vector3; end: THREE.Vector3 } {
  const toTarget = target.clone().sub(root);
  const reach = THREE.MathUtils.clamp(toTarget.length(), Math.abs(upper - lower) + 1e-4, upper + lower - 1e-4);
  const axis = toTarget.lengthSq() > 1e-10 ? toTarget.normalize() : new THREE.Vector3(0, -1, 0);
  const end = root.clone().addScaledVector(axis, reach);
  const cosine = (upper * upper + reach * reach - lower * lower) / (2 * upper * reach);
  const along = upper * cosine;
  const out = Math.sqrt(Math.max(upper * upper - along * along, 0));
  const bendDirection = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (bendDirection.lengthSq() < 1e-8) bendDirection.set(axis.y, -axis.x, 0);
  bendDirection.normalize();
  return { middle: root.clone().addScaledVector(axis, along).addScaledVector(bendDirection, out), end };
}

function basis(xAxis: THREE.Vector3, yHint: THREE.Vector3): THREE.Matrix4 {
  const x = xAxis.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, yHint).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}

export function buildSkeleton(pose: Pose): Skeleton {
  const a = ANTHROPOMETRY;
  const pelvisRotation = new THREE.Quaternion().setFromEuler(pose.pelvisRotation);
  const pelvis = frameFrom(pose.pelvis, pelvisRotation);

  // Spine: bend about the figure's lateral axis (z), split between the lumbar and thoracic segments.
  const bendLumbar = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.spineSide * 0.5, 0, -pose.spineBend * 0.45));
  const lumbarRotation = pelvisRotation.clone().multiply(bendLumbar);
  const lumbar = frameFrom(offset(pelvis, 0, a.pelvisToLumbar, 0), lumbarRotation);
  const bendChest = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.spineSide * 0.5, pose.spineTwist, -pose.spineBend * 0.55));
  const chestRotation = lumbarRotation.clone().multiply(bendChest);
  const chest = frameFrom(offset(lumbar, 0, a.lumbarToChest, 0), chestRotation);
  const neck = frameFrom(offset(chest, 0, a.chestToNeck, 0), chestRotation);
  const headRotation = chestRotation.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pose.headYaw, -pose.headPitch, 'YZX')));
  const headPivot = offset(neck, 0.01, a.neckToHeadPivot, 0);
  const head = frameFrom(headPivot, headRotation);
  head.position.copy(offset(head, 0.015, a.headPivotToCentre, 0));

  const result: Partial<Skeleton> = {
    pelvis, lumbar, chest, neck, head,
    hip: {} as Record<Side, THREE.Vector3>, knee: {} as Record<Side, THREE.Vector3>, ankle: {} as Record<Side, THREE.Vector3>,
    ball: {} as Record<Side, THREE.Vector3>, toe: {} as Record<Side, THREE.Vector3>, heel: {} as Record<Side, THREE.Vector3>,
    footFrame: {} as Record<Side, THREE.Matrix4>,
    shoulder: {} as Record<Side, THREE.Vector3>, elbow: {} as Record<Side, THREE.Vector3>, wrist: {} as Record<Side, THREE.Vector3>,
    handFrame: {} as Record<Side, THREE.Matrix4>, hand: pose.hands,
  };
  const skeleton = result as Skeleton;

  for (const side of ['left', 'right'] as const) {
    const s = sideSign(side);
    // Legs: hip socket on the pelvis, IK to the ankle target.
    const hip = offset(pelvis, 0, -a.hipDrop, s * a.hipHalfWidth);
    const foot = pose.feet[side];
    const leg = solveTwoBone(hip, foot.ankle, a.thigh, a.shin, foot.kneePole);
    skeleton.hip[side] = hip;
    skeleton.knee[side] = leg.middle;
    skeleton.ankle[side] = leg.end;
    const footFrame = basis(foot.toes, foot.sole);
    skeleton.footFrame[side] = footFrame;
    const toes = new THREE.Vector3().setFromMatrixColumn(footFrame, 0);
    const sole = new THREE.Vector3().setFromMatrixColumn(footFrame, 1);
    const soleCentre = leg.end.clone().addScaledVector(sole, -a.ankleHeight);
    skeleton.heel[side] = soleCentre.clone().addScaledVector(toes, -a.heelBehindAnkle);
    skeleton.ball[side] = soleCentre.clone().addScaledVector(toes, a.footLength * 0.58);
    skeleton.toe[side] = soleCentre.clone().addScaledVector(toes, a.footLength - a.heelBehindAnkle);

    // Arms: shoulder on the chest frame, IK so the palm centre lands on the grip.
    const shoulder = offset(chest, -0.02, a.chestToNeck - a.shoulderDrop, s * a.shoulderHalfWidth);
    skeleton.shoulder[side] = shoulder;
    const hand = pose.hands[side];
    const fingers = hand.fingers.clone().normalize();
    const palmNormal = hand.palm.clone().normalize();
    // The wrist sits behind the grip along the fingers, and off it by the hand's half thickness away from the palm.
    const wristTarget = hand.grip.clone().addScaledVector(fingers, -a.palm * 0.55).addScaledVector(palmNormal, -0.025);
    const arm = solveTwoBone(shoulder, wristTarget, a.upperArm, a.forearm, hand.elbowPole);
    skeleton.elbow[side] = arm.middle;
    skeleton.wrist[side] = arm.end;
    // Hand frame: x along the fingers, y out of the back of the hand (opposite the palm).
    skeleton.handFrame[side] = basis(fingers, palmNormal.clone().negate());
  }
  return skeleton;
}

/** Convenience for poses: a vector in figure space. */
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
