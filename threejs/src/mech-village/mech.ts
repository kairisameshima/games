import * as THREE from "three";
import { Kit, compose, createFrame, toWorld } from "./batch";
import type { SceneMaterials } from "./materials";
import { createRandom, type Random } from "./noise";
import { groundHeight } from "./terrain";

/** Deck outline of the hull in hull-local XZ, front of the machine toward +X. */
export const HULL_OUTLINE: ReadonlyArray<[number, number]> = [
  [48, 14],
  [38, 30],
  [-34, 30],
  [-46, 19],
  [-46, -19],
  [-34, -30],
  [38, -30],
  [48, -14],
];

const STEEL = "#c9cbc2";
const STEEL_WORN = "#aeb0a7";
const STEEL_UNDER = "#85877f";
const STEEL_DARK = "#5c5e59";
const FADED_PAINT = "#a7b8a6";
const PISTON = "#e4e6e2";
const CABLE = "#33302c";
const HOLLOW = "#1b1916";

export interface Climbable {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
}

export interface MechRuin {
  hull: THREE.Group;
  turret: THREE.Group;
  intactBarrel: THREE.Group;
  intactBarrelLength: number;
  barrelRadius: number;
  /** Turret-local point on the flat turret roof. */
  turretRoof: THREE.Vector3Tuple;
  /** Frame at the fallen barrel's muzzle; +X points out of the bore. */
  fallenMuzzle: THREE.Group;
  boreRadius: number;
  smokeSources: THREE.Vector3[];
  climbables: Climbable[];
  /** World polylines along top edges that vines drape from. */
  vineEdges: THREE.Vector3[][];
  waterfallSource: THREE.Vector3;
  waterfallDirection: THREE.Vector3;
  palmCenter: THREE.Vector3;
  lensCenter: THREE.Vector3;
}

function createSlab(
  outline: ReadonlyArray<[number, number]>,
  scale: number,
  depth: number,
  bevel: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x * scale, z * scale)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, -bevel, 0);
  return geometry;
}

function createProfile(points: ReadonlyArray<[number, number]>, width: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -width / 2);
  return geometry;
}

