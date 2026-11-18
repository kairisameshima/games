import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, compose } from "../mech-village/batch";
import { createRandom, fbm, pick, randomRange, type Random } from "../mech-village/noise";
import { COLORS, DECK_HEIGHT, DECK_X, DECK_Z, type Clearing, type Materials } from "./materials";

const CANOPY_LEAF = ["#2f4a2d", "#3a5a37", "#405e3c", "#324d34"] as const;
const CANOPY_HIGHLIGHT = ["#56703f", "#60773f", "#4d6438"] as const;
const FLOWER_TINTS = ["#f6ecd9", "#f0c3d0", "#e8a8bc", "#f7d9c4"] as const;
const GRASS_TINTS = ["#c9d1ad", "#d5dabb", "#b5c6a2", "#e4dfb6"] as const;
const GRASS_BASE = "#71845a";
const GRASS_TIP = "#c9d39a";
const VINE_STEM = "#3a4a26";

// Smaller plaza and stall clearings should stay open rather than being edged with brambles.
const COTTAGE_GARDEN_MIN_RADIUS = 2.8;

interface InstanceList {
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

function createInstanceList(): InstanceList {
  return { matrices: [], colors: [] };
}

function createInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, list: InstanceList, castShadow: boolean): THREE.InstancedMesh {
  // Stock vertex-colour materials also need white vertex colours when tint comes only from instances.
  if (!geometry.getAttribute("color")) {
    const white = new Float32Array(geometry.getAttribute("position").count * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));
  }
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.matrices.length));
  list.matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, list.colors[index]);
  });
  mesh.count = list.matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function insideEllipse(x: number, z: number, cx: number, cz: number, rx: number, rz: number): boolean {
  const dx = x - cx;
  const dz = z - cz;
  return (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) < 1;
}

function isInClearing(x: number, z: number, clearings: ReadonlyArray<Clearing>, margin = 0): boolean {
  return clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius + margin);
}

function randomPointInUnitSphere(random: Random): THREE.Vector3 {
  let point = new THREE.Vector3();
  let attempts = 0;
  do {
    point = new THREE.Vector3(randomRange(random, -1, 1), randomRange(random, -1, 1), randomRange(random, -1, 1));
    attempts++;
  } while (point.lengthSq() > 1 && attempts < 8);
  return point;
}

/** Irregular lumpy blob, used for mossy ground/stone hummocks (not canopy foliage). */
function createRoughBlob(random: Random, detail: number, roughness: number): THREE.BufferGeometry {
  const seed = Math.floor(random() * 1000);
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);
  const positions = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index);
    const bump = fbm(vertex.x * 1.9 + seed, vertex.z * 1.9 + vertex.y * 1.4, 3, seed);
    vertex.multiplyScalar(1 + (bump - 0.5) * roughness);
    if (vertex.y < -0.25) vertex.y = -0.25 + (vertex.y + 0.25) * 0.4;
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createLeafCardGeometry(kind: "heart" | "diamond" | "leaf"): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  if (kind === "heart") {
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.55, 0.4, 0, 1);
    shape.quadraticCurveTo(-0.55, 0.4, 0, 0);
  } else if (kind === "diamond") {
    shape.moveTo(0, -0.5);
    shape.lineTo(0.38, 0.1);
    shape.lineTo(0, 0.7);
    shape.lineTo(-0.38, 0.1);
    shape.lineTo(0, -0.5);
  } else {
    // Slightly asymmetric lanceolate leaf: stem at y=0, pointed tip at y~1.1.
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.3, 0.22, 0.21, 0.6);
    shape.quadraticCurveTo(0.11, 0.98, 0, 1.1);
    shape.quadraticCurveTo(-0.1, 0.96, -0.19, 0.58);
    shape.quadraticCurveTo(-0.27, 0.2, 0, 0);
  }
  const geometry = new THREE.ShapeGeometry(shape, kind === "leaf" ? 2 : 3);
  if (kind === "leaf") {
    // Fold a shallow midrib valley into the card so it reads as a leaf, not a flat sticker.
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const crease = (1 - Math.min(1, Math.abs(x) / 0.3)) * Math.sin(Math.min(1, Math.max(0, y)) * Math.PI) * 0.05;
      positions.setZ(index, crease);
    }
    positions.needsUpdate = true;
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Tapered grass blade from y=0 to y=1 with a baked dark-to-sunlit gradient. */
function createBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const rows = 4;
  const base = new THREE.Color(GRASS_BASE);
  const tip = new THREE.Color(GRASS_TIP);
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
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\nnormal = normalize(vNormal);",
    );
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

