import * as THREE from "three";
import { Kit, compose } from "../mech-village/batch";
import { createRandom, randomRange, pick, fbm, type Random } from "../mech-village/noise";
import { COLORS as C, type Materials } from "./materials";
import { MECH_SCALE, MECH_DECK_HEIGHT, SETTLEMENT_X, SETTLEMENT_Z } from "./scale";
import { distanceToTown } from "./town-layout";
import { terrainHeight } from "./terrain";

const TAU = Math.PI * 2;
/** World height of the mech's reclaimed deck plate; the village floor sits here too. */
const DECK_Y = MECH_DECK_HEIGHT;
const FLAT_OFFSET = 0.015;
const PATCH_RADIUS = 360;
const HULL_RADIUS_X = 400;
const HULL_RADIUS_Z = 304;
/** Camera approaches the village from +X, +Z; keep that wedge free of groves. */
const APPROACH_ANGLE = Math.atan2(1, 1);
const APPROACH_HALF_WIDTH = 0.55;
const IVY_BAND_ANGLES_DEG = [-150, -115, -78, -25, 20, 150, 205];
const TURBINE_EXCLUDE_CENTER = Math.PI / 2;
const TURBINE_EXCLUDE_HALF_WIDTH = 0.42;
const IVY_NEAR_DISTANCE = 260;

const LEAVES_PER_TREE = 1800;

function terraceBoundary(angle: number): number {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const radiusX = HULL_RADIUS_X - 12;
  const radiusZ = HULL_RADIUS_Z - 12;
  const a = (dx / radiusX) ** 2 + (dz / radiusZ) ** 2;
  const b = 2 * (SETTLEMENT_X * dx / radiusX ** 2 + SETTLEMENT_Z * dz / radiusZ ** 2);
  const c = (SETTLEMENT_X / radiusX) ** 2 + (SETTLEMENT_Z / radiusZ) ** 2 - 1;
  const hullEdge = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) - 4;
  const erodedEdge = PATCH_RADIUS + 18 * Math.sin(angle * 3 + 0.7) + 11 * Math.sin(angle * 7);
  return Math.min(hullEdge, erodedEdge);
}
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function angleDelta(a: number, b: number): number {
  let delta = Math.abs(a - b) % TAU;
  if (delta > Math.PI) delta = TAU - delta;
  return delta;
}

function terraceAmplitude(x: number, z: number): number {
  const radius = Math.hypot(x - SETTLEMENT_X, z - SETTLEMENT_Z);
  const outer = terraceBoundary(Math.atan2(z - SETTLEMENT_Z, x - SETTLEMENT_X));
  const rampIn = smoothstep(0, 20, distanceToTown(x, z));
  const rampOut = 1 - smoothstep(0.7, 1, radius / outer);
  return rampIn * rampOut;
}

/** Town foundations stay level while the surrounding reclaimed soil forms shallow hummocks. */
function terraceHeight(x: number, z: number): number {
  const radius = Math.hypot(x - SETTLEMENT_X, z - SETTLEMENT_Z);
  if (distanceToTown(x, z) === 0) return FLAT_OFFSET;
  const amplitude = terraceAmplitude(x, z);
  const raw = fbm(x * 0.05, z * 0.05, 4, 309);
  const shelf = Math.floor(raw * 5) / 5;
  const edge = radius / terraceBoundary(Math.atan2(z - SETTLEMENT_Z, x - SETTLEMENT_X));
  return (FLAT_OFFSET + Math.max(0, shelf - 0.12) * 2.6 * amplitude) * (1 - smoothstep(0.9, 1, edge)) - 0.08 * smoothstep(0.97, 1, edge);
}

