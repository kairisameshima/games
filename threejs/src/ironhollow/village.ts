import * as THREE from "three";
import { GeometryBatch, Kit, compose } from "../mech-village/batch";
import { createRandom, pick, randomRange, type Random } from "../mech-village/noise";
import { COLORS, type Materials, type Clearing } from "./materials";
import { TOWN_DISTRICTS } from "./town-layout";
import { MECH_DECK_HEIGHT, SETTLEMENT_X, SETTLEMENT_Z } from "./scale";

const BEAM = COLORS.wood;
const PLANK = COLORS.planks;
const DOOR = "#3a2a1c";
const STONE = COLORS.paleSteel;
const CAP = COLORS.darkSteel;
const ROOF_SLATE = "#4b5962";
const ROOF_TERRACOTTA = "#8a5240";
const SHUTTERS = [ROOF_SLATE, "#6f7d5e", ROOF_TERRACOTTA, "#3a2d22"];
const BUNTING = ["#c8473a", "#e8b94a", "#3f7cae", "#f1ead8", "#5f9d58"];
const VILLAGER_CLOTHES = ["#a8432f", "#3f6e8c", "#5e8a45"];
const SKIN = "#e3b48c";
const EXPANSION_ROOF_COLORS = [ROOF_SLATE, ROOF_TERRACOTTA, COLORS.tealRoof, COLORS.redRoof];

type Face = "front" | "back" | "left" | "right";

interface CottageSpec {
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  floors: 1 | 2;
  roofColor: string;
  chimney: boolean;
  dormer: boolean;
  balcony: boolean;
}

interface Builder {
  materials: Materials;
  random: Random;
  smoke: THREE.Vector3[];
}

const COTTAGES: CottageSpec[] = [
  { x: 9, z: 11, yaw: -2.78, width: 5, depth: 4.2, floors: 2, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: true, balcony: false },
  { x: 16, z: 11, yaw: -2.25, width: 4.6, depth: 4.2, floors: 1, roofColor: ROOF_SLATE, chimney: false, dormer: false, balcony: false },
  { x: 20, z: 5, yaw: -1.71, width: 4.8, depth: 4.4, floors: 2, roofColor: ROOF_SLATE, chimney: true, dormer: true, balcony: false },
  { x: 21, z: -3, yaw: -1.19, width: 4.4, depth: 4, floors: 1, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: false, balcony: false },
  { x: 19, z: -9, yaw: -0.826, width: 4, depth: 3.8, floors: 1, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: false, balcony: false },
  { x: -2, z: 9, yaw: 2.21, width: 4.8, depth: 4.2, floors: 2, roofColor: ROOF_SLATE, chimney: true, dormer: true, balcony: false },
  { x: 3, z: 13, yaw: 2.84, width: 4.8, depth: 4.4, floors: 1, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: false, balcony: false },
  { x: -4, z: 14, yaw: 2.4, width: 4.4, depth: 4, floors: 2, roofColor: ROOF_SLATE, chimney: true, dormer: true, balcony: false },
  { x: -9, z: 9, yaw: 1.95, width: 3.8, depth: 3.6, floors: 1, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: false, balcony: false },
  { x: 11, z: 6, yaw: -2.11, width: 4.6, depth: 4.2, floors: 2, roofColor: ROOF_SLATE, chimney: true, dormer: true, balcony: true },
  { x: 14, z: 1, yaw: -1.326, width: 4.2, depth: 3.8, floors: 1, roofColor: ROOF_TERRACOTTA, chimney: true, dormer: false, balcony: false },
  { x: 2, z: -7, yaw: 0.38, width: 4.2, depth: 4, floors: 1, roofColor: ROOF_SLATE, chimney: false, dormer: false, balcony: false },
];

function faceTransform(face: Face, along: number, y: number, width: number, depth: number): [THREE.Vector3Tuple, number] {
  switch (face) {
    case "front":
      return [[along, y, depth / 2 + 0.03], 0];
    case "back":
      return [[-along, y, -depth / 2 - 0.03], Math.PI];
    case "right":
      return [[width / 2 + 0.03, y, -along], Math.PI / 2];
    case "left":
      return [[-width / 2 - 0.03, y, along], -Math.PI / 2];
  }
}

function buildWindow(kit: Kit, builder: Builder, shutterColor: string): void {
  const { materials } = builder;
  kit.box([0.6, 0.72, 0.06], [0, 0, 0], materials.glow, "#ffd9a0");
  kit.box([0.05, 0.72, 0.03], [0, 0, 0.05], materials.wood, "#2e2115");
  kit.box([0.6, 0.045, 0.03], [0, 0, 0.05], materials.wood, "#2e2115");
  kit.box([0.82, 0.12, 0.14], [0, 0.42, 0.07], materials.wood, "#2e2115");
  kit.box([0.95, 0.1, 0.3], [0, -0.42, 0.14], materials.stone, STONE);
  for (const side of [1, -1] as const) {
    kit.box([0.1, 0.86, 0.14], [side * 0.36, 0, 0.07], materials.wood, "#2e2115");
    kit.box([0.32, 0.78, 0.05], [side * 0.56, 0, 0.17], materials.matte, shutterColor, [0, side * -0.3, 0]);
  }
}

function buildLanternSconce(kit: Kit, builder: Builder, position: THREE.Vector3Tuple): void {
  const [x, y, z] = position;
  kit.box([0.3, 0.08, 0.3], [x, y + 0.22, z], builder.materials.metal, CAP);
  kit.sphere(0.15, [x, y, z], builder.materials.glow, "#ffcf8a", [1, 1.25, 1], 8);
}

