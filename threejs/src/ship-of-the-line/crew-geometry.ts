import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type HatKind = "cap" | "round" | "officer" | "marine";
export type UniformKind = "officer" | "marine" | "carpenter";
export type LimbKind = "upper-arm" | "forearm" | "thigh" | "calf";

type BodySection = readonly [height: number, halfWidth: number, halfDepth: number, depthOffset: number, lateralOffset?: number];

const REFERENCE_HEAD_RADIUS = .135;
const TORSO_SECTIONS: readonly BodySection[] = [
  [-.5, .153, .088, 0], [-.44, .157, .092, 0], [-.3, .16, .096, .002],
  [-.1, .174, .106, .004], [.1, .191, .116, .006], [.27, .202, .115, .003],
  [.39, .185, .105, -.002], [.46, .145, .079, -.006], [.5, .066, .058, -.01],
];
const HEAD_SECTIONS: readonly BodySection[] = [
  [-.125, .034, .03, .045], [-.115, .052, .054, .024], [-.082, .075, .067, .009],
  [-.045, .084, .084, .002], [-.015, .09, .092, -.004], [.02, .088, .092, -.006],
  [.055, .087, .093, -.008], [.092, .08, .085, -.01], [.12, .059, .065, -.012],
  [.133, .014, .02, -.013],
];
const LIMB_SECTIONS: Record<LimbKind, readonly BodySection[]> = {
  "upper-arm": [
    [-.5, .05, .044, 0], [-.4, .055, .05, .001], [-.2, .065, .057, .004],
    [.05, .074, .064, .002], [.3, .073, .067, -.002], [.46, .061, .06, -.004],
    [.5, .058, .054, -.004], [.515, .043, .044, -.004],
    [.525, .02, .026, -.004], [.527, .003, .004, -.004],
  ],
  forearm: [
    [-.5, .031, .027, .002], [-.39, .035, .032, .002], [-.15, .046, .042, .008],
    [.12, .052, .048, .004], [.38, .049, .046, 0], [.5, .044, .042, -.001],
    [.59, .016, .02, 0], [.61, .002, .003, 0],
  ],
  thigh: [
    [-.5, .057, .057, .004], [-.39, .063, .066, .002], [-.12, .078, .083, -.003],
    [.15, .092, .098, -.004], [.38, .094, .096, -.002], [.5, .076, .078, 0],
    [.55, .045, .06, 0], [.6, .003, .004, 0],
  ],
  calf: [
    [-.5, .033, .037, -.002], [-.4, .037, .044, -.006], [-.18, .052, .064, -.012],
    [.05, .066, .075, -.014], [.25, .065, .067, -.007], [.43, .056, .054, 0],
    [.5, .054, .052, .002], [.6, .018, .023, .005], [.62, .002, .003, .005],
  ],
};

const LINEN = 0xe0d8bc;
const LEATHER = 0x352b23;
const GOLD = 0xba9752;
const NAVY = 0x24394f;
const UP = new THREE.Vector3(0, 1, 0);
export const SAILOR_HAND_GRIP = new THREE.Vector3(0, -.03, .025);
const CLOTH_CLEARANCE = .007;
const OUTER_CLOTH_CLEARANCE = .018;

function combine(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (let index = 0; index < parts.length; index++) {
    const source = parts[index];
    if (source.index) continue;
    parts[index] = mergeVertices(source);
    source.dispose();
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Sailor geometry attributes are incompatible");
  return geometry;
}

function colored(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute("position").count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
  return geometry;
}

function ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number, segments = 8): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, segments, 6).scale(sx, sy, sz).translate(x, y, z);
}

function ribbon(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number): THREE.BufferGeometry {
  const direction = to.clone().sub(from);
  const length = direction.length();
  return new THREE.BoxGeometry(width, length, depth, 1, 5, 1)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.divideScalar(length)))
    .translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
}