function addGrassBlade(list: InstanceList, random: Random, position: THREE.Vector3, height: number): void {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(randomRange(random, -0.2, 0.2), random() * Math.PI * 2, randomRange(random, -0.2, 0.2)));
  const width = 0.7 + random() * 0.6;
  list.matrices.push(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(width, height, width)));
  list.colors.push(new THREE.Color(pick(random, GRASS_TINTS)).offsetHSL(0, 0, randomRange(random, -0.05, 0.05)));
}

function addFlower(list: InstanceList, random: Random, position: THREE.Vector3): void {
  const size = 0.5 + random() * 0.4;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
  list.matrices.push(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(size, size * 0.8, size)));
  list.colors.push(new THREE.Color(pick(random, FLOWER_TINTS)));
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Scatters small instanced leaf cards in a porous, irregular puff around `center` -
 * the building block for canopies and undergrowth alike instead of one solid blob.
 */
function addLeafPuff(
  list: InstanceList,
  random: Random,
  center: THREE.Vector3,
  radius: number,
  count: number,
  sizeMin: number,
  sizeMax: number,
  basePalette: readonly string[],
  tipPalette: readonly string[] | null,
): void {
  for (let index = 0; index < count; index++) {
    const direction = randomPointInUnitSphere(random);
    const porosity = 0.4 + random() * 0.85;
    const offset = direction.clone().multiplyScalar(radius * porosity);
    const position = center.clone().add(offset);
    const outward = offset.lengthSq() > 1e-5 ? offset.clone().normalize() : UP_AXIS;
    const baseQuat = new THREE.Quaternion().setFromUnitVectors(UP_AXIS, outward);
    const jitter = new THREE.Quaternion().setFromEuler(new THREE.Euler(randomRange(random, -0.7, 0.7), random() * Math.PI * 2, randomRange(random, -0.7, 0.7)));
    const quaternion = baseQuat.multiply(jitter);
    const size = sizeMin + random() * (sizeMax - sizeMin);
    const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(size, size * (0.85 + random() * 0.3), size));
    const useTip = tipPalette !== null && random() < 0.4;
    const paletteColor = useTip && tipPalette ? pick(random, tipPalette) : pick(random, basePalette);
    const color = new THREE.Color(paletteColor).offsetHSL(randomRange(random, -0.012, 0.012), randomRange(random, -0.035, 0.035), randomRange(random, -0.045, 0.045));
    list.matrices.push(matrix);
    list.colors.push(color);
  }
}

function addBaseClump(grassList: InstanceList, flowerList: InstanceList, random: Random, base: THREE.Vector3, radius: number): void {
  const bladeCount = 10 + Math.floor(random() * 8);
  for (let index = 0; index < bladeCount; index++) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius;
    const position = base.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
    addGrassBlade(grassList, random, position, 0.3 + random() * 0.35);
  }
  const flowerCount = 2 + Math.floor(random() * 4);
  for (let index = 0; index < flowerCount; index++) {
    const angle = random() * Math.PI * 2;
    const distance = radius * (0.4 + random() * 0.7);
    const position = base.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0.1, Math.sin(angle) * distance));
    addFlower(flowerList, random, position);
  }
}

/**
 * Trunk, forks, branches and tapered twigs built from bark-material beams, each twig tip
 * carrying its own small instanced leaf puff - a porous canopy instead of a few big blobs.
 */
