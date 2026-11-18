import * as THREE from "three";
import { GeometryBatch, Kit, compose, toWorld } from "./batch";
import type { SceneMaterials } from "./materials";
import type { MechRuin } from "./mech";
import { createRandom, pick, type Random } from "./noise";
import { POND, PATHS, groundClearings, groundHeight } from "./terrain";

const BEAM = "#6a4a32";
const BOARD = "#9c7a56";
const PLANK = "#b48d63";
const DOOR = "#7b5536";
const STONE = "#e8e1d2";
const ROPE = "#6d5a43";
const FLOWER_COLORS = ["#e2543f", "#f2c14e", "#f4f1e8", "#d36ba6", "#8a6fd1"];
const BUNTING_COLORS = ["#c8473a", "#e8b94a", "#3f7cae", "#f1ead8", "#5f9d58"];
const SHUTTER_COLORS = ["#3f6e8c", "#5e8a45", "#a8432f", "#c99a33", "#6f5a8f"];

type RoofStyle = "thatch" | "shingle" | "plate";
type WallStyle = "timber" | "stone" | "salvage";
type Face = "front" | "back" | "right" | "left";

interface HouseSpec {
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  floors: 1 | 2;
  roof: RoofStyle;
  roofColor: string;
  walls: WallStyle;
  chimney: boolean;
  balcony?: boolean;
}

export interface Clearing {
  x: number;
  z: number;
  radius: number;
}

export interface Village {
  smokeSources: THREE.Vector3[];
  lanternLights: THREE.Vector3[];
  /** Hull-local circles kept free of deck grass. */
  deckClearings: Clearing[];
  updaters: Array<(elapsedSeconds: number) => void>;
}

interface Builder {
  materials: SceneMaterials;
  random: Random;
  smokeSources: THREE.Vector3[];
  lanternLights: THREE.Vector3[];
}

const DECK_HOUSES: HouseSpec[] = [
  { x: 6, z: -20, yaw: 0.15, width: 8, depth: 6, floors: 2, roof: "thatch", roofColor: "#ffffff", walls: "timber", chimney: true },
  { x: -4.5, z: -21.5, yaw: -0.1, width: 6, depth: 5, floors: 1, roof: "shingle", roofColor: "#b5553c", walls: "stone", chimney: false },
  { x: 18, z: -21, yaw: 0.05, width: 7, depth: 6, floors: 2, roof: "shingle", roofColor: "#56708c", walls: "timber", chimney: true },
  { x: 32, z: -7, yaw: 1.4, width: 6, depth: 5.5, floors: 2, roof: "shingle", roofColor: "#73777c", walls: "stone", chimney: true },
  { x: 39.5, z: 7, yaw: 1.7, width: 5, depth: 5, floors: 1, roof: "plate", roofColor: "#a7b8a6", walls: "salvage", chimney: false },
  { x: 30, z: 16, yaw: -0.4, width: 7, depth: 5.5, floors: 2, roof: "thatch", roofColor: "#ffffff", walls: "timber", chimney: true },
  { x: 2, z: -7, yaw: Math.PI / 2, width: 10, depth: 6, floors: 2, roof: "shingle", roofColor: "#c46a3f", walls: "timber", chimney: true },
  { x: -18, z: 23, yaw: 0.1, width: 6, depth: 5, floors: 2, roof: "thatch", roofColor: "#f2e6cc", walls: "stone", chimney: true, balcony: true },
  { x: -28, z: -21, yaw: 0.3, width: 6, depth: 5, floors: 2, roof: "shingle", roofColor: "#5d7a4a", walls: "timber", chimney: false },
  { x: -30, z: 23, yaw: -0.05, width: 5, depth: 4.5, floors: 1, roof: "plate", roofColor: "#c9a184", walls: "salvage", chimney: true },
  { x: 22, z: 24, yaw: 0.5, width: 5, depth: 4.5, floors: 1, roof: "shingle", roofColor: "#a24a3a", walls: "stone", chimney: false },
];

function faceTransform(face: Face, along: number, y: number, width: number, depth: number): [THREE.Vector3Tuple, number] {
  switch (face) {
    case "front":
      return [[along, y, depth / 2 + 0.02], 0];
    case "back":
      return [[-along, y, -depth / 2 - 0.02], Math.PI];
    case "right":
      return [[width / 2 + 0.02, y, -along], Math.PI / 2];
    case "left":
      return [[-width / 2 - 0.02, y, along], -Math.PI / 2];
  }
}

function buildWindow(kit: Kit, builder: Builder, shutterColor: string, flowers: boolean): void {
  const { materials, random } = builder;
  kit.add(new THREE.PlaneGeometry(0.9, 1.1), materials.window, compose([0, 0, 0.03]), 0xffffff, false);
  kit.box([1.15, 0.16, 0.18], [0, 0.63, 0.06], materials.wood, BEAM);
  kit.box([1.3, 0.14, 0.32], [0, -0.62, 0.12], materials.stone, STONE);
  for (const side of [1, -1]) {
    kit.box([0.13, 1.25, 0.18], [side * 0.52, 0, 0.06], materials.wood, BEAM);
    kit.box([0.46, 1.1, 0.06], [side * 0.82, 0, 0.18], materials.plain, shutterColor, [0, side * -0.35, 0]);
  }
  if (!flowers) return;
  kit.box([1.05, 0.24, 0.3], [0, -0.8, 0.26], materials.wood, BOARD);
  for (let index = 0; index < 6; index++) {
    kit.sphere(0.1 + random() * 0.05, [-0.42 + index * 0.17, -0.6 + random() * 0.08, 0.26 + (random() - 0.5) * 0.12], materials.foliage, pick(random, FLOWER_COLORS), [1, 1, 1], 6);
  }
  kit.sphere(0.22, [0, -0.66, 0.26], materials.foliage, "#4c6d2a", [2.2, 0.6, 0.6], 8);
}

