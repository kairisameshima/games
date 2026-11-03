import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  addVirtualLight, applyStudioShading, emissiveMaterial, matteMaterial, metalMaterial, type PlanarReflection, type VirtualLight,
} from '../render/studio';
import { mergeStaticMeshes, part, roundedBox, textPlateTexture } from './kit';
import { PALETTE } from './palette';

const FLOOR_TILE_GRID = 4;
const FLOOR_CANVAS_SIZE = 1024;
const BACK_WALL_Z = -15;
const WALL_SEAM_SPACING = 2.4;
const CLOUD_DECK_LENGTH = 40;

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
  return sweep;
}

/** Low-poly cumulus built from flat-shaded spheres, the guide's pale-prop treatment. */
function buildCloud(seed: number): THREE.Mesh {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const puffs: THREE.BufferGeometry[] = [];
  const puffCount = 6 + Math.floor(random() * 6);
  const length = 2.2 + random() * 2.4;
  for (let puff = 0; puff < puffCount; puff++) {
    const radius = 0.45 + random() * 0.55;
    const geometry = new THREE.IcosahedronGeometry(radius, 1);
    const t = puff / (puffCount - 1);
    geometry.scale(1.25, 0.8 + random() * 0.3, 1);
    geometry.translate((t - 0.5) * length, radius * 0.45 + Math.sin(t * Math.PI) * 0.35 * random(), (random() - 0.5) * 1.1);
    puffs.push(geometry);
  }
  const merged = mergeGeometries(puffs);
  merged.computeVertexNormals();
  const cloud = new THREE.Mesh(merged, matteMaterial(PALETTE.paleProp, { flatShading: true, roughness: 0.55, envMapIntensity: 0.7 }));
  cloud.castShadow = true;
  cloud.receiveShadow = true;
  return cloud;
}

function buildCloudDeck(): THREE.Group {
  const clouds = new THREE.Group();
  let seed = 41;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < 16; index++) {
    const cloud = buildCloud(1000 + index * 97);
    cloud.position.set((random() - 0.5) * CLOUD_DECK_LENGTH, 0.05 + random() * 0.35, -12 + random() * 15);
    cloud.rotation.y = (random() - 0.5) * 0.6;
    const scale = 0.55 + random() * 0.5;
    cloud.scale.setScalar(scale);
    clouds.add(cloud);
  }
  return clouds;
}

/** Moves the cloud deck aft at the formation's ground speed and wraps it round. */
export function driftClouds(clouds: THREE.Group, deltaSec: number, speed: number): void {
  for (const cloud of clouds.children) {
    cloud.position.x -= speed * deltaSec;
    if (cloud.position.x < -CLOUD_DECK_LENGTH / 2) cloud.position.x += CLOUD_DECK_LENGTH;
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

export interface DisplayStand {
  root: THREE.Group;
  /** Re-aims the rod from the base to the model's mounting point, in world space. */
  aimAt: (mountPoint: THREE.Vector3) => void;
}

const STAND_ROD_RADIUS = 0.035;

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
  const joint = part(root, new THREE.SphereGeometry(0.075, 16, 12), brass, 0, 0, 0);
  const rodBase = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const aimAt = (mountPoint: THREE.Vector3) => {
    rodBase.set(0, 0.46, 0).add(root.position);
    direction.subVectors(mountPoint, rodBase);
    const length = direction.length();
    rod.scale.set(1, length, 1);
    rod.quaternion.setFromUnitVectors(UP_AXIS, direction.normalize());
    joint.position.subVectors(mountPoint, root.position);
  };
  return { root, aimAt };
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
