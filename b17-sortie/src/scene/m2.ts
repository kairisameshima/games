import * as THREE from 'three';
import { applyStudioShading, matteMaterial, metalMaterial } from '../render/studio';
import { mergeStaticMeshes, part, roundedBox } from './kit';

/**
 * Browning AN/M2 .50 calibre aircraft machine gun, the B-17G's only gun. Real dimensions (TM 9-225): 1.44 m overall,
 * 0.91 m light barrel inside a perforated cooling jacket, a 0.1 m wide receiver. Gun space: origin at the front of the
 * trunnion block (where every mount holds the gun), +x out of the muzzle, +y the top of the receiver, +z its right side.
 */

/** Hand-held guns (cheek, waist, radio hatch) carry spade grips and a ring sight; turret guns fire by solenoid. */
export type M2Kind = 'flexible' | 'turret';

const RECEIVER = { back: -0.52, top: 0.045, bottom: -0.095, halfWidth: 0.05 } as const;
const BACKPLATE_DEPTH = 0.035;
const FEED_COVER = { back: -0.47, front: -0.13, height: 0.024 } as const;
const BARREL = { radius: 0.0145, muzzle: 0.84 } as const;
const JACKET = { radius: 0.026, back: 0.05, front: 0.64 } as const;
const FLASH_HIDER = { length: 0.085, backRadius: 0.018, frontRadius: 0.027 } as const;
const SPADE_GRIP = { x: -0.645, y: -0.03, halfSpread: 0.062, length: 0.11, radius: 0.016 } as const;
/** Belt feedway: the slot under the feed cover each side of the receiver; belts can be fed from either side. */
const FEEDWAY = { x: -0.29, y: 0.025 } as const;
/** The bolt stud rides in a slot in the right side plate; it is the bolt's one visible part. */
const BOLT_SLOT = { front: -0.12, back: -0.31, y: -0.005 } as const;

/** AN/M2 cyclic rate: 750 to 850 rounds a minute. */
export const M2_ROUNDS_PER_SECOND = 800 / 60;
/** Barrel and barrel extension recoil 1 1/8 in inside the jacket; the bolt runs back about 6 1/2 in in its slot. */
export const M2_BARREL_RECOIL = 0.029;
export const M2_BOLT_TRAVEL = 0.165;
/** Tip of the flash hider, gun space. */
export const M2_MUZZLE = new THREE.Vector3(BARREL.muzzle + FLASH_HIDER.length, 0, 0);
/** Ejection port under the receiver, behind the trunnion block: cases and links drop out here. */
export const M2_EJECTION_PORT = new THREE.Vector3(-0.14, RECEIVER.bottom - 0.005, 0);

/** Spade-grip centres in gun space, left and right as seen by the gunner behind the gun. */
export const M2_GRIPS = {
  left: new THREE.Vector3(SPADE_GRIP.x, SPADE_GRIP.y, -SPADE_GRIP.halfSpread),
  right: new THREE.Vector3(SPADE_GRIP.x, SPADE_GRIP.y, SPADE_GRIP.halfSpread),
} as const;

/** Rear face of the backplate, under the receiver: where a remote linkage (the tail guns') takes hold. */
export const M2_BACKPLATE = new THREE.Vector3(RECEIVER.back - BACKPLATE_DEPTH, RECEIVER.bottom + 0.02, 0);

/** Where the belt enters the receiver on the given side (+1 right, −1 left), in gun space. */
export function m2Feedway(side: 1 | -1): THREE.Vector3 {
  return new THREE.Vector3(FEEDWAY.x, FEEDWAY.y, side * (RECEIVER.halfWidth + 0.01));
}

const UP = new THREE.Vector3(0, 1, 0);

/** Gun space to parent space for a gun at `origin` pointing along `direction`, receiver top toward `up`. */
export function m2Frame(origin: THREE.Vector3, direction: THREE.Vector3, up: THREE.Vector3 = UP): THREE.Matrix4 {
  const forward = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const top = new THREE.Vector3().crossVectors(right, forward);
  return new THREE.Matrix4().makeBasis(forward, top, right).setPosition(origin);
}

interface M2Materials { parkerized: THREE.MeshStandardMaterial; jacket: THREE.MeshStandardMaterial; grip: THREE.MeshStandardMaterial; opening: THREE.MeshStandardMaterial }

let sharedMaterials: M2Materials | null = null;

/**
 * Cooling-jacket perforations as an alpha map over the jacket's UVs (u round it, v along it): staggered oval slots,
 * with plain bands at each end where the jacket is clamped.
 */
