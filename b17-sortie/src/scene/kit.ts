import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const roundedBoxCache = new Map<string, THREE.BufferGeometry>();

/** Beveled box. Bevels catch softbox highlights along edges, which sharp boxes cannot. */
export function roundedBox(width: number, height: number, depth: number, radius = 0.04): THREE.BufferGeometry {
  const key = `${width}|${height}|${depth}|${radius}`;
  const cached = roundedBoxCache.get(key);
  if (cached) return cached;
  const safeRadius = Math.min(radius, width / 2 - 1e-3, height / 2 - 1e-3, depth / 2 - 1e-3);
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, Math.max(safeRadius, 0.002));
  roundedBoxCache.set(key, geometry);
  return geometry;
}

export interface PartOptions {
  rotation?: [number, number, number];
  castShadow?: boolean;
}

/** Adds a mesh to `parent` at a local position and returns it. */
export function part(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  options: PartOptions = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  const isUnlit = material instanceof THREE.MeshBasicMaterial;
  mesh.castShadow = options.castShadow ?? !isUnlit;
  mesh.receiveShadow = !isUnlit;
  parent.add(mesh);
  return mesh;
}

const MERGED_ATTRIBUTES = ['position', 'normal', 'uv'];

/** Where a baked piece of geometry goes: which group, as part of that group's mesh for the piece's material. */
export interface MergeTarget { group: THREE.Object3D; geometry: THREE.BufferGeometry }

/**
 * Bakes the static meshes under `root` into one mesh per (target group, material), which keeps the reflection, AO and
 * main passes at a few dozen draw calls. `place` gets each mesh with its geometry already in `root`'s space and says
 * where it goes, splitting it if it must. Objects flagged `userData.unmerged` (moving parts) are kept whole, in the same
 * space, and handed to `keep`.
 */
export function mergeStaticMeshesInto(
  root: THREE.Object3D,
  place: (mesh: THREE.Mesh, geometry: THREE.BufferGeometry) => MergeTarget[],
  keep: (object: THREE.Object3D) => void,
): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const shadowByMaterial = new Map<THREE.Material, boolean>();
  const kept: THREE.Object3D[] = [];
  const keptMeshes = new Set<THREE.Object3D>();
  root.traverse((object) => {
    if (object !== root && object.userData.unmerged) {
      kept.push(object);
      object.traverse((inner) => keptMeshes.add(inner));
    }
  });
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || keptMeshes.has(object)) return;
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    for (const attributeName of Object.keys(source.attributes)) {
      if (!MERGED_ATTRIBUTES.includes(attributeName)) source.deleteAttribute(attributeName);
    }
    if (!source.getAttribute('uv')) {
      source.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(source.getAttribute('position').count * 2), 2));
    }
    source.applyMatrix4(object.matrixWorld);
    for (const target of place(object, source)) {
      const byMaterial = buckets.get(target.group) ?? new Map<THREE.Material, THREE.BufferGeometry[]>();
      buckets.set(target.group, byMaterial);
      const list = byMaterial.get(object.material) ?? [];
      list.push(target.geometry);
      byMaterial.set(object.material, list);
    }
    shadowByMaterial.set(object.material, object.castShadow);
  });
  for (const [group, byMaterial] of buckets) {
    for (const [material, geometries] of byMaterial) {
      const geometry = mergeGeometries(geometries);
      if (!geometry) {
        const layouts = [...new Set(geometries.map((source) => Object.keys(source.attributes).sort().join(',')))];
        throw new Error(`Cannot merge ${geometries.length} geometries for material ${material.type}; attribute layouts: ${layouts.join(' | ')}`);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = shadowByMaterial.get(material) ?? false;
      mesh.receiveShadow = !(material instanceof THREE.MeshBasicMaterial);
      group.add(mesh);
    }
  }
  // Same space as the baked geometry: world space of the source tree.
  for (const object of kept) {
    object.matrixWorld.decompose(object.position, object.quaternion, object.scale);
    object.removeFromParent();
    keep(object);
  }
}

/** `mergeStaticMeshesInto` with everything, kept parts included, in one returned group. */
export function mergeStaticMeshes(root: THREE.Object3D): THREE.Group {
  const merged = new THREE.Group();
  mergeStaticMeshesInto(root, (_mesh, geometry) => [{ group: merged, geometry }], (object) => merged.add(object));
  return merged;
}

export interface TextPlateOptions {
  width: number;
  height: number;
  lines: { text: string; font: string; color: string; y: number }[];
  background?: string;
  accent?: string;
}

/** Canvas-drawn sign face, drawn at 512 px per world unit. */
export function textPlateTexture(options: TextPlateOptions): THREE.CanvasTexture {
  const pixelsPerUnit = 512;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(options.width * pixelsPerUnit);
  canvas.height = Math.round(options.height * pixelsPerUnit);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (options.accent) {
    context.fillStyle = options.accent;
    context.fillRect(0, canvas.height - 10, canvas.width, 10);
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const line of options.lines) {
    context.font = line.font;
    context.fillStyle = line.color;
    context.fillText(line.text, canvas.width / 2, line.y * canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
