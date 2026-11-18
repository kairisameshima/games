import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, compose, toWorld } from "./batch";
import type { SceneMaterials } from "./materials";
import { HULL_OUTLINE, type MechRuin } from "./mech";
import { createRandom, fbm, pick, randomRange, valueNoise, type Random } from "./noise";
import { POND, distanceToPath, distanceToPond, groundClearings, groundHeight } from "./terrain";
import type { Clearing, Village } from "./village";

const FOLIAGE_GREENS = ["#33561c", "#3d6522", "#477026", "#2c4c1b", "#52742a"];
const AUTUMN_TINTS = ["#7d7a2c", "#8a6d2a"];
const BARK = "#5b4634";
const VINE_STEM = "#3a4a22";
const LEAF_GREENS = ["#4f7a2a", "#5f8b32", "#3d6424", "#6e9436", "#7b8f2e"];
const GRASS_TINTS = ["#5f7a26", "#6c832c", "#4f6c22", "#7f8a34", "#8f8640"];
const FLOWER_TINTS = ["#f4f1e8", "#f2c14e", "#e2543f", "#d36ba6", "#8a6fd1", "#f6e27a"];

export interface Vegetation {
  updaters: Array<(elapsedSeconds: number) => void>;
}

interface InstanceList {
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

function createInstanceList(): InstanceList {
  return { matrices: [], colors: [] };
}

function createInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  list: InstanceList,
  castShadow: boolean,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, list.matrices.length);
  list.matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, list.colors[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function createBlob(random: Random, detail: number, roughness: number): THREE.BufferGeometry {
  const seed = Math.floor(random() * 1000);
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);
  const positions = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index);
    const bump = fbm(vertex.x * 1.7 + seed, vertex.z * 1.7 + vertex.y * 1.3, 3, seed);
    vertex.multiplyScalar(1 + (bump - 0.5) * roughness);
    if (vertex.y < -0.3) vertex.y = -0.3 + (vertex.y + 0.3) * 0.45;
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createLeafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.55, 0.4, 0, 1);
  shape.quadraticCurveTo(-0.55, 0.4, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 3);
  geometry.computeVertexNormals();
  return geometry;
}

