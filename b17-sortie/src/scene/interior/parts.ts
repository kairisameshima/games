import * as THREE from 'three';
import type { CrewMember } from '../crew/figure';
import type { MountedGun } from '../gunnery';
import type { M2Gun } from '../m2';
import { part, roundedBox } from '../kit';
import type { InteriorMaterials } from './materials';

export interface CrewStation {
  role: string;
  /** Model-space point the cutaway callout pins to. */
  anchor: THREE.Vector3;
  /** Callouts sit above their anchor, except under the aircraft where they hang below it. */
  placement: 'above' | 'below';
  /** The bomb bay callout also reports how many bombs are still aboard. */
  showsBombLoad: boolean;
}

export interface CompartmentContext {
  /** Static parent: merged per material with the airframe. */
  parent: THREE.Object3D;
  /** Parent for parts that move or change visibility. */
  root: THREE.Object3D;
  materials: InteriorMaterials;
  topTurretYaw: THREE.Object3D;
  /** The top turret's gun cradle, inside its yaw group: the guns' belts go with it. */
  topTurretPitch: THREE.Object3D;
  /** The turrets' guns, port then starboard, built with the airframe; the interior feeds them. */
  topTurretGuns: M2Gun[];
  ballTurretGuns: M2Gun[];
  /** Every gun the interior builds or feeds is registered here for the gunnery. */
  guns: MountedGun[];
  ballTurretPitch: THREE.Object3D;
  createBomb: () => THREE.Object3D;
}

export interface StationCrew {
  member: CrewMember;
  /** Group the figure is built in: null for the static interior, or a turret group that carries its gunner round. */
  host: THREE.Object3D | null;
  /** Callout label; several men can share one (pilots, waist gunners), so only the first of a label is pinned. */
  label: string;
  placement: 'above' | 'below';
}

export interface CompartmentResult {
  crew: StationCrew[];
  /** Equipment callouts not tied to a man (the bomb bay). */
  stations: CrewStation[];
}

const UP = new THREE.Vector3(0, 1, 0);

/** Cylinder between two points. */
export function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, segments = 12): THREE.Mesh {
  const direction = b.clone().sub(a);
  const mesh = part(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), segments), material, 0, 0, 0);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

/** Rounded box whose local +x faces `facing` (horizontal), at `centre`. */
export function box(parent: THREE.Object3D, centre: THREE.Vector3, size: [number, number, number], material: THREE.Material, facingYaw = 0, radius = 0.01): THREE.Mesh {
  const mesh = part(parent, roundedBox(size[0], size[1], size[2], radius), material, centre.x, centre.y, centre.z);
  mesh.rotation.y = facingYaw;
  return mesh;
}

/** Yellow low-pressure oxygen bottle (G-1 / A-4) strapped to a wall, axis along `axis`. */
export function oxygenBottle(parent: THREE.Object3D, materials: InteriorMaterials, centre: THREE.Vector3, axis: THREE.Vector3, length = 0.5, radius = 0.1): void {
  const bottle = part(parent, new THREE.CapsuleGeometry(radius, length - radius * 2, 8, 18), materials.oxygen, centre.x, centre.y, centre.z);
  bottle.quaternion.setFromUnitVectors(UP, axis.clone().normalize());
  for (const offset of [-0.3, 0.3]) {
    const strap = part(parent, new THREE.TorusGeometry(radius + 0.004, 0.006, 6, 24), materials.aluminium, 0, 0, 0);
    strap.position.copy(centre).addScaledVector(axis.clone().normalize(), offset * length);
    strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
  }
}

export function extinguisher(parent: THREE.Object3D, materials: InteriorMaterials, base: THREE.Vector3): void {
  part(parent, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 16), materials.extinguisher, base.x, base.y + 0.15, base.z);
  part(parent, new THREE.CylinderGeometry(0.018, 0.024, 0.06, 10), materials.brass, base.x, base.y + 0.33, base.z);
  part(parent, roundedBox(0.08, 0.015, 0.02, 0.004), materials.brass, base.x + 0.02, base.y + 0.36, base.z);
}

/** Round seat cushion on a pedestal post (bombardier, navigator, tail gunner's bicycle seat style). */
export function pedestalSeat(parent: THREE.Object3D, materials: InteriorMaterials, cushionTop: THREE.Vector3, floorY: number, options: { radius?: number; back?: { yaw: number; height: number } } = {}): void {
  const radius = options.radius ?? 0.19;
  part(parent, new THREE.CylinderGeometry(radius, radius * 0.95, 0.07, 24), materials.seatCushion, cushionTop.x, cushionTop.y - 0.035, cushionTop.z);
  rod(parent, new THREE.Vector3(cushionTop.x, floorY, cushionTop.z), new THREE.Vector3(cushionTop.x, cushionTop.y - 0.07, cushionTop.z), 0.028, materials.aluminium);
  part(parent, new THREE.CylinderGeometry(0.16, 0.18, 0.02, 20), materials.aluminium, cushionTop.x, floorY + 0.01, cushionTop.z);
  if (options.back) {
    const back = new THREE.Vector3(-Math.cos(options.back.yaw), 0, Math.sin(options.back.yaw)).multiplyScalar(radius * 0.85);
    const panel = part(parent, roundedBox(0.04, options.back.height, radius * 1.5, 0.015), materials.seatCushion, cushionTop.x + back.x, cushionTop.y + options.back.height / 2 + 0.05, cushionTop.z + back.z);
    panel.rotation.y = options.back.yaw;
  }
}
