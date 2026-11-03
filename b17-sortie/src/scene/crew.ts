import * as THREE from 'three';
import { matteMaterial } from '../render/studio';
import { part, roundedBox } from './kit';

/** How a crew member sits in his station. Every figure faces +x with his feet (or seat) at the origin. */
export type CrewPose = 'standing' | 'seated' | 'kneeling' | 'curled';

type Point = [number, number, number];

interface Skeleton {
  pelvis: Point;
  neck: Point;
  head: Point;
  /** Left side only (−z); the right side mirrors it. */
  hip: Point;
  knee: Point;
  foot: Point;
  shoulder: Point;
  elbow: Point;
  hand: Point;
}

/** Joint positions in metres for a 1.75 m airman in heated suit, sheepskin jacket and flak vest. */
const POSES: Record<CrewPose, Skeleton> = {
  standing: {
    pelvis: [0, 0.95, 0], neck: [0.02, 1.45, 0], head: [0.04, 1.6, 0],
    hip: [0, 0.92, -0.1], knee: [0.04, 0.5, -0.12], foot: [0, 0.06, -0.13],
    shoulder: [0.02, 1.38, -0.2], elbow: [0.16, 1.14, -0.25], hand: [0.4, 1.2, -0.12],
  },
  seated: {
    pelvis: [0, 0.5, 0], neck: [0.03, 1.0, 0], head: [0.05, 1.15, 0],
    hip: [0, 0.5, -0.1], knee: [0.44, 0.52, -0.12], foot: [0.46, 0.06, -0.13],
    shoulder: [0.03, 0.94, -0.2], elbow: [0.18, 0.72, -0.25], hand: [0.42, 0.8, -0.14],
  },
  kneeling: {
    pelvis: [0, 0.55, 0], neck: [0.1, 1.04, 0], head: [0.14, 1.19, 0],
    hip: [0, 0.55, -0.1], knee: [0.18, 0.12, -0.12], foot: [-0.32, 0.07, -0.12],
    shoulder: [0.1, 0.98, -0.2], elbow: [0.22, 0.78, -0.24], hand: [0.46, 0.86, -0.13],
  },
  // Ball turret: back against the rear of the sphere, knees drawn up either side of the sight.
  curled: {
    pelvis: [-0.28, -0.22, 0], neck: [-0.2, 0.22, 0], head: [-0.1, 0.3, 0],
    hip: [-0.28, -0.22, -0.1], knee: [0.08, 0.02, -0.19], foot: [0.24, -0.3, -0.14],
    shoulder: [-0.2, 0.17, -0.19], elbow: [-0.02, 0.06, -0.24], hand: [0.14, 0.2, -0.12],
  },
};

const UP = new THREE.Vector3(0, 1, 0);

interface CrewMaterials {
  jacket: THREE.Material;
  trousers: THREE.Material;
  vest: THREE.Material;
  leather: THREE.Material;
  skin: THREE.Material;
  mask: THREE.Material;
  boots: THREE.Material;
}

function crewMaterials(): CrewMaterials {
  return {
    jacket: matteMaterial('#6a4a33', { roughness: 0.78 }),
    trousers: matteMaterial('#4d4a36', { roughness: 0.82 }),
    vest: matteMaterial('#5c5a3e', { roughness: 0.7 }),
    leather: matteMaterial('#3a2a1e', { roughness: 0.6 }),
    skin: matteMaterial('#d8a585', { roughness: 0.7 }),
    mask: matteMaterial('#55595e', { roughness: 0.5 }),
    boots: matteMaterial('#2b231d', { roughness: 0.65 }),
  };
}

const mirror = (point: Point): THREE.Vector3 => new THREE.Vector3(point[0], point[1], -point[2]);

/** Capsule or box stretched between two joints. */
function bone(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, geometryFor: (length: number) => THREE.BufferGeometry, material: THREE.Material): void {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const mesh = part(parent, geometryFor(length), material, 0, 0, 0);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

export function buildCrewFigure(pose: CrewPose): THREE.Group {
  const materials = crewMaterials();
  const skeleton = POSES[pose];
  const figure = new THREE.Group();
  const pelvis = new THREE.Vector3(...skeleton.pelvis);
  const neck = new THREE.Vector3(...skeleton.neck);
  const head = new THREE.Vector3(...skeleton.head);

  bone(figure, pelvis, neck, (length) => roundedBox(0.25, length + 0.08, 0.38, 0.08), materials.jacket);
  const vestBottom = pelvis.clone().lerp(neck, 0.3);
  const vestTop = pelvis.clone().lerp(neck, 0.92);
  bone(figure, vestBottom, vestTop, (length) => roundedBox(0.29, length, 0.4, 0.06), materials.vest);
  bone(figure, neck, head, (length) => new THREE.CapsuleGeometry(0.05, length * 0.5, 4, 8), materials.jacket);

  part(figure, new THREE.SphereGeometry(0.1, 16, 12), materials.skin, head.x, head.y, head.z);
  // Leather flying helmet over the crown and ears, goggles pushed up, oxygen mask over the face.
  part(figure, new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), materials.leather, head.x - 0.01, head.y + 0.005, head.z);
  part(figure, roundedBox(0.04, 0.04, 0.17, 0.015), materials.mask, head.x + 0.085, head.y + 0.055, head.z);
  part(figure, roundedBox(0.07, 0.07, 0.08, 0.025), materials.mask, head.x + 0.095, head.y - 0.04, head.z);

  for (const mirrored of [false, true]) {
    const point = (joint: Point) => (mirrored ? mirror(joint) : new THREE.Vector3(...joint));
    const hip = point(skeleton.hip);
    const knee = point(skeleton.knee);
    const foot = point(skeleton.foot);
    const shoulder = point(skeleton.shoulder);
    const elbow = point(skeleton.elbow);
    const hand = point(skeleton.hand);
    bone(figure, hip, knee, (length) => new THREE.CapsuleGeometry(0.075, length, 4, 10), materials.trousers);
    bone(figure, knee, foot, (length) => new THREE.CapsuleGeometry(0.062, length, 4, 10), materials.trousers);
    part(figure, roundedBox(0.24, 0.1, 0.12, 0.04), materials.boots, foot.x + 0.06, foot.y - 0.01, foot.z);
    bone(figure, shoulder, elbow, (length) => new THREE.CapsuleGeometry(0.06, length, 4, 10), materials.jacket);
    bone(figure, elbow, hand, (length) => new THREE.CapsuleGeometry(0.05, length, 4, 10), materials.jacket);
    part(figure, new THREE.SphereGeometry(0.05, 10, 8), materials.leather, hand.x, hand.y, hand.z);
  }
  return figure;
}