function buildTimberFrame(kit: Kit, builder: Builder, width: number, height: number, depth: number, base: number, frontSegments: number): void {
  const wood = builder.materials.wood;
  const beam = 0.22;
  for (const y of [base + beam / 2, base + 0.72, base + height - beam / 2]) {
    kit.box([width + 0.06, beam, beam], [0, y, depth / 2], wood, BEAM);
    kit.box([width + 0.06, beam, beam], [0, y, -depth / 2], wood, BEAM);
    kit.box([beam, beam, depth + 0.06], [width / 2, y, 0], wood, BEAM);
    kit.box([beam, beam, depth + 0.06], [-width / 2, y, 0], wood, BEAM);
  }
  for (let post = 0; post <= frontSegments; post++) {
    const x = -width / 2 + (post / frontSegments) * width;
    kit.box([beam, height, beam], [x, base + height / 2, depth / 2], wood, BEAM);
    kit.box([beam, height, beam], [x, base + height / 2, -depth / 2], wood, BEAM);
  }
  for (const side of [1, -1]) {
    kit.box([beam, height, beam], [side * width / 2, base + height / 2, 0], wood, BEAM);
    for (const sign of [1, -1]) {
      kit.bar(
        new THREE.Vector3(side * width / 2, base + 0.2, sign * depth * 0.42),
        new THREE.Vector3(side * width / 2, base + height - 0.2, sign * depth * 0.08),
        beam,
        beam,
        wood,
        BEAM,
      );
    }
  }
}

function buildLantern(kit: Kit, builder: Builder, position: THREE.Vector3Tuple, light: boolean): void {
  const [x, y, z] = position;
  kit.box([0.34, 0.08, 0.34], [x, y + 0.26, z], builder.materials.plain, "#2b2622");
  kit.sphere(0.17, [x, y, z], builder.materials.lanternGlow, 0xffffff, [1, 1.3, 1], 10);
  if (light) builder.lanternLights.push(kit.toWorld(position));
}

function buildRoof(kit: Kit, builder: Builder, spec: HouseSpec, wallTop: number, width: number, depth: number): number {
  const { materials } = builder;
  const overhang = 0.5;
  const roofLength = width + overhang * 2;
  if (spec.roof === "plate") {
    const halfAngle = 0.95;
    const radius = (depth / 2 + overhang) / Math.sin(halfAngle);
    const geometry = new THREE.CylinderGeometry(radius, radius, roofLength, 18, 1, false, Math.PI / 2 - halfAngle, halfAngle * 2);
    geometry.rotateZ(Math.PI / 2);
    const centerY = wallTop + 0.15 - radius * Math.cos(halfAngle);
    kit.add(geometry, materials.steel, compose([0, centerY, 0]), spec.roofColor);
    for (let rib = 0; rib < 4; rib++) {
      const ribGeometry = new THREE.TorusGeometry(radius + 0.08, 0.1, 6, 18, halfAngle * 2);
      ribGeometry.rotateZ(Math.PI / 2 - halfAngle);
      ribGeometry.rotateY(Math.PI / 2);
      kit.add(ribGeometry, materials.steel, compose([-width / 2 + (rib + 0.5) * (width / 4), centerY, 0]), "#5c5e59");
    }
    return centerY + radius;
  }
  const thatch = spec.roof === "thatch";
  const pitch = thatch ? 0.82 : 0.62;
  const thickness = thatch ? 0.55 : 0.22;
  const halfSpan = depth / 2 + overhang;
  const slope = halfSpan / Math.cos(pitch);
  const drop = overhang * Math.tan(pitch);
  const rise = halfSpan * Math.tan(pitch);
  const material = thatch ? materials.thatch : materials.shingle;
  for (const side of [1, -1]) {
    const geometry = new THREE.BoxGeometry(roofLength, thickness, slope + 0.2);
    const uvs = geometry.getAttribute("uv");
    for (let index = 0; index < uvs.count; index++) {
      uvs.setXY(index, uvs.getX(index) * (roofLength / 4), uvs.getY(index) * (slope / 4));
    }
    const centerY = wallTop - drop + rise / 2 + thickness / 2;
    kit.add(geometry, material, compose([0, centerY, (side * halfSpan) / 2], [side * pitch, 0, 0]), spec.roofColor);
  }
  const ridgeY = wallTop - drop + rise + thickness * 0.6;
  if (thatch) {
    kit.add(new THREE.CylinderGeometry(0.45, 0.45, roofLength + 0.1, 10).rotateZ(Math.PI / 2), materials.thatch, compose([0, ridgeY - 0.1, 0]), "#c9b07a");
  } else {
    kit.box([roofLength + 0.1, 0.24, 0.42], [0, ridgeY, 0], materials.plain, "#4a3f37");
  }
  const gableRise = (depth / 2) * Math.tan(pitch);
  const gable = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, gableRise)]);
  for (const side of [1, -1]) {
    const geometry = new THREE.ExtrudeGeometry(gable, { depth: 0.2, bevelEnabled: false });
    geometry.translate(0, 0, -0.1);
    geometry.rotateY(Math.PI / 2);
    kit.add(geometry, materials.wood, compose([(side * (width - 0.1)) / 2, wallTop, 0]), BOARD);
  }
  return ridgeY;
}