function jacketPerforationTexture(): THREE.CanvasTexture {
  const around = 2 * Math.PI * JACKET.radius;
  const along = JACKET.front - JACKET.back;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const pxAround = canvas.width / around;
  const pxAlong = canvas.height / along;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  const columns = 7;
  const rowPitch = 0.034;
  const endBand = 0.035;
  const rows = Math.floor((along - 2 * endBand) / rowPitch);
  for (let row = 0; row <= rows; row++) {
    const y = (endBand + row * rowPitch) * pxAlong;
    for (let column = 0; column < columns; column++) {
      const x = ((column + (row % 2) * 0.5) / columns) * canvas.width;
      // Draw wrapped copies so slots crossing the seam stay whole.
      for (const offset of [-canvas.width, 0, canvas.width]) {
        context.beginPath();
        context.ellipse(x + offset, y, 0.0055 * pxAround, 0.011 * pxAlong, 0, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function m2Materials(): M2Materials {
  if (sharedMaterials) return sharedMaterials;
  const parkerized = metalMaterial('#1f2124', { roughness: 0.52, metalness: 0.6, clearcoat: 0.15, envMapIntensity: 0.9 });
  sharedMaterials = {
    parkerized,
    jacket: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#1f2124', roughness: 0.52, metalness: 0.6, clearcoat: 0.15, envMapIntensity: 0.9,
      alphaMap: jacketPerforationTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
    })),
    grip: matteMaterial('#241d18', { roughness: 0.6 }),
    opening: matteMaterial('#070708', { roughness: 0.9, envMapIntensity: 0.2 }),
  };
  return sharedMaterials;
}

/** Cylinder along gun +x from `back` to `front`. */
function alongBarrel(parent: THREE.Object3D, back: number, front: number, backRadius: number, frontRadius: number, material: THREE.Material, segments = 16, openEnded = false): THREE.Mesh {
  return part(parent, new THREE.CylinderGeometry(frontRadius, backRadius, front - back, segments, 1, openEnded), material, (back + front) / 2, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
}

function buildReceiver(gun: THREE.Group, materials: M2Materials): void {
  const length = -RECEIVER.back;
  const height = RECEIVER.top - RECEIVER.bottom;
  const middleY = (RECEIVER.top + RECEIVER.bottom) / 2;
  part(gun, roundedBox(length, height, RECEIVER.halfWidth * 2, 0.006), materials.parkerized, RECEIVER.back / 2, middleY, 0);
  // Side-plate reinforcements: the raised trunnion block at the front and the bottom-plate lips along each side.
  part(gun, roundedBox(0.1, height + 0.012, RECEIVER.halfWidth * 2 + 0.012, 0.006), materials.parkerized, -0.05, middleY, 0);
  for (const side of [-1, 1]) part(gun, roundedBox(length - 0.14, 0.012, 0.008, 0.003), materials.parkerized, RECEIVER.back / 2 - 0.02, RECEIVER.bottom + 0.012, side * (RECEIVER.halfWidth + 0.003));
  // Feed cover, hinged at its front over the feedway; the cover latch at its rear.
  const coverLength = FEED_COVER.front - FEED_COVER.back;
  part(gun, roundedBox(coverLength, FEED_COVER.height, RECEIVER.halfWidth * 2 - 0.008, 0.006), materials.parkerized, (FEED_COVER.back + FEED_COVER.front) / 2, RECEIVER.top + FEED_COVER.height / 2, 0);
  part(gun, new THREE.CylinderGeometry(0.007, 0.007, RECEIVER.halfWidth * 2, 8), materials.parkerized, FEED_COVER.front, RECEIVER.top + FEED_COVER.height * 0.6, 0, { rotation: [Math.PI / 2, 0, 0] });
  part(gun, roundedBox(0.03, 0.012, 0.05, 0.004), materials.parkerized, FEED_COVER.back - 0.01, RECEIVER.top + 0.012, 0);
  // Feedway slots either side, where the belt enters and the empty links leave.
  for (const side of [-1, 1]) part(gun, roundedBox(0.075, 0.03, 0.006, 0.002), materials.opening, FEEDWAY.x, FEEDWAY.y - 0.01, side * (RECEIVER.halfWidth + 0.001));
  // Slot in the right side plate for the bolt stud, and the ejection port under the receiver.
  part(gun, roundedBox(BOLT_SLOT.front - BOLT_SLOT.back, 0.012, 0.004, 0.002), materials.opening, (BOLT_SLOT.front + BOLT_SLOT.back) / 2, BOLT_SLOT.y, RECEIVER.halfWidth + 0.0005);
  part(gun, roundedBox(0.07, 0.004, 0.05, 0.002), materials.opening, M2_EJECTION_PORT.x, RECEIVER.bottom - 0.0005, 0);
  // Retracting slide handle on the right side plate.
  part(gun, roundedBox(0.16, 0.022, 0.01, 0.004), materials.parkerized, -0.33, -0.035, RECEIVER.halfWidth + 0.005);
  part(gun, new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), materials.parkerized, -0.27, -0.035, RECEIVER.halfWidth + 0.02, { rotation: [Math.PI / 2, 0, 0] });
  part(gun, new THREE.CylinderGeometry(0.012, 0.012, 0.024, 12), materials.grip, -0.27, -0.035, RECEIVER.halfWidth + 0.045, { rotation: [Math.PI / 2, 0, 0] });
  // Backplate with the buffer housing behind it.
  part(gun, roundedBox(BACKPLATE_DEPTH, height + 0.016, RECEIVER.halfWidth * 2 + 0.01, 0.006), materials.parkerized, RECEIVER.back - BACKPLATE_DEPTH / 2, middleY, 0);
}

function buildJacket(gun: THREE.Group, materials: M2Materials): void {
  // Barrel support sleeve out of the trunnion block, the perforated jacket over most of the barrel, and its front collar.
  alongBarrel(gun, -0.005, JACKET.back + 0.01, 0.034, 0.031, materials.parkerized, 20);
  alongBarrel(gun, JACKET.back, JACKET.front, JACKET.radius, JACKET.radius, materials.jacket, 24, true);
  alongBarrel(gun, JACKET.front - 0.025, JACKET.front + 0.01, JACKET.radius + 0.004, JACKET.radius + 0.002, materials.parkerized, 20);
}

/** The recoiling parts: barrel and flash hider, which slide back inside the jacket on every shot. */
function buildBarrel(barrel: THREE.Group, materials: M2Materials): void {
  alongBarrel(barrel, 0, BARREL.muzzle, BARREL.radius, BARREL.radius, materials.parkerized, 12);
  // Flash hider: a flared cone on the muzzle, open at the front.
  alongBarrel(barrel, BARREL.muzzle - 0.01, BARREL.muzzle + FLASH_HIDER.length, FLASH_HIDER.backRadius, FLASH_HIDER.frontRadius, materials.parkerized, 16, true);
  part(barrel, new THREE.RingGeometry(BARREL.radius * 0.45, FLASH_HIDER.backRadius, 16), materials.parkerized, BARREL.muzzle + 0.02, 0, 0, { rotation: [0, Math.PI / 2, 0] });
}

/** Bolt stud, at the bolt's forward (battery) position; it runs back along the slot as the gun cycles. */
function buildBolt(bolt: THREE.Group, materials: M2Materials): void {
  part(bolt, new THREE.CylinderGeometry(0.0075, 0.0075, 0.016, 10), materials.parkerized, BOLT_SLOT.front - 0.02, BOLT_SLOT.y, RECEIVER.halfWidth + 0.006, { rotation: [Math.PI / 2, 0, 0] });
}

let flashTexture: THREE.CanvasTexture | null = null;

/** Radial falloff for the flash cards: white-hot core, orange fringe, transparent edge. */
function muzzleFlashTexture(): THREE.CanvasTexture {
  if (flashTexture) return flashTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 250, 225, 1)');
  gradient.addColorStop(0.22, 'rgba(255, 205, 110, 0.95)');
  gradient.addColorStop(0.55, 'rgba(255, 120, 30, 0.45)');
  gradient.addColorStop(1, 'rgba(255, 80, 10, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  flashTexture = new THREE.CanvasTexture(canvas);
  flashTexture.colorSpace = THREE.SRGBColorSpace;
  return flashTexture;
}

let flashTemplate: THREE.Group | null = null;

/**
 * Muzzle flash out of the flash hider: three cards crossed along the bore and one facing forward, additive and unlit.
 * A .50's flash through a cone hider is short and broad, about 30 cm long.
 */
function muzzleFlash(): THREE.Group {
  if (!flashTemplate) {
    const material = new THREE.MeshBasicMaterial({
      map: muzzleFlashTexture(), color: new THREE.Color(3.2, 2.6, 1.8), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    flashTemplate = new THREE.Group();
    const card = new THREE.PlaneGeometry(0.3, 0.16).translate(0.13, 0, 0);
    for (let index = 0; index < 3; index++) {
      const mesh = new THREE.Mesh(card, material);
      mesh.rotation.x = (index * Math.PI) / 3;
      flashTemplate.add(mesh);
    }
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), material);
    face.rotation.y = Math.PI / 2;
    face.position.x = 0.02;
    flashTemplate.add(face);
    flashTemplate.traverse((object) => {
      object.userData.skipAmbientOcclusion = true;
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
  }
  return flashTemplate.clone();
}

function buildSpadeGrips(gun: THREE.Group, materials: M2Materials): void {
  const backplateRear = RECEIVER.back - BACKPLATE_DEPTH;
  const half = SPADE_GRIP.length / 2;
  for (const side of [-1, 1]) {
    const z = side * SPADE_GRIP.halfSpread;
    part(gun, new THREE.CylinderGeometry(SPADE_GRIP.radius, SPADE_GRIP.radius * 1.08, SPADE_GRIP.length, 14), materials.grip, SPADE_GRIP.x, SPADE_GRIP.y, z);
    // Upper and lower arms from the backplate out to the ends of each grip.
    for (const end of [-1, 1]) {
      const y = SPADE_GRIP.y + end * (half + 0.006);
      part(gun, roundedBox(backplateRear - SPADE_GRIP.x + 0.012, 0.012, 0.02, 0.004), materials.parkerized, (backplateRear + SPADE_GRIP.x) / 2, y, z);
    }
  }
  // Butterfly trigger between the grips, pressed by both thumbs.
  part(gun, roundedBox(0.008, 0.04, SPADE_GRIP.halfSpread * 1.3, 0.003), materials.parkerized, SPADE_GRIP.x + 0.025, SPADE_GRIP.y + 0.025, 0);
}

/** Ring-and-bead sight for the hand-held guns: the ring on a post at the receiver end of the jacket, the bead near the muzzle. */
function buildRingSight(gun: THREE.Group, materials: M2Materials): void {
  const ringY = JACKET.radius + 0.085;
  part(gun, new THREE.TorusGeometry(0.045, 0.0028, 6, 32), materials.parkerized, 0.06, ringY, 0, { rotation: [0, Math.PI / 2, 0] });
  for (const angle of [0, Math.PI / 2]) {
    part(gun, roundedBox(0.003, 0.09, 0.003, 0.001), materials.parkerized, 0.06, ringY, 0, { rotation: [angle, 0, 0] });
  }
  part(gun, roundedBox(0.012, ringY - 0.045 - JACKET.radius + 0.004, 0.012, 0.003), materials.parkerized, 0.06, (JACKET.radius + ringY - 0.045) / 2, 0);
  part(gun, roundedBox(0.01, 0.07, 0.004, 0.0015), materials.parkerized, JACKET.front - 0.06, JACKET.radius + 0.035, 0);
  part(gun, new THREE.SphereGeometry(0.006, 10, 8), materials.parkerized, JACKET.front - 0.06, JACKET.radius + 0.07, 0);
}

interface M2Template { body: THREE.Group; barrel: THREE.Group; bolt: THREE.Group }

const templates = new Map<M2Kind, M2Template>();

function m2Template(kind: M2Kind): M2Template {
  const cached = templates.get(kind);
  if (cached) return cached;
  const materials = m2Materials();
  const body = new THREE.Group();
  buildReceiver(body, materials);
  buildJacket(body, materials);
  if (kind === 'flexible') {
    buildSpadeGrips(body, materials);
    buildRingSight(body, materials);
  }
  const barrel = new THREE.Group();
  buildBarrel(barrel, materials);
  const bolt = new THREE.Group();
  buildBolt(bolt, materials);
  const template = { body: mergeStaticMeshes(body), barrel: mergeStaticMeshes(barrel), bolt: mergeStaticMeshes(bolt) };
  templates.set(kind, template);
  return template;
}

/**
 * One gun and its moving parts. The barrel and bolt keep their own transforms through the airframe merge, so the
 * gunnery can cycle them: `barrel` slides along its local x by up to `M2_BARREL_RECOIL`, `bolt` back along its local
 * x by up to `M2_BOLT_TRAVEL`. The flash rides on the barrel at the muzzle. A hand-held gun's `group` is folded into the
 * airframe merge and goes stale; the barrel, which shares gun space, is the live frame.
 */
export interface M2Gun {
  kind: M2Kind;
  group: THREE.Group;
  barrel: THREE.Group;
  bolt: THREE.Group;
  flash: THREE.Group;
}

/** Adds one gun to `parent`, placed by `m2Frame`. Guns share merged geometry per kind. */
export function addM2(parent: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3, kind: M2Kind, up: THREE.Vector3 = UP): M2Gun {
  const template = m2Template(kind);
  const group = new THREE.Group();
  m2Frame(origin, direction, up).decompose(group.position, group.quaternion, group.scale);
  group.add(template.body.clone());
  const barrel = template.barrel.clone();
  const bolt = template.bolt.clone();
  const flash = muzzleFlash();
  flash.position.copy(M2_MUZZLE).x -= 0.01;
  flash.visible = false;
  barrel.add(flash);
  for (const moving of [barrel, bolt]) {
    moving.userData.unmerged = true;
    group.add(moving);
  }
  parent.add(group);
  return { kind, group, barrel, bolt, flash };
}

/** A point given in gun space, in the gun's parent space. */
export function m2Point(origin: THREE.Vector3, direction: THREE.Vector3, local: THREE.Vector3, up: THREE.Vector3 = UP): THREE.Vector3 {
  return local.clone().applyMatrix4(m2Frame(origin, direction, up));
}