function bodyLoft(sections: readonly BodySection[], segments = 12): THREE.BufferGeometry {
  const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let ring = 0; ring < sections.length; ring++) {
    const [y, width, depth, z, x = 0] = sections[ring];
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      vertices.push(x + Math.cos(angle) * width, y, z + Math.sin(angle) * depth);
      uv.push(segment / segments, ring / (sections.length - 1));
      if (ring === sections.length - 1) continue;
      const a = ring * segments + segment;
      const b = ring * segments + (segment + 1) % segments;
      indices.push(a, a + segments, b, b, a + segments, b + segments);
    }
  }
  const bottom = sections[0], top = sections[sections.length - 1];
  const bottomCenter = vertices.length / 3, topCenter = bottomCenter + 1;
  vertices.push(bottom[4] ?? 0, bottom[0], bottom[3], top[4] ?? 0, top[0], top[3]);
  uv.push(.5, 0, .5, 1);
  const lastRing = (sections.length - 1) * segments;
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    indices.push(bottomCenter, segment, next, topCenter, lastRing + next, lastRing + segment);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bodySurface(sections: readonly BodySection[], x: number, y: number, side: -1 | 1 = 1): number {
  let lower = sections[0], upper = lower;
  for (const section of sections) {
    upper = section;
    if (y <= section[0]) break;
    lower = section;
  }
  const blend = upper[0] === lower[0] ? 0 : THREE.MathUtils.clamp((y - lower[0]) / (upper[0] - lower[0]), 0, 1);
  const width = THREE.MathUtils.lerp(lower[1], upper[1], blend);
  const depth = THREE.MathUtils.lerp(lower[2], upper[2], blend);
  const offset = THREE.MathUtils.lerp(lower[3], upper[3], blend);
  return offset + side * depth * Math.sqrt(Math.max(0, 1 - (x / width) ** 2));
}

function fittedRibbon(height: number, from: THREE.Vector2, to: THREE.Vector2, width: number, side: -1 | 1 = 1, clearance = CLOTH_CLEARANCE): THREE.BufferGeometry {
  const geometry = ribbon(new THREE.Vector3(from.x, from.y * height, 0),
    new THREE.Vector3(to.x, to.y * height, 0), width, .009);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const surface = bodySurface(TORSO_SECTIONS, positions.getX(vertex), positions.getY(vertex) / height, side);
    positions.setZ(vertex, surface + side * (positions.getZ(vertex) + clearance));
  }
  if (side < 0) {
    const indices = geometry.getIndex()!;
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      const second = indices.getX(triangle + 1);
      indices.setX(triangle + 1, indices.getX(triangle + 2));
      indices.setX(triangle + 2, second);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function faceRelief(x: number, y: number): number {
  const cheek = Math.exp(-(((Math.abs(x) - .046) / .025) ** 2) - ((y + .014) / .026) ** 2);
  const brow = Math.exp(-(((Math.abs(x) - .033) / .022) ** 2) - ((y - .044) / .013) ** 2);
  const socket = Math.exp(-(((Math.abs(x) - .031) / .019) ** 2) - ((y - .022) / .012) ** 2);
  return cheek * .007 + brow * .007 - socket * .006;
}

function faceSurface(x: number, y: number): number {
  return bodySurface(HEAD_SECTIONS, x, y) + faceRelief(x, y);
}

export function sailorTorsoGeometry(height: number): THREE.BufferGeometry {
  const geometry = bodyLoft(TORSO_SECTIONS.map(([y, width, depth, offset]) => [y * height, width, depth, offset]), 16);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const y = positions.getY(vertex) / height, x = positions.getX(vertex), z = positions.getZ(vertex);
    const waistFold = Math.exp(-(((y + .33) / .19) ** 2));
    const fold = Math.sin(Math.atan2(z, x) * 7 + y * 9) * .003 * waistFold;
    positions.setZ(vertex, z + fold);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function sailorLimbGeometry(kind: LimbKind, length: number): THREE.BufferGeometry {
  const geometry = bodyLoft(LIMB_SECTIONS[kind].map(([y, width, depth, offset]) =>
    [y * length, width, depth, offset]), 12);
  if (kind === "forearm") return geometry;
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const y = positions.getY(vertex) / length;
    const crease = Math.exp(-(((y + .36) / .14) ** 2)) * Math.sin(y * 38) * .002;
    positions.setZ(vertex, positions.getZ(vertex) + crease);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function sailorPelvisGeometry(): THREE.BufferGeometry {
  const geometry = bodyLoft([
    [-.125, .159, .081, .001], [-.09, .19, .108, 0], [-.03, .194, .11, -.003],
    [.035, .174, .099, 0], [.07, .151, .087, 0],
  ], 16);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const y = positions.getY(vertex);
    if (y >= -.09) continue;
    const inseam = Math.max(0, 1 - Math.abs(positions.getX(vertex)) / .16);
    positions.setY(vertex, y + .015 * inseam ** 2);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function sailorHeadGeometry(radius: number): THREE.BufferGeometry {
  const skull = bodyLoft(HEAD_SECTIONS, 20);
  const positions = skull.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const z = positions.getZ(vertex);
    if (z > 0) positions.setZ(vertex, z + faceRelief(positions.getX(vertex), positions.getY(vertex)));
  }
  skull.computeVertexNormals();
  const parts = [skull, bodyLoft([
    [-.037, .008, .007, .1], [-.027, .015, .013, .108], [-.013, .012, .02, .109],
    [.008, .009, .014, .101], [.038, .005, .008, .09],
  ], 8)];
  for (const side of [-1, 1]) {
    parts.push(ellipsoid(side * .092, -.009, -.005, .015, .027, .018, 8));
    parts.push(new THREE.TorusGeometry(.018, .003, 4, 10).scale(.66, 1, .65)
      .rotateY(Math.PI / 2).translate(side * .104, -.006, -.005));
    const eyeX = side * .031;
    parts.push(ellipsoid(eyeX, .027, faceSurface(eyeX, .027) + .001, .014, .003, .004, 8));
    parts.push(ellipsoid(eyeX, .016, faceSurface(eyeX, .016) + .001, .013, .002, .003, 8));
  }
  const scale = radius / REFERENCE_HEAD_RADIUS;
  return combine(parts).scale(scale, scale, scale);
}

export function sailorFaceGeometry(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * .031, eyeZ = faceSurface(x, .022) + .001;
    parts.push(colored(ellipsoid(x, .022, eyeZ, .012, .0045, .004, 8), 0xc5bda7));
    parts.push(colored(new THREE.CircleGeometry(.0035, 10).translate(x, .022, eyeZ + .0045), 0x55452f));
    parts.push(colored(new THREE.CircleGeometry(.0018, 8).translate(x, .022, eyeZ + .0048), 0x251e18));
    const brow = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(x - .014, .039, faceSurface(x - .014, .039) + .002),
      new THREE.Vector3(x, .046, faceSurface(x, .046) + .003),
      new THREE.Vector3(x + .014, .04, faceSurface(x + .014, .04) + .002));
    parts.push(colored(new THREE.TubeGeometry(brow, 5, .0017, 3, false), 0x4a3828));
    parts.push(colored(ellipsoid(side * .01, -.031, .115, .003, .0016, .002, 6), 0x785443));
  }
  const mouth = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-.02, -.059, faceSurface(-.02, -.059) + .002),
    new THREE.Vector3(0, -.055, faceSurface(0, -.055) + .004),
    new THREE.Vector3(.02, -.059, faceSurface(.02, -.059) + .002));
  parts.push(colored(new THREE.TubeGeometry(mouth, 6, .0014, 3, false), 0x765347));
  const scale = radius / REFERENCE_HEAD_RADIUS;
  return combine(parts).scale(scale, scale, scale);
}