function randomTimberTint(random: Random): THREE.Color {
  return new THREE.Color(BEAM).offsetHSL(0, randomRange(random, -0.03, 0.03), randomRange(random, -0.05, 0.04));
}

function buildTimberBeams(kit: Kit, materials: Materials, random: Random, width: number, height: number, depth: number, base: number, frontSegments: number): void {
  const beam = 0.2;
  for (const y of [base + beam / 2, base + 0.6, base + height - beam / 2]) {
    const sag = randomRange(random, -0.02, 0.015);
    kit.box([width + 0.05, beam, beam], [0, y + sag, depth / 2], materials.wood, randomTimberTint(random), [randomRange(random, -0.02, 0.02), 0, 0]);
    kit.box([width + 0.05, beam, beam], [0, y - sag, -depth / 2], materials.wood, randomTimberTint(random), [randomRange(random, -0.02, 0.02), 0, 0]);
    kit.box([beam, beam, depth + 0.05], [width / 2, y + sag * 0.6, 0], materials.wood, randomTimberTint(random), [0, 0, randomRange(random, -0.02, 0.02)]);
    kit.box([beam, beam, depth + 0.05], [-width / 2, y - sag * 0.6, 0], materials.wood, randomTimberTint(random), [0, 0, randomRange(random, -0.02, 0.02)]);
  }
  for (let post = 0; post <= frontSegments; post++) {
    const x = -width / 2 + (post / frontSegments) * width + randomRange(random, -0.03, 0.03);
    const tilt = randomRange(random, -0.035, 0.035);
    kit.box([beam, height, beam], [x, base + height / 2, depth / 2], materials.wood, randomTimberTint(random), [tilt, 0, randomRange(random, -0.02, 0.02)]);
    kit.box([beam, height, beam], [x, base + height / 2, -depth / 2], materials.wood, randomTimberTint(random), [tilt * -0.7, 0, randomRange(random, -0.02, 0.02)]);
  }
  for (const side of [1, -1] as const) {
    kit.box([beam, height, beam], [(side * width) / 2, base + height / 2, 0], materials.wood, randomTimberTint(random), [0, 0, randomRange(random, -0.03, 0.03)]);
  }
}

function buildShingleCourses(
  kit: Kit,
  material: THREE.Material,
  roofLength: number,
  slopeLen: number,
  pitch: number,
  side: 1 | -1,
  ridgeY: number,
  eaveY: number,
  halfSpan: number,
  color: string,
  random: Random,
): void {
  const courseGap = 0.34;
  const courses = Math.max(4, Math.ceil(slopeLen / courseGap));
  const baseTileWidth = 0.42;
  for (let course = 0; course < courses; course++) {
    const s = Math.min(slopeLen - 0.05, (course + 0.5) * courseGap);
    const t = s / slopeLen;
    const y = ridgeY + (eaveY - ridgeY) * t;
    const z = side * halfSpan * t;
    const nearEave = course === 0;
    let cursor = -roofLength / 2 - 0.05 + (course % 2 === 0 ? 0 : baseTileWidth * 0.4);
    while (cursor < roofLength / 2 + 0.05) {
      const tileWidth = baseTileWidth * randomRange(random, 0.78, 1.2);
      const tileRun = courseGap * randomRange(random, 1.05, 1.32);
      const center = cursor + tileWidth / 2;
      const drop = nearEave ? randomRange(random, 0, 0.035) : 0;
      const jitterY = y - drop + randomRange(random, -0.016, 0.016);
      const tint = new THREE.Color(color).offsetHSL(randomRange(random, -0.012, 0.012), randomRange(random, -0.04, 0.02), randomRange(random, -0.05, 0.05));
      kit.box([tileWidth * 0.9, 0.085 + randomRange(random, -0.008, 0.015), tileRun], [center, jitterY, z], material, tint, [side * pitch, 0, 0]);
      cursor += tileWidth;
    }
  }
}

function buildDormer(kit: Kit, builder: Builder, side: 1 | -1, ridgeY: number, eaveY: number, halfSpan: number, roofColor: string): void {
  const { materials, random } = builder;
  const t = 0.52;
  const y = ridgeY + (eaveY - ridgeY) * t;
  const z = side * halfSpan * t;
  const dormer = kit.within([0, y + 0.55, z + side * 0.35]);
  const plasterTint = new THREE.Color(COLORS.plaster).offsetHSL(0, 0, randomRange(random, -0.04, 0.04));
  dormer.box([1.1, 0.9, 0.78], [0, 0, 0], materials.plaster, plasterTint);
  dormer.box([0.56, 0.48, 0.05], [0, 0.02, side * 0.4], materials.glow, "#ffd9a0");
  dormer.box([0.04, 0.48, 0.03], [0, 0.02, side * 0.44], materials.wood, "#2e2115");
  dormer.box([1.24, 0.1, 0.12], [0, 0.46, side * 0.42], materials.wood, BEAM);
  const roofPitch = 0.68;
  for (const s of [1, -1] as const) {
    dormer.box([1.2, 0.08, 0.6], [0, 0.82, s * 0.22], materials.roof, roofColor, [s * roofPitch, 0, 0]);
  }
}