/** A continuous soil cover joins the town's neighborhoods rather than isolating each on a plinth. */
function buildTerraces(materials: Materials, root: THREE.Object3D): void {
  const radialSegments = 64;
  const angularSegments = 144;
  const count = (radialSegments + 1) * (angularSegments + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices: number[] = [];
  const soil = new THREE.Color("#6d5a3d");
  const mossDark = new THREE.Color(C.moss);
  const mossLight = new THREE.Color(C.mossLight);
  const tint = new THREE.Color();
  for (let angleIndex = 0; angleIndex <= angularSegments; angleIndex++) {
    const angle = angleIndex / angularSegments * TAU;
    const boundary = terraceBoundary(angle);
    for (let ring = 0; ring <= radialSegments; ring++) {
      const radius = ring / radialSegments * boundary;
      const x = SETTLEMENT_X + Math.cos(angle) * radius;
      const z = SETTLEMENT_Z + Math.sin(angle) * radius;
      const index = angleIndex * (radialSegments + 1) + ring;
      positions[index * 3] = x;
      positions[index * 3 + 1] = DECK_Y + terraceHeight(x, z);
      positions[index * 3 + 2] = z;
      const patch = fbm(x * 0.07, z * 0.07, 4, 211);
      tint.copy(soil).lerp(mossDark, smoothstep(0.3, 0.55, patch));
      tint.lerp(mossLight, smoothstep(0.68, 0.9, patch));
      tint.toArray(colors, index * 3);
      if (angleIndex < angularSegments && ring < radialSegments) {
        const next = index + radialSegments + 1;
        indices.push(index, next, index + 1, index + 1, next, next + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materials.ground);
  mesh.receiveShadow = true;
  root.add(mesh);
}

function approachHeight(x: number, z: number): number {
  const onDeck = (x / (21.65 * 1.13 * MECH_SCALE)) ** 2 + (z / (21.65 * 0.86 * MECH_SCALE)) ** 2 < 1;
  return Math.max(terrainHeight(x, z), onDeck ? DECK_Y + Math.max(0, terraceHeight(x, z)) : -Infinity) + 0.04;
}

function buildApproach(materials: Materials, root: THREE.Object3D): void {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(184, 0, 123),
    new THREE.Vector3(265, 0, 123),
    new THREE.Vector3(330, 0, 135),
    new THREE.Vector3(385, 0, 164),
    new THREE.Vector3(450, 0, 220),
    new THREE.Vector3(432, 0, 272),
  ]);
  const segments = Math.ceil(curve.getLength() / 2);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const colors = new Float32Array(positions.length);
  const indices: number[] = [];
  const color = new THREE.Color();
  for (let step = 0; step <= segments; step++) {
    const t = step / segments;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    for (let side = 0; side < 2; side++) {
      const across = (side === 0 ? -1 : 1) * (2.2 + Math.sin(t * 35) * 0.25);
      const x = point.x - tangent.z * across;
      const z = point.z + tangent.x * across;
      const index = step * 2 + side;
      positions.set([x, approachHeight(x, z), z], index * 3);
      color.set("#8b7d62").offsetHSL(0, 0, (fbm(x * 0.2, z * 0.2, 2, 855) - 0.5) * 0.08).toArray(colors, index * 3);
    }
    if (step < segments) {
      const index = step * 2;
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const road = new THREE.Mesh(geometry, materials.ground);
  road.receiveShadow = true;
  root.add(road);
}

/** A handful of flat ancient deck panels poking through the eroded soil mid-field. */
function buildExposedPanels(kit: Kit, materials: Materials, random: Random): void {
  for (let index = 0; index < 22; index++) {
    const angle = random() * TAU;
    const radius = Math.sqrt(random()) * PATCH_RADIUS;
    const x = SETTLEMENT_X + Math.cos(angle) * radius;
    const z = SETTLEMENT_Z + Math.sin(angle) * radius;
    if (distanceToTown(x, z) < 8 || radius > terraceBoundary(angle) - 10) continue;
    const y = DECK_Y + Math.max(0, terraceHeight(x, z) - 0.2);
    const width = randomRange(random, 4, 10);
    const depth = randomRange(random, 3, 8);
    kit.box([width, 0.3, depth], [x, y, z], materials.metal, pick(random, [C.steel, C.darkSteel, C.paleSteel]), [0, random() * TAU, 0]);
  }
}

/** A box, broken up by noise into a jagged-topped, crack-seamed armor fragment. */
function createFracturedSlab(width: number, height: number, depth: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 6, 8, 4);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const top = Math.max(0, y / height + 0.5);
    const jagged = (fbm(x * 0.14 + seed, z * 0.14 + seed, 4, seed) - 0.55) * height * (0.5 + 0.5 * top) * top;
    const crack = (fbm(x * 0.45 + seed * 2, y * 0.3, 3, seed + 11) - 0.5) * Math.min(width, depth) * 0.1;
    position.setXYZ(index, x + crack, y - jagged, z + crack * 0.6);
  }
  geometry.computeVertexNormals();
  return geometry;
}

interface CliffCluster {
  anchorX: number;
  anchorZ: number;
  dirX: number;
  dirZ: number;
  count: number;
}

/** A chain of overlapping fractured slabs with exposed structural ribs, forming one cliff run. */
function buildCliffCluster(kit: Kit, materials: Materials, random: Random, cluster: CliffCluster, seedBase: number): void {
  const baseRotation = Math.atan2(-cluster.dirZ, cluster.dirX);
  let cursor = 0;
  for (let index = 0; index < cluster.count; index++) {
    const width = randomRange(random, 18, 42);
    const height = randomRange(random, 15, 35);
    const depth = randomRange(random, 10, 22);
    const along = cursor + width * 0.5;
    cursor += width * randomRange(random, 0.5, 0.75);
    const perpJitter = randomRange(random, -16, 16);
    const x = cluster.anchorX + cluster.dirX * along - cluster.dirZ * perpJitter;
    const z = cluster.anchorZ + cluster.dirZ * along + cluster.dirX * perpJitter;
    const y = DECK_Y + height / 2 - randomRange(random, 1, 4);
    const rotationY = baseRotation + randomRange(random, -0.45, 0.45);
    const rotationZ = randomRange(random, -0.07, 0.07);
    const tint = pick(random, [C.steel, C.darkSteel, C.paleSteel, C.orangeRust]);
    const material = index % 2 === 0 ? materials.metal : materials.stone;
    kit.add(createFracturedSlab(width, height, depth, seedBase + index * 37), material, compose([x, y, z], [0, rotationY, rotationZ]), tint);
    const ribs = 2 + Math.floor(random() * 3);
    for (let rib = 0; rib < ribs; rib++) {
      const ribX = x + (random() - 0.5) * width * 0.7;
      const ribZ = z + (random() - 0.5) * depth * 0.3;
      const topY = y + height / 2 - random() * height * 0.25;
      const bottomY = y - height / 2 + random() * height * 0.15;
      kit.beam(
        new THREE.Vector3(ribX, topY, ribZ),
        new THREE.Vector3(ribX + (random() - 0.5) * 5, bottomY, ribZ + (random() - 0.5) * 3),
        0.5 + random() * 0.6,
        materials.metal,
        C.darkSteel,
        8,
      );
    }
  }
}

/** Immense fractured armor slabs forming cliffs west/north of the village, away from the camera approach. */
function buildCliffs(kit: Kit, materials: Materials, random: Random): void {
  const westDirection = new THREE.Vector2(-60, -50).normalize();
  buildCliffCluster(
    kit,
    materials,
    random,
    { anchorX: 80, anchorZ: -120, dirX: westDirection.x, dirZ: westDirection.y, count: 6 },
    2101,
  );
  const northDirection = new THREE.Vector2(-30, -75).normalize();
  buildCliffCluster(
    kit,
    materials,
    random,
    { anchorX: 300, anchorZ: -45, dirX: northDirection.x, dirZ: northDirection.y, count: 4 },
    2777,
  );
}

function ellipsePoint(angle: number): { x: number; z: number; normal: THREE.Vector2; tangent: THREE.Vector2 } {
  const x = Math.cos(angle) * HULL_RADIUS_X;
  const z = Math.sin(angle) * HULL_RADIUS_Z;
  const normal = new THREE.Vector2(Math.cos(angle) / HULL_RADIUS_X, Math.sin(angle) / HULL_RADIUS_Z).normalize();
  const tangent = new THREE.Vector2(-normal.y, normal.x);
  return { x, z, normal, tangent };
}

/** Small hanging diamond card, human-sized (0.2-0.5m), used only where ivy hangs near the village. */
function createIvyLeafGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, -0.5, -0.7, 0.05, 0, -1, 0, 0.5, -0.7, -0.05]);
  const uvs = new Float32Array([0.5, 1, 0, 0.3, 0.5, 0, 1, 0.3]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.length).fill(1), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** One broad trailing curtain of ivy/roots draped off the hull edge at the given ellipse angle. */
