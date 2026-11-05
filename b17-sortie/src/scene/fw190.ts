import * as THREE from 'three';
import { applyBrushwork } from '../render/miniature';
import { applyStudioShading, glassMaterial, matteMaterial, metalMaterial } from '../render/studio';
import { airfoilSection, ellipseRing, loftGeometry, mirrorAcrossZ } from './loft';
import { part, roundedBox } from './kit';
import { handCutFlashTextures } from './textures';

/**
 * A Focke-Wulf Fw 190 A-8 in model metres (+x forward, y up, +z starboard; the thrust line at y = 0): 8.95 m long,
 * 10.5 m span, the BMW 801's 1.3 m cowling, a low wing with 6° dihedral, the blown hood. Painted in the 1944 day
 * fighter scheme, RLM 74/75 greys mottled down the sides over RLM 76 below, with a yellow panel under the cowling.
 */

/** Fuselage stations: x, top, bottom and half-width; the cowling runs from the first to `COWL_STATIONS`. */
const FUSELAGE: readonly (readonly [number, number, number, number])[] = [
  [3.92, 0.58, -0.58, 0.6],
  [3.7, 0.64, -0.64, 0.65],
  [3.0, 0.66, -0.66, 0.66],
  [2.3, 0.62, -0.64, 0.62],
  [1.4, 0.58, -0.62, 0.55],
  [0.6, 0.5, -0.6, 0.47],
  [-0.4, 0.44, -0.55, 0.42],
  [-1.4, 0.4, -0.45, 0.35],
  [-2.6, 0.33, -0.3, 0.25],
  [-3.6, 0.27, -0.12, 0.15],
  [-4.4, 0.22, 0.02, 0.06],
  [-4.6, 0.2, 0.08, 0.02],
];
const COWL_STATIONS = 4;
const RING_POINTS = 28;

/** Wing stations out from the centreline: span, leading-edge x, chord, thickness ratio. The tips are rounded off. */
const WING: readonly (readonly [number, number, number, number])[] = [
  [0.3, 1.55, 2.45, 0.15],
  [1.5, 1.45, 2.15, 0.14],
  [3.0, 1.32, 1.8, 0.125],
  [4.5, 1.18, 1.42, 0.11],
  [5.0, 1.1, 1.18, 0.1],
  [5.2, 0.98, 0.86, 0.09],
  [5.25, 0.82, 0.5, 0.08],
];
const WING_ROOT_Y = -0.38;
const DIHEDRAL = THREE.MathUtils.degToRad(6);

const TAILPLANE: readonly (readonly [number, number, number, number])[] = [
  [0.1, -3.72, 1.02, 0.1],
  [1.2, -3.86, 0.82, 0.09],
  [1.75, -3.98, 0.58, 0.08],
  [1.83, -4.08, 0.36, 0.07],
];
const TAILPLANE_Y = 0.16;

/** Fin stations up from the fuselage: height, leading-edge x, chord, thickness ratio. */
const FIN: readonly (readonly [number, number, number, number])[] = [
  [0.15, -3.2, 1.4, 0.1],
  [0.9, -3.62, 0.98, 0.09],
  [1.28, -3.94, 0.56, 0.08],
  [1.38, -4.12, 0.26, 0.07],
];

const PROPELLER = { x: 3.95, spinnerLength: 0.62, spinnerRadius: 0.36, bladeLength: 1.62, bladeChord: 0.24, bladeThickness: 0.05 } as const;
/** The hood: centre, half-length, height above the sill and half-width. */
const HOOD = { x: -0.32, y: 0.44, halfLength: 0.78, height: 0.44, halfWidth: 0.3 } as const;
/** The four guns' muzzles: two MG 131s over the cowling, two MG 151/20s in the wing roots. */
const MUZZLES: readonly THREE.Vector3[] = [
  new THREE.Vector3(3.0, 0.62, -0.12), new THREE.Vector3(3.0, 0.62, 0.12),
  new THREE.Vector3(1.6, -0.3, -1.05), new THREE.Vector3(1.6, -0.3, 1.05),
];
const COLOURS = { upper: '#5d6366', mottle: '#6f7578', lower: '#aab6bb', yellow: '#d9a62b', black: '#16181a', white: '#e8e6dc' } as const;
const FLAT_PAINT = { roughness: 0.66, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.72 } as const;
/** Width of a muzzle flash's paper star, model metres. */
const MUZZLE_FLASH_SIZE = 0.55;
/** Balkenkreuz arm length and width, and its white edging's width, model metres. */
const CROSS = { arm: 0.9, width: 0.22, edge: 0.06 } as const;

export interface Fw190 {
  root: THREE.Group;
  /** Turned about x to a fresh angle each exposure the engine runs. */
  propeller: THREE.Group;
  /** Muzzle flashes at the guns, shown on the exposures they fire. */
  flashes: THREE.Mesh[];
}