function buildChimney(kit: Kit, builder: Builder, roofWidth: number, roofDepth: number, ridgeY: number, wallTop: number): void {
  const { materials, random } = builder;
  const x = roofWidth / 2 - 0.85;
  const z = -roofDepth / 4;
  const top = ridgeY + 1.2;
  const shaftHeight = top - wallTop + 0.4;
  const courses = Math.max(4, Math.round(shaftHeight / 0.45));
  for (let course = 0; course < courses; course++) {
    const y = wallTop - 0.2 + shaftHeight * ((course + 0.5) / courses);
    const jitterX = x + randomRange(random, -0.03, 0.03);
    const jitterZ = z + randomRange(random, -0.03, 0.03);
    const stoneTint = new THREE.Color(STONE).offsetHSL(0, 0, randomRange(random, -0.05, 0.04));
    kit.box([0.85 + randomRange(random, -0.02, 0.03), shaftHeight / courses + 0.02, 0.85 + randomRange(random, -0.02, 0.03)], [jitterX, y, jitterZ], materials.stone, stoneTint);
  }
  const sootHeight = shaftHeight * 0.3;
  kit.box([0.88, sootHeight, 0.88], [x, top - 0.2 - sootHeight / 2, z], materials.stone, "#3a3733");
  kit.box([1.05, 0.18, 1.05], [x, top, z], materials.metal, CAP);
  builder.smoke.push(kit.toWorld([x, top + 0.4, z]));
}

function buildPitchedRoof(kit: Kit, builder: Builder, width: number, depth: number, wallTop: number, roofColor: string, dormerSide: 0 | 1 | -1, detail: "high" | "low" = "high"): number {
  const { materials, random } = builder;
  const overhang = 0.45;
  const roofLength = width + overhang * 2;
  const pitch = 0.6;
  const halfSpan = depth / 2 + overhang;
  const slopeLen = halfSpan / Math.cos(pitch);
  const drop = overhang * Math.tan(pitch);
  const rise = halfSpan * Math.tan(pitch);
  const eaveY = wallTop - drop;
  const ridgeY = eaveY + rise;
  for (const side of [1, -1] as const) {
    if (detail === "low") {
      const planeTint = new THREE.Color(roofColor).offsetHSL(0, 0, randomRange(random, -0.03, 0.03));
      kit.box([roofLength, 0.12, slopeLen], [0, (ridgeY + eaveY) / 2, (side * halfSpan) / 2], materials.roof, planeTint, [side * pitch, 0, 0]);
    } else {
      buildShingleCourses(kit, materials.roof, roofLength, slopeLen, pitch, side, ridgeY, eaveY, halfSpan, roofColor, random);
    }
    kit.box([roofLength + 0.1, 0.16, 0.06], [0, eaveY - 0.08, side * halfSpan], materials.wood, "#2a2015");
  }
  const ridgeTint = new THREE.Color(roofColor).offsetHSL(0, -0.05, -0.18);
  kit.box([roofLength + 0.08, 0.14, 0.3], [0, ridgeY, 0], materials.roof, ridgeTint);
  const gableRise = (depth / 2) * Math.tan(pitch);
  const gable = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, gableRise)]);
  for (const side of [1, -1] as const) {
    const geometry = new THREE.ExtrudeGeometry(gable, { depth: 0.18, bevelEnabled: false });
    geometry.translate(0, 0, -0.09);
    geometry.rotateY(Math.PI / 2);
    kit.add(geometry, materials.wood, compose([(side * (width - 0.08)) / 2, wallTop, 0]), PLANK);
  }
  if (dormerSide !== 0) buildDormer(kit, builder, dormerSide, ridgeY, eaveY, halfSpan, roofColor);
  return ridgeY;
}