function buildIvyBand(root: THREE.Object3D, materials: Materials, random: Random, angleDeg: number, seed: number): void {
  const angle = (angleDeg * Math.PI) / 180;
  if (angleDelta(angle, TURBINE_EXCLUDE_CENTER) < TURBINE_EXCLUDE_HALF_WIDTH) return;
  const { x: bx, z: bz, normal, tangent } = ellipsePoint(angle);
  const width = randomRange(random, 55, 95);
  const drop = randomRange(random, 30, 130);
  const leafPalette = [new THREE.Color(C.foliage), new THREE.Color(C.moss), new THREE.Color(C.mossLight)];

  const geometry = new THREE.PlaneGeometry(width, drop, 14, 22);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const rootColor = new THREE.Color("#3a3321");
  const tint = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    const localX = position.getX(index);
    const localY = position.getY(index);
    const u = localX / width + 0.5;
    const v = 0.5 - localY / drop;
    const finger = 0.45 + 0.55 * fbm(u * 5 + seed, seed, 3, seed);
    const columnDrop = drop * finger;
    const sway = Math.sin(v * 5 + u * 7 + seed) * 1.6 * v;
    const bulge = Math.sin(Math.PI * v) * (3 + 5 * fbm(u * 4 + seed, v * 3, 3, seed + 5));
    position.setXYZ(
      index,
      bx + tangent.x * (localX + sway) + normal.x * bulge,
      DECK_Y - v * columnDrop,
      bz + tangent.y * (localX + sway) + normal.y * bulge,
    );
    tint.copy(rootColor).lerp(pick(random, leafPalette), smoothstep(0.1, 0.5, v));
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const curtain = new THREE.Mesh(geometry, materials.leaves);
  curtain.receiveShadow = true;
  root.add(curtain);

  if (Math.hypot(bx - SETTLEMENT_X, bz - SETTLEMENT_Z) > IVY_NEAR_DISTANCE) return;
  const leafGeometry = createIvyLeafGeometry();
  const count = 140;
  const leafMesh = new THREE.InstancedMesh(leafGeometry, materials.leaves, count);
  const leafColors = new Float32Array(count * 3);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (let index = 0; index < count; index++) {
    const u = random();
    const v = randomRange(random, 0.5, 1);
    const localX = (u - 0.5) * width;
    const finger = 0.45 + 0.55 * fbm(u * 5 + seed, seed, 3, seed);
    const columnDrop = drop * finger;
    const sway = Math.sin(v * 5 + u * 7 + seed) * 1.6 * v;
    const bulge = Math.sin(Math.PI * v) * (3 + 5 * fbm(u * 4 + seed, v * 3, 3, seed + 5)) + 0.4;
    euler.set(randomRange(random, -0.3, 0.3), random() * TAU, randomRange(random, -0.2, 0.2));
    quaternion.setFromEuler(euler);
    const size = randomRange(random, 0.2, 0.5);
    matrix.compose(
      new THREE.Vector3(
        bx + tangent.x * (localX + sway) + normal.x * bulge,
        DECK_Y - v * columnDrop,
        bz + tangent.y * (localX + sway) + normal.y * bulge,
      ),
      quaternion,
      new THREE.Vector3(size, size * randomRange(random, 1, 1.6), size),
    );
    leafMesh.setMatrixAt(index, matrix);
    const color = pick(random, leafPalette);
    leafColors[index * 3] = color.r;
    leafColors[index * 3 + 1] = color.g;
    leafColors[index * 3 + 2] = color.b;
  }
  leafMesh.instanceColor = new THREE.InstancedBufferAttribute(leafColors, 3);
  leafMesh.instanceMatrix.needsUpdate = true;
  leafMesh.castShadow = true;
  root.add(leafMesh);
}