export function sailorHairGeometry(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    bodyLoft(HEAD_SECTIONS.filter(([y]) => y >= .055)
      .map(([y, width, depth, offset]) => [y + .001, width + .003, depth + .003, offset]), 20),
    new THREE.SphereGeometry(1, 12, 5, Math.PI, Math.PI, 1.02, 1.12).scale(.095, .135, .1),
    ellipsoid(0, -.084, -.092, .023, .021, .021, 8),
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -.09, -.095), new THREE.Vector3(0, -.123, -.105),
      new THREE.Vector3(0, -.155, -.101),
    ]), 6, .011, 5, false),
  ];
  for (const side of [-1, 1]) parts.push(ellipsoid(side * .083, .022, .031, .009, .029, .014, 6));
  const scale = radius / REFERENCE_HEAD_RADIUS;
  return combine(parts).scale(scale, scale, scale);
}

export function sailorHandGeometry(side: -1 | 1): THREE.BufferGeometry {
  const parts = [
    bodyLoft([
      [-.033, .034, .016, .007], [-.014, .039, .022, .002], [.014, .036, .022, 0],
      [.036, .028, .019, 0], [.055, .025, .022, 0], [.07, .026, .025, 0],
    ], 10),
  ];
  for (let finger = 0; finger < 4; finger++) {
    const shorter = Math.abs(finger - 1.5) * .004;
    parts.push(bodyLoft([
      [-.068 + shorter, .003, .004, .021], [-.061 + shorter, .006, .007, .027],
      [-.046 + shorter, .008, .009, .029], [-.028, .0085, .01, .017], [-.012, .008, .009, .009],
    ], 6).translate(-.024 + finger * .016, 0, 0));
  }
  parts.push(bodyLoft([
    [-.043, .004, .005, .029, -side * .032], [-.035, .009, .01, .029, -side * .037],
    [-.017, .012, .013, .019, -side * .042], [.006, .014, .016, .009, -side * .027],
  ], 8));
  return combine(parts);
}