/** Open tube along +Y whose top rim is torn into a ragged edge. */
function createTornTube(radius: number, length: number, random: Random): THREE.CylinderGeometry {
  const radialSegments = 24;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 5, true);
  const tears = Array.from({ length: radialSegments }, () => random() * length * 0.22);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    if (positions.getY(index) < length / 2 - 0.001) continue;
    const angle = Math.atan2(positions.getZ(index), positions.getX(index));
    const column = Math.round(((angle + Math.PI) / (Math.PI * 2)) * radialSegments) % radialSegments;
    positions.setY(index, positions.getY(index) - tears[column]);
    const flare = 1 + tears[column] * 0.05;
    positions.setX(index, positions.getX(index) * flare);
    positions.setZ(index, positions.getZ(index) * flare);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createGearGeometry(radius: number, teeth: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const toothDepth = radius * 0.13;
  const steps = teeth * 4;
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * Math.PI * 2;
    const phase = step % 4;
    const outer = phase === 1 || phase === 2;
    const r = outer ? radius : radius - toothDepth;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (step === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const axle = new THREE.Path();
  axle.absarc(0, 0, radius * 0.2, 0, Math.PI * 2, true);
  shape.holes.push(axle);
  for (let hole = 0; hole < 6; hole++) {
    const angle = (hole / 6) * Math.PI * 2;
    const path = new THREE.Path();
    path.absarc(Math.cos(angle) * radius * 0.56, Math.sin(angle) * radius * 0.56, radius * 0.18, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.25,
    bevelSegments: 1,
    curveSegments: 16,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** Group whose +X axis points from `origin` toward `target`. */
function createFrameAlongX(parent: THREE.Object3D, origin: THREE.Vector3, target: THREE.Vector3): THREE.Group {
  const frame = new THREE.Group();
  frame.position.copy(origin);
  const direction = new THREE.Vector3().subVectors(target, origin).normalize();
  frame.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
  parent.add(frame);
  frame.updateMatrixWorld(true);
  return frame;
}

function onGround(x: number, z: number, offset: number): THREE.Vector3 {
  return new THREE.Vector3(x, groundHeight(x, z) + offset, z);
}

function buildHull(kit: Kit, materials: SceneMaterials): void {
  const steel = materials.steel;
  kit.add(createSlab(HULL_OUTLINE, 1, 7, 1.2), steel, new THREE.Matrix4(), STEEL);
  kit.add(createSlab(HULL_OUTLINE, 0.84, 4.6, 0.8), steel, compose([0, -9.2, 0]), STEEL_UNDER);
  kit.add(createSlab(HULL_OUTLINE, 0.56, 3, 0.6), steel, compose([0, -15, 0]), STEEL_DARK);

  // Slanted skirt armour along both flanks; a few plates are missing or hang loose.
  for (const side of [1, -1]) {
    for (let index = 0; index < 8; index++) {
      const x = -28 + index * 8.2;
      const missing = side === 1 && index === 3;
      if (missing) {
        kit.box([7.6, 6.4, 0.4], [x, -4.6, 30.2], steel, HOLLOW);
        for (let rib = 0; rib < 4; rib++) {
          kit.box([0.7, 6.4, 1.2], [x - 3 + rib * 2, -4.6, 30.4], steel, STEEL_DARK);
        }
        kit.add(createGearGeometry(2.6, 12, 0.8), steel, compose([x + 1.2, -5.5, 30.8]), STEEL_WORN);
        continue;
      }
      const loose = side === -1 && index === 5;
      const tint = index % 3 === 0 ? FADED_PAINT : STEEL_WORN;
      const roll = loose ? 0.55 : 0;
      const drop = loose ? -2.2 : 0;
      kit.box([7.8, 6.6, 0.7], [x, -4.4 + drop, side * 31.4], steel, tint, [-side * 0.16, 0, roll]);
      kit.box([7.9, 0.6, 1.1], [x, -1.2 + drop, side * 31], steel, STEEL_DARK, [-side * 0.16, 0, roll]);
    }
  }

  // Prow armour and sensor housings on the front faces.
  kit.box([3, 7, 26], [48.2, -4.2, 0], steel, FADED_PAINT, [0, 0, 0.22]);
  for (const side of [1, -1]) {
    kit.box([3, 6.2, 16], [43.6, -4.4, side * 22.4], steel, STEEL_WORN, [0, side * 1.0, 0.2]);
  }

  // Deck furniture: bollards along the rim, hatches, rear vent grilles.
  for (let corner = 0; corner < HULL_OUTLINE.length; corner++) {
    const [ax, az] = HULL_OUTLINE[corner];
    const [bx, bz] = HULL_OUTLINE[(corner + 1) % HULL_OUTLINE.length];
    const length = Math.hypot(bx - ax, bz - az);
    const count = Math.floor(length / 9);
    for (let step = 1; step < count; step++) {
      const t = step / count;
      const inset = 0.93;
      kit.cylinder(0.55, 0.7, 1.1, [(ax + (bx - ax) * t) * inset, 0.55, (az + (bz - az) * t) * inset], steel, STEEL_DARK);
    }
  }
  const hatches: Array<[number, number, boolean]> = [
    [31, -21, true],
    [-6, -9, false],
    [-41, -2, false],
  ];
  for (const [x, z, open] of hatches) {
    kit.cylinder(3.1, 3.3, 0.9, [x, 0.45, z], steel, STEEL_WORN, [0, 0, 0], 28);
    if (open) {
      kit.cylinder(2.4, 2.4, 0.2, [x, 0.85, z], steel, HOLLOW, [0, 0, 0], 28);
      kit.cylinder(2.7, 2.7, 0.5, [x + 2.4, 2.4, z], steel, STEEL, [0, 0, 1.25], 28);
    } else {
      kit.cylinder(2.7, 2.8, 0.5, [x, 1.1, z], steel, STEEL, [0, 0, 0], 28);
      kit.box([0.5, 0.4, 3.2], [x, 1.45, z], steel, STEEL_DARK);
    }
  }
  for (const z of [-9, 9]) {
    kit.box([3.4, 1, 6], [-42.5, 0.5, z], steel, STEEL_DARK);
    for (let slat = 0; slat < 7; slat++) {
      kit.box([3.6, 0.25, 0.3], [-42.5, 1.05, z - 2.6 + slat * 0.86], steel, STEEL_WORN);
    }
  }
}

function buildExhaustStacks(kit: Kit, materials: SceneMaterials, hull: THREE.Group): THREE.Vector3[] {
  const tops: THREE.Vector3[] = [];
  for (const side of [1, -1]) {
    const base = new THREE.Vector3(-39, -1, side * 20);
    const top = new THREE.Vector3(-43.5, 15, side * 21.5);
    kit.beam(base, top, 2.7, materials.steel, STEEL_WORN, 24, 2.3);
    const axis = new THREE.Vector3().subVectors(top, base).normalize();
    for (const t of [0.2, 0.55, 0.9]) {
      const center = base.clone().lerp(top, t);
      kit.beam(center.clone().addScaledVector(axis, -0.35), center.clone().addScaledVector(axis, 0.35), 2.95 - t * 0.4, materials.steel, STEEL_DARK, 24);
    }
    kit.beam(top.clone().addScaledVector(axis, -0.6), top.clone().addScaledVector(axis, 0.4), 2.7, materials.steel, STEEL_DARK, 24);
    kit.beam(top.clone().addScaledVector(axis, 0.3), top.clone().addScaledVector(axis, 0.42), 1.9, materials.steel, HOLLOW, 24);
    tops.push(toWorld(hull, [top.x - axis.x * 0.2, top.y + 0.6, top.z]));
  }
  return tops;
}

function buildBarrel(kit: Kit, materials: SceneMaterials, length: number): void {
  const steel = materials.steel;
  const along = (x: number): THREE.Vector3 => new THREE.Vector3(x, 0, 0);
  kit.beam(along(-1), along(10), 3.1, steel, STEEL_WORN, 32);
  for (const x of [0.4, 9.4]) kit.beam(along(x - 0.4), along(x + 0.4), 3.4, steel, STEEL_DARK, 32);
  kit.beam(along(10), along(length - 17), 2.3, steel, STEEL, 28);
  kit.beam(along(length - 17), along(length - 15.5), 2.3, steel, STEEL_WORN, 28, 2.95);
  kit.beam(along(length - 15.5), along(length - 12.5), 2.95, steel, STEEL_WORN, 28);
  kit.beam(along(length - 12.5), along(length - 11), 2.95, steel, STEEL_WORN, 28, 2.3);
  kit.beam(along(length - 11), along(length - 6), 2.2, steel, STEEL, 28);
  kit.beam(along(length - 6), along(length), 3.1, steel, STEEL_WORN, 8);
  for (const side of [1, -1]) {
    for (const x of [length - 4.6, length - 2.1]) {
      kit.box([1.3, 2, 0.4], [x, 0, side * 2.95], steel, HOLLOW);
    }
  }
  kit.beam(along(length - 0.05), along(length + 0.03), 1.75, steel, HOLLOW, 24);
}

function buildTurret(kit: Kit, materials: SceneMaterials): void {
  const steel = materials.steel;
  kit.cylinder(13, 14, 3, [0, 1.5, 0], steel, STEEL_WORN, [0, 0, 0], 48);
  kit.cylinder(14.4, 14.4, 0.9, [0, 0.45, 0], steel, STEEL_DARK, [0, 0, 0], 48);
  const housing: Array<[number, number]> = [
    [-13, 0],
    [9, 0],
    [15, 3.5],
    [13.5, 8],
    [4, 10],
    [-9, 10],
    [-13, 7],
  ];
  kit.add(createProfile(housing, 20, 0.6), steel, compose([0, 3, 0]), FADED_PAINT);
  for (const side of [1, -1]) {
    kit.box([19, 6.4, 0.9], [0, 7, side * 10.9], steel, STEEL_WORN, [side * 0.06, 0, 0]);
    for (let rivetRow = 0; rivetRow < 2; rivetRow++) {
      for (let column = 0; column < 9; column++) {
        kit.cylinder(0.22, 0.22, 0.3, [-8 + column * 2, 5 + rivetRow * 4.2, side * 11.4], steel, STEEL_DARK, [Math.PI / 2, 0, 0], 8);
      }
    }
  }
  kit.box([5, 6, 17], [-15, 7, 0], steel, STEEL_WORN);
  kit.cylinder(2.2, 2.5, 1.8, [-2, 14.5, -6], steel, STEEL_WORN);
  kit.sphere(2.1, [-2, 15.3, -6], steel, STEEL, [1, 0.5, 1]);
  kit.box([0.4, 0.5, 2.6], [0.2, 14.6, -6], steel, HOLLOW);
  for (let slit = 0; slit < 3; slit++) {
    kit.box([0.5, 0.7, 2.4], [14.3, 5.2 + slit * 1.1, -6 + slit * 6], steel, HOLLOW, [0, 0, -0.3]);
  }
  kit.box([4.4, 8.6, 19], [16, 7.6, 0], steel, STEEL_WORN);
  kit.box([4.6, 1, 19.4], [16, 11.6, 0], steel, STEEL_DARK);
}

function buildBrokenBarrel(kit: Kit, materials: SceneMaterials, random: Random): void {
  const steel = materials.steel;
  const along = (x: number): THREE.Vector3 => new THREE.Vector3(x, 0, 0);
  kit.beam(along(-1), along(10), 3.1, steel, STEEL_WORN, 32);
  kit.beam(along(9), along(9.8), 3.4, steel, STEEL_DARK, 32);
  kit.add(createTornTube(2.3, 9, random), steel, alignAlongX(10, 19), STEEL);
  kit.add(createTornTube(1.75, 8.6, random), steel, alignAlongX(10, 18.6), HOLLOW);
}

function alignAlongX(fromX: number, toX: number): THREE.Matrix4 {
  return compose([(fromX + toX) / 2, 0, 0], [0, 0, -Math.PI / 2]);
}

function buildFallenBarrel(kit: Kit, materials: SceneMaterials, muzzle: THREE.Group, random: Random): void {
  const steel = materials.steel;
  const pieceKit = kit.withFrame(muzzle);
  const along = (x: number): THREE.Vector3 => new THREE.Vector3(x, 0, 0);
  pieceKit.add(createTornTube(2.3, 22, random), steel, compose([-17, 0, 0], [0, 0, Math.PI / 2]), STEEL_WORN);
  pieceKit.add(createTornTube(1.75, 21.6, random), steel, compose([-16.8, 0, 0], [0, 0, Math.PI / 2]), HOLLOW);
  pieceKit.beam(along(-12), along(-6), 2.2, steel, STEEL, 28);
  pieceKit.beam(along(-6), along(0), 3.1, steel, STEEL_WORN, 8);
  for (const side of [1, -1]) {
    pieceKit.box([1.3, 2, 0.4], [-4.6, 0, side * 2.95], steel, HOLLOW);
    pieceKit.box([1.3, 2, 0.4], [-2.1, 0, side * 2.95], steel, HOLLOW);
  }
  pieceKit.beam(along(-14), along(-12.5), 2.95, steel, STEEL_WORN, 28, 2.3);
  pieceKit.beam(along(-17), along(-14), 2.95, steel, STEEL_WORN, 28);
}

interface LegOptions {
  clawYaw: number;
  footRadius: number;
}

function buildLeg(
  kit: Kit,
  materials: SceneMaterials,
  hip: THREE.Vector3,
  knee: THREE.Vector3,
  foot: THREE.Vector3 | null,
  options: LegOptions,
  climbables: Climbable[],
): void {
  const steel = materials.steel;
  const thigh = new THREE.Vector3().subVectors(knee, hip);
  const side = new THREE.Vector3().crossVectors(thigh, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 0.5) side.set(0, 0, 1);
  kit.sphere(4.3, hip.toArray(), steel, STEEL_DARK);
  kit.beam(hip.clone().addScaledVector(side, -3.8), hip.clone().addScaledVector(side, 3.8), 3.2, steel, STEEL_WORN, 24);
  kit.bar(hip, knee, 4.4, 5.4, steel, STEEL_WORN);
  kit.bar(
    hip.clone().lerp(knee, 0.12).add(new THREE.Vector3(0, 2.8, 0)),
    hip.clone().lerp(knee, 0.85).add(new THREE.Vector3(0, 2.8, 0)),
    4.8,
    1,
    steel,
    FADED_PAINT,
  );
  for (const sign of [1, -1]) {
    const offset = side.clone().multiplyScalar(sign * 3.4);
    const pistonStart = hip.clone().lerp(knee, 0.1).add(offset);
    const pistonEnd = hip.clone().lerp(knee, 0.92).add(offset);
    const pistonMiddle = pistonStart.clone().lerp(pistonEnd, 0.55);
    kit.beam(pistonStart, pistonMiddle, 0.95, steel, STEEL, 16);
    kit.beam(pistonMiddle, pistonEnd, 0.5, steel, PISTON, 12);
    kit.beam(pistonMiddle.clone().addScaledVector(thigh, -0.01), pistonMiddle.clone().addScaledVector(thigh, 0.012), 1.15, steel, STEEL_DARK, 16);
  }
  kit.beam(knee.clone().addScaledVector(side, -3.6), knee.clone().addScaledVector(side, 3.6), 3.5, steel, STEEL_WORN, 28);
  kit.beam(knee.clone().addScaledVector(side, -4.2), knee.clone().addScaledVector(side, 4.2), 1.8, steel, STEEL_DARK, 16);
  const cable = new THREE.CatmullRomCurve3([
    hip.clone().addScaledVector(side, 2).add(new THREE.Vector3(0, -2.5, 0)),
    hip.clone().lerp(knee, 0.5).addScaledVector(side, 2.4).add(new THREE.Vector3(0, -4.5, 0)),
    knee.clone().addScaledVector(side, 2).add(new THREE.Vector3(0, -2.5, 0)),
  ]);
  kit.add(new THREE.TubeGeometry(cable, 24, 0.45, 8), steel, new THREE.Matrix4(), CABLE);
  climbables.push({ start: hip.clone(), end: knee.clone(), radius: 3 });
  if (!foot) return;
  const ankle = foot.clone().add(new THREE.Vector3(0, 2.2, 0));
  kit.beam(knee, ankle, 2.7, steel, STEEL, 6, 1.9);
  kit.sphere(2.2, ankle.toArray(), steel, STEEL_DARK);
  kit.cylinder(options.footRadius * 0.85, options.footRadius, 2.4, [foot.x, foot.y + 0.6, foot.z], steel, STEEL_WORN, [0, options.clawYaw, 0], 8);
  for (let claw = -1; claw <= 1; claw++) {
    const angle = options.clawYaw + claw * 0.75;
    const tip = foot.clone().add(new THREE.Vector3(Math.cos(angle) * (options.footRadius + 3), -0.6, -Math.sin(angle) * (options.footRadius + 3)));
    kit.bar(foot.clone().add(new THREE.Vector3(0, 0.9, 0)), tip, 1.7, 1.3, steel, STEEL_DARK);
  }
  climbables.push({ start: knee.clone(), end: ankle, radius: 2.4 });
}

function buildHead(kit: Kit, materials: SceneMaterials, head: THREE.Group): THREE.Vector3 {
  const steel = materials.steel;
  const headKit = kit.withFrame(head);
  const profile: Array<[number, number]> = [
    [-11, 0],
    [9, 0],
    [13, 3],
    [12.4, 7.2],
    [5, 10.5],
    [-7, 10.5],
    [-11.5, 6.5],
  ];
  headKit.add(createProfile(profile, 17, 0.8), steel, new THREE.Matrix4(), FADED_PAINT);
  const lensNormal = new THREE.Vector3(4.2, 0.6, 0).normalize();
  const lensCenter = new THREE.Vector3(12.9, 5.1, 0);
  headKit.beam(lensCenter.clone().addScaledVector(lensNormal, -0.4), lensCenter.clone().addScaledVector(lensNormal, 1.2), 4.4, steel, STEEL_DARK, 40);
  headKit.beam(lensCenter.clone().addScaledVector(lensNormal, 1.1), lensCenter.clone().addScaledVector(lensNormal, 1.35), 3.5, materials.lens, 0xffffff, 40);
  headKit.beam(lensCenter.clone().addScaledVector(lensNormal, 1.3), lensCenter.clone().addScaledVector(lensNormal, 1.42), 0.95, materials.lensCore, 0xffffff, 24);
  for (const side of [1, -1]) {
    const small = new THREE.Vector3(12.2, 7.4, side * 5.6);
    headKit.beam(small.clone().addScaledVector(lensNormal, -0.3), small.clone().addScaledVector(lensNormal, 0.9), 1.5, steel, STEEL_DARK, 20);
    headKit.beam(small.clone().addScaledVector(lensNormal, 0.85), small.clone().addScaledVector(lensNormal, 1.0), 1.1, materials.lens, 0xffffff, 20);
    headKit.beam(small.clone().addScaledVector(lensNormal, 0.95), small.clone().addScaledVector(lensNormal, 1.05), 0.35, materials.lensCore, 0xffffff, 12);
    headKit.beam(new THREE.Vector3(-1, 6, side * 8.6), new THREE.Vector3(-1, 6, side * 11.4), 2.8, steel, STEEL_WORN, 24);
    headKit.beam(new THREE.Vector3(-1, 6, side * 11.3), new THREE.Vector3(-1, 6, side * 11.7), 1.6, steel, STEEL_DARK, 16);
  }
  headKit.box([3.4, 1.4, 16], [11.2, 9, 0], steel, STEEL_WORN, [0, 0, -0.35]);
  headKit.box([12, 2.6, 0.9], [-1, 11.6, 0], steel, STEEL_WORN);
  for (let slat = 0; slat < 6; slat++) {
    headKit.box([0.6, 1.6, 1.2], [13.1, 1.6, -5 + slat * 2], steel, HOLLOW, [0, 0, -0.6]);
  }
  headKit.beam(new THREE.Vector3(-1, 8, 10.5), new THREE.Vector3(-6, 16, 12), 0.25, steel, STEEL_DARK, 6);
  return toWorld(head, lensCenter.clone().addScaledVector(lensNormal, 1.4).toArray());
}

function buildNeckCables(kit: Kit, materials: SceneMaterials, hull: THREE.Group, head: THREE.Group): void {
  const offsets = [-6, -2.5, 1, 4.5, 7.5];
  offsets.forEach((offset, index) => {
    const start = toWorld(hull, [46.5, -9 - (index % 2) * 2, offset]);
    const end = toWorld(head, [-11, 4 + (index % 3), offset * 0.8]);
    const middle = start.clone().lerp(end, 0.55);
    middle.y = groundHeight(middle.x, middle.z) + 0.7 + index * 0.15;
    const outward = start.clone().lerp(end, 0.2);
    outward.y -= 4;
    const curve = new THREE.CatmullRomCurve3([start, outward, middle, end]);
    const radius = index % 2 === 0 ? 1.05 : 0.75;
    kit.add(new THREE.TubeGeometry(curve, 40, radius, 10), materials.steel, new THREE.Matrix4(), CABLE);
    for (let collar = 1; collar < 8; collar++) {
      const t = collar / 8;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      kit.beam(point.clone().addScaledVector(tangent, -0.35), point.clone().addScaledVector(tangent, 0.35), radius + 0.25, materials.steel, STEEL_DARK, 12);
    }
  });
  const strutBase = onGround(58, -2, -1);
  kit.beam(toWorld(hull, [44, -12, -2]), strutBase, 1.6, materials.steel, STEEL_WORN, 12);
  kit.beam(strutBase.clone().lerp(toWorld(hull, [44, -12, -2]), 0.4), strutBase, 0.8, materials.steel, PISTON, 12);
}

function buildArm(kit: Kit, materials: SceneMaterials, hull: THREE.Group, climbables: Climbable[]): THREE.Vector3 {
  const steel = materials.steel;
  const shoulder = toWorld(hull, [14, -7, -29]);
  const elbow = onGround(shoulder.x + 12, shoulder.z - 24, 3.2);
  const wrist = onGround(elbow.x - 20, elbow.z - 13, 2.2);
  kit.sphere(5, shoulder.toArray(), steel, STEEL_DARK);
  for (let layer = 0; layer < 3; layer++) {
    kit.box(
      [10 - layer * 1.4, 1.1, 9 - layer * 1.2],
      [shoulder.x + layer * 1.1, shoulder.y + 4.4 - layer * 1.7, shoulder.z - 1.2 - layer * 1.3],
      steel,
      layer === 0 ? FADED_PAINT : STEEL_WORN,
      [-0.38 - layer * 0.14, 0, 0.12],
    );
  }
  kit.bar(shoulder, elbow, 4.6, 4.6, steel, STEEL_WORN);
  const side = new THREE.Vector3().subVectors(elbow, shoulder).cross(new THREE.Vector3(0, 1, 0)).normalize();
  for (const sign of [1, -1]) {
    const offset = side.clone().multiplyScalar(sign * 3.2);
    const start = shoulder.clone().lerp(elbow, 0.12).add(offset);
    const end = shoulder.clone().lerp(elbow, 0.9).add(offset);
    const middle = start.clone().lerp(end, 0.5);
    kit.beam(start, middle, 0.85, steel, STEEL, 16);
    kit.beam(middle, end, 0.45, steel, PISTON, 12);
  }
  kit.beam(elbow.clone().addScaledVector(side, -3.4), elbow.clone().addScaledVector(side, 3.4), 3.7, steel, STEEL_WORN, 28);
  kit.beam(elbow, wrist, 3.2, steel, STEEL, 8, 2.6);
  climbables.push({ start: shoulder, end: elbow, radius: 3.2 }, { start: elbow, end: wrist, radius: 3.1 });

  const towardHand = new THREE.Vector3().subVectors(wrist, elbow);
  towardHand.y = 0;
  const hand = createFrameAlongX(kit.frame, wrist, wrist.clone().add(towardHand));
  const handKit = kit.withFrame(hand);
  handKit.sphere(2.6, [0, 0, 0], steel, STEEL_DARK);
  handKit.box([8.4, 2.4, 7.2], [4.6, -0.8, 0], steel, STEEL_WORN);
  for (const z of [-2.5, 0, 2.5]) {
    const knuckle = new THREE.Vector3(9, -0.2, z);
    const middle = new THREE.Vector3(12.4, 1.2 + Math.abs(z) * 0.2, z * 1.05);
    const tip = new THREE.Vector3(13.6, 4.2, z * 1.1);
    handKit.sphere(1.25, knuckle.toArray(), steel, STEEL_DARK);
    handKit.beam(knuckle, middle, 1.0, steel, STEEL, 8);
    handKit.sphere(1.05, middle.toArray(), steel, STEEL_DARK);
    handKit.beam(middle, tip, 0.9, steel, STEEL, 8, 0.6);
  }
  const thumbBase = new THREE.Vector3(3.6, -0.2, 3.8);
  const thumbMiddle = new THREE.Vector3(6, 1.6, 6.4);
  handKit.beam(thumbBase, thumbMiddle, 1.1, steel, STEEL, 8);
  handKit.beam(thumbMiddle, new THREE.Vector3(8.4, 3.4, 6.6), 0.95, steel, STEEL, 8, 0.6);
  return toWorld(hand, [4.6, 0.5, 0]);
}

function buildGear(kit: Kit, materials: SceneMaterials, root: THREE.Object3D): void {
  const center = onGround(72, 48, 4.2);
  const gear = createFrame(root, center.toArray(), [0.1, 0.9, 0.12], "gear");
  const gearKit = kit.withFrame(gear);
  gearKit.add(createGearGeometry(10, 22, 2.2), materials.steel, new THREE.Matrix4(), STEEL_WORN);
  gearKit.beam(new THREE.Vector3(0, 0, -2.6), new THREE.Vector3(0, 0, 2.6), 1.9, materials.steel, STEEL_DARK, 20);
}

function buildFallenPlates(kit: Kit, materials: SceneMaterials): void {
  const plates: Array<[number, number, number, number]> = [
    [-14, 40, 0.5, 0.35],
    [28, -42, -0.3, 0.2],
    [-22, -40, 1.1, -0.4],
    [54, -30, 0.2, 0.5],
  ];
  for (const [x, z, yaw, tilt] of plates) {
    const position = onGround(x, z, 0.6);
    kit.box([7.8, 0.7, 6.6], position.toArray(), materials.steel, FADED_PAINT, [tilt, yaw, tilt * 0.4]);
  }
}

function buildCoolantPipe(kit: Kit, materials: SceneMaterials): void {
  const steel = materials.steel;
  kit.beam(new THREE.Vector3(8, -6, 27), new THREE.Vector3(8, -6, 39), 1.3, steel, STEEL_WORN, 20);
  for (const z of [31, 35.5]) {
    kit.beam(new THREE.Vector3(8, -6, z - 0.3), new THREE.Vector3(8, -6, z + 0.3), 1.65, steel, STEEL_DARK, 20);
  }
  kit.beam(new THREE.Vector3(8, -6, 38.8), new THREE.Vector3(8, -6, 39.3), 1.05, steel, HOLLOW, 20);
  kit.beam(new THREE.Vector3(8, -12, 31), new THREE.Vector3(8, -7, 36), 0.45, steel, STEEL_DARK, 8);
}

/** Top-edge polylines of the hull, pushed just outside the deck rim. */
function collectVineEdges(hull: THREE.Group, intactBarrel: THREE.Group, barrelLength: number): THREE.Vector3[][] {
  const deckEdge = HULL_OUTLINE.map(([x, z]) => {
    const length = Math.hypot(x, z);
    return toWorld(hull, [x + (x / length) * 1.4, -0.4, z + (z / length) * 1.4]);
  });
  deckEdge.push(deckEdge[0].clone());
  const barrelEdge = [toWorld(intactBarrel, [11, -2.2, 0]), toWorld(intactBarrel, [barrelLength - 7, -2.1, 0])];
  return [deckEdge, barrelEdge];
}

export function buildMechRuin(kit: Kit, materials: SceneMaterials, root: THREE.Object3D): MechRuin {
  const random = createRandom(1913);
  const climbables: Climbable[] = [];

  const hull = createFrame(root, [0, 30, 0], [-0.035, 0, 0.065], "hull");
  const hullKit = kit.withFrame(hull);
  buildHull(hullKit, materials);
  buildCoolantPipe(hullKit, materials);
  const smokeSources = buildExhaustStacks(hullKit, materials, hull);

  const turret = createFrame(hull, [-22, 0, 2], [0, -0.55, 0], "turret");
  buildTurret(kit.withFrame(turret), materials);
  const intactBarrelLength = 50;
  const intactBarrel = createFrame(turret, [18, 7.5, 5.6], [0, 0, 0.3], "intact-barrel");
  buildBarrel(kit.withFrame(intactBarrel), materials, intactBarrelLength);
  const brokenBarrel = createFrame(turret, [18, 7.5, -5.6], [0, 0, -0.07], "broken-barrel");
  buildBrokenBarrel(kit.withFrame(brokenBarrel), materials, random);

  const fallenMuzzleOrigin = onGround(-28, 56, 1.5);
  const fallenTail = onGround(-46, 36, 1.2);
  const fallenMuzzle = createFrameAlongX(root, fallenMuzzleOrigin, fallenMuzzleOrigin.clone().multiplyScalar(2).sub(fallenTail));
  buildFallenBarrel(kit, materials, fallenMuzzle, random);

  const worldKit = kit.withFrame(root);
  const frontRightHip = toWorld(hull, [30, -12, 23]);
  buildLeg(worldKit, materials, frontRightHip, frontRightHip.clone().add(new THREE.Vector3(9, 8, 14)), onGround(frontRightHip.x + 13, frontRightHip.z + 25, -0.6), { clawYaw: -0.6, footRadius: 4.6 }, climbables);
  const frontLeftHip = toWorld(hull, [30, -12, -23]);
  buildLeg(worldKit, materials, frontLeftHip, onGround(frontLeftHip.x + 13, frontLeftHip.z - 13, 3.2), onGround(frontLeftHip.x + 22, frontLeftHip.z - 3, -0.8), { clawYaw: 0.1, footRadius: 4.4 }, climbables);
  const rearLeftHip = toWorld(hull, [-30, -12, -23]);
  const rearLeftKnee = onGround(rearLeftHip.x - 10, rearLeftHip.z - 14, 2.4);
  buildLeg(worldKit, materials, rearLeftHip, rearLeftKnee, null, { clawYaw: 0, footRadius: 4.4 }, climbables);
  kit.beam(rearLeftKnee, onGround(rearLeftKnee.x - 4, rearLeftKnee.z - 6, -5), 2.7, materials.steel, STEEL, 6, 2.1);

  // The rear-right leg sheared at the thigh; the rest lies sprawled behind the machine.
  const rearRightHip = toWorld(hull, [-30, -12, 23]);
  worldKit.sphere(4.3, rearRightHip.toArray(), materials.steel, STEEL_DARK);
  const stubEnd = rearRightHip.clone().add(new THREE.Vector3(-3, 1.5, 5));
  const stubFrame = createFrameAlongX(root, rearRightHip, stubEnd);
  kit.withFrame(stubFrame).add(createTornTube(2.6, 6, random), materials.steel, alignAlongX(0, 6), STEEL_WORN);
  const severedKnee = onGround(-74, 14, 2.6);
  buildLeg(worldKit, materials, onGround(-62, 30, 2.4), severedKnee, onGround(-84, 4, -0.5), { clawYaw: 2.6, footRadius: 4.4 }, climbables);

  const head = createFrame(root, [80, groundHeight(80, -6) - 1.2, -6], [0.08, -0.85, -0.05], "head");
  const lensCenter = buildHead(kit, materials, head);
  buildNeckCables(worldKit, materials, hull, head);
  const palmCenter = buildArm(worldKit, materials, hull, climbables);
  buildGear(kit, materials, root);
  buildFallenPlates(worldKit, materials);

  const waterfallSource = toWorld(hull, [8, -6.8, 39.2]);
  const waterfallDirection = toWorld(hull, [8, -6.8, 40.2]).sub(waterfallSource).normalize();

  return {
    hull,
    turret,
    intactBarrel,
    intactBarrelLength,
    barrelRadius: 2.3,
    turretRoof: [-3, 13.6, 2],
    fallenMuzzle,
    boreRadius: 1.75,
    smokeSources,
    climbables,
    vineEdges: collectVineEdges(hull, intactBarrel, intactBarrelLength),
    waterfallSource,
    waterfallDirection,
    palmCenter,
    lensCenter,
  };
}

