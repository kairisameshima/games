import * as THREE from 'three';
import { matteMaterial, metalMaterial } from '../../render/studio';
import { mergeStaticMeshes, part, roundedBox } from '../kit';
import { m2Feedway, m2Frame } from '../m2';
import type { InteriorMaterials } from './materials';

/**
 * Caliber .50 ammunition from the box to the gun: the box, the articulated feed chute (Pilot's Manual figure 76 shows
 * the waist gun's sagging from the box to the receiver), and the exposed belt of linked rounds entering the feedway.
 *
 * Cartridge dimensions are the .50 BMG's: 99 mm case, 20.4 mm rim, 138 mm overall, linked at 25.4 mm pitch with M2
 * links. Belts were loaded in a repeating mix; this follows a common 1944 Eighth Air Force order of armour-piercing,
 * incendiary, armour-piercing-incendiary and a tracer every fifth round.
 */

const CARTRIDGE_LENGTH = 0.138;
const BELT_PITCH = 0.0254;
const CHUTE = { width: 0.155, thickness: 0.038, pitch: 0.026 } as const;
/** Straight run out of the box's throat and into the chute's mouth when the chute is routed through points. */
const CHUTE_LEAD = 0.08;
/** Exposed rounds between the chute's mouth and the receiver's side plate. */
const EXPOSED_ROUNDS = 4;

type RoundKind = 'armourPiercing' | 'incendiary' | 'armourPiercingIncendiary' | 'tracer';
const BELT_ORDER: RoundKind[] = ['armourPiercing', 'incendiary', 'armourPiercingIncendiary', 'armourPiercing', 'tracer'];
/** Bullet tip paint by type (TM 9-1990): black, blue, aluminium, red. */
const TIP_COLOUR: Record<RoundKind, string> = {
  armourPiercing: '#17181a', incendiary: '#2d4f8a', armourPiercingIncendiary: '#a9adb0', tracer: '#a3302a',
};

interface RoundMaterials { brass: THREE.Material; jacket: THREE.Material; link: THREE.Material; tips: Record<RoundKind, THREE.Material> }

let roundMaterials: RoundMaterials | null = null;

function ammunitionMaterials(): RoundMaterials {
  roundMaterials ??= {
    brass: metalMaterial('#b8904c', { roughness: 0.3, metalness: 1 }),
    jacket: metalMaterial('#a86b45', { roughness: 0.34, metalness: 1 }),
    link: metalMaterial('#2c2e31', { roughness: 0.5, metalness: 0.7 }),
    tips: {
      armourPiercing: matteMaterial(TIP_COLOUR.armourPiercing, { roughness: 0.6 }),
      incendiary: matteMaterial(TIP_COLOUR.incendiary, { roughness: 0.6 }),
      armourPiercingIncendiary: matteMaterial(TIP_COLOUR.armourPiercingIncendiary, { roughness: 0.5 }),
      tracer: matteMaterial(TIP_COLOUR.tracer, { roughness: 0.6 }),
    },
  };
  return roundMaterials;
}

let chuteMaterial: THREE.MeshStandardMaterial | null = null;
let segmentGeometry: THREE.BoxGeometry | null = null;
let fittingGeometry: THREE.BoxGeometry | null = null;

/** Lathe profile helper: points as [radius, distance from the case head] in millimetres. */
function lathe(points: [number, number][], segments: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([radius, along]) => new THREE.Vector2(radius / 1000, along / 1000)), segments);
}

const roundTemplates = new Map<RoundKind, THREE.Group>();

/**
 * One linked round in belt space: +x toward the bullet, +z along the belt (toward the next round), centred on the
 * cartridge's midpoint so the belt line runs through the middle of the rounds.
 */
