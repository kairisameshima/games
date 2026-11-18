import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const KEPT_ATTRIBUTES: Record<string, true> = { position: true, normal: true, uv: true };
const UP = new THREE.Vector3(0, 1, 0);

interface BatchBucket {
  material: THREE.Material;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

/**
 * Collects static world-space geometry per material and merges it into one mesh
 * per material, so thousands of props cost a handful of draw calls.
 */
export class GeometryBatch {
  private readonly buckets = new Map<string, BatchBucket>();

  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    matrix: THREE.Matrix4,
    color: THREE.ColorRepresentation = 0xffffff,
    castShadow = true,
  ): void {
    const prepared = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(prepared.attributes)) {
      if (!KEPT_ATTRIBUTES[name]) prepared.deleteAttribute(name);
    }
    if (!prepared.getAttribute("uv")) {
      const vertexCount = prepared.getAttribute("position").count;
      prepared.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 2), 2));
    }
    prepared.applyMatrix4(matrix);
    const tint = new THREE.Color(color);
    const vertexCount = prepared.getAttribute("position").count;
    const colors = new Float32Array(vertexCount * 3);
    for (let index = 0; index < vertexCount; index++) {
      colors[index * 3] = tint.r;
      colors[index * 3 + 1] = tint.g;
      colors[index * 3 + 2] = tint.b;
    }
    prepared.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const key = `${material.uuid}:${castShadow}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow, geometries: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geometries.push(prepared);
  }

  build(parent: THREE.Object3D): void {
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      if (!merged) throw new Error(`Batch merge failed for material ${bucket.material.name || bucket.material.uuid}`);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      for (const geometry of bucket.geometries) geometry.dispose();
    }
    this.buckets.clear();
  }
}

/**
 * Places primitives into a batch relative to a frame object (an empty group in the
 * scene) and an optional placement matrix inside that frame.
 */
export class Kit {
  constructor(
    readonly batch: GeometryBatch,
    readonly frame: THREE.Object3D,
    readonly placement: THREE.Matrix4 = new THREE.Matrix4(),
  ) {}

  withFrame(frame: THREE.Object3D): Kit {
    return new Kit(this.batch, frame);
  }

  /** Kit nested inside this one, offset by position, rotation and scale. */
  within(
    position: THREE.Vector3Tuple,
    rotation: THREE.Vector3Tuple = [0, 0, 0],
    scale: THREE.Vector3Tuple = [1, 1, 1],
  ): Kit {
    const placement = this.placement.clone().multiply(compose(position, rotation, scale));
    return new Kit(this.batch, this.frame, placement);
  }

  toWorld(local: THREE.Vector3Tuple): THREE.Vector3 {
    this.frame.updateWorldMatrix(true, false);
    return new THREE.Vector3(...local).applyMatrix4(this.placement).applyMatrix4(this.frame.matrixWorld);
  }

  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    localMatrix: THREE.Matrix4,
    color: THREE.ColorRepresentation = 0xffffff,
    castShadow = true,
  ): void {
    this.frame.updateWorldMatrix(true, false);
    const world = new THREE.Matrix4().multiplyMatrices(this.frame.matrixWorld, this.placement).multiply(localMatrix);
    this.batch.add(geometry, material, world, color, castShadow);
  }

  box(
    size: THREE.Vector3Tuple,
    position: THREE.Vector3Tuple,
    material: THREE.Material,
    color: THREE.ColorRepresentation = 0xffffff,
    rotation: THREE.Vector3Tuple = [0, 0, 0],
  ): void {
    this.add(new THREE.BoxGeometry(...size), material, compose(position, rotation), color);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    position: THREE.Vector3Tuple,
    material: THREE.Material,
    color: THREE.ColorRepresentation = 0xffffff,
    rotation: THREE.Vector3Tuple = [0, 0, 0],
    segments = 24,
  ): void {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
    this.add(geometry, material, compose(position, rotation), color);
  }

  /** Cylinder whose axis runs from `start` to `end` in frame space. */
  beam(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    color: THREE.ColorRepresentation = 0xffffff,
    segments = 16,
    radiusEnd = radius,
  ): void {
    const length = start.distanceTo(end);
    const geometry = new THREE.CylinderGeometry(radiusEnd, radius, length, segments);
    this.add(geometry, material, alignBetween(start, end), color);
  }

  /** Box whose long axis runs from `start` to `end`; `roll` spins it about that axis. */
  bar(
    start: THREE.Vector3,
    end: THREE.Vector3,
    width: number,
    depth: number,
    material: THREE.Material,
    color: THREE.ColorRepresentation = 0xffffff,
    roll = 0,
  ): void {
    const geometry = new THREE.BoxGeometry(width, start.distanceTo(end), depth);
    geometry.rotateY(roll);
    this.add(geometry, material, alignBetween(start, end), color);
  }

  sphere(
    radius: number,
    position: THREE.Vector3Tuple,
    material: THREE.Material,
    color: THREE.ColorRepresentation = 0xffffff,
    scale: THREE.Vector3Tuple = [1, 1, 1],
    detail = 16,
  ): void {
    const geometry = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.floor(detail * 0.75)));
    this.add(geometry, material, compose(position, [0, 0, 0], scale), color);
  }
}

export function compose(
  position: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple = [0, 0, 0],
  scale: THREE.Vector3Tuple = [1, 1, 1],
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

/** Matrix that moves a Y-axis-centred primitive so its axis spans start to end. */
export function alignBetween(start: THREE.Vector3, end: THREE.Vector3): THREE.Matrix4 {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction.divideScalar(length));
  const middle = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(middle, quaternion, new THREE.Vector3(1, 1, 1));
}

/** Creates an empty transform group used as a placement frame. */
export function createFrame(
  parent: THREE.Object3D,
  position: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple = [0, 0, 0],
  name = "",
): THREE.Group {
  const frame = new THREE.Group();
  frame.name = name;
  frame.position.set(...position);
  frame.rotation.set(...rotation);
  parent.add(frame);
  frame.updateMatrixWorld(true);
  return frame;
}

export function toWorld(frame: THREE.Object3D, local: THREE.Vector3Tuple): THREE.Vector3 {
  frame.updateWorldMatrix(true, false);
  return new THREE.Vector3(...local).applyMatrix4(frame.matrixWorld);
}
