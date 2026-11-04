import * as THREE from 'three';
import { toX } from './hull';
import { mergeStaticMeshesInto, type MergeTarget } from './kit';

/**
 * The aircraft as the assemblies an exploded view pulls apart. The fuselage splits at its bulkheads into the six
 * compartments (each carrying its crew, guns and fittings); the flying surfaces, the four engine nacelles, the three
 * turrets and the bomb bay doors come away on their own.
 */

export type FuselageSectionId = 'nose' | 'cockpit' | 'bomb-bay' | 'radio-room' | 'waist' | 'tail';
export type AssemblyId =
  | FuselageSectionId
  | 'wing-port' | 'wing-starboard'
  | 'engine-1' | 'engine-2' | 'engine-3' | 'engine-4'
  | 'stabilizer-port' | 'stabilizer-starboard' | 'fin'
  | 'top-turret' | 'ball-turret' | 'chin-turret' | 'bomb-doors';

/** Compartments in fuselage order, each ending at its aft bulkhead (No. 4 to No. 7 and the waist/tail joint). */
export const FUSELAGE_SECTIONS: readonly { id: FuselageSectionId; label: string; end: number }[] = [
  { id: 'nose', label: 'Nose', end: 2.85 },
  { id: 'cockpit', label: "Pilots' compartment", end: 5.76 },
  { id: 'bomb-bay', label: 'Bomb bay', end: 8.49 },
  { id: 'radio-room', label: 'Radio room', end: 10.6 },
  { id: 'waist', label: 'Waist', end: 16.7 },
  { id: 'tail', label: 'Tail', end: Infinity },
];

/** Section joints, for lofts that need a ring exactly on each cut. */
export const FUSELAGE_JOINTS = FUSELAGE_SECTIONS.slice(0, -1).map((section) => section.end);