/** Tapered grass blade from y=0 to y=1; normals point up so the lawn shades softly. */
function createBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const rows = 4;
  const base = new THREE.Color("#2c3f12");
  const tip = new THREE.Color("#c9d27a");
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const halfWidth = 0.07 * (1 - t * 0.92);
    const bend = t * t * 0.25;
    positions.push(-halfWidth, t, bend, halfWidth, t, bend);
    const color = base.clone().lerp(tip, Math.pow(t, 1.3));
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    const a = row * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(positions.length).fill(0).map((_, index) => (index % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(indices);
  return geometry;
}

function createGrassMaterial(time: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vec3 bladeRoot = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float gust = sin(uTime * 0.9 + bladeRoot.x * 0.05 + bladeRoot.z * 0.03) * 0.5 + 0.5;
        float sway = sin(uTime * 2.2 + bladeRoot.x * 0.35 + bladeRoot.z * 0.21) * (0.1 + gust * 0.22);
        transformed.x += sway * position.y * position.y;
        transformed.z += sway * 0.5 * position.y * position.y;
        `,
      );
  };
  return material;
}

function isInsidePolygon(x: number, z: number, polygon: ReadonlyArray<[number, number]>, scale: number): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index];
    const [xj, zj] = polygon[previous];
    const crosses = zi * scale > z !== zj * scale > z && x < ((xj - xi) * scale * (z - zi * scale)) / ((zj - zi) * scale) + xi * scale;
    if (crosses) inside = !inside;
  }
  return inside;
}

function isInClearing(x: number, z: number, clearings: ReadonlyArray<Clearing>, margin = 0): boolean {
  return clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin);
}

function isUnderHull(x: number, z: number): boolean {
  return Math.abs(x) < 52 && Math.abs(z) < 36;
}

interface TreeOptions {
  scale: number;
  autumn: boolean;
}

function buildTree(kit: Kit, materials: SceneMaterials, random: Random, blobs: THREE.BufferGeometry[], base: THREE.Vector3, options: TreeOptions): void {
  const { scale } = options;
  const height = (3.6 + random() * 2.4) * scale;
  const lean = new THREE.Vector3(randomRange(random, -0.2, 0.2), 1, randomRange(random, -0.2, 0.2)).normalize();
  const top = base.clone().addScaledVector(lean, height);
  kit.beam(base.clone().add(new THREE.Vector3(0, -0.5, 0)), top, 0.5 * scale, materials.wood, BARK, 9, 0.28 * scale);
  const crowns: THREE.Vector3[] = [top.clone().add(new THREE.Vector3(0, 2.2 * scale, 0))];
  const branchCount = 3 + Math.floor(random() * 3);
  for (let branch = 0; branch < branchCount; branch++) {
    const angle = (branch / branchCount) * Math.PI * 2 + random();
    const start = base.clone().lerp(top, 0.6 + random() * 0.3);
    const reach = (2 + random() * 1.6) * scale;
    const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * reach, (1.4 + random() * 1.4) * scale, Math.sin(angle) * reach));
    kit.beam(start, end, 0.2 * scale, materials.wood, BARK, 6, 0.1 * scale);
    crowns.push(end);
  }
  const green = options.autumn ? pick(random, AUTUMN_TINTS) : pick(random, FOLIAGE_GREENS);
  const tint = new THREE.Color(green);
  for (const crown of crowns) {
    const clumps = 2 + Math.floor(random() * 3);
    for (let clump = 0; clump < clumps; clump++) {
      const radius = (1.1 + random() * 0.9) * scale;
      const offset = new THREE.Vector3(randomRange(random, -1.3, 1.3), randomRange(random, -0.5, 0.9), randomRange(random, -1.3, 1.3)).multiplyScalar(scale);
      const color = tint.clone().offsetHSL(randomRange(random, -0.015, 0.015), 0, randomRange(random, -0.06, 0.05) + offset.y * 0.02);
      kit.add(pick(random, blobs), materials.foliage, compose(crown.clone().add(offset).toArray(), [random(), random() * 6, random()], [radius, radius * 0.9, radius]), color);
    }
  }
}

function buildBush(kit: Kit, materials: SceneMaterials, random: Random, blobs: THREE.BufferGeometry[], base: THREE.Vector3, scale: number): void {
  const color = new THREE.Color(pick(random, FOLIAGE_GREENS));
  const parts = 2 + Math.floor(random() * 3);
  for (let part = 0; part < parts; part++) {
    const radius = (0.6 + random() * 0.6) * scale;
    const offset = new THREE.Vector3(randomRange(random, -0.8, 0.8) * scale, radius * 0.45, randomRange(random, -0.8, 0.8) * scale);
    kit.add(pick(random, blobs), materials.foliage, compose(base.clone().add(offset).toArray(), [0, random() * 6, 0], [radius, radius * 0.8, radius]), color.clone().offsetHSL(0, 0, randomRange(random, -0.04, 0.04)));
  }
}

function buildRocks(kit: Kit, materials: SceneMaterials, random: Random): void {
  const rocks = Array.from({ length: 4 }, () => createBlob(random, 1, 0.7));
  let placed = 0;
  while (placed < 70) {
    const angle = random() * Math.PI * 2;
    const distance = 40 + random() * 200;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (isUnderHull(x, z) || distanceToPath(x, z) < 3 || isInClearing(x, z, groundClearings, 2)) continue;
    const size = 0.6 + Math.pow(random(), 2) * 3.2;
    const position = new THREE.Vector3(x, groundHeight(x, z) + size * 0.15, z);
    kit.add(pick(random, rocks), materials.stone, compose(position.toArray(), [random(), random() * 6, random()], [size, size * 0.7, size * 0.9]), "#c8c2b4");
    placed++;
  }
  const shore = 18;
  for (let index = 0; index < shore; index++) {
    const angle = (index / shore) * Math.PI * 2 + random() * 0.2;
    const distance = POND.radius * (1.02 + random() * 0.15);
    const x = POND.x + Math.cos(angle) * distance;
    const z = POND.z + Math.sin(angle) * distance;
    if (isInClearing(x, z, groundClearings)) continue;
    const size = 0.5 + random() * 0.9;
    kit.add(pick(random, rocks), materials.stone, compose([x, groundHeight(x, z), z], [random(), random() * 6, 0], [size, size * 0.6, size]), "#b9b3a6");
  }
}

/** Hull-local deck trees, including one bursting out of the open hatch. */
const DECK_TREES: Array<[number, number, number]> = [
  [20, -5, 1.25],
  [31, -21, 0.95],
  [-35, -24.5, 1.45],
  [-12, 28, 0.8],
  [44, 14, 0.7],
];

function buildTreeRoots(kit: Kit, materials: SceneMaterials, random: Random, hull: THREE.Group, x: number, z: number): void {
  for (let root = 0; root < 7; root++) {
    const angle = (root / 7) * Math.PI * 2 + random() * 0.4;
    const reach = 3 + random() * 4;
    const points = [
      new THREE.Vector3(x, 0.6, z),
      new THREE.Vector3(x + Math.cos(angle) * reach * 0.5, 0.15, z + Math.sin(angle) * reach * 0.5),
      new THREE.Vector3(x + Math.cos(angle) * reach, 0.1, z + Math.sin(angle) * reach),
    ];
    const end = points[2];
    const outward = new THREE.Vector2(end.x, end.z).normalize();
    if (!isInsidePolygon(end.x, end.z, HULL_OUTLINE, 0.97)) {
      points.push(new THREE.Vector3(end.x + outward.x * 1.4, -1.5, end.z + outward.y * 1.4));
      points.push(new THREE.Vector3(end.x + outward.x * 1.9, -6 - random() * 6, end.z + outward.y * 1.9));
    }
    const curve = new THREE.CatmullRomCurve3(points.map((point) => toWorld(hull, point.toArray())));
    kit.add(new THREE.TubeGeometry(curve, 20, 0.22 + random() * 0.12, 6), materials.wood, new THREE.Matrix4(), BARK);
  }
}

interface VineContext {
  kit: Kit;
  materials: SceneMaterials;
  random: Random;
  leaves: InstanceList;
}

function addLeavesAlong(context: VineContext, curve: THREE.Curve<THREE.Vector3>, length: number, density: number, size: number): void {
  const { random, leaves } = context;
  const count = Math.floor(length * density);
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (let index = 0; index < count; index++) {
    const point = curve.getPointAt(random());
    euler.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
    quaternion.setFromEuler(euler);
    const leafSize = size * (0.6 + random() * 0.7);
    const offset = new THREE.Vector3(randomRange(random, -0.15, 0.15), randomRange(random, -0.1, 0.1), randomRange(random, -0.15, 0.15));
    leaves.matrices.push(new THREE.Matrix4().compose(point.add(offset), quaternion, new THREE.Vector3(leafSize, leafSize, leafSize)));
    leaves.colors.push(new THREE.Color(pick(random, LEAF_GREENS)).offsetHSL(0, 0, randomRange(random, -0.05, 0.05)));
  }
}

function addVine(context: VineContext, points: THREE.Vector3[], radius: number, leafDensity: number): void {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  context.kit.add(new THREE.TubeGeometry(curve, Math.max(8, Math.round(length * 2)), radius, 5), context.materials.foliage, new THREE.Matrix4(), VINE_STEM);
  addLeavesAlong(context, curve, length, leafDensity, 0.42);
}

function buildHangingVines(context: VineContext, ruin: MechRuin): void {
  const { random } = context;
  const [deckEdge, barrelEdge] = ruin.vineEdges;
  for (let segment = 0; segment < deckEdge.length - 1; segment++) {
    const start = deckEdge[segment];
    const end = deckEdge[segment + 1];
    const length = start.distanceTo(end);
    for (let distance = 0; distance < length; distance += 0.7) {
      const anchor = start.clone().lerp(end, distance / length);
      const clump = fbm(anchor.x * 0.08 + 7, anchor.z * 0.08 + 7, 3, 55);
      if (random() > Math.pow(Math.max(0, clump - 0.3) * 1.6, 1.4)) continue;
      const outward = new THREE.Vector3(anchor.x, 0, anchor.z).normalize();
      const drop = 3 + random() * 14 * clump * 1.4;
      const sway = randomRange(random, -0.6, 0.6);
      const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
      const points = [
        anchor.clone().addScaledVector(outward, -0.6).add(new THREE.Vector3(0, 0.5, 0)),
        anchor.clone().addScaledVector(outward, 0.4),
        anchor.clone().addScaledVector(outward, 1.7).add(new THREE.Vector3(0, -drop * 0.3, 0)).addScaledVector(tangent, sway),
        anchor.clone().addScaledVector(outward, 2.1).add(new THREE.Vector3(0, -drop * 0.7, 0)).addScaledVector(tangent, sway * 1.5),
        anchor.clone().addScaledVector(outward, 2.2).add(new THREE.Vector3(0, -drop, 0)).addScaledVector(tangent, sway * 1.8),
      ];
      const lowest = points[points.length - 1];
      const floor = groundHeight(lowest.x, lowest.z) + 0.3;
      if (lowest.y < floor) lowest.y = floor;
      addVine(context, points, 0.05 + random() * 0.05, 9);
    }
  }
  const [barrelStart, barrelEnd] = barrelEdge;
  for (let t = 0; t <= 1; t += 0.035) {
    if (random() < 0.35) continue;
    const anchor = barrelStart.clone().lerp(barrelEnd, t);
    const drop = 1.5 + random() * 7;
    const sway = new THREE.Vector3(randomRange(random, -0.5, 0.5), 0, randomRange(random, -0.5, 0.5));
    addVine(context, [anchor, anchor.clone().add(new THREE.Vector3(0, -drop * 0.5, 0)).add(sway), anchor.clone().add(new THREE.Vector3(0, -drop, 0)).addScaledVector(sway, 1.6)], 0.05, 10);
  }
  // Long garlands draped from the raised barrel back down to the deck.
  const garlands: Array<[number, THREE.Vector3Tuple]> = [
    [14, [6, 3.5, 22]],
    [24, [16, 0.5, 29]],
    [32, [24, 7, 22]],
  ];
  for (const [alongBarrel, deckPoint] of garlands) {
    const top = toWorld(ruin.intactBarrel, [alongBarrel, -2.1, 0]);
    const bottom = toWorld(ruin.hull, deckPoint);
    const middle = top.clone().lerp(bottom, 0.5).add(new THREE.Vector3(0, -3, 0));
    addVine(context, [top, middle, bottom], 0.07, 11);
  }
}

function buildClimbingIvy(context: VineContext, ruin: MechRuin): void {
  const { random } = context;
  for (const climbable of ruin.climbables) {
    const axis = new THREE.Vector3().subVectors(climbable.end, climbable.start);
    const length = axis.length();
    axis.normalize();
    const reference = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const around = new THREE.Vector3().crossVectors(axis, across).normalize();
    const strands = 2 + Math.floor(random() * 2);
    for (let strand = 0; strand < strands; strand++) {
      const phase = random() * Math.PI * 2;
      const turns = 0.6 + random() * 1.2;
      const coverage = 0.45 + random() * 0.55;
      const points: THREE.Vector3[] = [];
      const steps = 14;
      for (let step = 0; step <= steps; step++) {
        const t = (step / steps) * coverage;
        const angle = phase + t * turns * Math.PI * 2;
        const radius = climbable.radius + 0.25 + valueNoise(step, strand, 3) * 0.25;
        points.push(
          climbable.start
            .clone()
            .addScaledVector(axis, t * length)
            .addScaledVector(across, Math.cos(angle) * radius)
            .addScaledVector(around, Math.sin(angle) * radius),
        );
      }
      addVine(context, points, 0.08, 16);
    }
  }
}

function scatterGrass(ruin: MechRuin, deckClearings: ReadonlyArray<Clearing>, random: Random): InstanceList {
  const list = createInstanceList();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const tint = GRASS_TINTS.map((color) => new THREE.Color(color));
  const addBlade = (position: THREE.Vector3, height: number, colorIndex: number): void => {
    euler.set(randomRange(random, -0.25, 0.25), random() * Math.PI * 2, randomRange(random, -0.25, 0.25));
    quaternion.setFromEuler(euler);
    const width = 0.8 + random() * 0.8;
    list.matrices.push(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(width, height, width)));
    list.colors.push(tint[colorIndex].clone().offsetHSL(0, 0, randomRange(random, -0.06, 0.06)));
  };

  const groundTarget = 90000;
  let attempts = 0;
  while (list.matrices.length < groundTarget && attempts < groundTarget * 4) {
    attempts++;
    const radius = Math.sqrt(random()) * 165;
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * radius + 5;
    const z = Math.sin(angle) * radius + 10;
    const density = fbm(x * 0.03 + 3, z * 0.03 + 3, 3, 61);
    if (random() > density * 1.6 - 0.15) continue;
    if (distanceToPond(x, z) < POND.radius * 0.95) continue;
    const pathDistance = distanceToPath(x, z);
    if (pathDistance < 1.3 || (pathDistance < 2.6 && random() < 0.7)) continue;
    if (isInClearing(x, z, groundClearings)) continue;
    const y = groundHeight(x, z);
    const height = 0.35 + density * 0.9 + random() * 0.35;
    addBlade(new THREE.Vector3(x, y - 0.05, z), height, Math.floor(fbm(x * 0.05, z * 0.05, 2, 63) * tint.length * 1.4) % tint.length);
  }

  ruin.hull.updateWorldMatrix(true, false);
  const deckTarget = 26000;
  attempts = 0;
  let deckCount = 0;
  while (deckCount < deckTarget && attempts < deckTarget * 6) {
    attempts++;
    const x = randomRange(random, -46, 48);
    const z = randomRange(random, -30, 30);
    if (!isInsidePolygon(x, z, HULL_OUTLINE, 0.97)) continue;
    if (isInClearing(x, z, deckClearings)) continue;
    const density = fbm(x * 0.09 + 11, z * 0.09 + 11, 3, 67);
    if (density < 0.45 || random() > (density - 0.45) * 3.2) continue;
    const position = toWorld(ruin.hull, [x, 0, z]);
    addBlade(position, 0.3 + density * 0.6 + random() * 0.3, Math.floor(random() * 3));
    deckCount++;
  }
  return list;
}

function scatterFlowers(ruin: MechRuin, deckClearings: ReadonlyArray<Clearing>, random: Random): InstanceList {
  const list = createInstanceList();
  const add = (position: THREE.Vector3, color: THREE.Color): void => {
    const size = 0.7 + random() * 0.6;
    list.matrices.push(new THREE.Matrix4().compose(position, new THREE.Quaternion(), new THREE.Vector3(size, size * 0.7, size)));
    list.colors.push(color);
  };
  let attempts = 0;
  while (list.matrices.length < 5000 && attempts < 60000) {
    attempts++;
    const x = randomRange(random, -120, 130);
    const z = randomRange(random, -120, 130);
    const patch = fbm(x * 0.045 + 21, z * 0.045 + 21, 3, 71);
    if (patch < 0.58 || distanceToPond(x, z) < POND.radius || distanceToPath(x, z) < 1.4 || isInClearing(x, z, groundClearings)) continue;
    const hue = FLOWER_TINTS[Math.floor(valueNoise(x * 0.06, z * 0.06, 73) * FLOWER_TINTS.length)];
    add(new THREE.Vector3(x, groundHeight(x, z) + 0.45 + random() * 0.4, z), new THREE.Color(hue));
  }
  attempts = 0;
  let deckFlowers = 0;
  while (deckFlowers < 900 && attempts < 20000) {
    attempts++;
    const x = randomRange(random, -46, 48);
    const z = randomRange(random, -30, 30);
    if (!isInsidePolygon(x, z, HULL_OUTLINE, 0.95) || isInClearing(x, z, deckClearings)) continue;
    if (fbm(x * 0.09 + 11, z * 0.09 + 11, 3, 67) < 0.55) continue;
    add(toWorld(ruin.hull, [x, 0.4 + random() * 0.3, z]), new THREE.Color(pick(random, FLOWER_TINTS)));
    deckFlowers++;
  }
  return list;
}

function scatterGroundTrees(kit: Kit, materials: SceneMaterials, random: Random, blobs: THREE.BufferGeometry[], ruin: MechRuin): void {
  const obstacles: Clearing[] = [
    { x: 78, z: -8, radius: 16 },
    { x: 72, z: 48, radius: 12 },
    { x: ruin.palmCenter.x, z: ruin.palmCenter.z, radius: 9 },
  ];
  for (const climbable of ruin.climbables) {
    for (const point of [climbable.start, climbable.end]) {
      if (point.y < groundHeight(point.x, point.z) + 8) obstacles.push({ x: point.x, z: point.z, radius: 7 });
    }
  }
  let placed = 0;
  let attempts = 0;
  while (placed < 95 && attempts < 4000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const distance = 38 + Math.pow(random(), 0.8) * 150;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (fbm(x * 0.02 + 31, z * 0.02 + 31, 3, 79) < 0.45) continue;
    if (isUnderHull(x, z) || distanceToPath(x, z) < 5 || distanceToPond(x, z) < POND.radius + 4) continue;
    if (isInClearing(x, z, groundClearings, 4) || isInClearing(x, z, obstacles)) continue;
    const base = new THREE.Vector3(x, groundHeight(x, z), z);
    if (random() < 0.3) {
      buildBush(kit, materials, random, blobs, base, 1 + random());
    } else {
      buildTree(kit, materials, random, blobs, base, { scale: 0.8 + random() * 0.7, autumn: random() < 0.12 });
    }
    placed++;
  }
  for (let bush = 0; bush < 60; bush++) {
    const angle = random() * Math.PI * 2;
    const distance = 30 + random() * 40;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (distanceToPath(x, z) < 2.5 || distanceToPond(x, z) < POND.radius + 1 || isInClearing(x, z, groundClearings, 1) || isInClearing(x, z, obstacles)) continue;
    buildBush(kit, materials, random, blobs, new THREE.Vector3(x, groundHeight(x, z), z), 0.8 + random() * 0.8);
  }
  buildTree(kit, materials, random, blobs, ruin.palmCenter, { scale: 0.85, autumn: false });
}

function buildPineForest(random: Random): THREE.Group {
  const trunks = createInstanceList();
  const crowns = createInstanceList();
  let attempts = 0;
  while (crowns.matrices.length < 900 && attempts < 20000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const distance = 150 + random() * 270;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (fbm(x * 0.012 + 41, z * 0.012 + 41, 3, 83) < 0.48) continue;
    if (distanceToPath(x, z) < 6) continue;
    const height = 9 + random() * 10;
    const y = groundHeight(x, z);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    trunks.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), yaw, new THREE.Vector3(height * 0.03, height * 0.3, height * 0.03)));
    trunks.colors.push(new THREE.Color(BARK));
    crowns.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + height * 0.18, z), yaw, new THREE.Vector3(height * 0.3, height, height * 0.3)));
    crowns.colors.push(new THREE.Color(pick(random, ["#2f4a26", "#36522a", "#2a4223", "#3d5a2c"])));
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.6, 1, 1, 6).translate(0, 0.5, 0);
  const tiers: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 3; tier++) {
    tiers.push(new THREE.ConeGeometry(1 - tier * 0.22, 0.5, 8).translate(0, 0.25 + tier * 0.24, 0));
  }
  const crownGeometry = mergeTiers(tiers);
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const group = new THREE.Group();
  group.name = "pines";
  group.add(createInstancedMesh(trunkGeometry, plain, trunks, true), createInstancedMesh(crownGeometry, plain, crowns, true));
  return group;
}

function mergeTiers(tiers: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const tier of tiers) {
    const flat = tier.toNonIndexed();
    positions.push(...(flat.getAttribute("position").array as Float32Array));
    normals.push(...(flat.getAttribute("normal").array as Float32Array));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function buildVegetation(kit: Kit, materials: SceneMaterials, ruin: MechRuin, village: Village, root: THREE.Object3D): Vegetation {
  const random = createRandom(777);
  const blobs = Array.from({ length: 6 }, () => createBlob(random, 2, 0.55));
  const worldKit = kit.withFrame(root);

  for (const [x, z, scale] of DECK_TREES) {
    buildTree(worldKit, materials, random, blobs, toWorld(ruin.hull, [x, 0, z]), { scale, autumn: false });
    buildTreeRoots(worldKit, materials, random, ruin.hull, x, z);
    village.deckClearings.push({ x, z, radius: 2.5 });
  }
  for (let bush = 0; bush < 40; bush++) {
    const x = randomRange(random, -44, 46);
    const z = randomRange(random, -28, 28);
    if (!isInsidePolygon(x, z, HULL_OUTLINE, 0.94) || isInClearing(x, z, village.deckClearings, 0.8)) continue;
    buildBush(worldKit, materials, random, blobs, toWorld(ruin.hull, [x, 0, z]), 0.6 + random() * 0.6);
  }
  scatterGroundTrees(worldKit, materials, random, blobs, ruin);
  buildRocks(worldKit, materials, random);

  const leaves = createInstanceList();
  const vineContext: VineContext = { kit: worldKit, materials, random, leaves };
  buildHangingVines(vineContext, ruin);
  buildClimbingIvy(vineContext, ruin);
  const leafMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  root.add(createInstancedMesh(createLeafGeometry(), leafMaterial, leaves, true));

  const time = { value: 0 };
  const grass = createInstancedMesh(createBladeGeometry(), createGrassMaterial(time), scatterGrass(ruin, village.deckClearings, random), false);
  grass.name = "grass";
  root.add(grass);
  const flowerMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: new THREE.Color("#221a10") });
  root.add(createInstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), flowerMaterial, scatterFlowers(ruin, village.deckClearings, random), false));
  root.add(buildPineForest(random));

  return {
    updaters: [
      (elapsedSeconds) => {
        time.value = elapsedSeconds;
      },
    ],
  };
}