function buildTree(kit: Kit, materials: Materials, random: Random, leafList: InstanceList, base: THREE.Vector3, scale: number, gnarly: boolean): void {
  const trunkHeight = (gnarly ? 4.4 : 2.6) * scale + random() * 1.5 * scale;
  const lean = new THREE.Vector3(randomRange(random, -0.3, 0.3), 1, randomRange(random, -0.3, 0.3)).normalize();
  const trunkTop = base.clone().addScaledVector(lean, trunkHeight);
  const trunkRadius = (gnarly ? 0.43 : 0.24) * scale;
  const bark = new THREE.Color(COLORS.wood);
  kit.beam(base.clone(), trunkTop, trunkRadius, materials.wood, bark.clone().offsetHSL(0, 0, randomRange(random, -0.04, 0.04)), 9, trunkRadius * 0.55);

  const leafSizeMin = 0.15;
  const leafSizeMax = 0.32;

  // A few short twigs at the trunk apex fill the canopy centre so the crown has no bald top.
  const capTwigs = gnarly ? 3 : 2;
  for (let index = 0; index < capTwigs; index++) {
    const direction = new THREE.Vector3(randomRange(random, -0.6, 0.6), 0.6 + random() * 0.5, randomRange(random, -0.6, 0.6)).normalize();
    const twigEnd = trunkTop.clone().addScaledVector(direction, (gnarly ? 1.0 : 0.65) * scale * (0.5 + random() * 0.5));
    kit.beam(trunkTop, twigEnd, trunkRadius * 0.12, materials.wood, bark, 4, trunkRadius * 0.02);
    const leafCount = gnarly ? 220 : 110;
    addLeafPuff(leafList, random, twigEnd, (gnarly ? 1.0 : 0.7) * scale, leafCount, leafSizeMin, leafSizeMax, CANOPY_LEAF, CANOPY_HIGHLIGHT);
  }

  const forkCount = gnarly ? 4 + Math.floor(random() * 3) : 2 + Math.floor(random() * 2);
  for (let fork = 0; fork < forkCount; fork++) {
    const forkStart = base.clone().lerp(trunkTop, 0.45 + random() * 0.3);
    const angle = (fork / forkCount) * Math.PI * 2 + random() * 1.2;
    const reach = (gnarly ? 2.4 : 1.4) * scale * (0.7 + random() * 0.6);
    const forkEnd = forkStart.clone().add(new THREE.Vector3(Math.cos(angle) * reach, (1.1 + random() * 1.2) * scale, Math.sin(angle) * reach));
    kit.beam(forkStart, forkEnd, trunkRadius * 0.55, materials.wood, bark.clone().offsetHSL(0, 0, randomRange(random, -0.05, 0.05)), 7, trunkRadius * 0.25);
    addLeafPuff(leafList, random, forkEnd, (gnarly ? 1.25 : 0.9) * scale, gnarly ? 550 : 260, leafSizeMin, leafSizeMax, CANOPY_LEAF, CANOPY_HIGHLIGHT);

    const branchCount = 2 + Math.floor(random() * 3);
    for (let branch = 0; branch < branchCount; branch++) {
      const branchAngle = angle + randomRange(random, -1.1, 1.1);
      const branchReach = (gnarly ? 1.6 : 1.0) * scale * (0.6 + random() * 0.7);
      const branchDir = new THREE.Vector3(Math.cos(branchAngle), 0.5 + random() * 0.6, Math.sin(branchAngle)).normalize();
      const branchEnd = forkEnd.clone().addScaledVector(branchDir, branchReach);
      kit.beam(forkEnd, branchEnd, trunkRadius * 0.22, materials.wood, bark, 5, trunkRadius * 0.05);
      addLeafPuff(leafList, random, branchEnd, (gnarly ? 0.95 : 0.7) * scale, gnarly ? 280 : 150, leafSizeMin, leafSizeMax, CANOPY_LEAF, CANOPY_HIGHLIGHT);

      const twigCount = gnarly ? 5 + Math.floor(random() * 4) : 3 + Math.floor(random() * 3);
      const puffRadius = (gnarly ? 0.55 : 0.4) * scale * (0.7 + random() * 0.5);
      for (let twig = 0; twig < twigCount; twig++) {
        const twigDir = branchDir.clone().addScaledVector(randomPointInUnitSphere(random), 0.8).normalize();
        const twigLength = branchReach * (0.3 + random() * 0.45);
        const twigEnd = branchEnd.clone().addScaledVector(twigDir, twigLength);
        kit.beam(branchEnd, twigEnd, trunkRadius * 0.08, materials.wood, bark.clone().offsetHSL(0, 0, randomRange(random, -0.06, 0.06)), 4, trunkRadius * 0.012);
        const leafCount = gnarly ? 85 + Math.floor(random() * 30) : 45 + Math.floor(random() * 20);
        addLeafPuff(leafList, random, twigEnd, puffRadius, leafCount, leafSizeMin, leafSizeMax, CANOPY_LEAF, CANOPY_HIGHLIGHT);
      }
    }
  }

  const rootCount = gnarly ? 7 : 5;
  for (let root = 0; root < rootCount; root++) {
    const angle = (root / rootCount) * Math.PI * 2 + random() * 0.5;
    const reach = (gnarly ? 2.6 : 1.6) * scale * (0.7 + random() * 0.6);
    const start = base.clone().add(new THREE.Vector3(0, 0.12 * scale, 0));
    const mid = base.clone().add(new THREE.Vector3(Math.cos(angle) * reach * 0.5, -0.08 * scale, Math.sin(angle) * reach * 0.5));
    const tip = base.clone().add(new THREE.Vector3(Math.cos(angle) * reach, -0.16 * scale, Math.sin(angle) * reach));
    const curve = new THREE.CatmullRomCurve3([start, mid, tip]);
    kit.add(new THREE.TubeGeometry(curve, 10, trunkRadius * 0.32, 6), materials.wood, new THREE.Matrix4(), bark);
  }
}