function buildHouse(kit: Kit, builder: Builder, spec: HouseSpec): void {
  const { materials, random } = builder;
  const house = kit.within([spec.x, 0, spec.z], [0, spec.yaw, 0]);
  const { width, depth } = spec;
  const base = 0.8;
  const shutterColor = pick(random, SHUTTER_COLORS);
  house.box([width + 0.6, base, depth + 0.6], [0, base / 2, 0], materials.stone, STONE);
  const lowerMaterial = spec.walls === "stone" ? materials.stone : spec.walls === "salvage" ? materials.steel : materials.plaster;
  const lowerTint = spec.walls === "salvage" ? "#b4b8ad" : spec.walls === "stone" ? STONE : 0xffffff;
  house.box([width, 3, depth], [0, base + 1.5, 0], lowerMaterial, lowerTint);
  const segments = Math.max(1, Math.round(width / 2.6));
  if (spec.walls === "timber") buildTimberFrame(house, builder, width, 3, depth, base, segments);
  if (spec.walls === "salvage") {
    for (let rib = 0; rib <= segments; rib++) {
      const x = -width / 2 + (rib / segments) * width;
      house.box([0.3, 3, depth + 0.12], [x, base + 1.5, 0], materials.steel, "#7b7e78");
    }
  }

  const floorLevels: Array<{ y: number; width: number; depth: number }> = [{ y: base + 1.75, width, depth }];
  let wallTop = base + 3;
  let roofWidth = width;
  let roofDepth = depth;
  if (spec.floors === 2) {
    roofWidth = width + 0.5;
    roofDepth = depth + 0.5;
    house.box([roofWidth + 0.2, 0.3, roofDepth + 0.2], [0, wallTop + 0.1, 0], materials.wood, BEAM);
    const upperMaterial = spec.walls === "salvage" ? materials.steel : materials.plaster;
    house.box([roofWidth, 2.8, roofDepth], [0, wallTop + 1.5, 0], upperMaterial);
    if (spec.walls !== "salvage") buildTimberFrame(house, builder, roofWidth, 2.8, roofDepth, wallTop + 0.1, segments);
    floorLevels.push({ y: wallTop + 1.75, width: roofWidth, depth: roofDepth });
    wallTop += 2.9;
  }

  const doorAlong = segments > 1 ? -width / 2 + width / segments / 2 : 0;
  floorLevels.forEach((level, floorIndex) => {
    for (const face of ["front", "back"] as const) {
      for (let segment = 0; segment < segments; segment++) {
        const along = -level.width / 2 + (segment + 0.5) * (level.width / segments);
        if (floorIndex === 0 && face === "front" && Math.abs(along - doorAlong) < 0.5) continue;
        const [position, rotationY] = faceTransform(face, along, level.y, level.width, level.depth);
        buildWindow(house.within(position, [0, rotationY, 0]), builder, shutterColor, floorIndex === 1 && random() < 0.6);
      }
    }
    if (level.depth >= 4.5) {
      for (const face of ["left", "right"] as const) {
        const [position, rotationY] = faceTransform(face, 0, level.y, level.width, level.depth);
        buildWindow(house.within(position, [0, rotationY, 0]), builder, shutterColor, false);
      }
    }
  });

  const doorFront = depth / 2;
  house.box([1.2, 2.2, 0.16], [doorAlong, base + 1.1, doorFront + 0.04], materials.wood, DOOR);
  house.box([1.6, 0.3, 0.3], [doorAlong, base + 2.35, doorFront + 0.08], materials.wood, BEAM);
  house.box([1.6, 0.4, 0.9], [doorAlong, base - 0.2, doorFront + 0.7], materials.stone, STONE);
  buildLantern(house, builder, [doorAlong + 1.0, base + 2.5, doorFront + 0.3], random() < 0.35);

  if (spec.balcony && spec.floors === 2) {
    const deckY = base + 3.1;
    house.box([roofWidth - 1, 0.18, 1.8], [0, deckY, roofDepth / 2 + 0.9], materials.wood, PLANK);
    for (let post = 0; post <= 4; post++) {
      const x = -(roofWidth - 1) / 2 + (post / 4) * (roofWidth - 1);
      house.box([0.12, 1, 0.12], [x, deckY + 0.5, roofDepth / 2 + 1.75], materials.wood, BEAM);
      house.bar(new THREE.Vector3(x, deckY - 0.1, roofDepth / 2 + 1.7), new THREE.Vector3(x, deckY - 1.6, roofDepth / 2), 0.14, 0.14, materials.wood, BEAM);
    }
    house.box([roofWidth - 0.9, 0.1, 0.1], [0, deckY + 1, roofDepth / 2 + 1.75], materials.wood, BEAM);
    for (let pot = 0; pot < 4; pot++) {
      house.sphere(0.28, [-1.5 + pot, deckY + 0.3, roofDepth / 2 + 1.5], materials.foliage, pick(random, ["#3f6a24", "#5c7f2c"]), [1, 0.8, 1], 8);
    }
  }

  const ridgeY = buildRoof(house, builder, spec, wallTop, roofWidth, roofDepth);
  if (spec.chimney) {
    const chimneyX = roofWidth / 2 - 0.9;
    const chimneyZ = -roofDepth / 4;
    const top = ridgeY + 1.1;
    house.box([0.9, top - wallTop + 0.5, 0.9], [chimneyX, (top + wallTop - 0.5) / 2, chimneyZ], materials.stone, "#d8cdb8");
    house.box([1.1, 0.2, 1.1], [chimneyX, top, chimneyZ], materials.stone, "#bdb3a2");
    builder.smokeSources.push(house.toWorld([chimneyX, top + 0.4, chimneyZ]));
  }
}

function buildMarketStall(kit: Kit, builder: Builder, stripe: string): void {
  const { materials, random } = builder;
  for (const [x, z] of [
    [-1.4, -0.9],
    [1.4, -0.9],
    [-1.4, 0.9],
    [1.4, 0.9],
  ]) {
    kit.box([0.14, 2.6, 0.14], [x, 1.3, z], materials.wood, BEAM);
  }
  kit.box([3, 0.9, 1.1], [0, 0.45, 0.4], materials.wood, BOARD);
  for (let index = 0; index < 6; index++) {
    const color = index % 2 === 0 ? stripe : "#f0e6d0";
    kit.box([0.52, 0.06, 2.4], [-1.3 + index * 0.52, 2.75, 0.05], materials.cloth, color, [0.22, 0, 0]);
  }
  for (let index = 0; index < 8; index++) {
    kit.sphere(0.13, [-1.1 + (index % 4) * 0.7, 0.98, 0.25 + Math.floor(index / 4) * 0.35], materials.foliage, pick(random, ["#d9542e", "#e6b03a", "#7aa33b", "#b23a3a"]), [1, 1, 1], 8);
  }
  kit.box([0.7, 0.6, 0.6], [1.9, 0.3, 0.8], materials.wood, PLANK, [0, 0.3, 0]);
}

function buildWell(kit: Kit, builder: Builder): void {
  const { materials } = builder;
  kit.cylinder(1.25, 1.35, 1, [0, 0.5, 0], materials.stone, STONE, [0, 0, 0], 20);
  kit.cylinder(0.95, 0.95, 0.06, [0, 0.98, 0], materials.plain, "#1a2a2c", [0, 0, 0], 20);
  for (const side of [1, -1]) kit.box([0.18, 2.4, 0.18], [side * 1.15, 1.6, 0], materials.wood, BEAM);
  kit.beam(new THREE.Vector3(-1.3, 2.2, 0), new THREE.Vector3(1.3, 2.2, 0), 0.1, materials.wood, BEAM, 8);
  for (const side of [1, -1]) {
    kit.box([3, 0.12, 1.3], [0, 2.95, side * 0.55], materials.shingle, "#8a4a3a", [side * 0.6, 0, 0]);
  }
  kit.box([0.4, 0.4, 0.4], [0, 1.6, 0], materials.wood, PLANK);
}

function buildCrates(kit: Kit, builder: Builder, count: number): void {
  const { materials, random } = builder;
  for (let index = 0; index < count; index++) {
    const x = (random() - 0.5) * 2.4;
    const z = (random() - 0.5) * 2.4;
    if (random() < 0.5) {
      const size = 0.6 + random() * 0.4;
      kit.box([size, size, size], [x, size / 2, z], materials.wood, PLANK, [0, random() * 2, 0]);
    } else {
      kit.cylinder(0.38, 0.34, 0.95, [x, 0.48, z], materials.wood, BOARD, [0, 0, 0], 12);
      kit.cylinder(0.4, 0.4, 0.06, [x, 0.75, z], materials.plain, "#3a3532", [0, 0, 0], 12);
      kit.cylinder(0.4, 0.4, 0.06, [x, 0.2, z], materials.plain, "#3a3532", [0, 0, 0], 12);
    }
  }
}

