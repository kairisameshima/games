import * as THREE from 'three';

/**
 * Skins a sequence of closed rings into one mesh. Every ring must have the same point count.
 * UV x runs along the rings (`ringParams`), UV y runs around each ring (0 to 1), so the seam sits at point 0.
 * Winding is fixed afterwards from the signed volume, so callers can order points either way round.
 */
export function loftGeometry(rings: THREE.Vector3[][], ringParams: number[], capStart: boolean, capEnd: boolean): THREE.BufferGeometry {
  const pointCount = rings[0].length;
  const stride = pointCount + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  rings.forEach((ring, ringIndex) => {
    if (ring.length !== pointCount) throw new Error(`Ring ${ringIndex} has ${ring.length} points, expected ${pointCount}`);
    for (let pointIndex = 0; pointIndex <= pointCount; pointIndex++) {
      const point = ring[pointIndex % pointCount];
      positions.push(point.x, point.y, point.z);
      uvs.push(ringParams[ringIndex], pointIndex / pointCount);
    }
  });
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      const a = ringIndex * stride + pointIndex;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // Caps get their own vertices so the rim normals stay those of the side wall.
  const addCap = (ring: THREE.Vector3[], ringParam: number, reverse: boolean) => {
    const centre = ring.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(ring.length);
    const centreIndex = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    uvs.push(ringParam, 0.5);
    for (const point of ring) {
      positions.push(point.x, point.y, point.z);
      uvs.push(ringParam, 0.5);
    }
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      const current = centreIndex + 1 + pointIndex;
      const next = centreIndex + 1 + ((pointIndex + 1) % pointCount);
      if (reverse) indices.push(centreIndex, next, current);
      else indices.push(centreIndex, current, next);
    }
  };
  if (capStart) addCap(rings[0], ringParams[0], false);
  if (capEnd) addCap(rings[rings.length - 1], ringParams[ringParams.length - 1], true);

  if (signedVolume(positions, indices) < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = swap;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  weldSeamNormals(geometry, rings.length, stride);
  return geometry;
}

function signedVolume(positions: number[], indices: number[]): number {
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let index = 0; index < indices.length; index += 3) {
    a.fromArray(positions, indices[index] * 3);
    b.fromArray(positions, indices[index + 1] * 3);
    c.fromArray(positions, indices[index + 2] * 3);
    volume += a.dot(b.cross(c));
  }
  return volume / 6;
}

/** The first and last point of each ring are duplicates for the UV seam; give them one shared normal. */
function weldSeamNormals(geometry: THREE.BufferGeometry, ringCount: number, stride: number): void {
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const first = new THREE.Vector3();
  const last = new THREE.Vector3();
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
    const firstIndex = ringIndex * stride;
    const lastIndex = firstIndex + stride - 1;
    first.fromBufferAttribute(normals, firstIndex);
    last.fromBufferAttribute(normals, lastIndex);
    first.add(last).normalize();
    normals.setXYZ(firstIndex, first.x, first.y, first.z);
    normals.setXYZ(lastIndex, first.x, first.y, first.z);
  }
  normals.needsUpdate = true;
}

/**
 * NACA four-digit section with a closed trailing edge. Points run from the upper trailing edge round the
 * leading edge to the lower surface, so ring parameter 0.5 is the leading edge and 0 to 0.5 is the upper surface.
 * Returned as (chord fraction from the leading edge, height as a fraction of chord).
 */
export function airfoilSection(thicknessRatio: number, camber: number, camberPosition: number, pointsPerSide: number): THREE.Vector2[] {
  const point = (beta: number, upper: boolean): THREE.Vector2 => {
    const x = (1 - Math.cos(beta)) / 2;
    const halfThickness = 5 * thicknessRatio * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camberLine = x < camberPosition
      ? (camber / camberPosition ** 2) * (2 * camberPosition * x - x * x)
      : (camber / (1 - camberPosition) ** 2) * (1 - 2 * camberPosition + 2 * camberPosition * x - x * x);
    return new THREE.Vector2(x, camberLine + (upper ? halfThickness : -halfThickness));
  };
  const points: THREE.Vector2[] = [];
  for (let step = 0; step <= pointsPerSide; step++) points.push(point(Math.PI * (1 - step / pointsPerSide), true));
  for (let step = 1; step < pointsPerSide; step++) points.push(point(Math.PI * (step / pointsPerSide), false));
  return points;
}

/** Superelliptic ring, starting at the bottom and going round through +z first. */
export function ellipseRing(
  centre: THREE.Vector3,
  top: number,
  bottom: number,
  halfWidth: number,
  pointCount: number,
  exponent = 2.3,
): THREE.Vector3[] {
  const middle = (top + bottom) / 2;
  const halfHeight = (top - bottom) / 2;
  const power = 2 / exponent;
  const ring: THREE.Vector3[] = [];
  for (let index = 0; index < pointCount; index++) {
    const theta = (index / pointCount) * Math.PI * 2;
    const cosine = Math.cos(theta);
    const sine = Math.sin(theta);
    ring.push(new THREE.Vector3(
      centre.x,
      centre.y + middle - halfHeight * Math.sign(cosine) * Math.abs(cosine) ** power,
      centre.z + halfWidth * Math.sign(sine) * Math.abs(sine) ** power,
    ));
  }
  return ring;
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through unevenly spaced samples. Unlike Catmull-Rom it never
 * overshoots, which matters at steps such as the windscreen, where the hull top jumps within a few centimetres.
 */
export function monotoneCubic(keys: readonly number[], values: readonly number[], x: number): number {
  const last = keys.length - 1;
  if (x <= keys[0]) return values[0];
  if (x >= keys[last]) return values[last];
  let index = 0;
  while (x > keys[index + 1]) index++;
  const secant = (i: number) => (values[i + 1] - values[i]) / (keys[i + 1] - keys[i]);
  const tangent = (i: number): number => {
    if (i === 0) return secant(0);
    if (i === last) return secant(last - 1);
    const before = secant(i - 1);
    const after = secant(i);
    if (before * after <= 0) return 0;
    return (3 * (before + after)) / ((2 * after + before) / after + (after + 2 * before) / before);
  };
  const width = keys[index + 1] - keys[index];
  const t = (x - keys[index]) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * values[index]
    + (t3 - 2 * t2 + t) * width * tangent(index)
    + (-2 * t3 + 3 * t2) * values[index + 1]
    + (t3 - t2) * width * tangent(index + 1);
}

/** Mirrors a geometry across z = 0 and restores outward winding. `scale` already mirrors the normals. */
export function mirrorAcrossZ(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const mirrored = geometry.clone();
  mirrored.scale(1, 1, -1);
  const index = mirrored.getIndex();
  if (index) {
    const array = index.array;
    for (let triangle = 0; triangle < array.length; triangle += 3) {
      const swap = array[triangle + 1];
      array[triangle + 1] = array[triangle + 2];
      array[triangle + 2] = swap;
    }
    index.needsUpdate = true;
  }
  return mirrored;
}
