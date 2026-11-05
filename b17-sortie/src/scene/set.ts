import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  addVirtualLight, applyStudioShading, emissiveMaterial, matteMaterial, metalMaterial, type PlanarReflection, type VirtualLight,
} from '../render/studio';
import { cottonMaterial, cottonTuftLayers } from '../render/miniature';
import { mergeStaticMeshes, part, roundedBox, textPlateTexture } from './kit';
import { PALETTE } from './palette';

const FLOOR_TILE_GRID = 4;
const FLOOR_CANVAS_SIZE = 1024;
const BACK_WALL_Z = -15;
const WALL_SEAM_SPACING = 2.4;
const CLOUD_DECK_LENGTH = 40;
/** Where the backdrop's two sheets meet, taped. */
const BACKDROP_SEAM_X = -3.4;
const TAPE_WIDTH = 0.14;
const TAPE_STANDOFF = 0.015;

export interface StudioSet {
  /** Lab mood: navy set, tiled floor, amber practicals. Hidden in Studio. */
  lab: THREE.Group;
  /** Studio mood: warm cream sweep. Hidden in Lab. */
  sweep: THREE.Group;
  floor: THREE.Mesh;
  practicalLights: VirtualLight[];
  clouds: THREE.Group;
}

function floorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FLOOR_CANVAS_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const tileSize = FLOOR_CANVAS_SIZE / FLOOR_TILE_GRID;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < FLOOR_TILE_GRID; row++) {
    for (let column = 0; column < FLOOR_TILE_GRID; column++) {
      const x = column * tileSize;
      const y = row * tileSize;
      context.fillStyle = `hsl(${212 + random() * 8}, ${7 + random() * 4}%, ${50 + random() * 6}%)`;
      context.fillRect(x, y, tileSize, tileSize);
      for (let smudge = 0; smudge < 70; smudge++) {
        const alpha = 0.025 + random() * 0.03;
        context.fillStyle = smudge % 2 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        context.beginPath();
        context.ellipse(x + random() * tileSize, y + random() * tileSize, 8 + random() * 40, 4 + random() * 22, random() * Math.PI, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  context.strokeStyle = '#3e434b';
  context.lineWidth = 3;
  for (let line = 0; line <= FLOOR_TILE_GRID; line++) {
    context.beginPath();
    context.moveTo(line * tileSize, 0);
    context.lineTo(line * tileSize, FLOOR_CANVAS_SIZE);
    context.moveTo(0, line * tileSize);
    context.lineTo(FLOOR_CANVAS_SIZE, line * tileSize);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 6);
  texture.anisotropy = 8;
  return texture;
}

/** Light strip that also lights its surroundings through a virtual light at its centre. */
function lightStrip(
  parent: THREE.Object3D,
  lights: VirtualLight[],
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  intensity: number,
  lightRadius: number,
): void {
  part(parent, new THREE.BoxGeometry(...size), emissiveMaterial(color, intensity), ...position);
  lights.push(addVirtualLight(new THREE.Vector3(...position), color, lightRadius, 0.9));
}

function buildLabSet(lights: VirtualLight[]): THREE.Group {
  const lab = new THREE.Group();
  const wall = matteMaterial(PALETTE.setWall, { roughness: 0.62, envMapIntensity: 0.6 });
  const panel = matteMaterial(PALETTE.wallPanel, { roughness: 0.7 });
  const trim = metalMaterial(PALETTE.trim, { roughness: 0.36 });
  const trimDark = metalMaterial(PALETTE.trimDark, { roughness: 0.4 });
  const paleProp = matteMaterial(PALETTE.paleProp, { flatShading: true, roughness: 0.55, envMapIntensity: 0.7 });

  const wallWidth = 64;
  const wallHeight = 18;
  part(lab, new THREE.BoxGeometry(wallWidth, wallHeight, 0.5), wall, 0, wallHeight / 2, BACK_WALL_Z - 0.25);
  for (let x = -wallWidth / 2 + WALL_SEAM_SPACING; x < wallWidth / 2; x += WALL_SEAM_SPACING) {
    part(lab, new THREE.BoxGeometry(0.05, wallHeight, 0.04), panel, x, wallHeight / 2, BACK_WALL_Z + 0.02);
  }
  part(lab, roundedBox(wallWidth, 0.28, 0.24, 0.04), trim, 0, 0.14, BACK_WALL_Z + 0.12);
  // Gaffer tape over a join in the backing board, and a patch where a flat was nailed up in a hurry.
  part(lab, new THREE.BoxGeometry(0.16, 9.5, 0.01), matteMaterial(PALETTE.gafferTape, { roughness: 0.75 }), BACKDROP_SEAM_X, 4.9, BACK_WALL_Z + 0.03);
  part(lab, new THREE.BoxGeometry(0.9, 0.16, 0.01), matteMaterial(PALETTE.gafferTape, { roughness: 0.75 }), BACKDROP_SEAM_X + 0.1, 9.4, BACK_WALL_Z + 0.04, { rotation: [0, 0, 0.12] });
  part(lab, roundedBox(wallWidth, 0.12, 0.3, 0.03), trimDark, 0, 14.2, BACK_WALL_Z + 0.15);

  // Two open shelving bays behind the formation, stocked like a model shop's parts wall.
  for (const centreX of [-12.5, 12.5]) {
    for (const [index, shelfY] of [2.4, 4.6, 6.8].entries()) {
      part(lab, roundedBox(8.6, 0.14, 1.3, 0.04), panel, centreX, shelfY, BACK_WALL_Z + 0.65);
      part(lab, roundedBox(8.6, 0.05, 0.06, 0.02), trim, centreX, shelfY + 0.03, BACK_WALL_Z + 1.3);
      lightStrip(lab, lights, [8.2, 0.045, 0.05], [centreX, shelfY - 0.1, BACK_WALL_Z + 1.25], index % 2 ? PALETTE.amberWarm : PALETTE.amber, 2.6, 2.8);
      for (let crate = 0; crate < 4; crate++) {
        const width = 0.7 + ((crate * 37 + index * 11) % 5) * 0.12;
        const height = 0.5 + ((crate * 13 + index * 7) % 4) * 0.14;
        part(lab, roundedBox(width, height, 0.8, 0.05), crate % 3 === 0 ? trimDark : paleProp, centreX - 3.2 + crate * 2.1, shelfY + 0.07 + height / 2, BACK_WALL_Z + 0.7);
      }
    }
    for (const sideX of [centreX - 4.4, centreX + 4.4]) {
      part(lab, roundedBox(0.22, 7.6, 1.4, 0.05), trimDark, sideX, 3.8, BACK_WALL_Z + 0.65);
    }
  }

  // Tall gantry frames framing the formation, with amber strips down their inner faces.
  for (const side of [-1, 1]) {
    const frameX = side * 17;
    part(lab, roundedBox(0.5, 13, 0.5, 0.06), trim, frameX, 6.5, -6);
    part(lab, roundedBox(0.5, 13, 0.5, 0.06), trim, frameX, 6.5, -11);
    part(lab, roundedBox(0.5, 0.5, 5.5, 0.06), trim, frameX, 13, -8.5);
    lightStrip(lab, lights, [0.05, 11.5, 0.06], [frameX - side * 0.27, 6.5, -6], PALETTE.amberSoft, 2.4, 3.4);
  }
  lightStrip(lab, lights, [56, 0.06, 0.06], [0, 14.05, BACK_WALL_Z + 0.32], PALETTE.amber, 3.0, 3.5);
  lightStrip(lab, lights, [60, 0.05, 0.05], [0, 0.32, BACK_WALL_Z + 0.26], PALETTE.amberWarm, 1.6, 2.2);
  return lab;
}

function buildFloor(reflection: PlanarReflection): THREE.Mesh {
  const material = applyStudioShading(new THREE.MeshStandardMaterial({
    map: floorTexture(), roughness: 0.2, metalness: 0.05, envMapIntensity: 0.55,
  }), reflection);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(72, 48), material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

/** Cream cove: floor curving up into the back wall, so the horizon disappears. */
function buildSweep(): THREE.Group {
  const sweep = new THREE.Group();
  const coveRadius = 9;
  const reach = 30;
  // Profile in (y, z): floor running toward the camera, a quarter-circle cove, then the wall.
  const profile: [number, number][] = [[0, reach], [0, 0]];
  for (let step = 1; step <= 16; step++) {
    const angle = (step / 16) * (Math.PI / 2);
    profile.push([coveRadius - Math.cos(angle) * coveRadius, -Math.sin(angle) * coveRadius]);
  }
  profile.push([reach, -coveRadius]);
  const width = 80;
  const positions: number[] = [];
  for (const x of [-width / 2, width / 2]) for (const [y, z] of profile) positions.push(x, y, z);
  const indices: number[] = [];
  for (let index = 0; index < profile.length - 1; index++) {
    const right = profile.length + index;
    indices.push(index, index + 1, right, index + 1, right + 1, right);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const cove = new THREE.Mesh(geometry, matteMaterial(PALETTE.studioBackground, { roughness: 0.9, envMapIntensity: 0.5, side: THREE.DoubleSide }));
  cove.position.z = BACK_WALL_Z + coveRadius;
  cove.receiveShadow = true;
  sweep.add(cove);
  // Two sheets of backdrop paper butt together here, the join taped down the wall, round the cove and onto the floor.
  const seam = tapeRibbon(profile.slice(1).map(([y, z]) => new THREE.Vector3(BACKDROP_SEAM_X, y, z)));
  const seamMesh = new THREE.Mesh(seam, matteMaterial(PALETTE.maskingTape, { roughness: 0.85, side: THREE.DoubleSide }));
  seamMesh.position.z = cove.position.z;
  seamMesh.receiveShadow = true;
  sweep.add(seamMesh);
  return sweep;
}

/** Cotton filaments per cloud unit (a tuft is half to one unit across), and how far its fibre halo reaches. */
const CLOUD_COTTON = { frequency: 30, fuzz: 0.1, shells: 4 } as const;
/** Stop-motion boil: how far an animator's hands shift a cloud between frames. */
const CLOUD_BOIL = { turn: 0.012, scale: 0.012, lift: 0.006 } as const;

/**
 * A cumulus of cotton wool: a handful of tufts pressed together, flattened a little where it sits. The fibre shells are
 * a child mesh that casts no shadow, since the body's shadow already covers theirs.
 */
function buildCloud(seed: number, material: THREE.Material): THREE.Mesh {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const bodies: THREE.BufferGeometry[] = [];
  const shells: THREE.BufferGeometry[] = [];
  const tuftCount = 6 + Math.floor(random() * 6);
  const length = 2.2 + random() * 2.4;
  const placement = new THREE.Matrix4();
  for (let tuft = 0; tuft < tuftCount; tuft++) {
    const radius = 0.45 + random() * 0.55;
    const layers = cottonTuftLayers(seed + tuft * 13, { detail: 6, shellDetail: 4, shells: CLOUD_COTTON.shells });
    const t = tuft / (tuftCount - 1);
    placement.compose(
      new THREE.Vector3((t - 0.5) * length, 0, (random() - 0.5) * 1.1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(radius * 1.25, radius * (0.8 + random() * 0.3), radius),
    );
    placement.elements[13] = radius * 0.45 + Math.sin(t * Math.PI) * 0.35 * random();
    bodies.push(layers.body.applyMatrix4(placement));
    shells.push(layers.shells.applyMatrix4(placement));
  }
  const cloud = new THREE.Mesh(mergeGeometries(bodies), material);
  cloud.castShadow = true;
  cloud.receiveShadow = true;
  const fuzz = new THREE.Mesh(mergeGeometries(shells), material);
  fuzz.receiveShadow = true;
  cloud.add(fuzz);
  return cloud;
}

function buildCloudDeck(): THREE.Group {
  const clouds = new THREE.Group();
  const material = cottonMaterial({ color: PALETTE.paleProp, frequency: CLOUD_COTTON.frequency, fuzz: CLOUD_COTTON.fuzz });
  let seed = 41;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < 16; index++) {
    const cloud = buildCloud(1000 + index * 97, material);
    cloud.position.set((random() - 0.5) * CLOUD_DECK_LENGTH, 0.05 + random() * 0.35, -12 + random() * 15);
    cloud.rotation.y = (random() - 0.5) * 0.6;
    const scale = 0.55 + random() * 0.5;
    cloud.scale.setScalar(scale);
    cloud.userData.rest = { y: cloud.position.y, turn: cloud.rotation.y, scale };
    clouds.add(cloud);
  }
  return clouds;
}

/**
 * One stop-motion frame of the cloud deck: it moves aft by the frame's worth of the formation's ground speed, wrapping
 * round, and every cloud is nudged a hair off its rest pose, the boil of cotton re-handled between exposures.
 */
export function driftClouds(clouds: THREE.Group, frameSec: number, speed: number, random: () => number): void {
  if (frameSec <= 0) return;
  for (const cloud of clouds.children) {
    cloud.position.x -= speed * frameSec;
    if (cloud.position.x < -CLOUD_DECK_LENGTH / 2) cloud.position.x += CLOUD_DECK_LENGTH;
    const rest = cloud.userData.rest as { y: number; turn: number; scale: number };
    cloud.rotation.y = rest.turn + (random() - 0.5) * CLOUD_BOIL.turn;
    cloud.scale.setScalar(rest.scale * (1 + (random() - 0.5) * CLOUD_BOIL.scale));
    cloud.position.y = rest.y + (random() - 0.5) * CLOUD_BOIL.lift;
  }
}

export function buildStudioSet(reflection: PlanarReflection): StudioSet {
  const practicalLights: VirtualLight[] = [];
  const labStatic = buildLabSet(practicalLights);
  const lab = new THREE.Group();
  lab.add(mergeStaticMeshes(labStatic));
  const floor = buildFloor(reflection);
  lab.add(floor);
  const sweep = buildSweep();
  sweep.visible = false;
  return { lab, sweep, floor, practicalLights, clouds: buildCloudDeck() };
}

/** A flat strip of tape laid along a path across x (the tape's width runs along x), standing just off the surface. */
function tapeRibbon(points: THREE.Vector3[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  points.forEach((point, index) => {
    tangent.subVectors(points[Math.min(index + 1, points.length - 1)], points[Math.max(index - 1, 0)]).normalize();
    normal.crossVectors(ACROSS_AXIS, tangent).normalize().multiplyScalar(TAPE_STANDOFF);
    for (const side of [-1, 1]) positions.push(point.x + (side * TAPE_WIDTH) / 2, point.y + normal.y, point.z + normal.z);
    if (index > 0) {
      const a = (index - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const ACROSS_AXIS = new THREE.Vector3(1, 0, 0);

function cuttingMatTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  context.fillStyle = PALETTE.cuttingMat;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const cell = 32;
  for (let x = cell; x < canvas.width; x += cell) {
    context.strokeStyle = (x / cell) % 5 === 0 ? 'rgba(230,240,220,0.55)' : 'rgba(230,240,220,0.22)';
    context.lineWidth = (x / cell) % 5 === 0 ? 2 : 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = cell; y < canvas.height; y += cell) {
    context.strokeStyle = (y / cell) % 5 === 0 ? 'rgba(230,240,220,0.55)' : 'rgba(230,240,220,0.22)';
    context.lineWidth = (y / cell) % 5 === 0 ? 2 : 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  context.fillStyle = 'rgba(230,240,220,0.7)';
  context.font = '600 15px "DM Mono", Menlo, monospace';
  for (let x = cell * 5; x < canvas.width; x += cell * 5) context.fillText(String(x / cell), x + 3, 16);
  // Knife scores from cutting decals and masks.
  context.strokeStyle = 'rgba(15,35,28,0.5)';
  let seed = 19;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let score = 0; score < 40; score++) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const angle = random() * Math.PI;
    const length = 30 + random() * 160;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function rulerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  context.fillStyle = '#b8bec4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1b1d20';
  const millimetre = canvas.width / 300;
  for (let mark = 0; mark <= 300; mark++) {
    const length = mark % 10 === 0 ? 40 : mark % 5 === 0 ? 28 : 16;
    context.fillRect(mark * millimetre, 0, 2, length);
    if (mark % 10 === 0 && mark > 0 && mark < 300) {
      context.font = '600 22px "DM Mono", Menlo, monospace';
      context.fillText(String(mark / 10), mark * millimetre - 8, 68);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The set's own construction left in frame: the animator's cutting mat and steel rule on the floor in front of the box,
 * and a lamp on a light stand at the side, aimed in at the formation.
 */
export function buildWorkshop(): THREE.Group {
  const workshop = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(WORKSHOP.mat.width, WORKSHOP.mat.depth), applyStudioShading(new THREE.MeshStandardMaterial({
    map: cuttingMatTexture(), roughness: 0.82, envMapIntensity: 0.3,
  })));
  mat.rotation.set(-Math.PI / 2, 0, WORKSHOP.mat.turn);
  mat.position.copy(WORKSHOP.mat.centre);
  mat.receiveShadow = true;
  workshop.add(mat);
  const rule = new THREE.Mesh(new THREE.BoxGeometry(WORKSHOP.rule.length, 0.012, 0.11), [
    metalMaterial(PALETTE.chrome, { roughness: 0.3, metalness: 1 }), metalMaterial(PALETTE.chrome, { roughness: 0.3, metalness: 1 }),
    applyStudioShading(new THREE.MeshPhysicalMaterial({ map: rulerTexture(), metalness: 0.85, roughness: 0.35, envMapIntensity: 1 })),
    metalMaterial(PALETTE.chrome, { roughness: 0.3, metalness: 1 }), metalMaterial(PALETTE.chrome, { roughness: 0.3, metalness: 1 }),
    metalMaterial(PALETTE.chrome, { roughness: 0.3, metalness: 1 }),
  ]);
  rule.position.copy(WORKSHOP.rule.position);
  rule.rotation.y = WORKSHOP.rule.turn;
  rule.castShadow = true;
  rule.receiveShadow = true;
  workshop.add(rule);

  const stand = new THREE.Group();
  stand.position.copy(WORKSHOP.lamp.foot);
  const black = matteMaterial('#18191b', { roughness: 0.6 });
  const steel = metalMaterial(PALETTE.chrome, { roughness: 0.28, metalness: 1 });
  for (let leg = 0; leg < 3; leg++) {
    const angle = (leg / 3) * Math.PI * 2;
    const foot = new THREE.Vector3(Math.cos(angle) * 1.1, 0, Math.sin(angle) * 1.1);
    const hip = new THREE.Vector3(0, 1.3, 0);
    const legMesh = part(stand, new THREE.CylinderGeometry(0.03, 0.03, foot.distanceTo(hip), 8), black, 0, 0, 0);
    legMesh.position.copy(foot).add(hip).multiplyScalar(0.5);
    legMesh.quaternion.setFromUnitVectors(UP_AXIS, hip.clone().sub(foot).normalize());
  }
  part(stand, new THREE.CylinderGeometry(0.05, 0.05, WORKSHOP.lamp.height, 10), steel, 0, WORKSHOP.lamp.height / 2, 0);
  const head = new THREE.Group();
  head.position.set(0, WORKSHOP.lamp.height, 0);
  part(head, new THREE.CylinderGeometry(0.42, 0.34, 0.6, 20, 1, true), black, 0, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  part(head, new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), black, -0.3, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  part(head, new THREE.CircleGeometry(0.38, 20), emissiveMaterial('#fff1d8', 2.2), 0.3, 0, 0, { rotation: [0, Math.PI / 2, 0], castShadow: false });
  for (const [y, z, tilt] of [[0.47, 0, -0.5], [-0.47, 0, 0.5], [0, 0.47, 0.5], [0, -0.47, -0.5]] as const) {
    const flap = part(head, new THREE.BoxGeometry(0.4, 0.02, 0.62), black, 0.48, y, z);
    if (z === 0) flap.rotation.z = tilt;
    else flap.rotation.set(Math.PI / 2, tilt, 0);
  }
  part(head, new THREE.BoxGeometry(0.06, 0.5, 0.06), steel, 0, -0.35, 0);
  // The lamp's face is its +x; turn it onto the formation.
  const aim = WORKSHOP.lamp.aim.clone().sub(WORKSHOP.lamp.foot).sub(head.position).normalize();
  head.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), aim);
  stand.add(head);
  workshop.add(stand);
  return workshop;
}

/** Where the workshop's things sit. */
const WORKSHOP = {
  mat: { centre: new THREE.Vector3(3.6, 0.006, 3.4), width: 4.8, depth: 3.6, turn: 0.22 },
  rule: { position: new THREE.Vector3(3.3, 0.012, 2.3), length: 4.2, turn: -0.08 },
  lamp: { foot: new THREE.Vector3(-11, 0, 4), height: 8.5, aim: new THREE.Vector3(0, 3.6, 0) },
} as const;

export interface DisplayStand {
  root: THREE.Group;
  /** Re-aims the rod from the base to the model's mounting point, in world space. */
  aimAt: (mountPoint: THREE.Vector3) => void;
}

const STAND_ROD_RADIUS = 0.035;
/** Rig marks on a stand: tape band and clamp distances below the joint, and the tape cross on the plinth top. */
const RIG_TAPE = { band: 0.07, belowJoint: 0.32, clampBelowJoint: 0.17, crossLength: 0.26, cross: new THREE.Vector3(0.62, 0.342, 0.28) } as const;

/** The brass ball joint at the top of a stand's rod, world units. */
export const STAND_JOINT_RADIUS = 0.075;

/** Gunmetal plinth with an amber edge strip, brass plaque, and a chrome rod up to the model's belly. */
export function buildDisplayStand(base: THREE.Vector3, plaque: { title: string; subtitle: string } | null, lights: VirtualLight[] | null): DisplayStand {
  const root = new THREE.Group();
  root.position.copy(base);
  const gunmetal = metalMaterial(PALETTE.gunmetalDark, { roughness: 0.4 });
  const chrome = metalMaterial(PALETTE.chrome, { roughness: 0.22, metalness: 1 });
  const brass = metalMaterial(PALETTE.brass, { roughness: 0.3, metalness: 1, clearcoat: 0.5 });
  part(root, roundedBox(2.4, 0.22, 1.5, 0.06), gunmetal, 0, 0.11, 0);
  part(root, roundedBox(1.9, 0.12, 1.1, 0.05), metalMaterial(PALETTE.anodised, { roughness: 0.46, metalness: 0.55 }), 0, 0.28, 0);
  part(root, new THREE.CylinderGeometry(0.16, 0.2, 0.12, 24), chrome, 0, 0.4, 0);
  part(root, new THREE.BoxGeometry(2.2, 0.035, 0.04), emissiveMaterial(PALETTE.amber, 2.4), 0, 0.05, 0.76);
  if (lights) lights.push(addVirtualLight(base.clone().add(new THREE.Vector3(0, 0.1, 0.9)), PALETTE.amber, 2.2, 0.8));
  if (plaque) {
    const texture = textPlateTexture({
      width: 1.3,
      height: 0.18,
      background: '#5a4220',
      lines: [
        { text: plaque.title, font: '700 44px Outfit, Arial, sans-serif', color: '#f3dfb8', y: 0.38 },
        { text: plaque.subtitle, font: '500 26px "DM Mono", Menlo, monospace', color: '#e6c58a', y: 0.76 },
      ],
    });
    const plate = new THREE.Mesh(roundedBox(1.3, 0.18, 0.02, 0.008), [brass, brass, brass, brass, applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: texture, metalness: 0.7, roughness: 0.32, clearcoat: 0.6, envMapIntensity: 1.1,
    })), brass]);
    plate.position.set(0, 0.28, 0.56);
    plate.rotation.x = -0.35;
    root.add(plate);
  }
  const rodGeometry = new THREE.CylinderGeometry(STAND_ROD_RADIUS, STAND_ROD_RADIUS, 1, 16);
  rodGeometry.translate(0, 0.5, 0);
  const rod = part(root, rodGeometry, chrome, 0, 0.46, 0);
  const joint = part(root, new THREE.SphereGeometry(STAND_JOINT_RADIUS, 16, 12), brass, 0, 0, 0);
  // The animator's rig marks: masking tape wound round the rod below the model, a screw clamp at the joint, and a tape
  // cross on the plinth where the base goes back after each knock.
  const tape = matteMaterial(PALETTE.maskingTape, { roughness: 0.85 });
  const tapeBand = part(root, new THREE.CylinderGeometry(STAND_ROD_RADIUS + 0.006, STAND_ROD_RADIUS + 0.006, RIG_TAPE.band, 16), tape, 0, 0, 0, { castShadow: false });
  const clamp = new THREE.Group();
  part(clamp, roundedBox(0.16, 0.07, 0.11, 0.015), gunmetal, 0, 0, 0);
  part(clamp, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 10), chrome, 0.11, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  part(clamp, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), chrome, 0.175, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  root.add(clamp);
  for (const turn of [Math.PI / 4, -Math.PI / 4]) {
    part(root, new THREE.BoxGeometry(RIG_TAPE.crossLength, 0.003, 0.045), tape, RIG_TAPE.cross.x, RIG_TAPE.cross.y, RIG_TAPE.cross.z, { rotation: [0, turn, 0], castShadow: false });
  }
  const rodBase = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const aimAt = (mountPoint: THREE.Vector3) => {
    rodBase.set(0, 0.46, 0).add(root.position);
    direction.subVectors(mountPoint, rodBase);
    const length = direction.length();
    rod.scale.set(1, length, 1);
    rod.quaternion.setFromUnitVectors(UP_AXIS, direction.normalize());
    joint.position.subVectors(mountPoint, root.position);
    tapeBand.quaternion.copy(rod.quaternion);
    tapeBand.position.copy(joint.position).addScaledVector(direction, -RIG_TAPE.belowJoint);
    clamp.quaternion.copy(rod.quaternion);
    clamp.position.copy(joint.position).addScaledVector(direction, -RIG_TAPE.clampBelowJoint);
  };
  return { root, aimAt };
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
