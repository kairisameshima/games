import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Ocean,
  OCEAN_FOG_COLOR,
  OCEAN_FOG_DENSITY,
  OCEAN_SUN_DIRECTION,
} from "./ocean";
import {
  DECK_HEIGHTS,
  MAST_X,
  MAST_HEIGHTS,
  YARD_HEIGHTS,
  SAIL_HEIGHTS,
  type BattleEvent,
  type CrewMember,
  type SimulationState,
  type ViewMode,
} from "./types";
import {
  backboneGeometry,
  galleryFittingGeometry,
  galleryMouldingGeometry,
  galleryPanelGeometry,
  galleryPoint,
  GALLERY_WINDOW_X,
  STERN_WINDOW_HEIGHTS,
  cannonBarrelGeometry,
  cannonCarriageGeometry,
  hullFrameGeometry,
  hullMouldingGeometry,
  hullPanelGeometry,
  hullSheer,
  launchHullGeometry,
  sailSeamsGeometry,
  squareSailGeometry,
  sternFittingGeometry,
  sternMouldingGeometry,
  sternPoint,
  rudderGeometry,
  transomGeometry,
  mastTopGeometry,
  yardGeometry,
  bowClosureGeometry,
} from "./geometry";
import {
  blocksLadderApproach,
  DECK_LADDERS,
  DECK_FITTINGS,
  DESIGN_WATERLINE,
  FORECASTLE_START,
  GANGWAY_INNER_Z,
  GUN_DIMENSIONS,
  GUN_MOUNT_FORWARD,
  GUN_STATIONS,
  SQUARE_SAIL_YARDS,
  hullBowX,
  hullPlankingThickness,
  hullSternX,
  LAUNCH_OFFSET_X,
  POOP_BOUNDS,
  QUARTERDECK_END,
  hullHalfWidth,
  mastClimbPosition,
  RIGGING_LANE_X,
  RIGGING_LANE_Z,
  LAUNCH_OFFSET_Z,
  LAUNCH_RISE,
  BOAT_SKID_X,
  WORK_ROPE_OFFSET,
  RETURN_ROPE_OFFSET,
  sailTrim,
  shroudAccess,
} from "./layout";
import { CrewAnimator } from "./crew-animation";
import { buildInterior, type InteriorLight } from "./interior";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const BOWSPRIT_RAKE = 23 * DEG;
const BOWSPRIT_RISE = Math.tan(BOWSPRIT_RAKE);
const SHIP_CAMERA_MIN_DISTANCE = 5;
const CREW_CAMERA_MIN_DISTANCE = 2.5;
const CREW_FOCUS_HEIGHT = .95;
const CREW_CAMERA_OFFSET = new THREE.Vector3(1.3, .65, 3.1);
const CREW_ORBIT_SPEED = .8;

function bowspritPoint(x: number, jibboom = false): THREE.Vector3 {
  return new THREE.Vector3(x, 7.5 + (x - 25) * BOWSPRIT_RISE + (jibboom ? .46 : 0), 0);
}

interface Structure {
  mesh: THREE.Mesh;
  side: number;
  deck: number;
  shell: boolean;
  rig: boolean;
  restOnly: boolean;
  original: THREE.Material;
  ghost: THREE.Material;
}
interface Bucket {
  geometries: THREE.BufferGeometry[];
  material: THREE.MeshStandardMaterial;
  side: number;
  deck: number;
  shell: boolean;
  rig: boolean;
  restOnly: boolean;
}
interface Sail {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  rest: Float32Array;
  width: number;
  height: number;
  level: number;
  phase: number;
  pivot: THREE.Group;
  furled: THREE.Mesh;
}
interface Vessel {
  root: THREE.Group;
  structure: Structure[];
  sails: Sail[];
  staysails: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  ropes: THREE.LineSegments;
  barrels: THREE.InstancedMesh;
  carriages: Map<32 | 18 | 9, { mesh: THREE.InstancedMesh; firstId: number }>;
  flag: THREE.Mesh;
  fire: THREE.Group;
  interiorLights: InteriorLight[];
}
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  born: number;
  life: number;
  kind: "smoke" | "flash" | "splash" | "ball";
  start: THREE.Vector3;
  end: THREE.Vector3;
}

function seeded(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
function surfaceTexture(
  kind: "wood" | "canvas" | "copper",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  context.fillStyle =
    kind === "wood" ? "#968067" : kind === "canvas" ? "#dbd2ac" : "#997257";
  context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 3000; index++) {
    const x = seeded(index + 7) * 512,
      y = seeded(index + 3500) * 512;
    context.strokeStyle = `rgba(${kind === "canvas" ? "82,68,40" : kind === "copper" ? "42,83,67" : "40,23,11"},${0.02 + seeded(index + 60) * 0.12})`;
    context.lineWidth = kind === "wood" ? 0.4 : 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x +
        (kind === "wood"
          ? 40 + seeded(index) * 160
          : kind === "canvas"
            ? 7
            : 12),
      y + (kind === "wood" ? seeded(index + 10) * 2 : 1),
    );
    context.stroke();
  }
  if (kind === "wood")
    for (let y = 0; y < 512; y += 48) {
      context.strokeStyle = "#392b1c66";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(512, y);
      context.stroke();
      for (let x = y % 96 === 0 ? 0 : 120; x < 512; x += 240) {
        context.fillStyle = "#3d2d2266";
        context.fillRect(x, y, 2, 48);
        context.fillRect(x + 6, y + 5, 2, 2);
        context.fillRect(x + 6, y + 40, 2, 2);
      }
    }
  if (kind === "canvas")
    for (let x = 0; x < 512; x += 85) {
      context.fillStyle = "#82794e44";
      context.fillRect(x, 0, 2, 512);
      context.fillStyle = "#f3edce44";
      context.fillRect(x + 3, 0, 1, 512);
    }
  if (kind === "copper")
    for (let y = 0; y < 512; y += 64)
      for (let x = y % 128 === 0 ? 0 : -64; x < 512; x += 128) {
        context.strokeStyle = "#264e4255";
        context.strokeRect(x, y, 128, 64);
        context.fillStyle = "#ad9b6c";
        context.fillRect(x + 6, y + 5, 2, 2);
      }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
