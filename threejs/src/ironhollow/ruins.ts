import * as THREE from "three";
import { Kit, compose, alignBetween } from "../mech-village/batch";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createRandom, pick, fbm, type Random } from "../mech-village/noise";
import { COLORS as C, DECK_HEIGHT, type Materials } from "./materials";
import { terrainHeight } from "./terrain";
import { MECH_SCALE, LAKE } from "./scale";

const TAU = Math.PI * 2;
const STEEL_PANELS = [C.steel, "#667565", "#798174", "#5f6b62", "#8a8d7c"];
const TRAIL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [27 * MECH_SCALE, 17 * MECH_SCALE], [25 * MECH_SCALE, 24 * MECH_SCALE],
  [21 * MECH_SCALE, 34 * MECH_SCALE], [23 * MECH_SCALE, 45 * MECH_SCALE],
  [38 * MECH_SCALE, 65 * MECH_SCALE], [44 * MECH_SCALE, 110 * MECH_SCALE],
  [66 * MECH_SCALE, 170 * MECH_SCALE],
];

function ring(kit: Kit, materials: Materials, radius: number, thickness: number, position: THREE.Vector3Tuple, color: string, rotation: THREE.Vector3Tuple = [0, 0, 0]): void {
  kit.add(new THREE.TorusGeometry(radius, thickness, 8, 56), materials.metal, compose(position, rotation), color);
}

function cable(kit: Kit, materials: Materials, points: THREE.Vector3Tuple[], radius: number, color: string = C.darkSteel): void {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  kit.add(new THREE.TubeGeometry(curve, 32, radius, 7), materials.metal, new THREE.Matrix4(), color);
}

function gear(radius: number, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const teeth = 22;
  for (let point = 0; point <= teeth * 4; point++) {
    const angle = (point / (teeth * 4)) * TAU;
    const r = point % 4 === 1 || point % 4 === 2 ? radius : radius * 0.86;
    if (point === 0) shape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  const axle = new THREE.Path();
  axle.absarc(0, 0, radius * 0.19, 0, TAU, true);
  shape.holes.push(axle);
  for (let hole = 0; hole < 5; hole++) {
    const angle = (hole / 5) * TAU;
    const opening = new THREE.Path();
    opening.absarc(Math.cos(angle) * radius * 0.54, Math.sin(angle) * radius * 0.54, radius * 0.19, 0, TAU, true);
    shape.holes.push(opening);
  }
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 1 });
}

function buildTurbine(kit: Kit, materials: Materials): void {
  const turbine = kit.within([0, 5.8, 18.6], [-0.08, 0, 0]);
  turbine.cylinder(6.3, 6.3, 2.6, [0, 0, 0], materials.metal, C.rust, [Math.PI / 2, 0, 0], 48);
  turbine.cylinder(5.6, 5.6, 0.3, [0, 0, 1.36], materials.metal, "#172e36", [Math.PI / 2, 0, 0], 48);
  ring(turbine, materials, 6.2, 0.32, [0, 0, 1.7], C.paleSteel);
  ring(turbine, materials, 5.7, 0.2, [0, 0, 1.75], C.orangeRust);
  ring(turbine, materials, 4.8, 0.15, [0, 0, 1.45], C.steel);
  for (let blade = 0; blade < 24; blade++) {
    const angle = (blade / 24) * TAU;
    turbine.box([0.66, 3.25, 0.35], [Math.sin(angle) * 3.15, Math.cos(angle) * 3.15, 1.7], materials.metal, blade % 4 === 0 ? C.rust : C.paleSteel, [0, 0.42, -angle + 0.28]);
  }
  turbine.cylinder(1.65, 1.65, 0.7, [0, 0, 2], materials.metal, C.darkSteel, [Math.PI / 2, 0, 0], 24);
  turbine.sphere(1.3, [0, 0, 2.3], materials.metal, C.brass, [1, 1, 0.4], 20);
  ring(turbine, materials, 1.45, 0.12, [0, 0, 2.45], C.orangeRust);
  for (let bolt = 0; bolt < 16; bolt++) {
    const angle = (bolt / 16) * TAU;
    turbine.cylinder(0.15, 0.15, 0.2, [Math.sin(angle) * 6.15, Math.cos(angle) * 6.15, 2.02], materials.metal, C.darkSteel, [Math.PI / 2, 0, 0], 6);
  }
}