export function fuselageSectionAt(d: number): FuselageSectionId {
  return (FUSELAGE_SECTIONS.find((section) => d < section.end) ?? FUSELAGE_SECTIONS[FUSELAGE_SECTIONS.length - 1]).id;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const SECTION_SPREAD: Record<FuselageSectionId, THREE.Vector3> = {
  nose: v(2.6, 0, 0), cockpit: v(1.3, 0, 0), 'bomb-bay': v(0, 0, 0), 'radio-room': v(-1.3, 0, 0), waist: v(-2.6, 0, 0), tail: v(-4.0, 0, 0),
};

/**
 * Fully exploded offset of each assembly in model space (metres; +x forward, +y up, +z starboard). Fuselage sections
 * spread along the axis; everything else moves off its parent section along the line it is fitted on.
 */
export const EXPLODED_OFFSET: Record<AssemblyId, THREE.Vector3> = {
  ...SECTION_SPREAD,
  'wing-port': v(0, 0.3, -3.0),
  'wing-starboard': v(0, 0.3, 3.0),
  'engine-1': v(1.9, 0.3, -3.0),
  'engine-2': v(1.9, 0.3, -3.0),
  'engine-3': v(1.9, 0.3, 3.0),
  'engine-4': v(1.9, 0.3, 3.0),
  'stabilizer-port': SECTION_SPREAD.tail.clone().add(v(0, 0, -1.7)),
  'stabilizer-starboard': SECTION_SPREAD.tail.clone().add(v(0, 0, 1.7)),
  fin: SECTION_SPREAD.tail.clone().add(v(0, 1.7, 0)),
  'top-turret': SECTION_SPREAD.cockpit.clone().add(v(0, 1.7, 0)),
  'ball-turret': SECTION_SPREAD.waist.clone().add(v(0, -1.9, 0)),
  'chin-turret': SECTION_SPREAD.nose.clone().add(v(0.6, -1.2, 0)),
  'bomb-doors': v(0, -1.5, 0),
};

/**
 * Labels for the exploded view's callouts: whether each hangs below its assembly, and (`outboard`) whether it pins out
 * toward the tip of a wing or stabilizer rather than over its middle. The fuselage sections' callouts hang below, so
 * they never stack on the fin's, the turret's and the stabilizers' above them.
 */
export interface AssemblyLabel { label: string; below: boolean; outboard?: boolean }

export const ASSEMBLY_LABEL: Record<AssemblyId, AssemblyLabel> = {
  ...Object.fromEntries(FUSELAGE_SECTIONS.map((section) => [section.id, { label: section.label, below: true }])) as Record<FuselageSectionId, AssemblyLabel>,
  'wing-port': { label: 'Port wing', below: false, outboard: true },
  'wing-starboard': { label: 'Starboard wing', below: false, outboard: true },
  'engine-1': { label: 'No. 1 engine', below: true },
  'engine-2': { label: 'No. 2 engine', below: true },
  'engine-3': { label: 'No. 3 engine', below: true },
  'engine-4': { label: 'No. 4 engine', below: true },
  'stabilizer-port': { label: 'Port stabilizer', below: false, outboard: true },
  'stabilizer-starboard': { label: 'Starboard stabilizer', below: false, outboard: true },
  fin: { label: 'Fin and rudder', below: false },
  'top-turret': { label: 'Top turret', below: false },
  'ball-turret': { label: 'Ball turret', below: true },
  'chin-turret': { label: 'Chin turret', below: true },
  'bomb-doors': { label: 'Bomb bay doors', below: true },
};

/** Engine numbers run from the port outboard (No. 1) to the starboard outboard (No. 4). */
export function engineAssembly(side: 1 | -1, inboard: boolean): AssemblyId {
  if (side < 0) return inboard ? 'engine-2' : 'engine-1';
  return inboard ? 'engine-3' : 'engine-4';
}

/** Marks an object (and so everything under it) as belonging to an assembly. */
export function assignAssembly<T extends THREE.Object3D>(object: T, id: AssemblyId): T {
  object.userData.assembly = id;
  return object;
}

/** The assembly an object was assigned to, through its ancestors up to `stop`. */
function taggedAssembly(object: THREE.Object3D, stop: THREE.Object3D): AssemblyId | null {
  for (let node: THREE.Object3D | null = object; node && node !== stop; node = node.parent) {
    if (node.userData.assembly) return node.userData.assembly as AssemblyId;
  }
  return null;
}

/** Splits a non-indexed geometry into one geometry per fuselage section, each triangle going by its centroid. */
function splitBySection(geometry: THREE.BufferGeometry): Map<FuselageSectionId, THREE.BufferGeometry> {
  const position = geometry.getAttribute('position');
  const triangles = new Map<FuselageSectionId, number[]>();
  for (let first = 0; first < position.count; first += 3) {
    const x = (position.getX(first) + position.getX(first + 1) + position.getX(first + 2)) / 3;
    const id = fuselageSectionAt(toX(x));
    const list = triangles.get(id) ?? [];
    list.push(first);
    triangles.set(id, list);
  }
  const pieces = new Map<FuselageSectionId, THREE.BufferGeometry>();
  if (triangles.size === 1) {
    pieces.set(triangles.keys().next().value as FuselageSectionId, geometry);
    return pieces;
  }
  for (const [id, firsts] of triangles) {
    const piece = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const size = attribute.itemSize;
      const array = new Float32Array(firsts.length * 3 * size);
      firsts.forEach((first, index) => array.set((attribute.array as Float32Array).subarray(first * size, (first + 3) * size), index * 3 * size));
      piece.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    pieces.set(id, piece);
  }
  return pieces;
}

/**
 * One group per assembly under the aircraft root, all at rest at the origin so their local space is model space.
 * Exploding moves each group by its offset; nothing inside changes.
 */
export class Assemblies {
  readonly groups = new Map<AssemblyId, THREE.Group>();

  constructor(private readonly root: THREE.Object3D) {
    for (const id of Object.keys(EXPLODED_OFFSET) as AssemblyId[]) {
      const group = new THREE.Group();
      group.name = id;
      group.userData.isAssembly = true;
      this.groups.set(id, group);
      root.add(group);
    }
  }

  get(id: AssemblyId): THREE.Group {
    const group = this.groups.get(id);
    if (!group) throw new Error(`Unknown assembly ${id}`);
    return group;
  }

  /** Bakes `airframe` into the assemblies: tagged parts whole, the rest split at the fuselage joints. */
  bake(airframe: THREE.Object3D): void {
    mergeStaticMeshesInto(
      airframe,
      (mesh, geometry): MergeTarget[] => {
        const tagged = taggedAssembly(mesh, airframe);
        if (tagged) return [{ group: this.get(tagged), geometry }];
        return [...splitBySection(geometry)].map(([id, piece]) => ({ group: this.get(id), geometry: piece }));
      },
      (object) => this.adopt(object, taggedAssembly(object, airframe)),
    );
  }

  /**
   * Moves the root's other children (turrets, propellers, crew, bombs, glazing) into their assemblies, keeping their
   * place: by tag, else by `userData.stationX` (a crew figure's pelvis, whose mesh sits at the origin), else by position.
   */
  adoptRootChildren(): void {
    for (const child of [...this.root.children]) {
      if (child.userData.isAssembly) continue;
      this.adopt(child, taggedAssembly(child, this.root));
    }
  }

  /**
   * Puts `object` into its assembly; untagged objects go to the fuselage section their position falls in. An untagged
   * single mesh running through several sections (a conduit along the wall) is cut at the joints instead, each piece
   * a mesh of its own in its own section with the original's material, flags and user data.
   */
  adopt(object: THREE.Object3D, tagged: AssemblyId | null): void {
    // A crew figure says where it is (`stationX`); its mesh may still be empty while it is meshed in a worker.
    const splittable = object instanceof THREE.Mesh && object.children.length === 0 && !Array.isArray(object.material)
      && object.userData.stationX === undefined && object.geometry.getAttribute('position') !== undefined;
    if (!tagged && splittable) {
      object.updateMatrix();
      const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrix);
      const pieces = splitBySection(geometry);
      if (pieces.size > 1) {
        object.removeFromParent();
        for (const [id, piece] of pieces) {
          const mesh = new THREE.Mesh(piece, object.material);
          mesh.castShadow = object.castShadow;
          mesh.receiveShadow = object.receiveShadow;
          mesh.userData = { ...object.userData };
          this.get(id).add(mesh);
        }
        return;
      }
    }
    this.get(tagged ?? fuselageSectionAt(toX(this.stationX(object)))).add(object);
  }

  /** Model-space x that decides an untagged object's section; the root must be at rest (identity) when asked. */
  private stationX(object: THREE.Object3D): number {
    if (typeof object.userData.stationX === 'number') return object.userData.stationX;
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    return bounds.isEmpty() ? object.getWorldPosition(new THREE.Vector3()).x : bounds.getCenter(new THREE.Vector3()).x;
  }

  /** The assembly group an object is in. */
  of(object: THREE.Object3D): THREE.Group {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (node.userData.isAssembly) return node as THREE.Group;
    }
    throw new Error(`${object.name || object.type} is not in an assembly`);
  }

  /** Places every assembly at `amount` (0 assembled, 1 fully exploded) of its exploded offset. */
  setExplosion(amount: number): void {
    for (const [id, group] of this.groups) group.position.copy(EXPLODED_OFFSET[id]).multiplyScalar(amount);
  }
}