function buildGardenBed(kit: Kit, builder: Builder, width: number, depth: number): void {
  const { materials, random } = builder;
  kit.box([width, 0.5, depth], [0, 0.25, 0], materials.wood, BOARD);
  kit.box([width - 0.3, 0.1, depth - 0.3], [0, 0.52, 0], materials.plain, "#4a3626");
  const rows = Math.floor(depth / 0.9);
  for (let row = 0; row < rows; row++) {
    const z = -depth / 2 + 0.6 + row * 0.9;
    const crop = pick(random, ["#5f8f2e", "#7ea83a", "#3f6d2a"]);
    for (let x = -width / 2 + 0.5; x < width / 2 - 0.3; x += 0.6) {
      kit.sphere(0.26 + random() * 0.1, [x, 0.7, z], materials.foliage, crop, [1, 0.75, 1], 7);
    }
  }
}

/** Points along a sagging rope between two frame-space points. */
function catenary(start: THREE.Vector3, end: THREE.Vector3, sag: number, count: number): THREE.Vector3[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const point = start.clone().lerp(end, t);
    point.y -= sag * 4 * t * (1 - t);
    return point;
  });
}

function buildRope(kit: Kit, builder: Builder, points: THREE.Vector3[], radius = 0.04): void {
  const curve = new THREE.CatmullRomCurve3(points);
  kit.add(new THREE.TubeGeometry(curve, points.length * 2, radius, 5), builder.materials.plain, new THREE.Matrix4(), ROPE, false);
}

function buildFestoon(kit: Kit, builder: Builder, start: THREE.Vector3, end: THREE.Vector3, lanterns: boolean): void {
  const { materials, random } = builder;
  const length = start.distanceTo(end);
  const points = catenary(start, end, length * 0.08, Math.max(6, Math.round(length)));
  buildRope(kit, builder, points);
  const curve = new THREE.CatmullRomCurve3(points);
  const count = Math.round(length / (lanterns ? 1.6 : 0.7));
  for (let index = 1; index < count; index++) {
    const point = curve.getPointAt(index / count);
    if (lanterns) {
      kit.sphere(0.16, [point.x, point.y - 0.22, point.z], materials.lanternGlow, 0xffffff, [1, 1.25, 1], 8);
      continue;
    }
    const tangent = curve.getTangentAt(index / count);
    const flag = new THREE.BufferGeometry();
    flag.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.5, 0], 3),
    );
    flag.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    flag.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const yaw = Math.atan2(-tangent.z, tangent.x);
    kit.add(flag, materials.cloth, compose(point.toArray(), [random() * 0.3, yaw, 0]), pick(random, BUNTING_COLORS), false);
  }
}

function buildLaundry(kit: Kit, builder: Builder, start: THREE.Vector3, end: THREE.Vector3): void {
  const { materials, random } = builder;
  const points = catenary(start, end, 0.4, 8);
  buildRope(kit, builder, points, 0.025);
  const curve = new THREE.CatmullRomCurve3(points);
  for (let index = 1; index < 6; index++) {
    const point = curve.getPointAt(index / 6);
    const tangent = curve.getTangentAt(index / 6);
    const width = 0.5 + random() * 0.4;
    const height = 0.6 + random() * 0.5;
    const yaw = Math.atan2(-tangent.z, tangent.x);
    kit.add(new THREE.PlaneGeometry(width, height), materials.cloth, compose([point.x, point.y - height / 2, point.z], [0, yaw, 0]), pick(random, ["#f1ead8", "#c8473a", "#6c8fb8", "#e8d27a"]), false);
  }
}

function buildWindmill(kit: Kit, builder: Builder, ruin: MechRuin): (elapsedSeconds: number) => void {
  const { materials } = builder;
  const [roofX, roofY, roofZ] = ruin.turretRoof;
  const mill = kit.withFrame(ruin.turret).within([roofX, roofY, roofZ]);
  mill.cylinder(2.3, 3.1, 7, [0, 3.5, 0], materials.plaster, 0xffffff, [0, 0, 0], 8);
  mill.cylinder(3.3, 3.3, 0.4, [0, 0.2, 0], materials.stone, STONE, [0, 0, 0], 8);
  mill.cylinder(2.7, 2.7, 0.3, [0, 7.1, 0], materials.wood, BEAM, [0, 0, 0], 8);
  mill.cylinder(0.3, 2.9, 2.8, [0, 8.6, 0], materials.shingle, "#8f4436", [0, 0, 0], 8);
  mill.box([1, 1.9, 0.12], [0, 1.1, 3.0], materials.wood, DOOR, [-0.12, 0, 0]);
  for (const angle of [0.9, 2.6, 4.2]) {
    const position: THREE.Vector3Tuple = [Math.sin(angle) * 2.62, 4.6, Math.cos(angle) * 2.62];
    buildWindow(mill.within(position, [0, angle, 0]), builder, "#5e8a45", false);
  }
  mill.beam(new THREE.Vector3(1.2, 7.6, 0), new THREE.Vector3(3.6, 7.6, 0), 0.3, materials.wood, BEAM, 8);
  buildLantern(mill, builder, [0, 7.0, 3.0], false);

  const sails = new THREE.Group();
  sails.position.set(roofX + 3.7, roofY + 7.6, roofZ);
  ruin.turret.add(sails);
  const sailBatch = new GeometryBatch();
  const spar = materials.plain;
  sailBatch.add(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 10).rotateZ(Math.PI / 2), spar, new THREE.Matrix4(), "#4b3524");
  for (let arm = 0; arm < 4; arm++) {
    const armRotation = new THREE.Matrix4().makeRotationX((arm * Math.PI) / 2);
    sailBatch.add(new THREE.BoxGeometry(0.2, 8.4, 0.24), spar, armRotation.clone().multiply(compose([0.1, 4.2, 0])), "#5a3e29");
    sailBatch.add(new THREE.BoxGeometry(0.06, 6.4, 1.5), materials.cloth, armRotation.clone().multiply(compose([0.2, 4.9, 0.85])), "#efe4c8");
    for (let rung = 0; rung < 7; rung++) {
      sailBatch.add(new THREE.BoxGeometry(0.1, 0.08, 1.7), spar, armRotation.clone().multiply(compose([0.24, 1.9 + rung * 1, 0.8])), "#5a3e29");
    }
  }
  sailBatch.build(sails);
  return (elapsedSeconds) => {
    sails.rotation.x = elapsedSeconds * 0.55;
  };
}