function buildHull(kit: Kit, materials: Materials, random: Random): void {
  const body = new THREE.CylinderGeometry(22, 19, 5, 48);
  kit.add(body, materials.metal, compose([0, 8.8, 0], [0, 0, 0], [1.13, 1, 0.86]), C.darkSteel);
  kit.add(new THREE.CylinderGeometry(20, 15, 3, 32), materials.metal, compose([0, 5, 0], [0, 0, 0], [1.13, 1, 0.86]), C.steel);
  kit.add(new THREE.CylinderGeometry(22.2, 22.2, 0.65, 64), materials.metal, compose([0, 11.65, 0], [0, 0, 0], [1.13, 1, 0.86]), C.paleSteel);
  kit.add(new THREE.CylinderGeometry(21.65, 21.65, 0.18, 64), materials.metal, compose([0, DECK_HEIGHT - 0.09, 0], [0, 0, 0], [1.13, 1, 0.86]), "#64776c");
  for (let panel = 0; panel < 28; panel++) {
    const a = (panel / 28) * TAU;
    const x = Math.sin(a) * 24;
    const z = Math.cos(a) * 18.3;
    if (Math.abs(x) < 6.6 && z > 0) continue;
    const face = kit.within([x, 8.7, z], [0, Math.atan2(Math.sin(a) / 25, Math.cos(a) / 19), 0]);
    const tint = pick(random, STEEL_PANELS);
    if (panel === 6 || panel === 20) {
      face.box([4.8, 4.2, 0.3], [0, 0, -0.25], materials.metal, "#1c333b");
      for (let coil = 0; coil < 4; coil++) {
        face.cylinder(0.35, 0.35, 2.8, [-1.5 + coil, 0, 0.2], materials.metal, C.rust, [0, 0, 0], 12);
        for (let band = 0; band < 5; band++) ring(face, materials, 0.38, 0.06, [-1.5 + coil, -1 + band * 0.5, 0.2], C.brass, [Math.PI / 2, 0, 0]);
      }
      face.box([4, 1.9, 0.25], [0.6, -2.8, 0.7], materials.metal, tint, [0.3, 0, 0.2]);
      continue;
    }
    face.add(new RoundedBoxGeometry(4.9, 4.6, 0.45, 2, 0.08), materials.metal, compose([0, 0, 0], [-0.1, 0, 0]), tint);
    face.box([4.95, 0.14, 0.3], [0, 2.27, 0.29], materials.metal, C.paleSteel);
    face.box([4.9, 0.22, 0.4], [0, -2.15, 0.25], materials.metal, C.rust);
    for (const bx of [-2.1, 2.1]) {
      for (const by of [-1.8, 1.8]) face.sphere(0.12, [bx, by, 0.35], materials.metal, C.brass, [1, 1, 0.5], 6);
    }
    if (panel % 3 === 0) {
      for (let vent = 0; vent < 6; vent++) face.box([0.18, 1.6, 0.13], [-1.15 + vent * 0.46, 0, 0.4], materials.metal, C.darkSteel, [0, 0, -0.2]);
    }
    for (let stain = 0; stain < 3; stain++) {
      const height = 0.3 + random() * 1.5;
      face.box([0.08 + random() * 0.16, height, 0.02], [(random() - 0.5) * 3.9, 1.9 - height / 2, 0.48], materials.metal, C.rust);
    }
  }
  // Exposed pressure vessels sit under the village rather than looking like house foundations.
  for (const side of [-1, 1]) {
    for (let vessel = 0; vessel < 3; vessel++) {
      const x = side * (9 + vessel * 3.4);
      const z = -15.4 + vessel;
      kit.beam(new THREE.Vector3(x, 4.5, z - 1), new THREE.Vector3(x, 8.5, z - 1), 1.25, materials.metal, C.rust, 16);
      ring(kit, materials, 1.27, 0.12, [x, 7.4, z - 1], C.brass, [Math.PI / 2, 0, 0]);
    }
  }
  for (const [x, z, r] of [[-2, -12, 2.5], [17, -2, 1.8], [-17, 9, 2]] as const) {
    kit.cylinder(r, r + 0.2, 0.45, [x, 12.25, z], materials.metal, C.rust, [0, 0, 0], 24);
    kit.cylinder(r * 0.83, r * 0.83, 0.14, [x, 12.52, z], materials.metal, C.steel, [0, 0, 0], 24);
    kit.box([r * 0.8, 0.12, 0.18], [x, 12.65, z], materials.metal, C.brass);
  }
  buildTurbine(kit, materials);
  buildHullMarking(kit);
}

