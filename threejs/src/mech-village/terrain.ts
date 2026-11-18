import * as THREE from "three";
import type { SceneMaterials } from "./materials";
import { fbm } from "./noise";

export const POND = { x: 6, z: 54, radius: 13, waterLevel: -1.1 };

export const PATHS: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [
    [57, 27],
    [46, 40],
    [28, 44],
    [22, 62],
    [-6, 74],
    [-24, 66],
    [-40, 72],
    [-70, 88],
    [-130, 140],
  ],
  [
    [57, 27],
    [84, 30],
    [130, 22],
    [200, 60],
  ],
];

/** Circles on the ground where props stand; vegetation scatter skips them. */
export const groundClearings: Array<{ x: number; z: number; radius: number }> = [];

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distanceToPath(x: number, z: number): number {
  let nearest = Infinity;
  for (const path of PATHS) {
    for (let index = 0; index < path.length - 1; index++) {
      const [ax, az] = path[index];
      const [bx, bz] = path[index + 1];
      nearest = Math.min(nearest, distanceToSegment(x, z, ax, az, bx, bz));
    }
  }
  return nearest;
}

export function distanceToPond(x: number, z: number): number {
  return Math.hypot(x - POND.x, z - POND.z);
}

export function groundHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const pondDistance = distanceToPond(x, z);
  const nearCalm = smoothstep(POND.radius * 0.6, POND.radius * 2.4, pondDistance);
  let height = (fbm(x * 0.011 + 40, z * 0.011 + 40, 4, 3) - 0.5) * 7 * nearCalm;
  height += smoothstep(140, 360, radius) * (14 + fbm(x * 0.005 + 9, z * 0.005 + 9, 4, 9) * 90);
  height += 10 * Math.exp(-((x + 46) ** 2) / (2 * 16 * 16) - (z * z) / (2 * 26 * 26));
  height += 3 * Math.exp(-((x - 72) ** 2) / (2 * 10 * 10) - ((z - 48) ** 2) / (2 * 10 * 10));
  height -= 3.4 * Math.exp(-((pondDistance / POND.radius) ** 2) * 1.6);
  return height;
}

const GRASS_LUSH = new THREE.Color("#46591f");
const GRASS_BRIGHT = new THREE.Color("#6d7c2c");
const GRASS_DRY = new THREE.Color("#93844a");
const DIRT = new THREE.Color("#8a6c45");
const MUD = new THREE.Color("#4b3b28");
const ROCK = new THREE.Color("#7c7668");

function createGround(materials: SceneMaterials): THREE.Mesh {
  const size = 900;
  const segments = 320;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    positions.setY(index, groundHeight(positions.getX(index), positions.getZ(index)));
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const lushness = fbm(x * 0.02, z * 0.02, 4, 15);
    const dryness = fbm(x * 0.008 + 3, z * 0.008 + 3, 3, 21);
    color.copy(GRASS_LUSH).lerp(GRASS_BRIGHT, lushness);
    color.lerp(GRASS_DRY, smoothstep(0.5, 0.75, dryness) * 0.7);
    const pathAmount = 1 - smoothstep(1.2, 3.4, distanceToPath(x, z) + (fbm(x * 0.3, z * 0.3, 2, 5) - 0.5) * 1.5);
    color.lerp(DIRT, pathAmount * 0.85);
    const shore = 1 - smoothstep(POND.radius * 0.7, POND.radius * 1.15, distanceToPond(x, z));
    color.lerp(MUD, shore);
    const steepness = 1 - normals.getY(index);
    color.lerp(ROCK, smoothstep(0.18, 0.4, steepness));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const uvs = geometry.getAttribute("uv");
  for (let index = 0; index < uvs.count; index++) {
    uvs.setXY(index, uvs.getX(index) * (size / 6), uvs.getY(index) * (size / 6));
  }
  const ground = new THREE.Mesh(geometry, materials.ground);
  ground.receiveShadow = true;
  ground.name = "ground";
  return ground;
}

/** Ridged mountain annulus that closes the horizon behind the fog. */
function createMountainRing(): THREE.Mesh {
  const steps = 360;
  const rows = 14;
  const innerRadius = 420;
  const outerRadius = 1400;
  const positions: number[] = [];
  const colors: number[] = [];
  const forest = new THREE.Color("#3f5434");
  const rock = new THREE.Color("#7d827c");
  const color = new THREE.Color();
  for (let row = 0; row <= rows; row++) {
    const rowT = row / rows;
    const radius = innerRadius + (outerRadius - innerRadius) * rowT;
    const envelope = smoothstep(0, 0.45, rowT);
    for (let step = 0; step <= steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const ridge = 1 - Math.abs(fbm(x * 0.0032 + 50, z * 0.0032 + 50, 5, 33) * 2 - 1);
      const massif = fbm(x * 0.0011 + 9, z * 0.0011 + 9, 3, 35);
      const height = groundHeight(x, z) * (1 - envelope) + envelope * (40 + Math.pow(ridge, 2.2) * 260 * (0.4 + massif));
      positions.push(x, height, z);
      color.copy(forest).lerp(rock, smoothstep(90, 220, height));
      colors.push(color.r, color.g, color.b);
    }
  }
  const indices: number[] = [];
  const stride = steps + 1;
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < steps; step++) {
      const a = row * stride + step;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "mountains";
  return mesh;
}

function createPond(materials: SceneMaterials): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(POND.radius * 1.5, 48);
  geometry.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geometry, materials.water);
  water.position.set(POND.x, POND.waterLevel, POND.z);
  water.receiveShadow = true;
  water.name = "pond";
  return water;
}

export function createTerrain(materials: SceneMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = "terrain";
  group.add(createGround(materials), createMountainRing(), createPond(materials));
  return group;
}