function buildBarrelWalk(kit: Kit, builder: Builder, ruin: MechRuin): void {
  const { materials } = builder;
  const barrel = kit.withFrame(ruin.intactBarrel);
  const length = ruin.intactBarrelLength;
  const surface = (x: number): number => (x < 10 ? 3.1 : x > length - 17 && x < length - 11 ? 2.95 : 2.3);
  for (let x = -0.4; x < length - 11; x += 0.5) {
    barrel.box([0.38, 0.12, 1.7], [x, surface(x) + 0.08, 0], materials.wood, PLANK, [0, 0, 0]);
  }
  const posts: THREE.Vector3[][] = [[], []];
  for (let x = 0; x < length - 11; x += 3) {
    for (const [index, side] of [1, -1].entries()) {
      const bottom = new THREE.Vector3(x, surface(x) + 0.1, side * 0.82);
      const top = bottom.clone().add(new THREE.Vector3(0, 1.05, 0));
      barrel.bar(bottom, top, 0.1, 0.1, materials.wood, BEAM);
      posts[index].push(top);
    }
  }
  for (const line of posts) buildRope(barrel, builder, line, 0.035);
  for (const x of [12, 24, 34]) {
    barrel.beam(new THREE.Vector3(x - 0.15, 0, 0), new THREE.Vector3(x + 0.15, 0, 0), 2.4, materials.plain, ROPE, 20);
  }

  const elevation = ruin.intactBarrel.rotation.z;
  const hut = barrel.within([length - 8.5, 0, 0], [0, 0, -elevation]);
  hut.box([5.6, 0.3, 5.6], [0, 3.3, 0], materials.wood, PLANK);
  for (const [x, z] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ]) {
    hut.box([0.22, 3.4, 0.22], [x, 1.7, z], materials.wood, BEAM);
    hut.box([0.12, 1.1, 0.12], [x, 4.0, z], materials.wood, BEAM);
  }
  for (const side of [1, -1]) {
    hut.box([5.4, 0.1, 0.1], [0, 4.5, side * 2.5], materials.wood, BEAM);
    hut.box([0.1, 0.1, 5.4], [side * 2.5, 4.5, 0], materials.wood, BEAM);
  }
  hut.box([3, 2.4, 3], [-0.6, 4.65, 0], materials.plaster);
  buildWindow(hut.within([0.92, 4.8, 0], [0, Math.PI / 2, 0]), builder, "#a8432f", false);
  hut.box([0.9, 1.9, 0.1], [-0.6, 4.4, 1.52], materials.wood, DOOR);
  const cap = new THREE.CylinderGeometry(0, 2.75, 2.2, 4).rotateY(Math.PI / 4);
  hut.add(cap, materials.shingle, compose([-0.6, 6.95, 0]), "#b5553c");
  hut.beam(new THREE.Vector3(-0.6, 7.8, 0), new THREE.Vector3(-0.6, 11.5, 0), 0.07, materials.wood, BEAM, 6);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.9, 0, 2.2, -0.45, 0], 3));
  pennant.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  pennant.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5], 2));
  hut.add(pennant, materials.cloth, compose([-0.6, 11.4, 0], [0, 0.3, 0]), "#c8473a");
  buildLantern(hut, builder, [2.3, 4.9, 2.3], true);
  buildLantern(hut, builder, [-2.3, 4.9, -2.3], false);
  const mast = new THREE.Vector3(-0.6, 9, 0);
  buildFestoon(hut, builder, mast, new THREE.Vector3(2.6, 4.6, -2.6), false);

  const turret = kit.withFrame(ruin.turret);
  for (let rung = 0; rung < 24; rung++) {
    turret.box([0.12, 0.1, 1.2], [18.6, 0.4 + rung * 0.5, 13.4], materials.wood, BEAM);
  }
  for (const side of [1, -1]) {
    turret.box([0.18, 12.4, 0.18], [18.6, 6.2, 13.4 + side * 0.65], materials.wood, BEAM);
  }
  turret.bar(new THREE.Vector3(18.6, 12.3, 13.4), new THREE.Vector3(18.6, 10.6, 6.6), 1.4, 0.15, materials.wood, PLANK);
}

function buildCraneLift(kit: Kit, builder: Builder, ruin: MechRuin, root: THREE.Object3D): (elapsedSeconds: number) => void {
  const { materials } = builder;
  const deck = kit.withFrame(ruin.hull);
  const left = new THREE.Vector3(-8, 0, 26);
  const right = new THREE.Vector3(-4, 0, 26);
  const apex = new THREE.Vector3(-6, 7, 28);
  deck.bar(left, apex, 0.35, 0.35, materials.wood, BEAM);
  deck.bar(right, apex, 0.35, 0.35, materials.wood, BEAM);
  const boomEnd = new THREE.Vector3(-6, 7.4, 36);
  deck.bar(new THREE.Vector3(-6, 0.4, 24.5), boomEnd, 0.4, 0.4, materials.wood, BOARD);
  deck.bar(apex, new THREE.Vector3(-6, 0.3, 22), 0.08, 0.08, materials.plain, ROPE);
  deck.cylinder(0.6, 0.6, 1.6, [-6, 1.2, 24.6], materials.wood, BOARD, [0, 0, Math.PI / 2], 12);
  deck.cylinder(0.25, 0.25, 0.4, [-6, 7.2, 35.8], materials.plain, "#2b2622", [0, 0, Math.PI / 2], 10);

  const pulley = toWorld(ruin.hull, boomEnd.toArray());
  const bottomY = groundHeight(pulley.x, pulley.z) + 0.05;
  const topY = toWorld(ruin.hull, [-6, 0.6, 33]).y;
  const basket = new THREE.Group();
  root.add(basket);
  const basketBatch = new GeometryBatch();
  basketBatch.add(new THREE.BoxGeometry(2, 0.15, 2), materials.wood, compose([0, 0.08, 0]), PLANK);
  for (const side of [1, -1]) {
    basketBatch.add(new THREE.BoxGeometry(2, 0.8, 0.1), materials.wood, compose([0, 0.5, side]), BOARD);
    basketBatch.add(new THREE.BoxGeometry(0.1, 0.8, 2), materials.wood, compose([side, 0.5, 0]), BOARD);
  }
  basketBatch.add(new THREE.BoxGeometry(0.7, 0.6, 0.7), materials.wood, compose([0.3, 0.45, -0.3]), PLANK);
  basketBatch.add(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10), materials.wood, compose([-0.5, 0.55, 0.4]), BOARD);
  basketBatch.build(basket);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: ROPE }));
  rope.position.copy(pulley);
  root.add(rope);
  return (elapsedSeconds) => {
    const cycle = (Math.sin(elapsedSeconds * 0.12) + 1) / 2;
    const eased = cycle * cycle * (3 - 2 * cycle);
    const y = bottomY + (topY - 2 - bottomY) * eased;
    basket.position.set(pulley.x, y, pulley.z);
    rope.scale.y = Math.max(0.1, pulley.y - y - 0.9);
  };
}