function buildCottage(kit: Kit, builder: Builder, spec: CottageSpec, detail: "high" | "low" = "high"): Clearing {
  const { materials, random } = builder;
  const house = kit.within([spec.x, 0, spec.z], [0, spec.yaw, 0]);
  const { width, depth } = spec;
  const base = 0.75;
  const shutterColor = pick(random, SHUTTERS);
  const plasterTint = new THREE.Color(COLORS.plaster).offsetHSL(0, 0, randomRange(random, -0.05, 0.05));

  const baseCourses = 3;
  const courseHeight = base / baseCourses;
  for (let course = 0; course < baseCourses; course++) {
    const y = courseHeight * (course + 0.5);
    const stoneTint = new THREE.Color(STONE).offsetHSL(0, 0, randomRange(random, -0.07, 0.05));
    house.box(
      [width + 0.5 + randomRange(random, -0.03, 0.03), courseHeight + 0.015, depth + 0.5 + randomRange(random, -0.03, 0.03)],
      [randomRange(random, -0.02, 0.02), y, randomRange(random, -0.02, 0.02)],
      materials.stone,
      stoneTint,
    );
  }
  house.box([width, 2.7, depth], [0, base + 1.35, 0], materials.plaster, plasterTint);
  const segments = Math.max(1, Math.round(width / 2.4));
  buildTimberBeams(house, materials, random, width, 2.7, depth, base, segments);

  let wallTop = base + 2.7;
  let roofWidth = width;
  let roofDepth = depth;
  const floorLevels: Array<{ y: number; width: number; depth: number }> = [{ y: base + 1.35, width, depth }];
  if (spec.floors === 2) {
    roofWidth = width + 0.4;
    roofDepth = depth + 0.4;
    house.box([roofWidth + 0.15, 0.25, roofDepth + 0.15], [0, wallTop + 0.08, 0], materials.wood, PLANK);
    house.box([roofWidth, 2.5, roofDepth], [0, wallTop + 1.33, 0], materials.plaster, plasterTint);
    buildTimberBeams(house, materials, random, roofWidth, 2.5, roofDepth, wallTop + 0.08, segments);
    floorLevels.push({ y: wallTop + 1.33, width: roofWidth, depth: roofDepth });
    wallTop += 2.58;
  }

  const doorAlong = segments > 1 ? -width / 2 + width / segments / 2 : 0;
  floorLevels.forEach((level, floorIndex) => {
    for (const face of ["front", "back"] as const) {
      for (let segment = 0; segment < segments; segment++) {
        const along = -level.width / 2 + (segment + 0.5) * (level.width / segments);
        if (floorIndex === 0 && face === "front" && Math.abs(along - doorAlong) < 0.5) continue;
        const [position, rotationY] = faceTransform(face, along, level.y, level.width, level.depth);
        buildWindow(house.within(position, [0, rotationY, 0]), builder, shutterColor);
      }
    }
    if (level.depth >= 4.2) {
      for (const face of ["left", "right"] as const) {
        const [position, rotationY] = faceTransform(face, 0, level.y, level.width, level.depth);
        buildWindow(house.within(position, [0, rotationY, 0]), builder, shutterColor);
      }
    }
  });

  const doorFront = depth / 2;
  house.box([0.9, 1.9, 0.14], [doorAlong, base + 0.95, doorFront + 0.04], materials.wood, DOOR);
  house.box([1.2, 0.26, 0.26], [doorAlong, base + 2.0, doorFront + 0.08], materials.wood, BEAM);
  house.box([1.3, 0.3, 0.7], [doorAlong, base - 0.15, doorFront + 0.5], materials.stone, STONE);
  buildLanternSconce(house, builder, [doorAlong + 0.85, base + 2.1, doorFront + 0.22]);

  if (spec.balcony && spec.floors === 2) {
    const deckY = base + 2.7;
    house.box([roofWidth - 0.9, 0.16, 1.5], [0, deckY, roofDepth / 2 + 0.75], materials.wood, PLANK);
    for (let post = 0; post <= 4; post++) {
      const x = -(roofWidth - 0.9) / 2 + (post / 4) * (roofWidth - 0.9);
      house.box([0.1, 0.85, 0.1], [x, deckY + 0.42, roofDepth / 2 + 1.42], materials.wood, BEAM);
    }
    house.box([roofWidth - 0.8, 0.08, 0.08], [0, deckY + 0.84, roofDepth / 2 + 1.42], materials.wood, BEAM);
    for (let pot = 0; pot < 3; pot++) {
      house.sphere(0.22, [-0.9 + pot * 0.9, deckY + 0.24, roofDepth / 2 + 1.2], materials.leaves, pick(random, [COLORS.moss, COLORS.mossLight, COLORS.leaves]), [1, 0.8, 1], 7);
    }
  }

  const dormerSide: 0 | 1 | -1 = spec.dormer ? (random() < 0.5 ? 1 : -1) : 0;
  const ridgeY = buildPitchedRoof(house, builder, roofWidth, roofDepth, wallTop, spec.roofColor, dormerSide, detail);
  if (spec.chimney) buildChimney(house, builder, roofWidth, roofDepth, ridgeY, wallTop);

  return { x: spec.x, z: spec.z, radius: Math.max(width, depth) / 2 + 1.1 };
}

function buildFountain(kit: Kit, builder: Builder): void {
  const { materials, random } = builder;
  const baseTint = new THREE.Color(STONE).offsetHSL(0, 0, randomRange(random, -0.04, 0.03));
  kit.cylinder(2.2, 2.4, 0.22, [0, 0.11, 0], materials.stone, baseTint, [0, 0, 0], 24);
  kit.cylinder(1.7, 1.8, 0.55, [0, 0.49, 0], materials.stone, "#c9c0ab", [0, 0, 0], 22);
  const waterGeometry = new THREE.CircleGeometry(1.55, 22);
  waterGeometry.rotateX(-Math.PI / 2);
  kit.add(waterGeometry, materials.water, compose([0, 0.79, 0]), 0xffffff, false);
  kit.cylinder(0.28, 0.34, 1.0, [0, 1.3, 0], materials.stone, "#c9c0ab", [0, 0, 0], 14);
  kit.sphere(0.3, [0, 1.85, 0], materials.metal, COLORS.brass, [1, 1, 1], 12);
}

function buildBench(kit: Kit, builder: Builder, position: THREE.Vector3Tuple, yaw: number): void {
  const { materials } = builder;
  const bench = kit.within(position, [0, yaw, 0]);
  for (const side of [1, -1] as const) {
    bench.box([0.12, 0.42, 0.5], [side * 0.75, 0.21, 0], materials.matte, STONE);
  }
  bench.box([1.8, 0.1, 0.45], [0, 0.46, 0], materials.matte, PLANK);
  bench.box([1.8, 0.4, 0.08], [0, 0.72, -0.2], materials.matte, PLANK);
}

function buildPlanter(kit: Kit, builder: Builder, position: THREE.Vector3Tuple): void {
  const { materials, random } = builder;
  const planter = kit.within(position);
  planter.cylinder(0.45, 0.4, 0.42, [0, 0.21, 0], materials.matte, PLANK, [0, 0, 0], 14);
  for (let index = 0; index < 5; index++) {
    const angle = randomRange(random, 0, Math.PI * 2);
    const r = randomRange(random, 0, 0.28);
    planter.sphere(0.16 + random() * 0.08, [Math.sin(angle) * r, 0.5 + random() * 0.1, Math.cos(angle) * r], materials.leaves, pick(random, [COLORS.moss, COLORS.mossLight, COLORS.leaves, COLORS.foliage]), [1, 0.85, 1], 7);
  }
}