function roundTemplate(kind: RoundKind): THREE.Group {
  const cached = roundTemplates.get(kind);
  if (cached) return cached;
  const materials = ammunitionMaterials();
  const round = new THREE.Group();
  // Rimless case: head, extractor groove, tapered body, shoulder, neck.
  const caseGeometry = lathe([[0, 0], [10.2, 0], [10.2, 1.6], [9.4, 2.3], [9.4, 3.6], [10.2, 4.6], [9.2, 77], [7.2, 83.5], [7.2, 99]], 16);
  const bullet = lathe([[6.5, 99], [6.48, 112], [5.6, 120], [3.5, 128], [0, 132.5]], 16);
  const tip = lathe([[3.6, 127.6], [2.2, 131], [0.6, 133.4], [0, 134]], 12);
  for (const [geometry, material] of [[caseGeometry, materials.brass], [bullet, materials.jacket], [tip, materials.tips[kind]]] as const) {
    geometry.rotateZ(-Math.PI / 2).translate(-CARTRIDGE_LENGTH / 2, 0, 0);
    part(round, geometry, material, 0, 0, 0);
  }
  // M2 link: a loop round the case body and the strap that carries the next round's loop.
  part(round, new THREE.TorusGeometry(0.0103, 0.0013, 5, 18), materials.link, 0.045 - CARTRIDGE_LENGTH / 2, 0, 0, { rotation: [0, Math.PI / 2, 0] });
  part(round, roundedBox(0.014, 0.0025, BELT_PITCH - 0.012, 0.001), materials.link, 0.045 - CARTRIDGE_LENGTH / 2, -0.0098, BELT_PITCH / 2);
  const template = mergeStaticMeshes(round);
  roundTemplates.set(kind, template);
  return template;
}

/** A gun's feed in its parent's space: the M2 frame and the side its belt enters from (+1 right, −1 left). */
export interface GunFeed {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  side: 1 | -1;
  /**
   * Direction the belt travels into the feedway, in gun space (x forward, y up, z right). Defaults to straight in
   * through the side plate; the ball turret's belts come down into it from the boxes above.
   */
  approach?: THREE.Vector3;
}

/**
 * Belt direction (gun space) for a belt that drops into the feedway from above and outboard: where there is no room
 * beside the receiver for a chute to come in level (inside the ball, in the narrow tail cone).
 */
export function beltFromAbove(side: 1 | -1, outboardLean = 0.5): THREE.Vector3 {
  return new THREE.Vector3(0, -1, -side * outboardLean).normalize();
}

/** Which side of the receiver (+1 right, −1 left) faces `point`: the side a box there feeds. */
export function receiverSideToward(origin: THREE.Vector3, direction: THREE.Vector3, point: THREE.Vector3): 1 | -1 {
  const right = new THREE.Vector3().setFromMatrixColumn(m2Frame(origin, direction), 2);
  return right.dot(point.clone().sub(origin)) > 0 ? 1 : -1;
}

/** Where the belt leaves the chute, and the frame it travels in from there: along `inward`, rounds pointing `forward`. */
function feedApproach(gun: GunFeed): { mouth: THREE.Vector3; inward: THREE.Vector3; forward: THREE.Vector3; feedway: THREE.Vector3 } {
  const frame = m2Frame(gun.origin, gun.direction);
  const forward = new THREE.Vector3().setFromMatrixColumn(frame, 0).normalize();
  const right = new THREE.Vector3().setFromMatrixColumn(frame, 2).normalize();
  const feedway = m2Feedway(gun.side).applyMatrix4(frame);
  const inward = gun.approach
    ? gun.approach.clone().transformDirection(frame)
    : right.multiplyScalar(-gun.side);
  const mouth = feedway.clone().addScaledVector(inward, -(EXPOSED_ROUNDS * BELT_PITCH + 0.012));
  return { mouth, inward, forward, feedway };
}

/** The rounds from the chute's mouth into the feedway, in the gun's parent. */
export function addExposedBelt(parent: THREE.Object3D, gun: GunFeed): void {
  const { feedway, inward, forward } = feedApproach(gun);
  const up = new THREE.Vector3().crossVectors(inward, forward).normalize();
  const basis = new THREE.Matrix4().makeBasis(forward, up, inward);
  // One round inside the side plate so the belt visibly enters it.
  for (let index = -1; index < EXPOSED_ROUNDS; index++) {
    const round = roundTemplate(BELT_ORDER[(index + BELT_ORDER.length) % BELT_ORDER.length]).clone();
    round.quaternion.setFromRotationMatrix(basis);
    round.position.copy(feedway).addScaledVector(inward, -(index + 0.5) * BELT_PITCH);
    parent.add(round);
  }
}

/**
 * Articulated feed chute: hinged segments along a curve, wide enough for a cartridge's length, fittings at each end.
 * The rounds' direction is carried along the curve without twisting (parallel transport), and the twist needed to
 * meet the gun's feedway is spread evenly over the run, the way the hinged links share it.
 */