function buildHullMarking(kit: Kit): void {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");
  context.fillStyle = "#dfd6b4";
  context.font = "bold 90px monospace";
  context.textAlign = "center";
  context.fillText("07", 128, 92);
  context.clearRect(0, 58, 256, 4);
  context.clearRect(0, 81, 256, 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const paint = new THREE.MeshStandardMaterial({ map, transparent: true, opacity: 0.7, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const angle = (4 / 28) * TAU;
  const face = kit.within([Math.sin(angle) * 24, 8.7, Math.cos(angle) * 18.3], [0, Math.atan2(Math.sin(angle) / 25, Math.cos(angle) / 19), 0]);
  face.add(new THREE.PlaneGeometry(3.4, 1.7), paint, compose([0, 0, 0.45]));
}

function buildLeg(kit: Kit, materials: Materials, hip: THREE.Vector3Tuple, knee: THREE.Vector3Tuple, foot: THREE.Vector3Tuple): void {
  const a = new THREE.Vector3(...hip);
  const b = new THREE.Vector3(...knee);
  const c = new THREE.Vector3(...foot);
  const axis = new THREE.Vector3().subVectors(b, a).normalize();
  const across = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
  kit.sphere(3, hip, materials.metal, C.darkSteel, [1, 0.9, 1], 16);
  kit.add(new RoundedBoxGeometry(3.4, a.distanceTo(b), 4.1, 2, 0.12), materials.metal, alignBetween(a, b), C.steel);
  kit.bar(a.clone().add(new THREE.Vector3(0, 2, 0)), b.clone().add(new THREE.Vector3(0, 2, 0)), 4, 0.5, materials.metal, C.paleSteel);
  for (const sign of [-1, 1]) {
    const offset = across.clone().multiplyScalar(2.3 * sign);
    const start = a.clone().lerp(b, 0.1).add(offset);
    const end = a.clone().lerp(b, 0.85).add(offset);
    const middle = start.clone().lerp(end, 0.55);
    kit.beam(start, middle, 0.55, materials.metal, C.rust, 12);
    kit.beam(middle, end, 0.28, materials.polishedMetal, "#bcbeb4", 16);
  }
  kit.beam(b.clone().addScaledVector(across, -2.8), b.clone().addScaledVector(across, 2.8), 2.7, materials.metal, C.darkSteel, 24);
  for (const sign of [-1, 1]) {
    const center = b.clone().addScaledVector(across, sign * 2.9);
    kit.beam(center, center.clone().addScaledVector(across, sign * 0.3), 2.1, materials.metal, C.rust, 24);
    kit.beam(center.clone().addScaledVector(across, sign * 0.3), center.clone().addScaledVector(across, sign * 0.45), 0.85, materials.metal, C.brass, 12);
  }
  kit.add(new RoundedBoxGeometry(2.8, b.distanceTo(c), 2.2, 2, 0.1), materials.metal, alignBetween(b, c), C.steel);
  const footKit = kit.within(foot, [0, Math.atan2(c.x - b.x, c.z - b.z), 0]);
  footKit.add(new RoundedBoxGeometry(5.2, 1, 5, 2, 0.12), materials.metal, compose([0, 0.15, 0]), C.darkSteel);
  for (const toe of [-1.7, 0, 1.7]) footKit.box([1.25, 0.65, 3.3], [toe, -0.1, 2.6], materials.metal, C.rust, [0.12, 0, 0]);
  const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -2.5, 0));
  cable(kit, materials, [a.toArray(), mid.toArray(), b.toArray()], 0.25);
}

function buildCannon(kit: Kit, materials: Materials): void {
  const turret = kit.within([-13, DECK_HEIGHT, -5]);
  turret.cylinder(7.5, 8, 1.5, [0, 0.75, 0], materials.metal, C.rust, [0, 0, 0], 48);
  ring(turret, materials, 7.6, 0.2, [0, 1.5, 0], C.brass, [Math.PI / 2, 0, 0]);
  turret.cylinder(6.1, 7.1, 4.8, [0, 3.8, 0], materials.metal, C.steel, [0, 0.2, 0], 8);
  turret.cylinder(6.3, 6.3, 0.35, [0, 6.3, 0], materials.metal, C.paleSteel, [0, 0.2, 0], 8);
  for (let panel = 0; panel < 8; panel++) {
    const a = (panel / 8) * TAU + 0.2;
    const face = turret.within([Math.sin(a) * 6.5, 3.5, Math.cos(a) * 6.5], [0, a, 0]);
    face.box([4, 2.4, 0.16], [0, 0, 0], materials.metal, panel % 3 ? C.steel : C.rust);
    for (const x of [-1.5, 1.5]) face.sphere(0.1, [x, 0.85, 0.17], materials.metal, C.brass, [1, 1, 1], 6);
  }
  const start = new THREE.Vector3(-16, 17.2, -7);
  const end = new THREE.Vector3(-40, 23.5, -5);
  const axis = end.clone().sub(start).normalize();
  kit.beam(start.clone().addScaledVector(axis, -2), start.clone().addScaledVector(axis, 8), 2.55, materials.metal, C.darkSteel, 24);
  const shaftStart = start.clone().addScaledVector(axis, 7);
  kit.add(new THREE.CylinderGeometry(1.65, 1.65, shaftStart.distanceTo(end), 24, 1, true), materials.metal, alignBetween(shaftStart, end), C.steel);
  for (const along of [0, 3, 7.5, 15, 20, 24]) {
    const center = start.clone().addScaledVector(axis, along);
    kit.beam(center.clone().addScaledVector(axis, -0.22), center.clone().addScaledVector(axis, 0.22), along < 8 ? 2.7 : 1.9, materials.metal, along % 2 ? C.rust : C.paleSteel, 24);
  }
  // A real open bore with a jagged rim keeps this recognisable as a ruined weapon.
  const muzzle = new THREE.CylinderGeometry(2.5, 2.25, 3.6, 24, 1, true);
  const positions = muzzle.getAttribute("position");
  for (let vertex = 0; vertex < positions.count; vertex++) {
    if (positions.getY(vertex) > 0) {
      const angle = Math.atan2(positions.getX(vertex), positions.getZ(vertex));
      positions.setY(vertex, positions.getY(vertex) - (0.5 + Math.sin(angle * 7) * 0.35));
    }
  }
  muzzle.computeVertexNormals();
  const matrix = alignBetween(end.clone().addScaledVector(axis, -1.8), end.clone().addScaledVector(axis, 1.8));
  const exposedSteel = materials.metal.clone();
  exposedSteel.onBeforeCompile = materials.metal.onBeforeCompile;
  exposedSteel.side = THREE.DoubleSide;
  kit.add(muzzle, exposedSteel, matrix, C.rust);
  const inner = new THREE.CylinderGeometry(1.65, 1.65, 3.6, 24, 1, true);
  kit.add(inner, exposedSteel, matrix, "#233a40");
  kit.beam(end.clone().addScaledVector(axis, -1.9), end.clone().addScaledVector(axis, -1.8), 1.65, materials.metal, "#172b30", 24);
  for (let rib = 0; rib < 4; rib++) {
    turret.box([0.2, 2.4, 5], [-4.5 + rib * 1.2, 7.5, -1], materials.metal, C.rust);
  }
  // The old sensor mast survives as a crooked aerial, now tied with bunting by the village.
  turret.beam(new THREE.Vector3(3.5, 6.5, -2), new THREE.Vector3(4.6, 14, -2.7), 0.09, materials.metal, C.darkSteel, 6);
  turret.beam(new THREE.Vector3(3.7, 11, -2), new THREE.Vector3(4.8, 11, -4), 0.07, materials.metal, C.brass, 6);
}

function buildBrokenHand(kit: Kit, materials: Materials): void {
  const hand = kit.within([9, -0.3, 31], [0, -0.45, 0]);
  hand.cylinder(2.8, 2.8, 3.2, [-6, 0.9, 0], materials.metal, C.rust, [0, 0, Math.PI / 2], 24);
  hand.box([7, 2, 7.3], [-0.4, 0.3, 0], materials.metal, C.steel, [0, 0, -0.08]);
  hand.box([5.2, 0.2, 5.6], [-0.4, 1.4, 0], materials.metal, C.paleSteel);
  for (let finger = 0; finger < 4; finger++) {
    const z = -2.5 + finger * 1.7;
    const middle = new THREE.Vector3(5.3, 0.2, z);
    hand.beam(new THREE.Vector3(2.6, 0.4, z), middle, 0.65, materials.metal, C.rust, 8);
    hand.sphere(0.72, middle.toArray(), materials.metal, C.darkSteel, [1, 1, 1], 12);
    hand.beam(middle, new THREE.Vector3(6.8, 1.7 + finger * 0.25, z), 0.52, materials.metal, C.paleSteel, 8);
  }
  hand.beam(new THREE.Vector3(-1, 0, 3.6), new THREE.Vector3(1.8, 1.2, 5.5), 0.8, materials.metal, C.rust, 8);
  hand.beam(new THREE.Vector3(1.8, 1.2, 5.5), new THREE.Vector3(3.7, 2.6, 4.8), 0.6, materials.metal, C.steel, 8);
  for (let strand = 0; strand < 4; strand++) {
    cable(hand, materials, [[-7.5, 1, strand * 0.35 - 0.5], [-11, 0, 0.5 + strand * 0.6], [-13, -0.2, 2 + strand]], 0.14, strand % 2 ? C.rust : C.darkSteel);
  }
}

function createWeatheredRock(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 18, 12);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const roughness = 0.7 + fbm(x * 2.8 + seed, z * 2.8 + y, 4, seed) * 0.6;
    positions.setXYZ(index, x * roughness, y * roughness * (y < 0 ? 0.5 : 1), z * roughness);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function trailDistance(x: number, z: number): number {
  let nearest = Infinity;
  for (let index = 0; index < TRAIL_POINTS.length - 1; index++) {
    const [ax, az] = TRAIL_POINTS[index], [bx, bz] = TRAIL_POINTS[index + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return nearest;
}

export function buildLandscape(kit: Kit, materials: Materials, root: THREE.Object3D): void {
  const random = createRandom(7811);
  const ground = new THREE.PlaneGeometry(2, 2, 360, 360).rotateX(-Math.PI / 2);
  const positions = ground.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const earth = new THREE.Color("#978569");
  const grass = new THREE.Color("#697856");
  const shade = new THREE.Color("#4d5d42");
  for (let index = 0; index < positions.count; index++) {
    const u = positions.getX(index), v = positions.getZ(index);
    const x = u * 250 + u * u * u * 5750;
    const z = v * 250 + v * v * v * 5750;
    positions.setXYZ(index, x, terrainHeight(x, z), z);
    const variation = fbm(x * 0.04, z * 0.04, 4, 45);
    color.copy(shade).lerp(grass, variation);
    const path = Math.max(0, 1 - trailDistance(x, z) / 2.2);
    color.lerp(earth, path * 0.9);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  ground.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const meadow = new THREE.Mesh(ground, materials.ground);
  meadow.receiveShadow = true;
  root.add(meadow);

  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), materials.water);
  pond.position.set(LAKE.x, LAKE.waterLevel, LAKE.z);
  pond.scale.set(LAKE.radiusX, 1, LAKE.radiusZ);
  root.add(pond);
  const rocks = [createWeatheredRock(14), createWeatheredRock(32), createWeatheredRock(63), createWeatheredRock(107)];
  for (let stone = 0; stone < 100; stone++) {
    const angle = random() * TAU;
    const radius = (30 + random() * 90) * MECH_SCALE;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    if ((Math.abs(x) < 30 * MECH_SCALE && Math.abs(z) < 23 * MECH_SCALE) || trailDistance(x, z) < 4) continue;
    if (((x - LAKE.x) / (LAKE.radiusX + 4)) ** 2 + ((z - LAKE.z) / (LAKE.radiusZ + 4)) ** 2 < 1) continue;
    const size = 0.4 + random() * 2.6;
    kit.add(pick(random, rocks), materials.stone, compose([x, terrainHeight(x, z) - size * 0.3, z], [random() * 0.3, random() * TAU, random() * 0.3], [size * 1.5, size, size]), pick(random, ["#8e9180", "#a3a38c", "#737e70"]));
  }
  for (let block = 0; block < 16; block++) {
    const x = -36 * MECH_SCALE + block * 1.7, z = -23 * MECH_SCALE - Math.sin(block) * 1.3;
    kit.box([1.4, 0.8 + (block % 3) * 0.6, 1.3], [x, terrainHeight(x, z) + 0.4, z], materials.stone, "#b4b29b", [0.1, random() * 0.6, random() * 0.12]);
  }
}

export function buildRuins(kit: Kit, materials: Materials): void {
  const random = createRandom(2741);
  buildHull(kit, materials, random);
  buildCannon(kit, materials);
  buildLeg(kit, materials, [17, 7, 8], [30, 3.5, 16], [33, -0.6, 24]);
  buildLeg(kit, materials, [-17, 6, 9], [-30, 0.9, 17], [-35, -1.2, 26]);
  buildLeg(kit, materials, [14, 6, -11], [25, 1, -20], [31, -1, -25]);
  buildLeg(kit, materials, [-16, 6, -10], [-28, 3, -18], [-36, -1.4, -24]);
  buildBrokenHand(kit, materials);
  kit.add(gear(5.7, 0.9), materials.metal, compose([28, 0.7, 30], [0.3, 0.35, -0.2]), C.rust);
  ring(kit, materials, 3.6, 0.18, [28, 0.7, 30.9], C.brass, [0.3, 0.35, -0.2]);
  for (let pipe = 0; pipe < 3; pipe++) {
    const x = -15 - pipe * 2.2;
    kit.beam(new THREE.Vector3(x, 10, -12), new THREE.Vector3(x - 1.3, 17 + pipe * 1.5, -12), 0.7, materials.metal, C.rust, 16);
    kit.beam(new THREE.Vector3(x - 1.3, 17 + pipe * 1.5, -12), new THREE.Vector3(x - 1.45, 17.8 + pipe * 1.5, -12), 0.9, materials.metal, C.darkSteel, 16);
  }
  cable(kit, materials, [[-8, 9, 16], [-10, 9, 20], [-10, 7.8, 22]], 0.7, C.rust);
  ring(kit, materials, 0.8, 0.12, [-10, 7.8, 22.05], C.brass);
}