function addVineLeaves(heartList: InstanceList, diamondList: InstanceList, random: Random, curve: THREE.Curve<THREE.Vector3>, length: number): void {
  const count = Math.max(3, Math.floor(length * 32));
  for (let index = 0; index < count; index++) {
    const point = curve.getPointAt(random());
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2));
    const size = 0.2 + random() * 0.3;
    const offset = new THREE.Vector3(randomRange(random, -0.2, 0.2), randomRange(random, -0.1, 0.1), randomRange(random, -0.2, 0.2));
    const matrix = new THREE.Matrix4().compose(point.clone().add(offset), quaternion, new THREE.Vector3(size, size, size));
    const palette = random() < 0.5 ? CANOPY_LEAF : CANOPY_HIGHLIGHT;
    const color = new THREE.Color(pick(random, palette)).offsetHSL(0, 0, randomRange(random, -0.05, 0.05));
    const list = random() < 0.5 ? heartList : diamondList;
    list.matrices.push(matrix);
    list.colors.push(color);
  }
}

/** Low, rooted brambles around the cottage gardens, rather than unsupported vines in the air. */
function buildGardenVines(kit: Kit, materials: Materials, random: Random, clearings: ReadonlyArray<Clearing>): { heart: InstanceList; diamond: InstanceList } {
  const heart = createInstanceList();
  const diamond = createInstanceList();
  for (const cottage of clearings) {
    if (cottage.radius < COTTAGE_GARDEN_MIN_RADIUS) continue;
    if (random() > 0.6) continue;
    const strandCount = 1 + Math.floor(random() * 2);
    for (let strand = 0; strand < strandCount; strand++) {
      const angle = random() * Math.PI * 2;
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
      const wallFoot = new THREE.Vector3(cottage.x, DECK_HEIGHT, cottage.z).addScaledVector(outward, cottage.radius * 0.85);
      const climbHeight = randomRange(random, 0.55, 1.1);
      const sway = randomRange(random, -0.4, 0.4);
      const points = [
        wallFoot.clone(),
        wallFoot.clone().add(new THREE.Vector3(0, climbHeight * 0.35, 0)).addScaledVector(tangent, sway * 0.3),
        wallFoot.clone().add(new THREE.Vector3(0, climbHeight * 0.7, 0)).addScaledVector(outward, 0.15).addScaledVector(tangent, sway * 0.65),
        wallFoot.clone().add(new THREE.Vector3(0, 0.08, 0)).addScaledVector(outward, 0.25).addScaledVector(tangent, sway + 0.8),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      const length = curve.getLength();
      kit.add(new THREE.TubeGeometry(curve, Math.max(6, Math.round(length * 3)), 0.03 + random() * 0.02, 5), materials.matte, new THREE.Matrix4(), VINE_STEM);
      addVineLeaves(heart, diamond, random, curve, length);
    }
  }
  return { heart, diamond };
}

function buildMossPatches(kit: Kit, materials: Materials, random: Random, clearings: ReadonlyArray<Clearing>): void {
  const hummocks = Array.from({ length: 3 }, () => createRoughBlob(random, 1, 0.3));
  let placed = 0;
  let attempts = 0;
  while (placed < 85 && attempts < 4000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const t = 0.7 + random() * 0.28;
    const x = Math.cos(angle) * DECK_X * t;
    const z = Math.sin(angle) * DECK_Z * t;
    if (isInClearing(x, z, clearings, 0.6)) continue;
    const density = fbm(x * 0.1 + 5, z * 0.1 + 5, 3, 41);
    if (density < 0.4) continue;
    const size = 0.6 + random() * 1.1;
    kit.add(
      pick(random, hummocks),
      materials.stone,
      compose([x, DECK_HEIGHT + 0.02, z], [0, random() * 6, 0], [size, size * (0.6 + random() * 0.3), size * (0.8 + random() * 0.3)]),
      pick(random, [COLORS.moss, COLORS.mossLight]),
    );
    placed++;
  }
}

function scatterDeckMeadow(random: Random, clearings: ReadonlyArray<Clearing>): { grass: InstanceList; flowers: InstanceList } {
  const grass = createInstanceList();
  const flowers = createInstanceList();
  let attempts = 0;
  const grassTarget = 3600;
  while (grass.matrices.length < grassTarget && attempts < grassTarget * 5) {
    attempts++;
    const x = randomRange(random, -DECK_X, DECK_X);
    const z = randomRange(random, -DECK_Z, DECK_Z);
    if (!insideEllipse(x, z, 0, 0, DECK_X * 0.96, DECK_Z * 0.96)) continue;
    if (isInClearing(x, z, clearings, 0.5)) continue;
    const density = fbm(x * 0.12 + 3, z * 0.12 + 3, 3, 47);
    if (density < 0.4 || random() > (density - 0.2) * 2.4) continue;
    addGrassBlade(grass, random, new THREE.Vector3(x, DECK_HEIGHT + 0.01, z), 0.15 + density * 0.25 + random() * 0.2);
  }
  attempts = 0;
  const flowerTarget = 280;
  while (flowers.matrices.length < flowerTarget && attempts < flowerTarget * 8) {
    attempts++;
    const x = randomRange(random, -DECK_X, DECK_X);
    const z = randomRange(random, -DECK_Z, DECK_Z);
    if (!insideEllipse(x, z, 0, 0, DECK_X * 0.95, DECK_Z * 0.95)) continue;
    if (isInClearing(x, z, clearings, 0.6)) continue;
    if (fbm(x * 0.12 + 3, z * 0.12 + 3, 3, 47) < 0.45) continue;
    addFlower(flowers, random, new THREE.Vector3(x, DECK_HEIGHT + 0.1 + random() * 0.15, z));
  }
  return { grass, flowers };
}

function buildNamedTrees(kit: Kit, materials: Materials, random: Random, leafList: InstanceList, grassList: InstanceList, flowerList: InstanceList): Clearing[] {
  const trees: Array<[number, number, number, boolean]> = [
    [10, -13, 2.1, true],
    [-19, 9, 1.0, false],
  ];
  const clearings: Clearing[] = [];
  for (const [x, z, scale, gnarly] of trees) {
    const base = new THREE.Vector3(x, DECK_HEIGHT, z);
    buildTree(kit, materials, random, leafList, base, scale, gnarly);
    addBaseClump(grassList, flowerList, random, base, 2.2 * scale);
    clearings.push({ x, z, radius: 1.8 * scale });
  }
  return clearings;
}

export function buildGrowth(kit: Kit, materials: Materials, root: THREE.Object3D, clearings: Clearing[]): { update: (seconds: number) => void } {
  const random = createRandom(4821);
  const leaves = createInstanceList();
  const deckGrass = createInstanceList();
  const deckFlowers = createInstanceList();

  const namedTreeClearings = buildNamedTrees(kit, materials, random, leaves, deckGrass, deckFlowers);
  const allClearings = [...clearings, ...namedTreeClearings];

  buildMossPatches(kit, materials, random, allClearings);
  const deckMeadow = scatterDeckMeadow(random, allClearings);
  deckGrass.matrices.push(...deckMeadow.grass.matrices);
  deckGrass.colors.push(...deckMeadow.grass.colors);
  deckFlowers.matrices.push(...deckMeadow.flowers.matrices);
  deckFlowers.colors.push(...deckMeadow.flowers.colors);

  const ivy = buildGardenVines(kit, materials, random, clearings);

  const time = { value: 0 };
  const grassMesh = createInstancedMesh(createBladeGeometry(), createGrassMaterial(time), deckGrass, false);
  grassMesh.name = "growthGrass";
  root.add(grassMesh);

  root.add(createInstancedMesh(new THREE.IcosahedronGeometry(0.14, 0), materials.matte, deckFlowers, false));
  root.add(createInstancedMesh(createLeafCardGeometry("leaf"), materials.leaves, leaves, true));
  root.add(createInstancedMesh(createLeafCardGeometry("heart"), materials.leaves, ivy.heart, true));
  root.add(createInstancedMesh(createLeafCardGeometry("diamond"), materials.leaves, ivy.diamond, true));

  return {
    update: (seconds: number) => {
      time.value = seconds;
    },
  };
}