function addChute(parent: THREE.Object3D, curve: THREE.Curve<THREE.Vector3>, startWidth: THREE.Vector3, endWidth: THREE.Vector3): void {
  chuteMaterial ??= metalMaterial('#70757a', { roughness: 0.48, metalness: 0.7, envMapIntensity: 0.7 });
  const segments = Math.max(4, Math.round(curve.getLength() / CHUTE.pitch));
  const tangents = Array.from({ length: segments + 1 }, (_, index) => curve.getTangentAt(index / segments).normalize());
  const widths: THREE.Vector3[] = [startWidth.clone().addScaledVector(tangents[0], -startWidth.dot(tangents[0])).normalize()];
  const turn = new THREE.Quaternion();
  for (let index = 1; index <= segments; index++) {
    turn.setFromUnitVectors(tangents[index - 1], tangents[index]);
    widths.push(widths[index - 1].clone().applyQuaternion(turn).normalize());
  }
  const lastTangent = tangents[segments];
  const target = endWidth.clone().addScaledVector(lastTangent, -endWidth.dot(lastTangent)).normalize();
  const transported = widths[segments];
  const twist = Math.atan2(new THREE.Vector3().crossVectors(transported, target).dot(lastTangent), transported.dot(target));
  // Plain boxes: a chute is hundreds of links, and the gaps between them carry the look, not bevels.
  segmentGeometry ??= new THREE.BoxGeometry(CHUTE.pitch * 0.82, CHUTE.thickness, CHUTE.width);
  fittingGeometry ??= new THREE.BoxGeometry(0.035, CHUTE.thickness + 0.012, CHUTE.width + 0.016);
  const normal = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const tangent = tangents[index];
    const width = widths[index].applyAxisAngle(tangent, twist * t);
    normal.crossVectors(width, tangent).normalize();
    basis.makeBasis(tangent, normal, width);
    const isEnd = index === 0 || index === segments;
    const mesh = part(parent, isEnd ? fittingGeometry : segmentGeometry, chuteMaterial, 0, 0, 0);
    mesh.position.copy(curve.getPointAt(t));
    mesh.quaternion.setFromRotationMatrix(basis);
  }
}

export interface AmmunitionBoxSpec {
  centre: THREE.Vector3;
  /** Length (box x), height, depth (box z). */
  size: [number, number, number];
  yaw?: number;
  material: THREE.Material;
  /** Where the belt leaves the box, in box space; defaults to the middle of the lid, facing up. */
  throat?: { at: THREE.Vector3; facing: THREE.Vector3 };
  /** Lightening holes in a stiffener flange on this box-x face (the tail gunner's boxes, Pilot's Manual figure 78). */
  holedFace?: 1 | -1;
}

/** Riveted ammunition box: lid on a piano hinge, latch, stiffening beads; returns the throat the chute fastens to. */
export function addAmmunitionBox(parent: THREE.Object3D, materials: InteriorMaterials, spec: AmmunitionBoxSpec): { throat: THREE.Vector3; facing: THREE.Vector3 } {
  const [length, height, depth] = spec.size;
  const box = new THREE.Group();
  box.position.copy(spec.centre);
  box.rotation.y = spec.yaw ?? 0;
  parent.add(box);
  part(box, roundedBox(length, height - 0.02, depth, 0.008), spec.material, 0, -0.01, 0);
  // Lid overlapping the body, hinged along its back edge, latched at the front.
  part(box, roundedBox(length + 0.01, 0.022, depth + 0.01, 0.006), spec.material, 0, height / 2 - 0.011, 0);
  part(box, new THREE.CylinderGeometry(0.006, 0.006, length - 0.02, 8), materials.gunBlack, 0, height / 2 - 0.016, -depth / 2 - 0.006, { rotation: [0, 0, Math.PI / 2] });
  part(box, roundedBox(0.03, 0.05, 0.012, 0.003), materials.gunBlack, 0, height / 2 - 0.04, depth / 2 + 0.008);
  // Pressed stiffening beads on the long faces.
  for (const face of [-1, 1]) {
    for (let bead = 1; bead < 4; bead++) {
      part(box, roundedBox(0.012, height - 0.07, 0.006, 0.003), spec.material, -length / 2 + (bead * length) / 4, -0.02, face * (depth / 2 + 0.002));
    }
  }
  if (spec.holedFace) {
    const flangeX = spec.holedFace * (length / 2 + 0.004);
    part(box, roundedBox(0.008, height - 0.03, depth * 0.62, 0.003), spec.material, flangeX, -0.01, 0);
    const holes = Math.max(2, Math.floor((height - 0.06) / 0.11));
    for (let hole = 0; hole < holes; hole++) {
      const y = -height / 2 + 0.05 + ((hole + 0.5) * (height - 0.08)) / holes;
      part(box, new THREE.CircleGeometry(depth * 0.2, 20), materials.rubber, flangeX + spec.holedFace * 0.0045, y, 0, { rotation: [0, (spec.holedFace * Math.PI) / 2, 0] });
    }
  }
  // The chute's end fitting, built with the chute, is the throat's collar.
  const throat = spec.throat ?? { at: new THREE.Vector3(0, height / 2, 0), facing: new THREE.Vector3(0, 1, 0) };
  box.updateMatrix();
  return {
    throat: throat.at.clone().addScaledVector(throat.facing, 0.018).applyMatrix4(box.matrix),
    facing: throat.facing.clone().applyQuaternion(box.quaternion).normalize(),
  };
}