function buildMarketStall(kit: Kit, builder: Builder, position: THREE.Vector3Tuple, yaw: number, stripe: string): void {
  const { materials, random } = builder;
  const stall = kit.within(position, [0, yaw, 0]);
  for (const [x, z] of [
    [-1.1, -0.7],
    [1.1, -0.7],
    [-1.1, 0.7],
    [1.1, 0.7],
  ] as const) {
    stall.box([0.12, 2.0, 0.12], [x, 1.0, z], materials.matte, BEAM);
  }
  stall.box([2.4, 0.7, 0.9], [0, 0.35, 0.28], materials.matte, PLANK);
  for (let index = 0; index < 5; index++) {
    const color = index % 2 === 0 ? stripe : "#f0e6d0";
    stall.box([0.46, 0.06, 1.9], [-1.0 + index * 0.46, 2.1, 0.05], materials.cloth, color, [0.2, 0, 0]);
  }
  for (let index = 0; index < 6; index++) {
    stall.sphere(0.1, [-0.9 + (index % 3) * 0.6, 0.78, 0.15 + Math.floor(index / 3) * 0.3], materials.leaves, pick(random, ["#d9542e", "#e6b03a", "#7aa33b"]), [1, 1, 1], 7);
  }
}

function catenary(start: THREE.Vector3, end: THREE.Vector3, sag: number, count: number): THREE.Vector3[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const point = start.clone().lerp(end, t);
    point.y -= sag * 4 * t * (1 - t);
    return point;
  });
}

function buildRope(kit: Kit, materials: Materials, points: THREE.Vector3[], radius = 0.035): void {
  const curve = new THREE.CatmullRomCurve3(points);
  kit.add(new THREE.TubeGeometry(curve, points.length * 2, radius, 5), materials.matte, new THREE.Matrix4(), "#6d5a43", false);
}

function buildLanternFestoon(kit: Kit, builder: Builder, start: THREE.Vector3, end: THREE.Vector3): void {
  const { materials } = builder;
  const length = start.distanceTo(end);
  const points = catenary(start, end, length * 0.09, Math.max(6, Math.round(length)));
  buildRope(kit, materials, points);
  const curve = new THREE.CatmullRomCurve3(points);
  const count = Math.max(2, Math.round(length / 1.5));
  for (let index = 1; index < count; index++) {
    const point = curve.getPointAt(index / count);
    kit.sphere(0.13, [point.x, point.y - 0.2, point.z], materials.glow, "#ffcf8a", [1, 1.25, 1], 8);
  }
}

function buildBunting(kit: Kit, builder: Builder, start: THREE.Vector3, end: THREE.Vector3): void {
  const { materials, random } = builder;
  const length = start.distanceTo(end);
  const points = catenary(start, end, length * 0.12, Math.max(6, Math.round(length)));
  buildRope(kit, materials, points);
  const curve = new THREE.CatmullRomCurve3(points);
  const count = Math.max(3, Math.round(length / 0.65));
  for (let index = 1; index < count; index++) {
    const t = index / count;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const flag = new THREE.BufferGeometry();
    flag.setAttribute("position", new THREE.Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.4, 0], 3));
    flag.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    flag.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const yaw = Math.atan2(-tangent.z, tangent.x);
    kit.add(flag, materials.cloth, compose(point.toArray(), [random() * 0.25, yaw, 0]), pick(random, BUNTING), false);
  }
}

function buildVillager(kit: Kit, builder: Builder, position: THREE.Vector3Tuple, yaw: number, clothColor: string): void {
  const { materials } = builder;
  const person = kit.within(position, [0, yaw, 0]);
  person.cylinder(0.1, 0.12, 0.6, [0, 0.3, 0], materials.matte, clothColor, [0, 0, 0], 8);
  person.sphere(0.14, [0, 0.72, 0], materials.matte, SKIN, [1, 1, 1], 8);
  person.box([0.1, 0.06, 0.1], [0, 0.86, 0], materials.matte, clothColor);
  for (const side of [1, -1] as const) {
    person.cylinder(0.045, 0.05, 0.42, [side * 0.09, 0.05, 0], materials.matte, "#3a2f28", [0, 0, 0], 6);
  }
}

function buildConeShingles(kit: Kit, builder: Builder, baseRadius: number, height: number, baseY: number, color: string): void {
  const { materials, random } = builder;
  const courses = 5;
  for (let course = 0; course < courses; course++) {
    const t0 = course / courses;
    const t1 = (course + 1) / courses;
    const r0 = baseRadius * (1 - t0) + 0.1 * t0;
    const r1 = baseRadius * (1 - t1) + 0.1 * t1;
    const y0 = baseY + height * t0;
    const y1 = baseY + height * t1;
    const ringCount = Math.max(6, Math.round(r0 * 10));
    for (let index = 0; index < ringCount; index++) {
      const angle = (index / ringCount) * Math.PI * 2 + (course % 2 === 0 ? 0 : Math.PI / ringCount);
      const tint = new THREE.Color(color).offsetHSL(0, -0.02, randomRange(random, -0.06, 0.05));
      const widthJitter = randomRange(random, 0.85, 1.1);
      const start = new THREE.Vector3(Math.sin(angle) * (r0 + 0.1), y0 - 0.05, Math.cos(angle) * (r0 + 0.1));
      const end = new THREE.Vector3(Math.sin(angle) * r1, y1, Math.cos(angle) * r1);
      kit.bar(start, end, 0.3 * widthJitter, 0.06, materials.roof, tint);
    }
  }
}