function material(
  color: number,
  map?: THREE.Texture,
  metalness = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map,
    roughness: metalness ? 0.45 : 0.83,
    metalness,
  });
}
function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}
function spar(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  endRadius = radius,
  sides = 8,
): THREE.BufferGeometry {
  const direction = new THREE.Vector3().subVectors(to, from);
  const geometry = new THREE.CylinderGeometry(
    endRadius,
    radius,
    direction.length(),
    sides,
  );
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
  );
  geometry.translate(
    (from.x + to.x) / 2,
    (from.y + to.y) / 2,
    (from.z + to.z) / 2,
  );
  return geometry;
}
function caskGeometry(x: number, y: number, z: number): THREE.BufferGeometry {
  const lower = new THREE.CylinderGeometry(0.36, 0.28, 0.34, 10).translate(0, -0.17, 0);
  const upper = new THREE.CylinderGeometry(0.28, 0.36, 0.34, 10).translate(0, 0.17, 0);
  const hoopLower = new THREE.TorusGeometry(0.33, 0.025, 4, 12)
    .rotateX(Math.PI / 2)
    .translate(0, -0.2, 0);
  const hoopUpper = hoopLower.clone().translate(0, 0.4, 0);
  return (mergeGeometries([lower, upper, hoopLower, hoopUpper]) as THREE.BufferGeometry).translate(
    x,
    y + 0.34,
    z,
  );
}
function deckGeometry(
  height: number,
  side: number,
  start = -30.5,
  end = 30.8,
): THREE.BufferGeometry {
  const first = Math.max(start, hullSternX(height) + .06);
  const last = Math.min(end, hullBowX(height) - .38);
  const hatches = DECK_LADDERS.filter((ladder) => Math.abs(ladder.upper.y - height) < .05);
  const gratings = DECK_FITTINGS.filter((fitting) => fitting.kind === "grating" && fitting.y === height);
  const cuts = [
    first, last, QUARTERDECK_END, FORECASTLE_START,
    ...Array.from({ length: 97 }, (_, index) => first + index / 96 * (last - first)),
    ...hatches.flatMap((ladder) => [
      Math.min(ladder.start.x, ladder.end.x) - .4,
      Math.max(ladder.start.x, ladder.end.x) + .4,
    ]),
    ...gratings.flatMap((grating) => [grating.x - grating.halfX, grating.x + grating.halfX]),
  ];
  const xCuts = [...new Set(cuts)].filter((x) => x >= first && x <= last).sort((a, b) => a - b);
  const vertices: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let index = 0; index < xCuts.length - 1; index++) {
    const x0 = xCuts[index], x1 = xCuts[index + 1], middle = (x0 + x1) / 2;
    const waist = height === 8.2 && middle > QUARTERDECK_END && middle < FORECASTLE_START;
    let strips: [number, number][] = [[waist ? GANGWAY_INNER_Z : 0, Infinity]];
    const openings: [number, number][] = [];
    for (const ladder of hatches) {
      if (middle > Math.min(ladder.start.x, ladder.end.x) - .4
        && middle < Math.max(ladder.start.x, ladder.end.x) + .4) {
        openings.push([side * ladder.start.z - ladder.halfWidth - .05, side * ladder.start.z + ladder.halfWidth + .05]);
      }
    }
    for (const grating of gratings) {
      if (Math.abs(middle - grating.x) < grating.halfX) openings.push([0, grating.halfZ]);
    }
    for (const [openingStart, openingEnd] of openings) {
      const remaining: [number, number][] = [];
      for (const [near, far] of strips) {
        if (openingEnd <= near || openingStart >= far) remaining.push([near, far]);
        else {
          if (openingStart > near) remaining.push([near, openingStart]);
          if (openingEnd < far) remaining.push([openingEnd, far]);
        }
      }
      strips = remaining;
    }
    for (const [near, far] of strips) {
      const outer0 = Math.min(far, hullHalfWidth(x0, height) - hullPlankingThickness(height));
      const outer1 = Math.min(far, hullHalfWidth(x1, height) - hullPlankingThickness(height));
      if (outer0 <= near && outer1 <= near) continue;
      const points = [
        [x0, height, side * near], [x0, height, side * Math.max(near, outer0)],
        [x1, height, side * near], [x1, height, side * Math.max(near, outer1)],
        [x0, height - .14, side * near], [x0, height - .14, side * Math.max(near, outer0)],
        [x1, height - .14, side * near], [x1, height - .14, side * Math.max(near, outer1)],
      ];
      for (const face of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
        const offset = vertices.length / 3;
        for (let corner = 0; corner < 4; corner++) {
          const point = points[face[side > 0 ? corner : 3 - corner]];
          vertices.push(point[0], point[1], point[2]);
          uv.push(point[0] / 9, point[2] / 9);
        }
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function triangularCanvas(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): THREE.BufferGeometry {
  const vertices: number[] = [],
    uv: number[] = [];
  const divisions = 16;
  for (let row = 0; row < divisions; row++)
    for (let column = 0; column < divisions - row; column++) {
      const coordinates = [
        [row, column],
        [row + 1, column],
        [row, column + 1],
      ];
      if (column < divisions - row - 1)
        coordinates.push(
          [row + 1, column],
          [row + 1, column + 1],
          [row, column + 1],
        );
      for (const [r, s] of coordinates) {
        const u = r / divisions,
          v = s / divisions,
          w = 1 - u - v;
        vertices.push(
          a.x * w + b.x * u + c.x * v,
          a.y * w + b.y * u + c.y * v,
          Math.sin(u * Math.PI) *
            Math.sin(v * Math.PI) *
            Math.sin(w * Math.PI) *
            0.8,
        );
        uv.push(u, v);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}
function buildVessel(detailed: boolean): Vessel {
  const root = new THREE.Group();
  root.name = detailed ? "HMS Resolute — 74 gun third rate" : "L’Indomptable";
  const wood = surfaceTexture("wood"),
    canvas = surfaceTexture("canvas"),
    copper = surfaceTexture("copper");
  const timber = material(0x887050, wood),
    deckWood = material(0xc8ac78, wood),
    dark = material(0x292b27, wood),
    ochre = material(0xcda452, wood),
    copperMat = material(0x8e6749, copper, 0.4),
    gold = material(0xc8a453, undefined, 0.4),
    iron = material(0x272d2c, undefined, 0.6),
    red = material(0x66392c, wood),
    glass = material(0x477478, undefined, 0.45),
    ropeMat = material(0x6b5a3c);
  glass.transparent = true;
  glass.opacity = .48;
  glass.roughness = .15;
  glass.depthWrite = false;
  const buckets = new Map<string, Bucket>();
  const add = (
    geometry: THREE.BufferGeometry,
    mat: THREE.MeshStandardMaterial,
    side = 0,
    deck = 0,
    shell = false,
    rig = false,
    restOnly = false,
  ): void => {
    if (!geometry.index) {
      const indexed = mergeVertices(geometry);
      geometry.dispose();
      geometry = indexed;
    }
    const key = `${mat.uuid}:${side}:${deck}:${shell}:${rig}:${restOnly}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { geometries: [], material: mat, side, deck, shell, rig, restOnly };
      buckets.set(key, bucket);
    }
    if (!geometry.getAttribute("uv"))
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          new Float32Array(geometry.getAttribute("position").count * 2),
          2,
        ),
      );
    bucket.geometries.push(geometry);
  };
  const lineVertices: number[] = [];
  const rope = (from: THREE.Vector3, to: THREE.Vector3): void => {
    lineVertices.push(from.x, from.y, from.z, to.x, to.y, to.z);
  };
  const v = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z);
  const ports = GUN_STATIONS.filter((station) => station.side === "port").map((station) => ({
    x: station.position.x,
    y: station.position.y + .15,
    halfWidth: station.calibre === 9 ? .53 : .68,
    deck: station.deck,
  }));
  const xCuts = Array.from(
    new Set([
      -30.5,
      30.8,
      ...Array.from({ length: 77 }, (_, i) => -30.4 + i * 0.8),
      QUARTERDECK_END, FORECASTLE_START,
      ...ports.flatMap((port) => [port.x - port.halfWidth, port.x + port.halfWidth]),
    ]),
  )
    .sort((a, b) => a - b)
    .filter((x) => x >= -30.5 && x <= 30.8);
  const yCuts = [
    -4.45, -4.25, -3.9, -3.5, -3, -2.4, -1.6, -.8, 0, .6, 1.2, 1.8, 1.95, 2.4, 2.9, 3.4, 3.55, 4.45,
    4.7, 5.2, 5.8, 5.95, 6.85, 7.1, 7.7, 8.2, 8.35, 8.85, 9.25, 9.45,
  ];
  for (const side of [-1, 1]) {
    for (let band = 0; band < yCuts.length - 1; band++) {
      const lower = yCuts[band],
        upper = yCuts[band + 1],
        middle = (lower + upper) / 2;
      const finish =
        middle < 1.95
          ? copperMat
          : (middle > 2.9 && middle < 4.7) ||
              (middle > 5.2 && middle < 7.1) ||
              middle > 8.2
            ? ochre
            : dark;
      add(
        bowClosureGeometry(side, lower, upper),
        finish,
        side,
        Math.max(1, Math.ceil((middle - 1) / 2.4)),
        true,
      );
    }
    for (let ix = 0; ix < xCuts.length - 1; ix++)
      for (let iy = 0; iy < yCuts.length - 1; iy++) {
        const x = (xCuts[ix] + xCuts[ix + 1]) / 2,
          y = (yCuts[iy] + yCuts[iy + 1]) / 2;
        if (x > QUARTERDECK_END && x < FORECASTLE_START && y > 8.85) continue;
        if (ports.some((port) => y > port.y && y < port.y + .9 && Math.abs(x - port.x) < port.halfWidth)) continue;
        const mat =
          y < 1.95
            ? copperMat
            : (y > 2.9 && y < 4.7) || (y > 5.2 && y < 7.1) || y > 8.2
              ? ochre
              : dark;
        add(
          hullPanelGeometry(
            xCuts[ix],
            xCuts[ix + 1],
            yCuts[iy],
            yCuts[iy + 1],
            side,
          ),
          mat,
          side,
          Math.max(1, Math.ceil((y - 1) / 2.4)),
          true,
        );
      }
    for (const y of [1.95, 2.8, 4.75, 5.1, 7.15, 7.7]) {
      add(
        hullMouldingGeometry(
          y,
          y === 9.45 ? 0.19 : 0.105,
          y === 9.45 ? 0.12 : 0.075,
          side,
        ),
        y === 9.45 ? dark : gold,
        side,
        Math.max(1, Math.ceil((y - 1) / 2.4)),
        true,
      );
    }
    add(hullMouldingGeometry(9.45, .19, .12, side, -30.5, QUARTERDECK_END), dark, side, 4, true);
    add(hullMouldingGeometry(8.85, .19, .12, side, QUARTERDECK_END, FORECASTLE_START), dark, side, 4, true);
    add(hullMouldingGeometry(9.45, .19, .12, side, FORECASTLE_START, 30.8), dark, side, 4, true);
    for (const y of [2.05, 2.33, 2.61])
      add(hullMouldingGeometry(y, .2, .15, side), dark, side, 1, true);
    for (const port of ports) {
      const { x, y, halfWidth, deck } = port;
      const thickness = hullPlankingThickness(y);
      const z = side * (hullHalfWidth(x, y) - thickness / 2);
      add(box(halfWidth * 2 + .1, .08, thickness + .02, x, y - .02, z), red, side, deck + 1, true);
      for (const edge of [-1, 1]) {
        const edgeX = x + edge * halfWidth;
        add(box(.08, .94, thickness + .02, edgeX, y + .45,
          side * (hullHalfWidth(edgeX, y + .45) - thickness / 2)), red, side, deck + 1, true);
      }
      add(box(halfWidth * 2 + .1, .08, thickness + .02, x, y + .94, z), dark, side, deck + 1, true);
      const outerZ = side * hullHalfWidth(x, y + .9);
      add(new THREE.BoxGeometry(halfWidth * 2 + .05, .98, .09)
        .rotateX(side * 1.22).translate(x, y + 1.07, outerZ + side * .42),
        dark, side, deck + 1, true);
      for (const offset of [-halfWidth * .65, halfWidth * .65]) {
        add(box(.065, .06, .82, x + offset, y + 1.1, outerZ + side * .4),
          iron, side, deck + 1, true);
        rope(v(x + offset, y + 1.35, outerZ), v(x + offset, y + 1.13, outerZ + side * .8));
      }
    }
    for (let x = -27; x < 29; x += 1.8) {
      const top = x > QUARTERDECK_END && x < FORECASTLE_START ? 8.85 : 9.45;
      const z = side * hullHalfWidth(x, top);
      add(
        spar(
          v(x, 8.3 + hullSheer(x, 8.3), z),
          v(x, top + hullSheer(x, top), z),
          0.075,
        ),
        ochre,
        side,
        4,
        true,
      );
    }
    add(deckGeometry(1, side), timber, side, 1);
    add(deckGeometry(3.4, side), deckWood, side, 2);
    add(deckGeometry(5.8, side), deckWood, side, 3);
    add(deckGeometry(8.2, side), deckWood, side, 4);
    add(deckGeometry(10.4, side, -30.4, POOP_BOUNDS.maxX), deckWood, side, 5);
    for (let x = -28; x < 29; x += 2.2) {
      add(hullFrameGeometry(x, side), timber, 0, 0);
      for (const y of [3.2, 5.6, 8.0]) {
        const span = hullHalfWidth(x, y) - hullPlankingThickness(y);
        const inner = y === 8 && x > QUARTERDECK_END && x < FORECASTLE_START ? GANGWAY_INNER_Z : 0;
        add(
          box(.24, .27, Math.max(.05, span - inner), x, y, side * (span + inner) / 2),
          timber,
          side,
          Math.round((y - 1) / 2.4) + 1,
        );
      }
    }
  }
  add(backboneGeometry(), timber, 0, 0, true);
  add(box(54.7, .32, .54, -.75, -4.05, 0), timber);
  add(rudderGeometry(), timber, 0, 0, true);
  for (const y of [-3.5, -2, -.5, 1, 2.4]) {
    const x = hullSternX(y) - .16;
    add(box(.75, .12, .34, x - .3, y, 0), iron, 0, 0, true);
    add(spar(v(x, y - .16, 0), v(x - .1, y + .16, 0), .075), iron, 0, 0, true);
  }
  add(transomGeometry(-4.45, 1.95), copperMat, 0, 0, true);
  add(transomGeometry(1.95, 10.5), dark, 0, 0, true);
  for (const y of [0.2, 3.0, 5.6, 7.75, 8.0, 10.45])
    add(
      sternMouldingGeometry(y, y === 5.6 || y === 10.45 ? 0.12 : 0.065),
      gold,
      0,
      0,
      true,
    );
  for (const y of STERN_WINDOW_HEIGHTS)
    for (let index = -3; index <= 3; index++) {
      const transverse = index * 0.255;
      add(
        sternFittingGeometry(0.95, 1.38, 0.12, y, transverse, 0.1),
        glass,
        0,
        0,
        true,
      );
      for (const edge of [-0.58, 0.58])
        add(
          sternFittingGeometry(0.99, 0.1, 0.17, y + edge, transverse, 0.2),
          gold,
          0,
          0,
          true,
        );
      for (const edge of [-0.105, 0.105])
        add(
          sternFittingGeometry(0.075, 1.42, 0.2, y, transverse + edge, 0.2),
          gold,
          0,
          0,
          true,
        );
      add(
        sternFittingGeometry(0.055, 1.25, 0.15, y, transverse, 0.23),
        gold,
        0,
        0,
        true,
      );
      add(
        sternFittingGeometry(0.94, 0.055, 0.15, y + 0.08, transverse, 0.23),
        gold,
        0,
        0,
        true,
      );
      for (let arch = 0; arch < 8; arch++) {
        const angle = (arch / 7) * Math.PI;
        const point = sternPoint(
          y + 0.67 + Math.sin(angle) * 0.12,
          transverse + Math.cos(angle) * 0.115,
        );
        point.x -= 0.23;
        add(
          new THREE.SphereGeometry(0.065, 6, 4).translate(
            point.x,
            point.y,
            point.z,
          ),
          gold,
          0,
          0,
          true,
        );
      }
    }
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.48, 0.7);
  crestShape.lineTo(0.48, 0.7);
  crestShape.lineTo(0.42, 0.05);
  crestShape.quadraticCurveTo(0.2, -0.3, 0, -0.45);
  crestShape.quadraticCurveTo(-0.2, -0.3, -0.42, 0.05);
  crestShape.closePath();
  const crest = new THREE.ExtrudeGeometry(crestShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelSize: 0.045,
    bevelThickness: 0.035,
    bevelSegments: 2,
    steps: 1,
  });
  const crestPoint = sternPoint(10.75, 0);
  crest.rotateY(-Math.PI / 2).translate(crestPoint.x - .08, crestPoint.y, 0);
  add(crest, gold, 0, 5, true);
  for (const side of [-1, 1])
    for (let leaf = 0; leaf < 9; leaf++) {
      const angle = ((leaf / 8) * 0.8 + 0.15) * Math.PI;
      const relief = new THREE.SphereGeometry(0.12, 6, 4);
      relief.scale(0.45, 1.1, 0.65);
      relief.rotateX(side * angle);
      relief.translate(
        crestPoint.x - .06,
        crestPoint.y - .15 + Math.sin(angle) * .7,
        side * (0.45 + Math.cos(angle) * 0.45),
      );
      add(relief, gold, 0, 5, true);
    }
  for (const side of [-1, 1]) {
    const galleryCuts = [...new Set([
      -30.5, -26, ...Array.from({ length: 19 }, (_, index) => -30.5 + index * .25),
      ...GALLERY_WINDOW_X.flatMap((x) => [x - .48, x + .48]),
    ])].filter((x) => x >= -30.5 && x <= -26).sort((a, b) => a - b);
    for (let index = 0; index < galleryCuts.length - 1; index++) {
      const x0 = galleryCuts[index], x1 = galleryCuts[index + 1], middle = (x0 + x1) / 2;
      for (const [y0, y1] of [[8, 8.48], [8.48, 9.62], [9.62, 10.4]]) {
        if (y0 === 8.48 && GALLERY_WINDOW_X.some((x) => Math.abs(middle - x) < .48)) continue;
        add(galleryPanelGeometry(x0, x1, y0, y1, side), dark, side, 5, true);
      }
      const outer0 = galleryPoint(x0, 10.4, side), outer1 = galleryPoint(x1, 10.4, side);
      const inner0 = v(x0, 10.4, side * (hullHalfWidth(x0, 10.4) - .22));
      const inner1 = v(x1, 10.4, side * (hullHalfWidth(x1, 10.4) - .22));
      const roof = new THREE.BufferGeometry().setFromPoints([inner0, outer0, inner1, outer1]);
      roof.setIndex(side > 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3]);
      roof.computeVertexNormals();
      add(roof, dark, side, 5, true);
    }
    for (const x of GALLERY_WINDOW_X) {
      add(galleryFittingGeometry(.96, 1.28, .1, x, 9.05, side), glass, side, 5, true);
      for (const edge of [-.55, .55])
        add(galleryFittingGeometry(.085, 1.4, .16, x + edge, 9.05, side), gold, side, 5, true);
      for (const y of [8.48, 9.62])
        add(galleryFittingGeometry(1.12, .1, .17, x, y, side), gold, side, 5, true);
      add(galleryFittingGeometry(.045, 1.28, .14, x, 9.05, side), gold, side, 5, true);
      add(galleryFittingGeometry(.96, .045, .14, x, 9.05, side), gold, side, 5, true);
      add(spar(v(x, 7.7, side * hullHalfWidth(x, 7.7)), galleryPoint(x, 8.1, side), .11),
        gold, side, 5, true);
    }
    for (const y of [8.05, 10.4]) add(galleryMouldingGeometry(y, side), gold, side, 5, true);
    const poopRail: THREE.Vector3[] = [];
    for (let index = 0; index < 23; index++) {
      const x = -30 + index / 22 * (POOP_BOUNDS.maxX + 30);
      const z = side * (hullHalfWidth(x, 10.4) - .26);
      add(spar(v(x, 10.45, z), v(x, 11.23, z), .055, .04), gold, side, 5, true);
      add(new THREE.SphereGeometry(.085, 6, 4).translate(x, 10.84, z), gold, side, 5, true);
      poopRail.push(v(x, 11.23, z));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(poopRail), 64, .08, 6, false), dark, side, 5, true);
    const headrailPaths: THREE.CatmullRomCurve3[] = [];
    for (const drop of [0, 0.6, 1.15]) {
      const headrail = new THREE.CatmullRomCurve3([
        v(25.5, 9.05 - drop, side * (hullHalfWidth(25.5, 9.05) + .2)),
        v(28, 8.65 - drop, side * (hullHalfWidth(28, 8.65) + .5)),
        v(31, 7.1 - drop * 0.65, side * 1.6),
        v(34, 7.75 - drop * 0.4, side * 0.4),
      ]);
      headrailPaths.push(headrail);
      add(
        new THREE.TubeGeometry(headrail, 28, 0.105, 7, false),
        gold,
        side,
        4,
        true,
      );
    }
    for (let support = 1; support < 8; support++) {
      const t = support / 8;
      add(spar(headrailPaths[2].getPoint(t), headrailPaths[0].getPoint(t), .055), timber, side, 4, true);
    }
    const anchorX = 25;
    const anchorZ = side * (hullHalfWidth(anchorX, 8.5) + 1.6);
    const catheadTip = v(anchorX, 9.4, anchorZ + side * .2);
    add(spar(v(23.8, 8.6, side * (hullHalfWidth(23.8, 8.6) - .45)),
      catheadTip, .25, .22, 4), timber, side, 4, true);
    add(new THREE.CylinderGeometry(.095, .14, 3.4, 4).rotateY(Math.PI / 4)
      .translate(anchorX, 7, anchorZ), iron, side, 0, true);
    add(new THREE.TorusGeometry(.19, .055, 6, 16).translate(anchorX, 8.9, anchorZ), iron, side, 0, true);
    add(box(.3, .34, 2.7, anchorX, 8.25, anchorZ), timber, side, 0, true);
    for (const band of [-.9, 0, .9])
      add(box(.34, .38, .075, anchorX, 8.25, anchorZ + band), iron, side, 0, true);
    for (const arm of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        v(anchorX, 5.3, anchorZ), v(anchorX + arm * .8, 5.4, anchorZ),
        v(anchorX + arm * 1.35, 5.9, anchorZ),
      ]);
      add(new THREE.TubeGeometry(curve, 12, .13, 6, false), iron, side, 0, true);
      const fluke = new THREE.Shape();
      fluke.moveTo(anchorX + arm * 1.45, 6.15);
      fluke.lineTo(anchorX + arm * .85, 5.9);
      fluke.lineTo(anchorX + arm * 1.3, 5.48);
      fluke.lineTo(anchorX + arm * 1.67, 5.72);
      fluke.closePath();
      add(new THREE.ExtrudeGeometry(fluke, {
        depth: .12, bevelEnabled: true, bevelSize: .025, bevelThickness: .015,
        bevelSegments: 1, curveSegments: 1,
      }).translate(0, 0, anchorZ - .06), iron, side, 0, true);
    }
    add(box(.22, .3, .24, anchorX, 9.15, anchorZ), timber, side, 4, true);
    for (const fall of [-.075, 0, .075])
      rope(v(catheadTip.x + fall, catheadTip.y, catheadTip.z),
        v(anchorX + fall, 8.9, anchorZ));
    const hawse = v(27.5, 6.3, side * (hullHalfWidth(27.5, 6.3) + .08));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      v(anchorX, 8.9, anchorZ), v(26.3, 7.5, anchorZ), hawse,
    ]), 24, .07, 6, false), ropeMat, side, 0, true);
    add(new THREE.TorusGeometry(.18, .055, 6, 14).translate(hawse.x, hawse.y, hawse.z),
      iron, side, 0, true);
  }
  // Landings and hatch openings use the same coordinates as the navigator.
  for (const ladder of DECK_LADDERS) {
    const steps = 8;
    const railZ = [ladder.z - ladder.halfWidth - 0.05, ladder.z + ladder.halfWidth + 0.05];
    // Lanes of a two-way ladder share one landing, so each lane's half stops at the divider.
    const landingDepth = 2 * ladder.halfWidth + (ladder.flow === undefined ? 0.4 : 0);
    for (let step = 0; step < steps; step++) {
      const run = THREE.MathUtils.lerp(ladder.start.x, ladder.end.x, (step + 0.5) / steps);
      const rise = THREE.MathUtils.lerp(ladder.start.y, ladder.end.y, (step + 1) / steps);
      add(
        box((Math.abs(ladder.end.x - ladder.start.x) / steps) * 1.2, 0.13, 2 * ladder.halfWidth, run, rise, ladder.z),
        deckWood,
        0,
        ladder.lowerDeck + 1,
      );
    }
    for (const z of railZ)
      add(
        spar(v(ladder.start.x, ladder.start.y + 0.95, z), v(ladder.end.x, ladder.end.y + 0.95, z), 0.045),
        dark,
        0,
        ladder.lowerDeck + 1,
      );
    add(box(1.7, 0.14, landingDepth, ladder.upper.x, ladder.upper.y, ladder.z), deckWood, 0, ladder.upperDeck + 1);
    for (const postX of [ladder.upper.x - 0.65, ladder.upper.x + 0.65])
      for (const z of railZ)
        add(
          spar(v(postX, ladder.lower.y, z), v(postX, ladder.upper.y, z), 0.05),
          timber,
          0,
          ladder.upperDeck + 1,
        );
  }
  // Storage below decks, skipping any position the navigator excludes as a ladder approach.
  for (let index = 0; index < 34; index++) {
    const x = -25 + index % 17 * 2.9;
    const z = (index % 2 ? 1 : -1) * 3.5;
    if (blocksLadderApproach(0, x, z, .36, .36)) continue;
    add(caskGeometry(x, 1, z), ochre, 0, 1);
    for (const offset of [.13, .64])
      add(new THREE.TorusGeometry(.34, .027, 4, 10).rotateX(Math.PI / 2)
        .translate(x, 1 + offset, z), iron, 0, 1);
  }
  for (let index = 0; index < 18; index++) {
    const x = -24 + (index % 6) * 2,
      z = -1.9 + Math.floor(index / 6) * 1.9;
    if (blocksLadderApproach(0, x, z, 0.57, 0.42)) continue;
    add(box(1.14, 0.6, 0.84, x, 1.3, z), timber, 0, 1);
  }
  for (const fitting of DECK_FITTINGS) {
    const { x, y, deck, halfX, halfZ } = fitting;
    if (fitting.kind === "grating") {
      for (const side of [-1, 1])
        add(box(halfX * 2, .32, .16, x, y + .18, side * (halfZ - .08)), timber, 0, deck + 1);
      for (const end of [-1, 1])
        add(box(.18, .32, halfZ * 2, x + end * (halfX - .05), y + .18, 0), timber, 0, deck + 1);
      const columns = Math.ceil((halfX * 2 - .4) / .4);
      const rows = Math.ceil((halfZ * 2 - .8) / .4);
      for (let index = 0; index <= columns; index++)
        add(box(.15, .12, halfZ * 2 - .3, x - halfX + .2 + index / columns * (halfX * 2 - .4),
          y + .31, 0), timber, 0, deck + 1);
      for (let index = 0; index <= rows; index++)
        add(box(halfX * 2 - .2, .12, .12, x, y + .31,
          -halfZ + .4 + index / rows * (halfZ * 2 - .8)), timber, 0, deck + 1);
      continue;
    }
    add(new THREE.CylinderGeometry(.55, .8, 1.2, 12).translate(x, y + .6, 0), timber, 0, deck + 1);
    add(new THREE.CylinderGeometry(.9, .9, .18, 16).translate(x, y + 1.2, 0), iron, 0, deck + 1);
    for (let index = 0; index < 6; index++) {
      const angle = index / 6 * Math.PI;
      add(spar(v(x - Math.cos(angle) * 1.6, y + 1.15, -Math.sin(angle) * 1.6),
        v(x + Math.cos(angle) * 1.6, y + 1.15, Math.sin(angle) * 1.6), .055), timber, 0, deck + 1);
    }
  }
  for (const z of [-0.8, 0.8]) {
    add(spar(v(-24, 10.5, z), v(-24, 11.6, z), 0.12), timber, 0, 5);
    const wheel = new THREE.TorusGeometry(0.68, 0.075, 8, 24);
    wheel.rotateY(Math.PI / 2);
    wheel.translate(-24, 11.5, z);
    add(wheel, timber, 0, 5);
    for (let spoke = 0; spoke < 8; spoke++) {
      const angle = (spoke * Math.PI) / 4;
      add(
        spar(
          v(-24, 11.5, z),
          v(-24, 11.5 + Math.cos(angle) * 0.85, z + Math.sin(angle) * 0.85),
          0.035,
        ),
        gold,
        0,
        5,
      );
    }
  }
  add(launchHullGeometry().translate(LAUNCH_OFFSET_X, LAUNCH_RISE, LAUNCH_OFFSET_Z), deckWood, 0, 4);
  for (const side of [-1, 1]) {
    const gunwale: THREE.Vector3[] = [];
    for (let index = 0; index <= 24; index++) {
      const t = index / 24;
      gunwale.push(
        v(
          LAUNCH_OFFSET_X - 8.2 + t * 8.6,
          LAUNCH_RISE + 9.34 +
            Math.sin(t * Math.PI) * 0.16 +
            0.16 * Math.pow(Math.abs(t * 2 - 1), 3),
          LAUNCH_OFFSET_Z +
            side * (0.055 + Math.pow(Math.sin(t * Math.PI), 0.72) * 1.2),
        ),
      );
    }
    add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(gunwale),
        48,
        0.065,
        6,
        false,
      ),
      dark,
      0,
      4,
    );
  }
  for (let index = 1; index < 10; index++) {
    const t = index / 10,
      width = 0.055 + Math.pow(Math.sin(t * Math.PI), 0.72) * 1.2,
      x = LAUNCH_OFFSET_X - 8.2 + t * 8.6;
    const frame: THREE.Vector3[] = [];
    for (let rib = 0; rib <= 12; rib++) {
      const angle = -Math.PI / 2 + (rib / 12) * Math.PI;
      frame.push(
        v(
          x,
          LAUNCH_RISE + 8.74 + .16 * Math.pow(Math.abs(t * 2 - 1), 3)
            + (0.68 + Math.sin(t * Math.PI) * 0.16) * (1 - Math.cos(angle)),
          LAUNCH_OFFSET_Z + Math.sin(angle) * (width - 0.1),
        ),
      );
    }
    add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(frame),
        20,
        0.035,
        5,
        false,
      ),
      timber,
      0,
      4,
    );
    if (index % 2 === 0)
      add(
        box(0.23, 0.11, (width - 0.08) * 2, x, 9.24 + LAUNCH_RISE, LAUNCH_OFFSET_Z),
        timber,
        0,
        4,
      );
  }
  for (const x of BOAT_SKID_X) {
    add(box(.35, .24, hullHalfWidth(x, 8.2) * 2 - .5, x, 8.08, 0), timber, 0, 4);
    const t = (x - LAUNCH_OFFSET_X + 8.2) / 8.6;
    const width = .055 + Math.pow(Math.sin(t * Math.PI), .72) * 1.2;
    const depth = .68 + Math.sin(t * Math.PI) * .16;
    const keel = 8.65 + LAUNCH_RISE + .16 * Math.pow(Math.abs(t * 2 - 1), 3);
    const cradle = new THREE.Shape();
    cradle.moveTo(-Math.sin(.85) * width, 8.2);
    cradle.lineTo(Math.sin(.85) * width, 8.2);
    for (let point = 0; point <= 16; point++) {
      const angle = .85 - point / 16 * 1.7;
      cradle.lineTo(Math.sin(angle) * width, keel + depth * (1 - Math.cos(angle)) - .025);
    }
    cradle.closePath();
    add(new THREE.ExtrudeGeometry(cradle, {
      depth: .35, bevelEnabled: false, curveSegments: 1,
    }).rotateY(Math.PI / 2).translate(x - .175, 0, LAUNCH_OFFSET_Z), timber, 0, 4);
  }
  for (const side of [-1, 1]) {
    const innerZ = side * (GANGWAY_INNER_Z - .05);
    add(spar(v(QUARTERDECK_END, 9.1, innerZ), v(FORECASTLE_START, 9.1, innerZ), .045), timber, side, 4);
    for (let x = QUARTERDECK_END; x <= FORECASTLE_START; x += 1.4)
      add(spar(v(x, 8.2, innerZ), v(x, 9.1, innerZ), .04), iron, side, 4);
    for (let index = 0; index < 49; index++) {
      const x = -25 + index * 1.05;
      const top = x > QUARTERDECK_END && x < FORECASTLE_START ? 8.85 : 9.45;
      const y = top + hullSheer(x, top);
      const z = side * (hullHalfWidth(x, top) - .1);
      add(new THREE.CapsuleGeometry(.16, .45, 2, 4).rotateZ(Math.PI / 2)
        .translate(x, y + .22, z), deckWood, side, 4, true);
      if (index % 2 === 0)
        add(spar(v(x, y, z), v(x, y + .48, z), .025), iron, side, 4, true);
    }
  }
  const barrels = new THREE.InstancedMesh(cannonBarrelGeometry(), iron, GUN_STATIONS.length);
  barrels.name = "74 iron guns";
  barrels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  barrels.castShadow = true;
  root.add(barrels);
  const carriages: Vessel["carriages"] = new Map();
  for (const calibre of [32, 18, 9] as const) {
    const dimensions = GUN_DIMENSIONS[calibre];
    const count = GUN_STATIONS.filter((station) => station.calibre === calibre).length;
    const mesh = new THREE.InstancedMesh(cannonCarriageGeometry(
      dimensions.axisHeight, dimensions.widthScale, dimensions.lengthScale), [red, timber, iron], count);
    mesh.name = `${calibre}-pounder truck carriages`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    carriages.set(calibre, { mesh, firstId: GUN_STATIONS.findIndex((station) => station.calibre === calibre) });
  }
  const gunTransform = new THREE.Object3D();
  for (let id = 0; id < GUN_STATIONS.length; id++) {
    const station = GUN_STATIONS[id], dimensions = GUN_DIMENSIONS[station.calibre];
    const side = station.side === "port" ? -1 : 1;
    gunTransform.rotation.y = side < 0 ? Math.PI : 0;
    gunTransform.scale.set(dimensions.widthScale, dimensions.widthScale, dimensions.lengthScale);
    gunTransform.position.set(station.position.x, station.position.y + dimensions.axisHeight,
      station.position.z + side * GUN_MOUNT_FORWARD);
    gunTransform.updateMatrix();
    barrels.setMatrixAt(id, gunTransform.matrix);
    gunTransform.scale.setScalar(1);
    gunTransform.position.set(station.position.x, station.position.y, station.position.z);
    gunTransform.updateMatrix();
    const carriage = carriages.get(station.calibre)!;
    carriage.mesh.setMatrixAt(id - carriage.firstId, gunTransform.matrix);
  }
  const sails: Sail[] = [];
  const staysails: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >[] = [];
  for (let mast = 0; mast < 3; mast++) {
    const x = MAST_X[mast],
      height = MAST_HEIGHTS[mast];
    const lowerTop = YARD_HEIGHTS[mast][0] + 1.9,
      upperTop = YARD_HEIGHTS[mast][1] + 2;
    add(
      spar(v(x, -3.9, 0), v(x, lowerTop, 0), 0.53, 0.36, 16),
      timber,
      0,
      0,
      false,
      true,
    );
    // Step: the heel is let into a chock on the keelson, well below the orlop.
    add(box(1.2, .35, 1.2, x, -3.99, 0), dark, 0, 0, false, true);
    // Partners: timber collars where the trunk passes through each deck.
    const partnerDecks: number[] = DECK_HEIGHTS.filter((height) => height !== 8.2 || x < QUARTERDECK_END || x > FORECASTLE_START);
    if (x >= POOP_BOUNDS.minX && x <= POOP_BOUNDS.maxX) partnerDecks.push(10.4);
    for (const deckY of partnerDecks) {
      const partnerRadius = .53 - ((deckY + 3.9) / (lowerTop + 3.9)) * .17 + .12;
      add(
        new THREE.CylinderGeometry(partnerRadius, partnerRadius, 0.14, 16).translate(
          x,
          deckY + 0.04,
          0,
        ),
        dark,
        0,
        0,
        false,
        true,
      );
    }
    add(
      spar(
        v(x - 0.18, lowerTop - 2, 0),
        v(x - 0.18, upperTop, 0),
        0.31,
        0.2,
        14,
      ),
      timber,
      0,
      0,
      false,
      true,
    );
    add(
      spar(
        v(x - 0.3, upperTop - 1.3, 0),
        v(x - 0.3, height, 0),
        0.175,
        0.075,
        12,
      ),
      timber,
      0,
      0,
      false,
      true,
    );
    for (let y = 10; y < lowerTop; y += 2.2) {
      const radius = 0.53 - ((y + 2) / (lowerTop + 2)) * 0.17 + 0.025;
      add(
        new THREE.CylinderGeometry(radius, radius, 0.14, 16).translate(x, y, 0),
        iron,
        0,
        0,
        false,
        true,
      );
    }
    for (const [y, radius, capSize] of [
      [YARD_HEIGHTS[mast][0] - 1, 2.05, 0.95],
      [YARD_HEIGHTS[mast][1] - 1, 1.2, 0.55],
    ]) {
      const capX = x - (radius > 1.5 ? .05 : .23);
      // Trestletrees stay outside the crew's lubber-hole corridors.
      for (const side of [-1, 1])
        add(box(radius * 1.1, 0.12, 0.18, x, y - 0.16, side * 0.62), timber, 0, 0, false, true);
      // Crosstrees: athwart timbers notched over the trestletrees, carrying the top.
      for (const dx of [-0.4, 0.4])
        add(box(0.16, 0.1, 1.42, x + dx, y - 0.04, 0), timber, 0, 0, false, true);
      add(mastTopGeometry(x, y, radius), dark, 0, 0, false, true);
      for (let railing = 0; railing < 14; railing++) {
        const angle = (railing / 14) * Math.PI * 2;
        add(
          spar(
            v(x + Math.cos(angle) * radius, y, Math.sin(angle) * radius),
            v(x + Math.cos(angle) * radius, y + 0.65, Math.sin(angle) * radius),
            0.035,
          ),
          timber,
          0,
          0,
          false,
          true,
        );
      }
      for (const side of [-1, 1])
        add(
          spar(
            v(x - 1, y - 0.2, side * radius * 0.7),
            v(x, y - 2.4, side * 0.4),
            0.1,
          ),
          timber,
          0,
          0,
          false,
          true,
        );
      // Cap: the iron-bound block doubling the next stage's heel and fid.
      add(box(capSize, .3, capSize * .72, capX, y + 1, 0), iron, 0, 0, false, true);
      add(
        new THREE.TorusGeometry(capSize * 0.24, 0.04, 5, 10)
          .rotateX(Math.PI / 2)
          .translate(capX, y + 1, 0),
        iron,
        0,
        0,
        false,
        true,
      );
    }
    // Truck: the capped head of the topgallant mast, carrying the halyard sheaves.
    add(
      new THREE.CylinderGeometry(.1, .14, .2, 10).translate(x - .3, height - .12, 0),
      dark,
      0,
      0,
      false,
      true,
    );
    add(
      new THREE.SphereGeometry(.08, 8, 6).translate(x - .3, height + .02, 0),
      dark,
      0,
      0,
      false,
      true,
    );
    for (let level = 0; level < 3; level++) {
      const y = YARD_HEIGHTS[mast][level];
      const width = (mast === 2 ? 13 : 19) * (1 - level * 0.23),
        sailHeight = SAIL_HEIGHTS[mast][level];
      const bareCrossjack = !SQUARE_SAIL_YARDS.some((yard) => yard.mast === mast && yard.level === level);
      const pivot = new THREE.Group();
      pivot.position.set(x + 0.25, y, 0);
      root.add(pivot);
      const yard = new THREE.Mesh(
        yardGeometry(width + 2, 0.18 - level * 0.035),
        timber,
      );
      yard.castShadow = true;
      pivot.add(yard);
      yard.userData.rig = true;
      if (bareCrossjack) yard.name = "Mizzen crossjack yard";
      for (const side of [-1, 1]) {
        for (const offset of [WORK_ROPE_OFFSET, RETURN_ROPE_OFFSET]) {
          const footrope: THREE.Vector3[] = [];
          for (let step = 0; step <= 12; step++) {
            const t = step / 12;
            footrope.push(v(
              -offset,
              -.25 - Math.sin(t * Math.PI) * .8,
              side * (.4 + t * (width / 2 - .4)),
            ));
          }
          pivot.add(new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(footrope), 24, .02, 4, false),
            ropeMat,
          ));
        }
        for (const fraction of [0.3, 0.65]) {
          const z = ((side * width) / 2) * fraction;
          const block = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.11, 0.19, 3, 6),
            ropeMat,
          );
          block.position.set(0, -0.27, z);
          pivot.add(block);
        }
      }
      if (!bareCrossjack) {
        const geometry = squareSailGeometry(width, sailHeight, level);
        const positions = geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        const sailMat = material(0xe8dfbf, canvas);
        sailMat.side = THREE.DoubleSide;
        sailMat.roughness = 0.93;
        const mesh = new THREE.Mesh(geometry, sailMat);
        mesh.name = `${mast === 0 ? "Fore" : mast === 1 ? "Main" : "Mizzen"} ${level === 0 ? "course" : level === 1 ? "topsail" : "topgallant"}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pivot.add(mesh);
        const seams = new THREE.LineSegments(
          sailSeamsGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: 0x7b704f,
            transparent: true,
            opacity: 0.5,
          }),
        );
        mesh.add(seams);
        const furled = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.17, width - 0.25, 4, 10).rotateX(
            Math.PI / 2,
          ),
          sailMat,
        );
        furled.position.set(0.14, -0.1, 0);
        furled.castShadow = true;
        pivot.add(furled);
        sails.push({
          mesh,
          rest: new Float32Array(positions.array),
          width,
          height: sailHeight,
          level,
          phase: mast * 2 + level,
          pivot,
          furled,
        });
      }
      for (const side of [-1, 1]) {
        rope(
          v(x, y, side * (width / 2 + 1)),
          v(x, y + Math.min(4, height - y), 0),
        );
        if (!bareCrossjack) {
          rope(
            v(
              x + 0.25,
              y - sailHeight,
              side * width * (level === 0 ? 0.47 : 0.62),
            ),
            v(x + 3, 8.8, side * 4),
          );
          rope(
            v(x, y - 0.25, side * width * 0.48),
            v(x, y - 0.7, side * width * 0.43),
          );
        }
      }
    }
    for (const side of [-1, 1]) {
      add(box(7.4, 0.2, 0.75, x, 8.7, side * 6.35), dark, side, 4, true);
      // Ratline landings bridge the two climbing lanes at each yard crossing.
      for (let level = 0; level < 3; level++) {
        const deckY = YARD_HEIGHTS[mast][level] + .03;
        add(box(RIGGING_LANE_X * 2 + .25, .14, .3, x, deckY, side * .8), dark, 0, 0, false, true);
        for (const direction of [-1, 1]) {
          add(box(.28, .14, .8, x + direction * RIGGING_LANE_X, deckY, side * .55), dark, 0, 0, false, true);
          if (level === 2) continue;
          const lower = mastClimbPosition(mast, level, side, direction > 0);
          const upper = mastClimbPosition(mast, level + 1, side, direction > 0);
          for (const lateral of [-.22, .22])
            rope(v(lower.x + lateral, lower.y, lower.z), v(upper.x + lateral, upper.y, upper.z));
          const count = Math.ceil((upper.y - lower.y) / .35);
          for (let rung = 0; rung <= count; rung++) {
            const y = THREE.MathUtils.lerp(lower.y, upper.y, rung / count);
            rope(v(lower.x - .22, y, side * RIGGING_LANE_Z), v(lower.x + .22, y, side * RIGGING_LANE_Z));
          }
        }
      }
      for (let shroud = 0; shroud < 6; shroud++) {
        const bottom = v(x - 3 + shroud * 1.2, 9, side * 6.5),
          top = v(x, YARD_HEIGHTS[mast][0] - 1, side * 0.75);
        rope(bottom, top);
        if (shroud === 0 || shroud === 5)
          add(spar(bottom, top, 0.028), ropeMat, 0, 0, false, true);
        const deadeyeTop = 8.95,
          deadeyeLower = 8.55;
        add(
          new THREE.TorusGeometry(0.145, 0.055, 5, 12).translate(bottom.x, deadeyeTop, bottom.z),
          iron,
          side,
          4,
          true,
        );
        add(
          new THREE.TorusGeometry(0.13, 0.05, 5, 12).translate(bottom.x, deadeyeLower, bottom.z),
          iron,
          side,
          4,
          true,
        );
        for (const lace of [-0.09, 0, 0.09])
          rope(
            v(bottom.x + lace, deadeyeTop - 0.09, bottom.z),
            v(bottom.x - lace, deadeyeLower + 0.08, bottom.z),
          );
        add(
          spar(
            v(bottom.x, 7.1, side * hullHalfWidth(bottom.x, 7.1)),
            v(bottom.x, deadeyeLower - 0.05, bottom.z),
            0.035,
          ),
          iron,
          side,
          4,
          true,
        );
        for (let rung = 1; rung < 31; rung++) {
          const t = rung / 32,
            next = v(x - 3 + (shroud + 1) * 1.2, 9, side * 6.5);
          if (shroud < 5) rope(bottom.clone().lerp(top, t), next.lerp(top, t));
        }
      }
      for (let shroud = 0; shroud < 4; shroud++) {
        const lower = v(
            x - 1.3 + shroud * 0.8,
            YARD_HEIGHTS[mast][0] - 1,
            side * 1.6,
          ),
          upper = v(x - 0.18, YARD_HEIGHTS[mast][1] + 1, side * 0.25);
        rope(lower, upper);
        // Futtock plate: the topmast shroud's iron band bolted to the top rim.
        add(box(0.1, 0.22, 0.05, lower.x, lower.y, lower.z), iron, 0, 0, false, true);
        for (let rung = 1; rung < 20; rung++) {
          const t = rung / 20;
          if (shroud < 3)
            rope(
              lower.clone().lerp(upper, t),
              v(lower.x + 0.8, lower.y, lower.z).lerp(upper, t),
            );
        }
      }
      // A short boarding ladder through the gun-gap bulwark, then a footrope out to the shrouds.
      for (let lane = 0; lane < 3; lane++) {
        const access = shroudAccess(mast, side, lane);
        if (lane !== 1) {
          const lower = v(access.base.x, access.base.y, access.base.z);
          const upper = v(access.top.x, access.top.y, access.top.z);
          for (const lateral of [-.22, .22])
            rope(lower.clone().add(v(lateral, 0, 0)), upper.clone().add(v(lateral, 0, 0)));
          const count = Math.ceil(lower.distanceTo(upper) / .35);
          for (let rung = 0; rung <= count; rung++) {
            const point = lower.clone().lerp(upper, rung / count);
            rope(point.clone().add(v(-.22, 0, 0)), point.clone().add(v(.22, 0, 0)));
          }
        }
        for (const dx of [-0.22, 0.22])
          add(
            spar(
              v(access.deck.x + dx, access.deck.y, access.deck.z),
              v(access.rail.x + dx, access.rail.y, access.rail.z),
              0.028,
            ),
            ropeMat,
            side,
            4,
            false,
            true,
          );
        for (let rung = 1; rung < 4; rung++) {
          const t = rung / 4;
          add(
            spar(
              v(
                access.deck.x - 0.22,
                THREE.MathUtils.lerp(access.deck.y, access.rail.y, t),
                THREE.MathUtils.lerp(access.deck.z, access.rail.z, t),
              ),
              v(
                access.deck.x + 0.22,
                THREE.MathUtils.lerp(access.deck.y, access.rail.y, t),
                THREE.MathUtils.lerp(access.deck.z, access.rail.z, t),
              ),
              0.022,
            ),
            timber,
            side,
            4,
            false,
            true,
          );
        }
        if (access.rail.x !== access.base.x) {
          for (const dy of [0, .9])
            add(spar(
              v(access.rail.x, access.rail.y + dy, access.rail.z),
              v(access.base.x, access.base.y + dy, access.base.z), .024),
            ropeMat, side, 4, false, true);
        }
      }
    }
    const stayStart = v(x - .3, height - 1, 0);
    const stayEnd = mast === 0 ? bowspritPoint(41, true)
      : v(MAST_X[mast - 1] - .18, YARD_HEIGHTS[mast - 1][1] + 2, 0);
    rope(stayStart, stayEnd);
    add(spar(stayStart, stayEnd, 0.045), ropeMat, 0, 0, false, true);
    const backstayX = Math.max(-28.5, x - 10);
    const backstayY = backstayX <= POOP_BOUNDS.maxX ? 10.65 : 8.7;
    for (const side of [-1, 1])
      rope(v(x - .18, YARD_HEIGHTS[mast][1], 0),
        v(backstayX, backstayY, side * (hullHalfWidth(backstayX, backstayY) + .1)));
  }
  // Bowsprit: steps through the forecastle bitts and beak bulkhead to a capped outer end.
  const bowspritCap = bowspritPoint(34);
  add(spar(bowspritPoint(25), bowspritCap, .37, .26, 14), timber, 0, 0, false, true);
  add(new THREE.BoxGeometry(.55, .75, .5).rotateZ(BOWSPRIT_RAKE)
    .translate(bowspritCap.x - .08, bowspritCap.y + .2, 0), iron, 0, 0, false, true);
  // Jib-boom: a lighter spar doubled alongside the bowsprit, run out through the cap.
  const jibHeel = bowspritPoint(33.2, true),
    jibTip = bowspritPoint(43, true);
  add(spar(jibHeel, jibTip, 0.17, 0.09, 12), timber, 0, 0, false, true);
  for (const t of [0.05, 0.9])
    add(
      new THREE.TorusGeometry(THREE.MathUtils.lerp(0.2, 0.11, t), 0.025, 5, 12)
        .rotateY(Math.PI / 2)
        .rotateZ(BOWSPRIT_RAKE)
        .translate(
          THREE.MathUtils.lerp(jibHeel.x, jibTip.x, t),
          THREE.MathUtils.lerp(jibHeel.y, jibTip.y, t),
          0,
        ),
      iron,
      0,
      0,
      false,
      true,
    );
  // Dolphin striker: the martingale boom taking the jib-boom's downward stays.
  const dolphin = v(34.4, 7.3, 0);
  add(
    spar(v(bowspritCap.x - 0.1, bowspritCap.y - 0.15, 0), dolphin, 0.1, 0.055),
    timber,
    0,
    0,
    false,
    true,
  );
  add(new THREE.SphereGeometry(0.08, 8, 6).translate(dolphin.x, dolphin.y, 0), iron, 0, 0, false, true);
  const bobstayEye = v(hullBowX(3.4) + .1, 3.4, 0);
  rope(bobstayEye, dolphin);
  add(spar(bobstayEye, dolphin, .03), ropeMat, 0, 0, false, true);
  rope(dolphin, bowspritCap);
  add(spar(dolphin, bowspritCap, 0.03), ropeMat, 0, 0, false, true);
  rope(jibTip, dolphin);
  for (const side of [-1, 1])
    rope(dolphin, v(27, 6.8, side * (hullHalfWidth(27, 6.8) + .1)));
  for (const [a, b, c] of [
    [bowspritPoint(39, true), v(MAST_X[0] - .18, YARD_HEIGHTS[0][1] + 2, 0), v(22, 12, 0)],
    [bowspritPoint(32), v(MAST_X[0], YARD_HEIGHTS[0][0] + 1.9, 0), v(19, 11, 0)],
  ] as THREE.Vector3[][]) {
    rope(a, b);
    for (const side of [-1, 1]) rope(c, v(18, 8.7, side * 3.8));
    const geometry = triangularCanvas(a, b, c);
    const mat = material(0xe4d8b5, canvas);
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    root.add(mesh);
    mesh.userData.staysail = true;
    mesh.userData.axis = b.x;
    mesh.userData.rest = new Float32Array(
      geometry.getAttribute("position").array,
    );
    staysails.push(mesh);
  }
  // Mizzen spanker: a gaff-and-boom driver bent loose-footed abaft the mast — not a square course.
  const mizzenX = MAST_X[2];
  const spankerThroat = v(mizzenX, 18, 0),
    spankerPeak = v(mizzenX - 8.5, 23.5, 0),
    spankerClew = v(mizzenX - 9.5, 10.8, 0),
    spankerTack = v(mizzenX, 10.6, 0);
  add(spar(spankerThroat, spankerPeak, 0.09, 0.05, 10), timber, 0, 0, false, true);
  add(spar(spankerTack, spankerClew, 0.11, 0.065, 10), timber, 0, 0, false, true);
  add(
    new THREE.TorusGeometry(0.1, 0.03, 5, 10).rotateX(Math.PI / 2).translate(spankerThroat.x, spankerThroat.y, 0),
    iron,
    0,
    0,
    false,
    true,
  );
  add(
    new THREE.TorusGeometry(0.12, 0.035, 5, 10).rotateX(Math.PI / 2).translate(spankerTack.x, spankerTack.y, 0),
    iron,
    0,
    0,
    false,
    true,
  );
  add(
    new THREE.CapsuleGeometry(0.1, 0.16, 3, 6).translate(spankerPeak.x, spankerPeak.y - 0.1, 0),
    ropeMat,
    0,
    0,
    false,
    true,
  );
  add(
    new THREE.CapsuleGeometry(0.1, 0.16, 3, 6).translate(spankerClew.x, spankerClew.y + 0.1, 0),
    ropeMat,
    0,
    0,
    false,
    true,
  );
  const spankerPanel = mergeGeometries([
    triangularCanvas(spankerThroat, spankerPeak, spankerClew),
    triangularCanvas(spankerThroat, spankerClew, spankerTack),
  ])!;
  const spankerMat = material(0xe4d8b5, canvas);
  spankerMat.side = THREE.DoubleSide;
  const spankerMesh = new THREE.Mesh(spankerPanel, spankerMat);
  spankerMesh.name = "Mizzen spanker";
  spankerMesh.castShadow = true;
  root.add(spankerMesh);
  spankerMesh.userData.staysail = true;
  spankerMesh.userData.axis = mizzenX;
  spankerMesh.userData.rest = new Float32Array(
    spankerPanel.getAttribute("position").array,
  );
  staysails.push(spankerMesh);
  rope(spankerPeak, v(mizzenX, 26, 0));
  rope(spankerThroat, v(mizzenX, 20.5, 0));
  rope(v(mizzenX - 4.5, 10.85, 0), v(mizzenX, 21, 0));
  for (const side of [-1, 1])
    rope(spankerClew, v(spankerClew.x + 0.5, 10.6, side * 2.4));
  add(
    spar(v(-28, 10.4, 0), v(-30, 20, 0), 0.08, 0.045),
    timber,
    0,
    0,
    false,
    true,
  );
  const flagGeometry = new THREE.PlaneGeometry(4.5, 2.4, 16, 6);
  const flagCanvas = document.createElement("canvas");
  flagCanvas.width = 256;
  flagCanvas.height = 128;
  const flagContext = flagCanvas.getContext("2d")!;
  flagContext.fillStyle = detailed ? "#dcd7bd" : "#e8dfc1";
  flagContext.fillRect(0, 0, 256, 128);
  flagContext.fillStyle = detailed ? "#a93830" : "#315889";
  flagContext.fillRect(0, 53, 256, 22);
  flagContext.fillRect(92, 0, 22, 128);
  if (detailed) {
    flagContext.fillStyle = "#253c5b";
    flagContext.fillRect(0, 0, 86, 49);
    flagContext.strokeStyle = "#d8d7c1";
    flagContext.lineWidth = 8;
    flagContext.beginPath();
    flagContext.moveTo(0, 0);
    flagContext.lineTo(86, 49);
    flagContext.moveTo(86, 0);
    flagContext.lineTo(0, 49);
    flagContext.stroke();
    flagContext.strokeStyle = "#ad3935";
    flagContext.lineWidth = 9;
    flagContext.beginPath();
    flagContext.moveTo(43, 0);
    flagContext.lineTo(43, 49);
    flagContext.moveTo(0, 24);
    flagContext.lineTo(86, 24);
    flagContext.stroke();
  }
  const flagTexture = new THREE.CanvasTexture(flagCanvas);
  flagTexture.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(
    flagGeometry,
    new THREE.MeshStandardMaterial({
      map: flagTexture,
      side: THREE.DoubleSide,
      roughness: 0.9,
    }),
  );
  flag.position.set(-31.8, 18.3, 0);
  root.add(flag);
  for (const [index, mast] of MAST_X.entries()) {
    const pennant = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 0.3, 8, 1),
      new THREE.MeshStandardMaterial({
        color: 0x9e3a2a,
        side: THREE.DoubleSide,
      }),
    );
    pennant.position.set(mast - 2, MAST_HEIGHTS[index], 0);
    root.add(pennant);
    pennant.userData.pennant = true;
  }
  const lionBody = new THREE.SphereGeometry(0.55, 12, 10)
    .scale(0.9, 1.5, 0.58)
    .rotateZ(-0.4)
    .translate(32.6, 7.55, 0);
  add(lionBody, gold, 0, 0, true);
  add(
    new THREE.DodecahedronGeometry(0.39, 1)
      .scale(0.8, 1.1, 1)
      .translate(33.05, 8.3, 0),
    gold,
    0,
    0,
    true,
  );
  add(
    new THREE.SphereGeometry(0.26, 12, 8).translate(33.27, 8.35, 0),
    gold,
    0,
    0,
    true,
  );
  add(
    new THREE.SphereGeometry(0.19, 10, 8)
      .scale(1, 0.65, 0.8)
      .translate(33.47, 8.23, 0),
    gold,
    0,
    0,
    true,
  );
  for (const side of [-1, 1]) {
    add(
      new THREE.SphereGeometry(0.21, 8, 6)
        .scale(0.8, 1.2, 1)
        .translate(32.35, 7.24, side * 0.25),
      gold,
      0,
      0,
      true,
    );
    add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          v(32.9, 7.95, side * 0.22),
          v(33.45, 7.8, side * 0.3),
          v(33.7, 8.1, side * 0.3),
        ]),
        12,
        0.085,
        6,
        false,
      ),
      gold,
      0,
      0,
      true,
    );
    add(
      spar(v(32.3, 7.2, side * 0.25), v(31.95, 6.9, side * 0.3), 0.095, 0.07),
      gold,
      0,
      0,
      true,
    );
  }
  add(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        v(32.2, 7.6, 0),
        v(31.75, 8.05, 0),
        v(31.9, 8.7, 0),
        v(32.1, 8.85, 0),
      ]),
      20,
      0.055,
      6,
      false,
    ),
    gold,
    0,
    0,
    true,
  );
  for (const side of [-1, 1]) {
    const center = sternPoint(11.7, side * 0.84);
    add(
      new THREE.CylinderGeometry(0.22, 0.27, 0.65, 6).translate(
        center.x - 0.12,
        11.7,
        center.z,
      ),
      glass,
      0,
      5,
      true,
    );
    add(
      new THREE.ConeGeometry(0.38, 0.28, 6).translate(
        center.x - 0.12,
        12.16,
        center.z,
      ),
      gold,
      0,
      5,
      true,
    );
    add(
      new THREE.CylinderGeometry(0.29, 0.3, 0.12, 6).translate(
        center.x - 0.12,
        11.32,
        center.z,
      ),
      gold,
      0,
      5,
      true,
    );
    for (let edge = 0; edge < 6; edge++) {
      const angle = (edge / 6) * Math.PI * 2,
        dx = Math.cos(angle) * 0.26,
        dz = Math.sin(angle) * 0.26;
      add(
        spar(
          v(center.x - 0.12 + dx, 11.35, center.z + dz),
          v(center.x - 0.12 + dx, 12.02, center.z + dz),
          0.025,
        ),
        gold,
        0,
        5,
        true,
      );
    }
  }
  const structure: Structure[] = [];
  let interiorLights: InteriorLight[] = [];
  if (detailed) {
    const berthCanvas = material(0xe0d6bb, canvas);
    berthCanvas.side = THREE.DoubleSide;
    const glow = new THREE.MeshStandardMaterial({
      color: 0xffce82, emissive: 0xffa341, emissiveIntensity: 1.4, roughness: .4,
    });
    interiorLights = buildInterior(add, {
      timber, dark, iron, brass: gold, canvas: berthCanvas,
      pale: material(0xd4cdb4, wood),
      paper: new THREE.MeshStandardMaterial({ color: 0xe9ddbc, roughness: .95 }),
      brick: material(0x825b49, wood),
      glow,
    });
    for (const illumination of interiorLights) root.add(illumination.light);
  }
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const source of bucket.geometries) source.dispose();
    if (!geometry) throw new Error("Ship structure contains incompatible geometry attributes");
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.castShadow = bucket.material !== glass;
    mesh.receiveShadow = true;
    root.add(mesh);
    const ghost = bucket.material.clone();
    ghost.transparent = true;
    ghost.opacity = bucket.shell ? 0.13 : 0.2;
    ghost.depthWrite = false;
    ghost.color.lerp(new THREE.Color(0x86bdc0), 0.45);
    ghost.side = THREE.DoubleSide;
    structure.push({
      mesh,
      side: bucket.side,
      deck: bucket.deck,
      shell: bucket.shell,
      rig: bucket.rig,
      restOnly: bucket.restOnly,
      original: bucket.material,
      ghost,
    });
  }
  const ropeGeometry = new THREE.BufferGeometry();
  ropeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(lineVertices, 3),
  );
  const ropes = new THREE.LineSegments(
    ropeGeometry,
    new THREE.LineBasicMaterial({
      color: 0x493e2d,
      transparent: true,
      opacity: 0.85,
    }),
  );
  ropes.name = "Standing and running rigging, shrouds and ratlines";
  root.add(ropes);
  const fire = new THREE.Group();
  for (let index = 0; index < 12; index++) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.8, 5),
      new THREE.MeshBasicMaterial({
        color: index % 2 ? 0xffb947 : 0xdd6126,
        transparent: true,
        opacity: 0.8,
      }),
    );
    flame.position.set(-16 + index * 3, 7.9, ((index % 3) - 1) * 3);
    fire.add(flame);
  }
  root.add(fire);
  fire.visible = false;
  return { root, structure, sails, staysails, ropes, barrels, carriages, flag, fire, interiorLights };
}