/** A few thick hull-edge ivy curtains around the deck's outer rim, skirting the front turbine. */
function buildHullIvy(root: THREE.Object3D, materials: Materials, random: Random): void {
  IVY_BAND_ANGLES_DEG.forEach((angleDeg, index) => buildIvyBand(root, materials, random, angleDeg, 3100 + index * 53));
}

function buildGroveTree(kit: Kit, materials: Materials, random: Random, base: THREE.Vector3, foliage: THREE.InstancedMesh, offset: number): void {
  const height = randomRange(random, 10, 15);
  const top = base.clone().add(new THREE.Vector3(randomRange(random, -0.8, 0.8), height * 0.62, randomRange(random, -0.8, 0.8)));
  const trunkRadius = height * 0.035;
  kit.beam(base, top, trunkRadius, materials.wood, C.wood, 10, trunkRadius * 0.4);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const branchCount = 6;
  const leavesPerBranch = LEAVES_PER_TREE / branchCount;
  for (let branch = 0; branch < branchCount; branch++) {
    const angle = branch / branchCount * TAU + random() * 0.5;
    const center = top.clone().add(new THREE.Vector3(
      Math.cos(angle) * height * 0.2,
      height * randomRange(random, 0.05, 0.2),
      Math.sin(angle) * height * 0.2,
    ));
    const branchBase = base.clone().lerp(top, randomRange(random, 0.65, 0.95));
    kit.beam(branchBase, center, trunkRadius * 0.32, materials.wood, C.wood, 7, 0.035);
    const radius = height * randomRange(random, 0.14, 0.2);
    for (let leaf = 0; leaf < leavesPerBranch; leaf++) {
      const azimuth = random() * TAU;
      const vertical = randomRange(random, -1, 1);
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const distance = Math.cbrt(random()) * radius;
      position.set(center.x + Math.cos(azimuth) * horizontal * distance, center.y + vertical * distance * 0.8, center.z + Math.sin(azimuth) * horizontal * distance);
      rotation.set(random() * TAU, random() * TAU, random() * TAU);
      quaternion.setFromEuler(rotation);
      const size = randomRange(random, 0.18, 0.4);
      scale.set(size, size * 1.4, size);
      matrix.compose(position, quaternion, scale);
      const index = offset + branch * leavesPerBranch + leaf;
      foliage.setMatrixAt(index, matrix);
      tint.set(pick(random, [C.foliage, "#415e32", "#587442"]));
      foliage.setColorAt(index, tint);
    }
  }
}