function buildWindmillTower(kit: Kit, builder: Builder, root: THREE.Object3D): (seconds: number) => void {
  const { materials, random } = builder;
  const tower = kit.within([13, 0, -6], [0, 0, 0], [1, 1.5, 1]);
  const stoneTint = new THREE.Color(STONE).offsetHSL(0, 0, randomRange(random, -0.05, 0.03));
  tower.cylinder(1.7, 1.9, 0.6, [0, 0.3, 0], materials.stone, stoneTint, [0, 0, 0], 20);
  tower.cylinder(1.3, 1.55, 4.2, [0, 2.7, 0], materials.plaster, new THREE.Color(COLORS.plaster).offsetHSL(0, 0, -0.03), [0, 0, 0], 18);
  tower.cylinder(1.5, 1.5, 0.22, [0, 4.9, 0], materials.wood, PLANK, [0, 0, 0], 18);
  for (const angle of [0.6, 2.4, 4.3]) {
    const position: THREE.Vector3Tuple = [Math.sin(angle) * 1.33, 3.1, Math.cos(angle) * 1.33];
    buildWindow(tower.within(position, [0, angle, 0]), builder, ROOF_SLATE);
  }
  tower.box([0.85, 1.8, 0.12], [0, 1.0, 1.42], materials.wood, DOOR);
  const roofBaseY = 5.0;
  const roofHeight = 2.3;
  buildConeShingles(tower, builder, 1.55, roofHeight, roofBaseY, ROOF_SLATE);
  tower.sphere(0.16, [0, roofBaseY + roofHeight + 0.05, 0], materials.metal, COLORS.brass, [1, 1, 1], 8);

  const hubWorld = tower.toWorld([1.85, 3.1, 0]);
  const sails = new THREE.Group();
  sails.position.copy(hubWorld);
  root.add(sails);
  const sailBatch = new GeometryBatch();
  const hubColor = "#3a2a1c";
  sailBatch.add(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10).rotateZ(Math.PI / 2), materials.wood, new THREE.Matrix4(), hubColor);
  const clothTone = "#9c8f78";
  for (let arm = 0; arm < 4; arm++) {
    const armRotation = new THREE.Matrix4().makeRotationX((arm * Math.PI) / 2);
    sailBatch.add(new THREE.BoxGeometry(0.12, 3.2, 0.14), materials.wood, armRotation.clone().multiply(compose([0.06, 1.6, 0])), "#4a3a2c");
    const rungCount = 6;
    for (let rung = 0; rung < rungCount; rung++) {
      const along = 0.55 + (rung / (rungCount - 1)) * 2.3;
      sailBatch.add(new THREE.BoxGeometry(0.06, 0.05, 0.62), materials.wood, armRotation.clone().multiply(compose([0.06, along, 0])), "#4a3a2c");
    }
    const patches = 3;
    for (let patch = 0; patch < patches; patch++) {
      if (randomRange(random, 0, 1) < 0.22) continue;
      const along = 0.75 + patch * 0.85 + randomRange(random, -0.1, 0.1);
      const patchHeight = randomRange(random, 0.55, 0.85);
      const patchWidth = randomRange(random, 0.38, 0.56);
      const tone = new THREE.Color(clothTone).offsetHSL(0, 0, randomRange(random, -0.06, 0.05));
      sailBatch.add(
        new THREE.BoxGeometry(0.03, patchHeight, patchWidth),
        materials.cloth,
        armRotation.clone().multiply(compose([0.1, along, randomRange(random, -0.05, 0.05)], [randomRange(random, -0.08, 0.08), 0, 0])),
        tone,
      );
    }
  }
  sailBatch.build(sails);
  return (seconds: number): void => {
    sails.rotation.x = seconds * 0.6;
  };
}

function buildVillageBoardwalk(kit: Kit, builder: Builder): void {
  const { materials, random } = builder;
  const start = new THREE.Vector3(28, 12.1, 16);
  const end = new THREE.Vector3(20, 12.1, 12);
  const stepCount = Math.ceil(start.distanceTo(end) / 0.5);
  const sideways = new THREE.Vector3().subVectors(end, start).cross(new THREE.Vector3(0, 1, 0)).normalize();
  const railLeft: THREE.Vector3[] = [];
  const railRight: THREE.Vector3[] = [];
  for (let step = 0; step <= stepCount; step++) {
    const t = step / stepCount;
    const point = start.clone().lerp(end, t);
    const stoneTread = step % 2 === 0;
    const tint = stoneTread
      ? new THREE.Color(STONE).offsetHSL(0, 0, randomRange(random, -0.05, 0.04))
      : new THREE.Color(PLANK).offsetHSL(0, 0, randomRange(random, -0.05, 0.03));
    kit.bar(point.clone().addScaledVector(sideways, -1.1), point.clone().addScaledVector(sideways, 1.1), 0.42, 0.12, stoneTread ? materials.stone : materials.wood, tint, Math.PI / 2);
    if (step % 3 === 0) {
      railLeft.push(point.clone().addScaledVector(sideways, 1.15).add(new THREE.Vector3(0, 0.85, 0)));
      railRight.push(point.clone().addScaledVector(sideways, -1.15).add(new THREE.Vector3(0, 0.85, 0)));
      const left = railLeft[railLeft.length - 1];
      const right = railRight[railRight.length - 1];
      kit.beam(left.clone().setY(point.y), left, 0.07, materials.wood, BEAM, 8);
      kit.beam(right.clone().setY(point.y), right, 0.07, materials.wood, BEAM, 8);
    }
  }
  buildRope(kit, materials, railLeft);
  buildRope(kit, materials, railRight);
  kit.box([0.1, 1.62, 0.1], [start.x, start.y + 0.81, start.z - 1.1], materials.wood, BEAM);
  kit.box([0.1, 1.62, 0.1], [end.x, end.y + 0.81, end.z - 0.8], materials.wood, BEAM);
  buildLanternSconce(kit, builder, [start.x, start.y + 1.4, start.z - 1.3]);
  buildLanternSconce(kit, builder, [end.x, end.y + 1.4, end.z - 1.0]);
}

