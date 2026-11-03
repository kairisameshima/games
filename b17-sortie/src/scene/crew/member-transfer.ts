import * as THREE from 'three';
import type { CrewMember, Outfit } from './figure';
import type { FootTarget, HandTarget, Pose, Side } from './skeleton';

/** A crew member as plain arrays, so it can cross to a meshing worker by structured clone. */
type Triple = [number, number, number];

interface HandTransfer { grip: Triple; fingers: Triple; palm: Triple; curl: number; elbowPole: Triple }
interface FootTransfer { ankle: Triple; toes: Triple; sole: Triple; kneePole: Triple }

export interface CrewMemberTransfer {
  role: string;
  outfit: Outfit;
  regulator: Triple | null;
  faceSeed: number;
  pose: {
    pelvis: Triple;
    pelvisRotation: { angles: Triple; order: THREE.EulerOrder };
    spineBend: number;
    spineTwist: number;
    spineSide: number;
    headYaw: number;
    headPitch: number;
    hands: Record<Side, HandTransfer>;
    feet: Record<Side, FootTransfer>;
  };
}

const triple = (vector: THREE.Vector3): Triple => [vector.x, vector.y, vector.z];
const vector = (values: Triple): THREE.Vector3 => new THREE.Vector3(...values);

const encodeHand = (hand: HandTarget): HandTransfer => ({
  grip: triple(hand.grip), fingers: triple(hand.fingers), palm: triple(hand.palm), curl: hand.curl, elbowPole: triple(hand.elbowPole),
});
const decodeHand = (hand: HandTransfer): HandTarget => ({
  grip: vector(hand.grip), fingers: vector(hand.fingers), palm: vector(hand.palm), curl: hand.curl, elbowPole: vector(hand.elbowPole),
});
const encodeFoot = (foot: FootTarget): FootTransfer => ({
  ankle: triple(foot.ankle), toes: triple(foot.toes), sole: triple(foot.sole), kneePole: triple(foot.kneePole),
});
const decodeFoot = (foot: FootTransfer): FootTarget => ({
  ankle: vector(foot.ankle), toes: vector(foot.toes), sole: vector(foot.sole), kneePole: vector(foot.kneePole),
});

export function encodeMember(member: CrewMember): CrewMemberTransfer {
  const { pose } = member;
  return {
    role: member.role,
    outfit: { ...member.outfit },
    regulator: member.regulator ? triple(member.regulator) : null,
    faceSeed: member.faceSeed,
    pose: {
      pelvis: triple(pose.pelvis),
      pelvisRotation: { angles: [pose.pelvisRotation.x, pose.pelvisRotation.y, pose.pelvisRotation.z], order: pose.pelvisRotation.order },
      spineBend: pose.spineBend,
      spineTwist: pose.spineTwist,
      spineSide: pose.spineSide,
      headYaw: pose.headYaw,
      headPitch: pose.headPitch,
      hands: { left: encodeHand(pose.hands.left), right: encodeHand(pose.hands.right) },
      feet: { left: encodeFoot(pose.feet.left), right: encodeFoot(pose.feet.right) },
    },
  };
}

export function decodeMember(transfer: CrewMemberTransfer): CrewMember {
  const { pose } = transfer;
  const decoded: Pose = {
    pelvis: vector(pose.pelvis),
    pelvisRotation: new THREE.Euler(...pose.pelvisRotation.angles, pose.pelvisRotation.order),
    spineBend: pose.spineBend,
    spineTwist: pose.spineTwist,
    spineSide: pose.spineSide,
    headYaw: pose.headYaw,
    headPitch: pose.headPitch,
    hands: { left: decodeHand(pose.hands.left), right: decodeHand(pose.hands.right) },
    feet: { left: decodeFoot(pose.feet.left), right: decodeFoot(pose.feet.right) },
  };
  return { role: transfer.role, outfit: transfer.outfit, regulator: transfer.regulator ? vector(transfer.regulator) : null, faceSeed: transfer.faceSeed, pose: decoded };
}