function buildGroves(kit: Kit, materials: Materials, root: THREE.Object3D, random: Random): void {
  const target = 32;
  const foliage = new THREE.InstancedMesh(createIvyLeafGeometry(), materials.leaves, target * LEAVES_PER_TREE);
  let planted = 0;
  let attempts = 0;
  while (planted < target && attempts < target * 15) {
    attempts++;
    const angle = random() * TAU;
    const radius = Math.sqrt(random()) * (PATCH_RADIUS - 15);
    if (radius > terraceBoundary(angle) - 5 || angleDelta(angle, APPROACH_ANGLE) < APPROACH_HALF_WIDTH) continue;
    const x = SETTLEMENT_X + Math.cos(angle) * radius;
    const z = SETTLEMENT_Z + Math.sin(angle) * radius;
    if (distanceToTown(x, z) < 10) continue;
    const y = DECK_Y + terraceHeight(x, z);
    buildGroveTree(kit, materials, random, new THREE.Vector3(x, y, z), foliage, planted * LEAVES_PER_TREE);
    planted++;
  }
  foliage.count = planted * LEAVES_PER_TREE;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  root.add(foliage);
}

/**
 * Builds the giant reclaimed-deck landscape: eroded soil terraces around the village, fractured
 * armor-slab cliffs behind/beside it, hull-edge ivy curtains, and a few sparse groves. Operates
 * entirely in world space (the identity frame `root`/`kit` are given in).
 */
export function buildReclamation(kit: Kit, materials: Materials, root: THREE.Object3D): void {
  buildTerraces(materials, root);
  buildApproach(materials, root);
  buildExposedPanels(kit, materials, createRandom(4001));
  buildCliffs(kit, materials, createRandom(5231));
  buildHullIvy(root, materials, createRandom(6417));
  buildGroves(kit, materials, root, createRandom(7109));
}