export function buildVillage(kit: Kit, materials: Materials, root: THREE.Object3D): { smoke: THREE.Vector3[]; clearings: Clearing[]; update: (seconds: number) => void } {
  const random = createRandom(917531);
  const builder: Builder = { materials, random, smoke: [] };
  const clearings: Clearing[] = [];
  const deck = kit.within([0, 12, 0]);

  for (const spec of COTTAGES) {
    clearings.push(buildCottage(deck, builder, spec));
  }

  deck.cylinder(4.8, 5.0, 0.06, [6, 0.03, 3], materials.stone, STONE, [0, 0, 0], 28);
  buildFountain(deck.within([6, 0, 3]), builder);
  clearings.push({ x: 6, z: 3, radius: 2.6 });
  buildBench(deck, builder, [6, 0, 6.2], Math.PI);
  buildBench(deck, builder, [9.3, 0, 1.6], -2.1);
  buildPlanter(deck, builder, [3.2, 0, 1.0]);
  buildPlanter(deck, builder, [9.0, 0, 4.8]);
  buildPlanter(deck, builder, [5.6, 0, -0.3]);
  buildMarketStall(deck, builder, [2.6, 0, 6.6], 0.5, "#c8473a");
  clearings.push({ x: 2.6, z: 6.6, radius: 2.0 });

  const festoons: Array<[THREE.Vector3Tuple, THREE.Vector3Tuple]> = [
    [[9, 4.0, 11], [16, 3.4, 11]],
    [[11, 4.0, 6], [14, 3.4, 1]],
  ];
  for (const [start, end] of festoons) {
    buildLanternFestoon(deck, builder, new THREE.Vector3(...start), new THREE.Vector3(...end));
  }
  buildBunting(deck, builder, new THREE.Vector3(3, 4.0, 13), new THREE.Vector3(-4, 3.6, 14));
  buildBunting(deck, builder, new THREE.Vector3(3, 4.0, 13), new THREE.Vector3(2.6, 3.2, 6.6));

  buildVillager(deck, builder, [7.4, 0, 6.6], 0.6, pick(random, VILLAGER_CLOTHES));
  buildVillager(deck, builder, [12.2, 0, 3.6], -1.2, pick(random, VILLAGER_CLOTHES));

  buildVillageBoardwalk(kit, builder);
  const updateWindmill = buildWindmillTower(deck, builder, root);
  clearings.push({ x: 13, z: -6, radius: 2.4 });

  return {
    smoke: builder.smoke,
    clearings,
    update: updateWindmill,
  };
}

const WARD_ALLEY_X = -26;
const WARD_STREET_Z = -22;
const WARD_HALF_EXTENT = 26;
const WARD_PLAZA: THREE.Vector3Tuple = [-18, 0, 0];

interface WardStreetJunctions {
  north: THREE.Vector3;
  south: THREE.Vector3;
  west: THREE.Vector3;
  east: THREE.Vector3;
}

function variateCottage(base: CottageSpec, random: Random, index: number): CottageSpec {
  const row = Math.floor(index / 4);
  return {
    ...base,
    x: -11 + (index % 4) * 10 + randomRange(random, -0.6, 0.6),
    z: -10 + row * 16 + randomRange(random, -0.5, 0.5),
    yaw: (row === 2 ? Math.PI : 0) + randomRange(random, -0.025, 0.025),
    roofColor: pick(random, EXPANSION_ROOF_COLORS),
    floors: random() < 0.35 ? (base.floors === 2 ? 1 : 2) : base.floors,
    width: base.width * randomRange(random, 0.88, 1),
  };
}