export interface GunFeedOptions {
  /** Where the box-side chute and box go; the gun's belt goes with the gun. */
  boxParent: THREE.Object3D;
  box: AmmunitionBoxSpec;
  /** The gun in `boxParent`'s space, to route the chute. */
  gun: GunFeed;
  /** The same gun in its own parent's space (a turret's pitch group), where the exposed belt is built. */
  beltGun?: { parent: THREE.Object3D; gun: GunFeed };
  /** How far the chute rises out of the box before it turns toward the gun, as a fraction of the run. */
  rise?: number;
  /** Points the chute passes through on its way, where it has to follow a wall (the tail gunner's feed tracks). */
  via?: THREE.Vector3[];
}

/**
 * A chute routed through waypoints: a spline from the throat through them, then a Bezier into the mouth so the last
 * turn toward the feedway cannot swing wide of the waypoints (a spline overshoots on a sharp final turn).
 */
function routedChute(throat: THREE.Vector3, facing: THREE.Vector3, via: THREE.Vector3[], mouth: THREE.Vector3, inward: THREE.Vector3): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const spline = new THREE.CatmullRomCurve3([throat, throat.clone().addScaledVector(facing, CHUTE_LEAD), ...via], false, 'centripetal');
  path.add(spline);
  const last = via[via.length - 1];
  const reach = last.distanceTo(mouth) * 0.4;
  const leaving = spline.getTangentAt(1).multiplyScalar(reach);
  path.add(new THREE.CubicBezierCurve3(last, last.clone().add(leaving), mouth.clone().addScaledVector(inward, -reach), mouth));
  return path;
}

/** Box, chute and belt for one gun. Box and chute are one group, so the cutaway keeps or hides them together. */
export function feedGun(materials: InteriorMaterials, options: GunFeedOptions): void {
  const feed = new THREE.Group();
  options.boxParent.add(feed);
  const { throat, facing } = addAmmunitionBox(feed, materials, options.box);
  const { mouth, inward, forward } = feedApproach(options.gun);
  const run = throat.distanceTo(mouth);
  const rise = run * (options.rise ?? 0.45);
  const curve = options.via ? routedChute(throat, facing, options.via, mouth, inward) : new THREE.CubicBezierCurve3(throat, throat.clone().addScaledVector(facing, rise), mouth.clone().addScaledVector(inward, -run * 0.35), mouth);
  // The rounds lie across the chute: along the box's length at its throat, along the gun's barrel at the mouth.
  const boxLength = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), options.box.yaw ?? 0);
  const startWidth = boxLength.addScaledVector(facing, -boxLength.dot(facing));
  if (startWidth.lengthSq() < 1e-4) startWidth.crossVectors(facing, inward);
  addChute(feed, curve, startWidth.normalize(), forward);
  const belt = options.beltGun ?? { parent: options.boxParent, gun: options.gun };
  addExposedBelt(belt.parent, belt.gun);
}