export function sailorShoeGeometry(): THREE.BufferGeometry {
  const upper = new THREE.SphereGeometry(1, 16, 8);
  const positions = upper.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const z = positions.getZ(vertex), y = positions.getY(vertex);
    const forefoot = Math.exp(-(((z - .35) / .7) ** 2));
    positions.setXYZ(vertex, positions.getX(vertex) * (.044 + forefoot * .011),
      -.012 + (y + 1) * .5 * (.035 + (1 - z) * .014), z * .108 + .012);
  }
  upper.computeVertexNormals();
  const outline = new THREE.Shape();
  outline.moveTo(-.033, -.1); outline.quadraticCurveTo(-.048, -.105, -.048, -.065);
  outline.lineTo(-.055, .065); outline.quadraticCurveTo(-.054, .121, -.023, .124);
  outline.quadraticCurveTo(.046, .133, .055, .075); outline.lineTo(.047, -.065);
  outline.quadraticCurveTo(.047, -.105, .033, -.1); outline.closePath();
  const sole = new THREE.ExtrudeGeometry(outline, { depth: .014, bevelEnabled: false, curveSegments: 4 })
    .rotateX(Math.PI / 2).translate(0, -.015, 0);
  const solePositions = sole.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < solePositions.count; vertex++) {
    const arch = Math.max(0, 1 - Math.abs(solePositions.getZ(vertex) + .022) / .04);
    if (solePositions.getY(vertex) < -.02)
      solePositions.setY(vertex, solePositions.getY(vertex) + arch * .008);
  }
  sole.computeVertexNormals();
  return combine([
    upper, sole,
    new THREE.CylinderGeometry(.041, .046, .044, 12).translate(0, .053, -.055),
    new THREE.TorusGeometry(.041, .003, 4, 12).rotateX(Math.PI / 2).translate(0, .073, -.055),
  ]);
}

export function sailorClothingGeometry(height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .085, .46),
      new THREE.Vector2(side * .025, .22), .037), LINEN));
    parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .085, .37),
      new THREE.Vector2(0, .18), .025, 1, OUTER_CLOTH_CLEARANCE), NAVY));
  }
  const knotY = height * .18, knotZ = bodySurface(TORSO_SECTIONS, 0, .18) + .012;
  parts.push(colored(ellipsoid(0, knotY, knotZ, .019, .02, .012, 8), NAVY));
  parts.push(colored(fittedRibbon(height, new THREE.Vector2(0, .17),
    new THREE.Vector2(.025, -.02), .024, 1, OUTER_CLOTH_CLEARANCE), NAVY));
  parts.push(colored(bodyLoft([
    [-height * .42, .159, .097, .001], [-height * .35, .164, .1, .002],
  ], 16), LEATHER));
  const buckle = new THREE.Shape();
  buckle.moveTo(-.026, -.016); buckle.lineTo(.026, -.016); buckle.lineTo(.026, .016); buckle.lineTo(-.026, .016); buckle.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-.019, -.009); opening.lineTo(-.019, .009); opening.lineTo(.019, .009); opening.lineTo(.019, -.009); opening.closePath();
  buckle.holes.push(opening);
  parts.push(colored(new THREE.ExtrudeGeometry(buckle, { depth: .007, bevelEnabled: false })
    .translate(0, -height * .385, .105), GOLD));
  parts.push(colored(new THREE.BoxGeometry(.028, .003, .008).translate(.004, -height * .385, .112), GOLD));
  for (let button = 0; button < 3; button++) {
    const y = .045 - button * .067;
    parts.push(colored(new THREE.CylinderGeometry(.007, .007, .004, 8).rotateX(Math.PI / 2)
      .translate(0, y, bodySurface(TORSO_SECTIONS, 0, y / height) + .005), LINEN));
  }
  return combine(parts);
}