/** A painted surface mapped round its loft: upper colours across the top of the ring, RLM 76 under it. */
function paintTexture(kind: 'fuselage' | 'cowl' | 'wing', seed: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  // Loft v runs round the ring: fuselage rings start under the belly (0) through starboard to the top (0.5); wing
  // sections from the upper trailing edge round the leading edge (0.5) to the lower surface.
  context.fillStyle = COLOURS.lower;
  context.fillRect(0, 0, size, size);
  if (kind === 'wing') {
    context.fillStyle = COLOURS.upper;
    context.fillRect(0, 0, size, size * 0.5);
  } else {
    const gradient = context.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0.18, COLOURS.lower);
    gradient.addColorStop(0.3, COLOURS.upper);
    gradient.addColorStop(0.7, COLOURS.upper);
    gradient.addColorStop(0.82, COLOURS.lower);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    // Soft mottle sprayed down the sides, where the upper greys feather into RLM 76.
    let state = seed;
    const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
    for (let spot = 0; spot < 140; spot++) {
      const v = random() < 0.5 ? 0.16 + random() * 0.14 : 0.7 + random() * 0.14;
      context.fillStyle = random() < 0.5 ? COLOURS.upper : COLOURS.mottle;
      context.globalAlpha = 0.35 + random() * 0.4;
      context.beginPath();
      context.arc(random() * size, v * size, 3 + random() * 7, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    if (kind === 'cowl') {
      context.fillStyle = COLOURS.yellow;
      context.fillRect(0, 0, size, size * 0.12);
      context.fillRect(0, size * 0.88, size, size * 0.12);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function paint(map: THREE.Texture | null, color: THREE.ColorRepresentation = '#ffffff'): THREE.MeshStandardMaterial {
  return applyBrushwork(applyStudioShading(new THREE.MeshPhysicalMaterial({ color, map, ...FLAT_PAINT })));
}

interface Fw190Materials {
  fuselage: THREE.MeshStandardMaterial;
  cowl: THREE.MeshStandardMaterial;
  wing: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  fan: THREE.MeshStandardMaterial;
  spinner: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  hood: THREE.MeshPhysicalMaterial;
  frame: THREE.MeshStandardMaterial;
  pilot: THREE.MeshStandardMaterial;
  armour: THREE.MeshStandardMaterial;
  crossBlack: THREE.MeshStandardMaterial;
  crossWhite: THREE.MeshStandardMaterial;
  /** Hand-cut paper flashes, one per piece; each gun shows one of them. */
  flashes: THREE.MeshBasicMaterial[];
}

/** One shared set of materials for every fighter: they are painted alike. */
let materials: Fw190Materials | null = null;

function createMaterials(): Fw190Materials {
  return {
    fuselage: paint(paintTexture('fuselage', 190)),
    cowl: paint(paintTexture('cowl', 801)),
    wing: paint(paintTexture('wing', 0)),
    tail: paint(null, COLOURS.upper),
    fan: matteMaterial('#202224', { roughness: 0.6 }),
    spinner: paint(null, COLOURS.black),
    blade: paint(null, '#2c3029'),
    hood: glassMaterial({ opacity: 0.22 }),
    frame: paint(null, COLOURS.upper),
    pilot: matteMaterial('#4a3424', { roughness: 0.8 }),
    armour: metalMaterial('#3d4144', { roughness: 0.6, metalness: 0.4 }),
    crossBlack: paint(null, COLOURS.black),
    crossWhite: paint(null, COLOURS.white),
    flashes: handCutFlashTextures().map((texture) => new THREE.MeshBasicMaterial({
      map: texture, color: new THREE.Color(2.4, 2.1, 1.8), alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false,
    })),
  };
}

/** Lofts a flying surface from stations [span, leading-edge x, chord, thickness] placed by `place`. */
function surfaceGeometry(
  stations: readonly (readonly [number, number, number, number])[],
  place: (span: number, chordX: number, height: number) => THREE.Vector3,
): THREE.BufferGeometry {
  const rings = stations.map(([span, leadingEdge, chord, thickness]) => airfoilSection(thickness, 0.01, 0.4, 12)
    .map((point) => place(span, leadingEdge - point.x * chord, point.y * chord)));
  return loftGeometry(rings, stations.map((_, index) => index / (stations.length - 1)), true, true);
}

function fuselageGeometry(from: number, to: number): THREE.BufferGeometry {
  const stations = FUSELAGE.slice(from, to);
  const rings = stations.map(([x, top, bottom, halfWidth]) => ellipseRing(new THREE.Vector3(x, 0, 0), top, bottom, halfWidth, RING_POINTS, 2.2));
  return loftGeometry(rings, stations.map((_, index) => index / (stations.length - 1)), from === 0, to === FUSELAGE.length);
}

/** A Balkenkreuz: the white-edged black cross, flat in its local x–y plane, facing +z. */
function balkenkreuz(parent: THREE.Object3D, shared: Fw190Materials, position: THREE.Vector3, rotation: THREE.Euler, scale: number): void {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.copy(rotation);
  group.scale.setScalar(scale);
  const { arm, width, edge } = CROSS;
  for (const [length, breadth, material, lift] of [[arm + edge * 2, width + edge * 2, shared.crossWhite, 0], [arm, width, shared.crossBlack, 0.004]] as const) {
    part(group, new THREE.PlaneGeometry(length, breadth), material, 0, 0, lift, { castShadow: false });
    part(group, new THREE.PlaneGeometry(breadth, length), material, 0, 0, lift, { castShadow: false });
  }
  parent.add(group);
}

export function buildFw190(): Fw190 {
  materials ??= createMaterials();
  const shared = materials;
  const root = new THREE.Group();
  part(root, fuselageGeometry(0, COWL_STATIONS), shared.cowl, 0, 0, 0);
  part(root, fuselageGeometry(COWL_STATIONS - 1, FUSELAGE.length), shared.fuselage, 0, 0, 0);
  // The cooling fan behind the spinner, filling the cowling's mouth.
  part(root, new THREE.CircleGeometry(0.56, 24), shared.fan, FUSELAGE[0][0] + 0.005, 0, 0, { rotation: [0, Math.PI / 2, 0], castShadow: false });

  const wing = surfaceGeometry(WING, (span, x, height) => new THREE.Vector3(x, WING_ROOT_Y + span * Math.tan(DIHEDRAL) + height, span));
  part(root, wing, shared.wing, 0, 0, 0);
  part(root, mirrorAcrossZ(wing), shared.wing, 0, 0, 0);
  const tailplane = surfaceGeometry(TAILPLANE, (span, x, height) => new THREE.Vector3(x, TAILPLANE_Y + height, span));
  part(root, tailplane, shared.wing, 0, 0, 0);
  part(root, mirrorAcrossZ(tailplane), shared.wing, 0, 0, 0);
  const finTop = FUSELAGE[FUSELAGE.length - 3][1];
  part(root, surfaceGeometry(FIN, (height, x, across) => new THREE.Vector3(x, finTop + height, across)), shared.tail, 0, 0, 0);

  // The blown hood over the pilot, his head and the armour behind it, and the windscreen's frame.
  const hood = part(root, new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), shared.hood, HOOD.x, HOOD.y, 0, { castShadow: false });
  hood.scale.set(HOOD.halfLength, HOOD.height, HOOD.halfWidth);
  part(root, new THREE.SphereGeometry(0.13, 12, 8), shared.pilot, HOOD.x + 0.1, HOOD.y + 0.2, 0);
  part(root, roundedBox(0.05, 0.36, 0.34, 0.02), shared.armour, HOOD.x - 0.12, HOOD.y + 0.18, 0);
  const frame = part(root, new THREE.TorusGeometry(1, 0.025, 4, 24, Math.PI), shared.frame, HOOD.x + HOOD.halfLength * 0.55, HOOD.y, 0, { rotation: [0, Math.PI / 2, 0] });
  frame.scale.set(HOOD.halfWidth, HOOD.height * 0.84, 1);

  const propeller = new THREE.Group();
  propeller.position.x = PROPELLER.x;
  root.add(propeller);
  part(propeller, new THREE.ConeGeometry(PROPELLER.spinnerRadius, PROPELLER.spinnerLength, 20), shared.spinner, PROPELLER.spinnerLength / 2, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
  for (let blade = 0; blade < 3; blade++) {
    const holder = new THREE.Group();
    holder.rotation.x = (blade / 3) * Math.PI * 2;
    const mesh = part(holder, roundedBox(PROPELLER.bladeThickness, PROPELLER.bladeLength, PROPELLER.bladeChord, 0.02), shared.blade, 0.12, PROPELLER.bladeLength / 2 + 0.2, 0);
    mesh.rotation.y = 0.35;
    propeller.add(holder);
  }

  // Crosses on the fuselage sides and under and over each wing.
  for (const side of [-1, 1]) {
    balkenkreuz(root, shared, new THREE.Vector3(-1.95, 0.02, side * 0.32), new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0), 0.8);
    const wingY = WING_ROOT_Y + 3.6 * Math.tan(DIHEDRAL);
    balkenkreuz(root, shared, new THREE.Vector3(0.45, wingY + 0.13, side * 3.6), new THREE.Euler(-Math.PI / 2, 0, 0), 0.9);
    balkenkreuz(root, shared, new THREE.Vector3(0.45, wingY - 0.11, side * 3.6), new THREE.Euler(Math.PI / 2, 0, 0), 1.1);
  }

  // A paper flash at each muzzle: a star cut from paper, set square across the line of fire.
  const flashes = MUZZLES.map((muzzle, index) => {
    const material = shared.flashes[index % shared.flashes.length];
    const flash = part(root, new THREE.PlaneGeometry(MUZZLE_FLASH_SIZE, MUZZLE_FLASH_SIZE), material, muzzle.x + 0.1, muzzle.y, muzzle.z, { rotation: [0, Math.PI / 2, 0], castShadow: false });
    flash.visible = false;
    return flash;
  });
  return { root, propeller, flashes };
}