function buildStairTower(kit: Kit, builder: Builder, ruin: MechRuin): void {
  const { materials } = builder;
  const center = new THREE.Vector3(57, 0, 21);
  const groundY = groundHeight(center.x, center.z) - 0.4;
  const landing = toWorld(ruin.hull, [42, 0.1, 18]);
  const height = landing.y - groundY;
  const tower = kit.within([center.x, groundY, center.z]);
  const half = 3;
  for (const [x, z] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
  ]) {
    tower.box([0.4, height + 1.4, 0.4], [x, (height + 1.4) / 2, z], materials.wood, BEAM);
  }
  tower.box([7, 0.8, 7], [0, 0.4, 0], materials.stone, STONE);
  const flights = Math.ceil(height / 3.2);
  const rise = height / flights;
  for (let flight = 0; flight < flights; flight++) {
    const y0 = flight * rise;
    const y1 = y0 + rise;
    const forward = flight % 2 === 0;
    const z = forward ? -1.4 : 1.4;
    const startX = forward ? -2.1 : 2.1;
    const endX = -startX;
    tower.bar(new THREE.Vector3(startX, y0 + 0.2, z - 0.7), new THREE.Vector3(endX, y1, z - 0.7), 0.16, 0.3, materials.wood, BEAM);
    tower.bar(new THREE.Vector3(startX, y0 + 0.2, z + 0.7), new THREE.Vector3(endX, y1, z + 0.7), 0.16, 0.3, materials.wood, BEAM);
    const steps = 8;
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps;
      tower.box([0.36, 0.08, 1.5], [startX + (endX - startX) * t, y0 + 0.25 + rise * t, z], materials.wood, PLANK);
    }
    tower.box([1.8, 0.18, 6.2], [endX + Math.sign(endX) * 0.9, y1, 0], materials.wood, PLANK);
    const side = forward ? -half : half;
    tower.bar(new THREE.Vector3(-half, y0, side), new THREE.Vector3(half, y1, side), 0.16, 0.16, materials.wood, BEAM);
    tower.bar(new THREE.Vector3(side, y0, -half), new THREE.Vector3(side, y1, half), 0.16, 0.16, materials.wood, BEAM);
  }
  buildLantern(tower, builder, [half + 0.3, height + 1.6, half + 0.3], true);

  const bridgeStart = new THREE.Vector3(center.x - half, landing.y, center.z);
  const bridgeLength = bridgeStart.distanceTo(landing);
  const plankCount = Math.round(bridgeLength / 0.5);
  const sideways = new THREE.Vector3().subVectors(landing, bridgeStart).cross(new THREE.Vector3(0, 1, 0)).normalize();
  const railLeft: THREE.Vector3[] = [];
  const railRight: THREE.Vector3[] = [];
  for (let plank = 0; plank <= plankCount; plank++) {
    const t = plank / plankCount;
    const point = bridgeStart.clone().lerp(landing, t);
    point.y -= 0.6 * 4 * t * (1 - t);
    kit.bar(point.clone().addScaledVector(sideways, -0.8), point.clone().addScaledVector(sideways, 0.8), 0.4, 0.1, materials.wood, PLANK, Math.PI / 2);
    if (plank % 4 === 0) {
      railLeft.push(point.clone().addScaledVector(sideways, 0.85).add(new THREE.Vector3(0, 1, 0)));
      railRight.push(point.clone().addScaledVector(sideways, -0.85).add(new THREE.Vector3(0, 1, 0)));
    }
  }
  buildRope(kit, builder, railLeft, 0.04);
  buildRope(kit, builder, railRight, 0.04);
  groundClearings.push({ x: center.x, z: center.z, radius: 5 });
}

function buildBarrelBurrow(kit: Kit, builder: Builder, ruin: MechRuin): void {
  const { materials, random } = builder;
  const burrow = kit.withFrame(ruin.fallenMuzzle);
  const bore = ruin.boreRadius;
  burrow.beam(new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0.05, 0, 0), bore - 0.05, materials.wood, DOOR, 24);
  burrow.beam(new THREE.Vector3(0.05, 0, 0), new THREE.Vector3(0.12, 0, 0), 0.32, materials.plain, "#c9a23a", 12);
  for (let plank = 0; plank < 4; plank++) {
    burrow.box([0.06, bore * 1.9, 0.08], [0.1, 0, -0.9 + plank * 0.6], materials.wood, BEAM);
  }
  burrow.add(new THREE.CircleGeometry(0.42, 16).rotateY(Math.PI / 2), materials.window, compose([0.08, 0.8, 0.6]), 0xffffff, false);
  const stovePipeBase = new THREE.Vector3(-9, 2.2, 0.8);
  burrow.beam(stovePipeBase, stovePipeBase.clone().add(new THREE.Vector3(0, 3, 0)), 0.25, materials.steel, "#4a4542", 10);
  burrow.cylinder(0.45, 0.32, 0.4, [stovePipeBase.x, stovePipeBase.y + 3.1, stovePipeBase.z], materials.steel, "#4a4542", [0, 0, 0], 10);
  builder.smokeSources.push(burrow.toWorld([stovePipeBase.x, stovePipeBase.y + 3.6, stovePipeBase.z]));
  buildLantern(burrow, builder, [0.6, 2.4, -1.9], true);

  const muzzleWorld = ruin.fallenMuzzle.getWorldPosition(new THREE.Vector3());
  const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(ruin.fallenMuzzle.quaternion);
  const yaw = Math.atan2(-facing.z, facing.x);
  const porchCenter = muzzleWorld.clone().addScaledVector(facing, 2.6);
  const porch = kit.within([porchCenter.x, groundHeight(porchCenter.x, porchCenter.z), porchCenter.z], [0, yaw, 0]);
  porch.box([3.6, 0.25, 4.4], [0, 0.12, 0], materials.wood, PLANK);
  porch.box([0.5, 0.45, 1.6], [0.8, 0.45, 1.7], materials.wood, BOARD);
  porch.box([0.12, 1.3, 0.12], [1.2, 0.65, -2.6], materials.wood, BEAM);
  porch.box([0.5, 0.35, 0.3], [1.2, 1.3, -2.6], materials.plain, "#3f6e8c");
  for (let post = 0; post < 9; post++) {
    const z = -4 + post;
    porch.box([0.12, 0.9, 0.12], [3.2, 0.45, z], materials.wood, BEAM);
  }
  porch.box([0.08, 0.1, 8.2], [3.2, 0.8, 0], materials.wood, BEAM);
  porch.box([0.08, 0.1, 8.2], [3.2, 0.4, 0], materials.wood, BEAM);
  for (let plant = 0; plant < 10; plant++) {
    porch.sphere(0.3 + random() * 0.2, [2.2 + random() * 0.6, 0.35, -3.6 + plant * 0.8], materials.foliage, pick(random, ["#4f7a26", "#6a9131"]), [1, 0.8, 1], 7);
  }
  const lineStart = burrow.toWorld([-6, 2.7, 0]);
  const linePost = porchCenter.clone().addScaledVector(new THREE.Vector3(-facing.z, 0, facing.x), 6);
  linePost.y = groundHeight(linePost.x, linePost.z);
  kit.bar(linePost, linePost.clone().add(new THREE.Vector3(0, 2.8, 0)), 0.14, 0.14, materials.wood, BEAM);
  buildLaundry(kit, builder, lineStart, linePost.clone().add(new THREE.Vector3(0, 2.7, 0)));
  groundClearings.push({ x: porchCenter.x, z: porchCenter.z, radius: 4 }, { x: muzzleWorld.x - facing.x * 12, z: muzzleWorld.z - facing.z * 12, radius: 12 });
}