export function sailorUniformGeometry(kind: UniformKind, height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === "carpenter") {
    const apron = new THREE.Shape();
    apron.moveTo(-.075, .13); apron.lineTo(.075, .13); apron.lineTo(.145, -.12);
    apron.lineTo(.155, -.39); apron.lineTo(-.155, -.39); apron.lineTo(-.145, -.12); apron.closePath();
    parts.push(colored(new THREE.ExtrudeGeometry(apron, { depth: .012, bevelEnabled: false }).translate(0, 0, .117), 0x85623d));
    parts.push(colored(new THREE.BoxGeometry(.12, .08, .014).translate(0, -.17, .136), 0x67482e));
  } else if (kind === "marine") {
    for (const side of [-1, 1]) {
      parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .13, .4),
        new THREE.Vector2(-side * .125, -.37), .035, 1, side === 1 ? OUTER_CLOTH_CLEARANCE : CLOTH_CLEARANCE), LINEN));
      parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .13, .4),
        new THREE.Vector2(-side * .125, -.37), .035, -1, side === 1 ? OUTER_CLOTH_CLEARANCE : CLOTH_CLEARANCE), LINEN));
    }
    parts.push(colored(new THREE.CylinderGeometry(.024, .024, .016, 10).rotateX(Math.PI / 2)
      .translate(0, -.015, .141), GOLD));
    parts.push(colored(new THREE.BoxGeometry(.09, .11, .038).translate(.14, -.2, .118), LEATHER));
  } else {
    for (const side of [-1, 1]) {
      parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .115, .4),
        new THREE.Vector2(side * .047, -.05), .045), LINEN));
      parts.push(colored(fittedRibbon(height, new THREE.Vector2(side * .141, .39),
        new THREE.Vector2(side * .073, -.05), .005), GOLD));
      parts.push(colored(ellipsoid(side * .19, height * .41, -.004, .055, .013, .067, 8), GOLD));
      parts.push(colored(bodyLoft([
        [-.4, .048, .018, -.089], [-.29, .063, .025, -.092], [-.19, .067, .033, -.08],
      ], 8).translate(side * .091, 0, 0), NAVY));
      for (let button = 0; button < 4; button++) {
        const x = side * .063, y = .09 - button * .066;
        parts.push(colored(new THREE.CylinderGeometry(.007, .007, .005, 8).rotateX(Math.PI / 2)
          .translate(x, y, bodySurface(TORSO_SECTIONS, x, y / height) + .014), GOLD));
      }
    }
  }
  return combine(parts);
}

export function sailorHatGeometry(kind: HatKind): THREE.BufferGeometry {
  if (kind === "cap") return combine([
    colored(ellipsoid(.006, -.004, -.004, .113, .045, .105, 16), 0x4b5149),
    colored(new THREE.CylinderGeometry(.1, .102, .022, 16).scale(1, 1, .93).translate(0, -.027, 0), 0x343c3c),
  ]);
  if (kind === "round") return combine([
    colored(new THREE.LatheGeometry([
      new THREE.Vector2(.1, -.028), new THREE.Vector2(.145, -.033), new THREE.Vector2(.18, -.025),
      new THREE.Vector2(.18, -.021), new THREE.Vector2(.145, -.027), new THREE.Vector2(.1, -.022),
    ], 20).scale(1, 1, .93), 0x34332c),
    colored(new THREE.CylinderGeometry(.1, .109, .066, 16).translate(0, .005, 0), 0x34332c),
    colored(new THREE.CylinderGeometry(.11, .111, .013, 16).translate(0, -.015, 0), 0x65533d),
  ]);
  const vertices: number[] = [], indices: number[] = [], uv: number[] = [], edge: THREE.Vector3[] = [];
  const segments = 36, folds = kind === "officer" ? 3 : 2, rings = 3;
  for (let ring = 0; ring < rings; ring++) for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const point = (.5 + .5 * Math.cos(angle * folds));
    const across = ring / (rings - 1);
    const radius = THREE.MathUtils.lerp(.099, .15 + .055 * point, across);
    const y = -.027 + .075 * (1 - point) * across ** 2;
    vertices.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    uv.push(index / segments, across);
    if (ring === rings - 1) edge.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    if (ring < rings - 1) {
      const a = ring * segments + index, b = ring * segments + (index + 1) % segments;
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  }
  const brim = new THREE.BufferGeometry();
  brim.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  brim.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  brim.setIndex(indices);
  brim.computeVertexNormals();
  return combine([
    colored(brim, 0x252a29),
    colored(new THREE.CylinderGeometry(.097, .105, .066, 16).translate(0, .005, 0), 0x252a29),
    colored(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 36, .0035, 3, true), kind === "officer" ? GOLD : LINEN),
  ]);
}