export class ShipScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.2, 18000);
  readonly controls: OrbitControls;
  viewMode: ViewMode = "exterior";
  deckLevel = 0;
  private readonly vessel: Vessel;
  private readonly enemy: Vessel;
  private readonly ocean = new Ocean();
  private readonly crew: CrewAnimator;
  private readonly selection: THREE.Mesh;
  private readonly matrix = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly deckClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly particles: Particle[] = [];
  private readonly shotGeometry = new THREE.SphereGeometry(0.18, 6, 4);
  private readonly smokeGeometry = new THREE.IcosahedronGeometry(1, 1);
  private selectedId: number | null = null;
  private lastEvent = 0;
  private cutSide = 1;
  private trackedPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDisplacement = new THREE.Vector3();
  private readonly container: HTMLElement;
  private focusTarget: "ship" | "deck" | "enemy" | "crew" = "ship";
  private battleStations = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.append(this.renderer.domElement);
    this.renderer.localClippingEnabled = true;
    this.scene.fog = new THREE.FogExp2(OCEAN_FOG_COLOR, OCEAN_FOG_DENSITY);
    this.scene.background = OCEAN_FOG_COLOR;
    this.scene.add(new THREE.HemisphereLight(0xc6e4ee, 0x71664c, 2.05));
    const sun = new THREE.DirectionalLight(0xffe6b9, 3.2);
    sun.position.copy(OCEAN_SUN_DIRECTION).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -65,
      right: 65,
      top: 65,
      bottom: -65,
      near: 1,
      far: 300,
    });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
    sun.name = "Afternoon sunlight";
    const fill = new THREE.DirectionalLight(0x9bc6e3, 0.65);
    fill.position.set(-30, 30, 80);
    this.scene.add(fill);
    this.scene.add(this.ocean.group);
    this.vessel = buildVessel(true);
    this.enemy = buildVessel(false);
    this.enemy.root.visible = false;
    this.scene.add(this.vessel.root, this.enemy.root);
    this.crew = new CrewAnimator(this.vessel.root);
    const ring = new THREE.TorusGeometry(0.48, 0.04, 5, 32);
    ring.rotateX(Math.PI / 2);
    this.selection = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({
        color: 0xece09b,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.selection.renderOrder = 10;
    this.selection.visible = false;
    this.vessel.root.add(this.selection);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = SHIP_CAMERA_MIN_DISTANCE;
    this.controls.maxDistance = 430;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 16, 0);
    this.camera.position.set(89, 49, 83);
    this.controls.update();
    this.resize();
    if (window.innerWidth < 760) this.focus("ship");
  }
  resize(): void {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  setView(mode: ViewMode): void {
    this.viewMode = mode;
    this.applyInspection();
  }
  setDeck(deck: number): void {
    this.deckLevel = deck;
    if (deck > 0) this.focus("deck");
    this.applyInspection();
  }
  focus(kind: "ship" | "deck" | "enemy"): void {
    this.stopCrewFocus();
    this.focusTarget = kind;
    const root = kind === "enemy" ? this.enemy.root : this.vessel.root;
    this.trackedPosition.set(root.position.x, 0, root.position.z);
    const center = root.position.clone();
    center.y +=
      kind === "deck"
        ? this.deckLevel
          ? 1 + (this.deckLevel - 1) * 2.4
          : 5
        : 16;
    const offset =
      kind === "deck"
        ? new THREE.Vector3(48, 31, 51)
        : new THREE.Vector3(89, 49, 83);
    if (window.innerWidth < 760) offset.multiplyScalar(1.4);
    this.camera.position.copy(center).add(offset);
    this.controls.target.copy(center);
    this.controls.update();
  }
  selectCrew(crew: CrewMember | null): void {
    this.selectedId = crew?.id ?? null;
    this.selection.visible = crew !== null && crew.health > 0;
    if (!crew || crew.health <= 0) {
      this.stopCrewFocus();
      return;
    }
    this.focusTarget = "crew";
    this.cameraTarget.set(crew.position.x, crew.position.y + CREW_FOCUS_HEIGHT, crew.position.z);
    this.vessel.root.localToWorld(this.cameraTarget);
    this.cameraDisplacement.copy(CREW_CAMERA_OFFSET)
      .applyAxisAngle(UP, crew.heading).applyQuaternion(this.vessel.root.quaternion);
    if (window.innerWidth < 760) this.cameraDisplacement.multiplyScalar(1.4);
    this.camera.position.copy(this.cameraTarget).add(this.cameraDisplacement);
    this.controls.target.copy(this.cameraTarget);
    this.trackedPosition.copy(this.cameraTarget);
    this.controls.minDistance = CREW_CAMERA_MIN_DISTANCE;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = CREW_ORBIT_SPEED;
    this.controls.update();
  }
  private stopCrewFocus(): void {
    if (this.focusTarget !== "crew") return;
    this.focusTarget = "ship";
    this.controls.autoRotate = false;
    this.controls.enablePan = true;
    this.controls.minDistance = SHIP_CAMERA_MIN_DISTANCE;
    this.trackedPosition.set(this.vessel.root.position.x, 0, this.vessel.root.position.z);
  }
  pickCrew(clientX: number, clientY: number): number | null {
    const rectangle = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rectangle.left) / rectangle.width) * 2 - 1,
      (-(clientY - rectangle.top) / rectangle.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.crew.pickable, false)[0];
    if (!hit) return null;
    if (this.viewMode !== "xray") {
      const blockers = this.vessel.structure
        .filter((structure) => structure.mesh.visible)
        .map((structure) => structure.mesh);
      const obstruction = this.raycaster.intersectObjects(blockers, false)[0];
      if (obstruction && obstruction.distance < hit.distance - 0.15)
        return null;
    }
    return hit.instanceId ?? null;
  }
  private applyInspection(): void {
    this.ocean.setInspection(this.viewMode !== "exterior" || this.deckLevel > 0);
    const ceiling = this.deckLevel
      ? 1 + (this.deckLevel - 1) * 2.4 + 1.8
      : Infinity;
    for (const structure of this.vessel.structure) {
      const above =
        this.deckLevel > 0 &&
        (structure.rig || structure.deck > this.deckLevel);
      const cut =
        this.viewMode === "cutaway" && structure.side === this.cutSide;
      structure.mesh.visible = !above && !cut && !(structure.restOnly && this.battleStations);
      structure.mesh.material =
        this.viewMode === "xray" ? structure.ghost : structure.original;
      (structure.original as THREE.MeshStandardMaterial).clippingPlanes = this
        .deckLevel
        ? [this.deckClip]
        : [];
      (structure.ghost as THREE.MeshStandardMaterial).clippingPlanes = this
        .deckLevel
        ? [this.deckClip]
        : [];
    }
    for (const illumination of this.vessel.interiorLights)
      illumination.light.visible = !this.deckLevel || illumination.deck <= this.deckLevel;
    for (const sail of this.vessel.sails) {
      sail.pivot.visible = !this.deckLevel;
      sail.mesh.material.transparent = this.viewMode !== "exterior";
      sail.mesh.material.opacity =
        this.viewMode === "xray" ? 0.1 : this.viewMode === "cutaway" ? 0.65 : 1;
      sail.mesh.material.depthWrite = this.viewMode === "exterior";
    }
    this.vessel.ropes.visible = !this.deckLevel;
    (this.vessel.ropes.material as THREE.LineBasicMaterial).opacity =
      this.viewMode === "xray" ? 0.25 : 0.85;
    this.vessel.root.traverse((object) => {
      if (object.userData.staysail) {
        object.visible = !this.deckLevel;
        const mat = (object as THREE.Mesh)
          .material as THREE.MeshStandardMaterial;
        mat.transparent = this.viewMode !== "exterior";
        mat.opacity =
          this.viewMode === "xray"
            ? 0.1
            : this.viewMode === "cutaway"
              ? 0.6
              : 1;
      }
      if (object.userData.pennant) object.visible = !this.deckLevel;
    });
    this.vessel.flag.visible = ceiling > 18;
  }
  private updateSails(
    vessel: Vessel,
    state: SimulationState,
    enemy: boolean,
  ): void {
    const ship = enemy ? state.enemy : state.ship;
    const trim = sailTrim(ship.heading, state.wind.direction);
    for (const sail of vessel.sails) {
      const deploy = THREE.MathUtils.clamp(
        (ship.sail - (sail.level === 2 ? 0.7 : sail.level === 1 ? 0.15 : 0)) /
          (sail.level === 2 ? 0.3 : sail.level === 1 ? 0.5 : 0.5),
        0.035,
        1,
      );
      sail.mesh.scale.y = deploy;
      sail.mesh.scale.x = 0.08 + 0.92 * Math.sqrt(deploy);
      sail.furled.scale.set(
        Math.max(0.05, Math.sqrt(1 - deploy)),
        Math.max(0.05, Math.sqrt(1 - deploy)),
        1,
      );
      sail.pivot.rotation.y = trim;
      const attribute = sail.mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let index = 0; index < attribute.count; index++) {
        const x = sail.rest[index * 3],
          y = sail.rest[index * 3 + 1],
          z = sail.rest[index * 3 + 2];
        const flutter =
          Math.sin(state.time * 2.5 + z * 0.8 + y * 0.5 + sail.phase) *
          0.07 *
          (-y / sail.height);
        attribute.setX(index, x + flutter);
      }
      attribute.needsUpdate = true;
    }
    for (const sail of vessel.staysails) {
      const positions = sail.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const rest = sail.userData.rest as Float32Array;
      const axis = sail.userData.axis as number;
      const deploy = Math.max(0.015, ship.sail);
      for (let index = 0; index < positions.count; index++) {
        positions.setX(index, axis + (rest[index * 3] - axis) * deploy);
        positions.setZ(
          index,
          rest[index * 3 + 2] * deploy +
            Math.sin(state.time * 3 + rest[index * 3 + 1]) * 0.025 * deploy,
        );
      }
      positions.needsUpdate = true;
    }
    const flagPositions = vessel.flag.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let index = 0; index < flagPositions.count; index++) {
      const x = flagPositions.getX(index);
      flagPositions.setZ(
        index,
        Math.sin(x * 2 - state.time * 4) * 0.22 * (x / 4.5 + 0.5),
      );
    }
    flagPositions.needsUpdate = true;
  }
  private updateCrew(state: SimulationState): void {
    const ceiling = this.deckLevel
      ? 1 + (this.deckLevel - 1) * 2.4 + 1.8
      : Infinity;
    this.crew.update(state, ceiling, this.selectedId);
    const selected = state.crew.find((crew) => crew.id === this.selectedId);
    this.selection.visible =
      !!selected && selected.health > 0 && selected.position.y < ceiling;
    if (selected)
      this.selection.position.set(
        selected.position.x,
        selected.position.y + 0.05,
        selected.position.z,
      );
    if (this.focusTarget === "crew") {
      if (selected && selected.health > 0) {
        this.cameraTarget.set(selected.position.x, selected.position.y + CREW_FOCUS_HEIGHT, selected.position.z);
        this.vessel.root.localToWorld(this.cameraTarget);
        this.cameraDisplacement.copy(this.cameraTarget).sub(this.trackedPosition);
        this.camera.position.add(this.cameraDisplacement);
        this.controls.target.copy(this.cameraTarget);
        this.trackedPosition.copy(this.cameraTarget);
      } else {
        this.stopCrewFocus();
      }
    }
    const object = this.matrix;
    for (const gun of state.guns) {
      const dimensions = GUN_DIMENSIONS[gun.calibre];
      const visible = gun.position.y < ceiling ? 1 : 0;
      const side = gun.side === "port" ? -1 : 1;
      const recoil = gun.recoil * 1.1 * dimensions.lengthScale;
      object.scale.set(dimensions.widthScale * visible, dimensions.widthScale * visible, dimensions.lengthScale * visible);
      object.rotation.set(0, side < 0 ? Math.PI : 0, 0);
      object.position.set(gun.position.x, gun.position.y + dimensions.axisHeight,
        gun.position.z + side * (GUN_MOUNT_FORWARD - recoil));
      object.updateMatrix();
      this.vessel.barrels.setMatrixAt(gun.id, object.matrix);
      object.scale.setScalar(visible);
      object.position.set(gun.position.x, gun.position.y, gun.position.z - side * recoil);
      object.updateMatrix();
      const carriage = this.vessel.carriages.get(gun.calibre)!;
      carriage.mesh.setMatrixAt(gun.id - carriage.firstId, object.matrix);
    }
    this.vessel.barrels.instanceMatrix.needsUpdate = true;
    for (const carriage of this.vessel.carriages.values()) carriage.mesh.instanceMatrix.needsUpdate = true;
  }
  private emit(event: BattleEvent, time: number): void {
    if (
      event.kind !== "shot" &&
      event.kind !== "hit" &&
      event.kind !== "splash"
    )
      return;
    const from = new THREE.Vector3(
      event.position.x,
      event.position.y,
      event.position.z,
    );
    if (event.kind === "shot" && event.target) {
      const target = new THREE.Vector3(
        event.target.x,
        event.target.y,
        event.target.z,
      );
      const ball = new THREE.Mesh(
        this.shotGeometry,
        new THREE.MeshBasicMaterial({ color: 0x282925 }),
      );
      this.scene.add(ball);
      this.particles.push({
        mesh: ball,
        velocity: new THREE.Vector3(),
        born: event.time,
        life: Math.max(0.2, from.distanceTo(target) / 105),
        kind: "ball",
        start: from,
        end: target,
      });
      const flash = new THREE.Mesh(
        this.smokeGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffdc8c,
          transparent: true,
          opacity: 0.9,
        }),
      );
      flash.scale.setScalar(1);
      flash.position.copy(from);
      this.scene.add(flash);
      this.particles.push({
        mesh: flash,
        velocity: new THREE.Vector3(),
        born: time,
        life: 0.18,
        kind: "flash",
        start: from,
        end: target,
      });
    }
    for (
      let index = 0;
      index < (event.kind === "shot" ? 4 : event.kind === "splash" ? 5 : 2);
      index++
    ) {
      const splash = event.kind === "splash";
      const mesh = new THREE.Mesh(
        this.smokeGeometry,
        new THREE.MeshBasicMaterial({
          color: splash
            ? 0xc5e4e5
            : event.kind === "shot"
              ? 0xc9c4b1
              : 0x8b7965,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
      mesh.position.copy(from);
      mesh.scale.setScalar(0.3 + index * 0.13);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (seeded(event.id + index) - 0.5) * 1.4,
          splash ? 3 + index : 0.5 + index * 0.2,
          (seeded(event.id + index + 9) - 0.5) * 1.4,
        ),
        born: time,
        life: splash ? 1.6 : 5 + index * 0.5,
        kind: splash ? "splash" : "smoke",
        start: from,
        end: from,
      });
    }
  }
  private updateEffects(state: SimulationState, delta: number): void {
    for (const event of state.events)
      if (event.id > this.lastEvent) {
        if (state.time - event.time < 6) this.emit(event, state.time);
        this.lastEvent = event.id;
      }
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index],
        age = state.time - particle.born;
      if (age > particle.life) {
        this.scene.remove(particle.mesh);
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(index, 1);
        continue;
      }
      const fraction = age / particle.life;
      if (particle.kind === "ball") {
        particle.mesh.position.lerpVectors(
          particle.start,
          particle.end,
          fraction,
        );
        particle.mesh.position.y += Math.sin(fraction * Math.PI) * 1.8;
      } else {
        particle.mesh.position.addScaledVector(particle.velocity, delta);
        if (particle.kind === "splash") particle.velocity.y -= delta * 6;
        particle.mesh.scale.setScalar(
          particle.kind === "flash"
            ? 1.6
            : 0.45 + age * (particle.kind === "smoke" ? 0.65 : 0.2),
        );
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity =
          (1 - fraction) * (particle.kind === "flash" ? 0.9 : 0.35);
      }
    }
    for (const [vessel, ship] of [
      [this.vessel, state.ship],
      [this.enemy, state.enemy],
    ] as const) {
      vessel.fire.visible = ship.fire > 0.1;
      vessel.fire.children.forEach((flame, index) => {
        flame.scale.y =
          (0.6 + Math.sin(state.time * 10 + index) * 0.3) *
          Math.min(4, ship.fire);
      });
    }
  }
  update(state: SimulationState, delta: number): void {
    if (state.stations !== this.battleStations) {
      this.battleStations = state.stations;
      this.applyInspection();
    }
    if (this.focusTarget !== "crew") {
      const target =
        this.focusTarget === "enemy" && state.enemy.active
          ? state.enemy
          : state.ship;
      this.cameraDisplacement.set(
        target.position.x - this.trackedPosition.x,
        0,
        target.position.z - this.trackedPosition.z,
      );
      if (this.cameraDisplacement.length() < 40) {
        this.camera.position.add(this.cameraDisplacement);
        this.controls.target.add(this.cameraDisplacement);
      }
      this.trackedPosition.set(target.position.x, 0, target.position.z);
    }
    this.vessel.root.position.set(
      state.ship.position.x,
      (state.ship.sunk
        ? -Math.min(14, (100 - state.ship.hull) * 0.08)
        : Math.sin(state.time * 0.65) * 0.12) - DESIGN_WATERLINE,
      state.ship.position.z,
    );
    this.vessel.root.rotation.set(
      Math.sin(state.time * 0.45) * 0.008,
      -state.ship.heading * DEG,
      Math.sin(state.time * 0.6) * 0.008 + (state.ship.sunk ? 0.18 : 0),
    );
    this.deckClip.constant =
      this.vessel.root.position.y +
      (this.deckLevel ? 1 + (this.deckLevel - 1) * 2.4 + 1.8 : 1000);
    this.enemy.root.visible = state.enemy.active;
    this.enemy.root.position.set(
      state.enemy.position.x,
      (state.enemy.sunk ? -8 : Math.sin(state.time * .6) * .13) - DESIGN_WATERLINE,
      state.enemy.position.z,
    );
    this.enemy.root.rotation.y = -state.enemy.heading * DEG;
    const localCamera = this.vessel.root.worldToLocal(
      this.camera.position.clone(),
    );
    const nextSide = localCamera.z >= 0 ? 1 : -1;
    if (nextSide !== this.cutSide) {
      this.cutSide = nextSide;
      if (this.viewMode === "cutaway") this.applyInspection();
    }
    this.updateSails(this.vessel, state, false);
    if (state.enemy.active) this.updateSails(this.enemy, state, true);
    this.updateCrew(state);
    this.updateEffects(state, delta);
    const sun = this.scene.getObjectByName(
      "Afternoon sunlight",
    ) as THREE.DirectionalLight;
    sun.position
      .copy(OCEAN_SUN_DIRECTION)
      .multiplyScalar(120)
      .add(this.vessel.root.position);
    sun.target.position.copy(this.vessel.root.position);
    sun.target.updateMatrixWorld();
    this.ocean.update({
      time: state.time,
      windDirectionDegrees: state.wind.direction,
      windSpeed: state.wind.speed,
      shipWorldX: state.ship.position.x,
      shipWorldZ: state.ship.position.z,
      shipHeadingDegrees: state.ship.heading,
      shipSpeed: state.ship.speed,
    });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