function buildFishingHut(kit: Kit, builder: Builder): void {
  const { materials } = builder;
  const shoreX = POND.x + 10.5;
  const shoreZ = POND.z - 7.5;
  const yaw = Math.atan2(-(POND.z - shoreZ), POND.x - shoreX) + Math.PI / 2;
  const hutY = POND.waterLevel + 1.6;
  const hut = kit.within([shoreX, hutY, shoreZ], [0, yaw, 0]);
  for (const [x, z] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [-1, 6],
    [1, 6],
    [-1, 9],
    [1, 9],
  ]) {
    hut.box([0.24, 3.4, 0.24], [x, -1.2, z], materials.wood, BEAM);
  }
  hut.box([4.6, 0.2, 4.6], [0, 0.4, 0], materials.wood, PLANK);
  hut.box([2.2, 0.15, 7], [0, 0.4, 6], materials.wood, PLANK);
  hut.box([3.6, 2.4, 3.4], [0, 1.7, -0.3], materials.wood, BOARD);
  buildWindow(hut.within([0, 1.8, 1.42], [0, 0, 0]), builder, "#3f6e8c", false);
  for (const side of [1, -1]) {
    hut.box([4.4, 0.16, 2.6], [0, 3.35, -0.3 + side * 1.0], materials.shingle, "#5f6a72", [side * 0.5, 0, 0]);
  }
  hut.beam(new THREE.Vector3(1.8, 0.5, 2.2), new THREE.Vector3(3.2, 4.4, 5.2), 0.05, materials.wood, BEAM, 5);
  buildLantern(hut, builder, [-1.9, 2.6, 1.6], true);
  buildCrates(hut.within([-1.6, 0.5, 2.6]), builder, 2);
  const boat = kit.within([POND.x + 2, POND.waterLevel + 0.15, POND.z - 1], [0, 0.7, 0]);
  boat.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), materials.wood, compose([0, 0.35, 0], [0, 0, 0], [2.1, 0.6, 0.85]), BOARD);
  boat.box([0.3, 0.1, 1.5], [0.4, 0.3, 0], materials.wood, PLANK);
  boat.bar(new THREE.Vector3(-0.6, 0.4, 0.5), new THREE.Vector3(1.6, 0.2, 1.4), 0.06, 0.06, materials.wood, BEAM);
  groundClearings.push({ x: shoreX, z: shoreZ, radius: 4 });
}

function buildFarm(kit: Kit, builder: Builder): void {
  const { materials, random } = builder;
  const farmhouse: HouseSpec = { x: -58, z: 62, yaw: 0.6, width: 8, depth: 6, floors: 1, roof: "thatch", roofColor: "#ffffff", walls: "stone", chimney: true };
  buildHouse(kit.within([0, groundHeight(-58, 62) - 0.3, 0]), builder, farmhouse);
  groundClearings.push({ x: farmhouse.x, z: farmhouse.z, radius: 6.5 });
  const fieldCenter = new THREE.Vector3(-82, 0, 58);
  const fieldYaw = 0.5;
  const rows = 14;
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < 18; step++) {
      const local = new THREE.Vector3(-17 + step * 2, 0, -13 + row * 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), fieldYaw);
      const x = fieldCenter.x + local.x;
      const z = fieldCenter.z + local.z;
      kit.sphere(0.55 + random() * 0.25, [x, groundHeight(x, z) + 0.2, z], materials.foliage, row % 4 < 2 ? "#c9a640" : "#6f9430", [1.3, 0.7, 1.3], 6);
    }
  }
  groundClearings.push({ x: fieldCenter.x, z: fieldCenter.z, radius: 20 });
  for (let stack = 0; stack < 4; stack++) {
    const x = -70 + stack * 4 + random() * 2;
    const z = 78 - stack * 1.5;
    const y = groundHeight(x, z);
    kit.cylinder(1.3, 1.5, 1.8, [x, y + 0.9, z], materials.thatch, "#ffffff", [0, 0, 0], 12);
    kit.cylinder(0.1, 1.45, 1.4, [x, y + 2.5, z], materials.thatch, "#ffffff", [0, 0, 0], 12);
  }
  const fence: THREE.Vector3[] = [];
  for (let post = 0; post <= 28; post++) {
    const local = new THREE.Vector3(-19 + post * 1.4, 0, 15.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), fieldYaw);
    const x = fieldCenter.x + local.x;
    const z = fieldCenter.z + local.z;
    const y = groundHeight(x, z);
    kit.box([0.14, 1.2, 0.14], [x, y + 0.6, z], materials.wood, BEAM);
    fence.push(new THREE.Vector3(x, y + 1, z));
  }
  buildRope(kit, builder, fence, 0.05);
}