/** Narrow cobbled street made of a handful of bent box segments, not per-stone geometry. */
function buildStreetPath(kit: Kit, builder: Builder, points: ReadonlyArray<readonly [number, number]>, width: number): void {
  const { materials, random } = builder;
  for (let index = 0; index < points.length - 1; index++) {
    const [x0, z0] = points[index];
    const [x1, z1] = points[index + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const tint = new THREE.Color("#8b816d").offsetHSL(0, 0, randomRange(random, -0.04, 0.03));
    kit.box([length + width * 0.4, 0.08, width], [(x0 + x1) / 2, 0.04, (z0 + z1) / 2], materials.ground, tint, [0, yaw, 0]);
  }
}

/** Boundary alley/street pair plus short links into the local plaza, kept clear of every cottage. */
function buildWardStreets(kit: Kit, builder: Builder): WardStreetJunctions {
  const { random } = builder;
  const alleyBend = randomRange(random, -2, 2);
  buildStreetPath(
    kit,
    builder,
    [
      [WARD_ALLEY_X, -WARD_HALF_EXTENT],
      [WARD_ALLEY_X + alleyBend, -WARD_HALF_EXTENT / 3],
      [WARD_ALLEY_X, WARD_HALF_EXTENT / 3],
      [WARD_ALLEY_X - alleyBend, WARD_HALF_EXTENT],
    ],
    3.2,
  );
  const streetBend = randomRange(random, -2, 2);
  buildStreetPath(
    kit,
    builder,
    [
      [-WARD_HALF_EXTENT, WARD_STREET_Z],
      [-WARD_HALF_EXTENT / 3, WARD_STREET_Z + streetBend],
      [WARD_HALF_EXTENT / 3, WARD_STREET_Z],
      [WARD_HALF_EXTENT, WARD_STREET_Z + streetBend],
    ],
    3.6,
  );
  buildStreetPath(
    kit,
    builder,
    [
      [WARD_ALLEY_X, WARD_PLAZA[2]],
      [(WARD_ALLEY_X + WARD_PLAZA[0]) / 2, WARD_PLAZA[2] + randomRange(random, -1, 1)],
      [WARD_PLAZA[0], WARD_PLAZA[2]],
    ],
    2.6,
  );
  buildStreetPath(
    kit,
    builder,
    [
      [WARD_PLAZA[0], WARD_PLAZA[2]],
      [WARD_PLAZA[0] + randomRange(random, -1, 1), WARD_STREET_Z / 2],
      [WARD_PLAZA[0], WARD_STREET_Z],
    ],
    2.4,
  );
  return {
    north: kit.toWorld([WARD_ALLEY_X, 0, -WARD_HALF_EXTENT]),
    south: kit.toWorld([WARD_ALLEY_X - alleyBend, 0, WARD_HALF_EXTENT]),
    west: kit.toWorld([-WARD_HALF_EXTENT, 0, WARD_STREET_Z]),
    east: kit.toWorld([WARD_HALF_EXTENT, 0, WARD_STREET_Z + streetBend]),
  };
}

/** A small, varied square (never a windmill/fountain clone) at the plaza node. */
function buildWardPlaza(kit: Kit, builder: Builder, seed: number): void {
  const { random } = builder;
  const [px, , pz] = WARD_PLAZA;
  switch (seed % 3) {
    case 0:
      buildPlanter(kit, builder, [px - 1.6, 0, pz + 1.8]);
      buildPlanter(kit, builder, [px + 1.4, 0, pz - 1.6]);
      buildBench(kit, builder, [px, 0, pz + 2.6], 0);
      break;
    case 1:
      buildMarketStall(kit, builder, [px - 0.4, 0, pz + 0.8], 0.4, pick(random, BUNTING));
      buildBench(kit, builder, [px + 1.8, 0, pz - 1.6], -Math.PI / 2);
      break;
    default:
      buildBench(kit, builder, [px, 0, pz + 2.2], 0);
      buildBench(kit, builder, [px, 0, pz - 2.2], Math.PI);
      buildPlanter(kit, builder, [px + 1.6, 0, pz]);
  }
}

/** Secondary roofs stay texture-based so the larger town shares the existing material batches. */
export function buildTownExpansion(kit: Kit, materials: Materials): { smoke: THREE.Vector3[] } {
  const smoke: THREE.Vector3[] = [];
  const streetNodes: Array<{ x: number; z: number; junctions: WardStreetJunctions }> = [];
  for (const district of TOWN_DISTRICTS) {
    const random = createRandom(district.seed);
    const builder: Builder = { materials, random, smoke };
    const ward = kit.within([district.x, MECH_DECK_HEIGHT, district.z], [0, district.yaw, 0]);
    const primary = district.x === SETTLEMENT_X && district.z === SETTLEMENT_Z;
    if (!primary) {
      for (const [index, spec] of COTTAGES.entries()) buildCottage(ward, builder, variateCottage(spec, random, index), "low");
      buildStreetPath(ward, builder, [[-18, 0], [26, 0]], 2.6);
      buildStreetPath(ward, builder, [[-26, 14], [26, 14]], 2.8);
      buildWardPlaza(ward, builder, district.seed);
    }
    streetNodes.push({ x: district.x, z: district.z, junctions: buildWardStreets(ward, builder) });
    if (primary) buildStreetPath(ward, builder, [[-18, 0], [6, 3]], 2.6);
  }
  const streetKit = kit.within([0, MECH_DECK_HEIGHT, 0]);
  const builder: Builder = { materials, random: createRandom(12941), smoke };
  for (const node of streetNodes) {
    let east: typeof node | undefined;
    let south: typeof node | undefined;
    for (const candidate of streetNodes) {
      if (candidate.z === node.z && candidate.x > node.x && (!east || candidate.x < east.x)) east = candidate;
      if (candidate.x === node.x && candidate.z > node.z && (!south || candidate.z < south.z)) south = candidate;
    }
    if (east) buildStreetPath(streetKit, builder, [[node.junctions.east.x, node.junctions.east.z], [east.junctions.west.x, east.junctions.west.z]], 3.6);
    if (south) buildStreetPath(streetKit, builder, [[node.junctions.south.x, node.junctions.south.z], [south.junctions.north.x, south.junctions.north.z]], 3.2);
  }
  return { smoke };
}