function buildPathLanterns(kit: Kit, builder: Builder): void {
  const { materials } = builder;
  const route = PATHS[0];
  for (let index = 1; index < route.length - 2; index++) {
    const [ax, az] = route[index];
    const [bx, bz] = route[index + 1];
    const x = (ax + bx) / 2 + 2.2;
    const z = (az + bz) / 2 + 2.2;
    const y = groundHeight(x, z);
    kit.box([0.18, 2.6, 0.18], [x, y + 1.3, z], materials.wood, BEAM);
    kit.box([0.9, 0.12, 0.12], [x + 0.35, y + 2.55, z], materials.wood, BEAM);
    buildLantern(kit, builder, [x + 0.7, y + 2.2, z], index === 2);
  }
}

function buildDeckLife(kit: Kit, builder: Builder, ruin: MechRuin, clearings: Clearing[]): void {
  const deck = kit.withFrame(ruin.hull);
  for (const spec of DECK_HOUSES) {
    buildHouse(deck, builder, spec);
    clearings.push({ x: spec.x, z: spec.z, radius: Math.max(spec.width, spec.depth) / 2 + 0.9 });
  }
  const stalls: Array<[number, number, number, string]> = [
    [1, 9.5, 0.55, "#c8473a"],
    [7.5, 13.5, 0.55, "#3f7cae"],
    [15, 6, -0.3, "#5f9d58"],
  ];
  for (const [x, z, yaw, stripe] of stalls) {
    buildMarketStall(deck.within([x, 0, z], [0, yaw, 0]), builder, stripe);
    clearings.push({ x, z, radius: 2.2 });
  }
  buildWell(deck.within([11, 0, -1]), builder);
  clearings.push({ x: 11, z: -1, radius: 1.8 });
  const crateSpots: Array<[number, number]> = [
    [-2, 14],
    [36, -1],
    [24, 8],
    [-14, -14],
  ];
  for (const [x, z] of crateSpots) {
    buildCrates(deck.within([x, 0, z]), builder, 4);
    clearings.push({ x, z, radius: 1.8 });
  }
  buildGardenBed(deck.within([40, 0, -17.5], [0, -0.2, 0]), builder, 6, 3.6);
  buildGardenBed(deck.within([-12, 0, -13], [0, 0.1, 0]), builder, 6.5, 3);
  buildGardenBed(deck.within([-36, 0, 14.5], [0, 0.2, 0]), builder, 4, 2.6);
  clearings.push({ x: 40, z: -17.5, radius: 3.6 }, { x: -12, z: -13, radius: 3.6 }, { x: -36, z: 14.5, radius: 2.4 });
  clearings.push({ x: -22, z: 2, radius: 15 }, { x: -6, z: 26, radius: 3 }, { x: 42, z: 18, radius: 2.4 });

  const festoons: Array<[THREE.Vector3Tuple, THREE.Vector3Tuple, boolean]> = [
    [[5.2, 6.2, -3], [15, 3.4, 4.8], true],
    [[5.2, 6.2, -10], [17, 6.4, -17.5], false],
    [[15, 3.4, 4.8], [26.5, 6, 13], true],
    [[-1.5, 6.2, -3], [7.5, 3.3, 12.6], false],
    [[26, 6, 13], [31, 6.4, -4], false],
    [[-15, 6.4, 21], [-6, 7, 27.6], true],
  ];
  for (const [start, end, lanterns] of festoons) {
    buildFestoon(deck, builder, new THREE.Vector3(...start), new THREE.Vector3(...end), lanterns);
  }
  builder.lanternLights.push(toWorld(ruin.hull, [10, 4.4, 1]), toWorld(ruin.hull, [22, 4.8, 9]));
  buildLaundry(deck, builder, new THREE.Vector3(-25, 5.4, -19), new THREE.Vector3(-11, 4.4, -19.5));
  buildLaundry(deck, builder, new THREE.Vector3(26, 3.6, 21), new THREE.Vector3(31, 5.8, 13.5));

  const tower = deck.within([44, 0, -4], [0, Math.PI / 2, 0]);
  tower.box([4.6, 0.8, 4.6], [0, 0.4, 0], builder.materials.stone, STONE);
  tower.box([4, 8.4, 4], [0, 5, 0], builder.materials.stone, STONE);
  tower.box([4.4, 0.3, 4.4], [0, 9.3, 0], builder.materials.wood, BEAM);
  for (const [x, z] of [
    [-1.8, -1.8],
    [1.8, -1.8],
    [-1.8, 1.8],
    [1.8, 1.8],
  ]) {
    tower.box([0.36, 3, 0.36], [x, 10.9, z], builder.materials.wood, BEAM);
  }
  tower.add(new THREE.CylinderGeometry(0.55, 0.95, 1.3, 16, 1, true), builder.materials.steel, compose([0, 11.4, 0]), "#c9a24a");
  tower.box([4.6, 0.3, 4.6], [0, 12.5, 0], builder.materials.wood, BEAM);
  tower.add(new THREE.CylinderGeometry(0, 3.3, 5.5, 4).rotateY(Math.PI / 4), builder.materials.shingle, compose([0, 15.4, 0]), "#56708c");
  tower.box([1.2, 2.2, 0.14], [0, 1.9, 2.05], builder.materials.wood, DOOR);
  for (const face of ["front", "back", "left", "right"] as const) {
    const [position, rotationY] = faceTransform(face, 0, 6.2, 4, 4);
    buildWindow(tower.within(position, [0, rotationY, 0]), builder, "#3f6e8c", false);
  }
  clearings.push({ x: 44, z: -4, radius: 3.2 });
}

export function buildVillage(kit: Kit, materials: SceneMaterials, ruin: MechRuin, root: THREE.Object3D): Village {
  const builder: Builder = {
    materials,
    random: createRandom(424242),
    smokeSources: [],
    lanternLights: [],
  };
  const deckClearings: Clearing[] = [];
  buildDeckLife(kit, builder, ruin, deckClearings);
  const updaters = [buildWindmill(kit, builder, ruin), buildCraneLift(kit, builder, ruin, root)];
  buildBarrelWalk(kit, builder, ruin);
  const groundKit = kit.withFrame(root);
  buildStairTower(groundKit, builder, ruin);
  buildBarrelBurrow(groundKit, builder, ruin);
  buildFishingHut(groundKit, builder);
  buildFarm(groundKit, builder);
  buildPathLanterns(groundKit, builder);
  return {
    smokeSources: builder.smokeSources,
    lanternLights: builder.lanternLights,
    deckClearings,
    updaters,
  };
}
