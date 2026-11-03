import type * as THREE from 'three';
import { Field } from './sdf';

/** Coarse grid step, in fine voxels. Fine samples are taken only in coarse cells near the surface. */
const COARSE_STEP = 4;

export interface SurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Primary and secondary region per vertex, and the share of the secondary. */
  regions: Uint8Array;
  secondaryRegions: Uint8Array;
  regionMix: Float32Array;
  indices: Uint32Array;
}

/**
 * Naive surface nets over a narrow band: a coarse pass finds the cells the surface can pass through, the fine pass
 * samples only those, and each fine cell with a sign change gets one vertex at the mean of its edge crossings. Normals
 * come from the field gradient (so wrinkle detail finer than the voxels still shades), and each vertex takes the
 * region of the nearest primitive.
 */
export function meshField(field: Field, bounds: THREE.Box3, voxel: number): SurfaceMesh {
  const margin = voxel * 2;
  const minX = bounds.min.x - margin, minY = bounds.min.y - margin, minZ = bounds.min.z - margin;
  const coarseVoxel = voxel * COARSE_STEP;
  const cx = Math.ceil((bounds.max.x + margin - minX) / coarseVoxel) + 1;
  const cy = Math.ceil((bounds.max.y + margin - minY) / coarseVoxel) + 1;
  const cz = Math.ceil((bounds.max.z + margin - minZ) / coarseVoxel) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        coarse[i + cx * (j + cy * k)] = field.distance(minX + i * coarseVoxel, minY + j * coarseVoxel, minZ + k * coarseVoxel);
      }
    }
  }

  const nx = (cx - 1) * COARSE_STEP + 1, ny = (cy - 1) * COARSE_STEP + 1, nz = (cz - 1) * COARSE_STEP + 1;
  const values = new Float32Array(nx * ny * nz);
  const fineIndex = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // A coarse cell can only contain surface if some corner is within the cell diagonal of it.
  const nearThreshold = coarseVoxel * Math.sqrt(3);
  const cellRadius = coarseVoxel * Math.sqrt(3) / 2;
  // Per near coarse cell, only the primitives that can reach it.
  const localFields = new Map<number, Field>();
  for (let k = 0; k < cz - 1; k++) {
    for (let j = 0; j < cy - 1; j++) {
      for (let i = 0; i < cx - 1; i++) {
        let near = false;
        let smallest = 1e9;
        const corners: number[] = [];
        for (let c = 0; c < 8; c++) {
          const value = coarse[(i + (c & 1)) + cx * ((j + ((c >> 1) & 1)) + cy * (k + ((c >> 2) & 1)))];
          corners.push(value);
          if (Math.abs(value) < nearThreshold) near = true;
          smallest = Math.min(smallest, value);
        }
        const local = near
          ? field.restrict(minX + (i + 0.5) * coarseVoxel, minY + (j + 0.5) * coarseVoxel, minZ + (k + 0.5) * coarseVoxel, cellRadius, smallest + cellRadius)
          : field;
        if (near) localFields.set(i + cx * (j + cy * k), local);
        for (let fk = 0; fk <= COARSE_STEP; fk++) {
          for (let fj = 0; fj <= COARSE_STEP; fj++) {
            for (let fi = 0; fi <= COARSE_STEP; fi++) {
              const gi = i * COARSE_STEP + fi, gj = j * COARSE_STEP + fj, gk = k * COARSE_STEP + fk;
              const index = fineIndex(gi, gj, gk);
              if (near) {
                values[index] = local.distance(minX + gi * voxel, minY + gj * voxel, minZ + gk * voxel);
              } else {
                // Far from the surface only the sign matters; trilinear from the coarse corners keeps it.
                const u = fi / COARSE_STEP, v = fj / COARSE_STEP, w = fk / COARSE_STEP;
                const x00 = corners[0] + (corners[1] - corners[0]) * u;
                const x10 = corners[2] + (corners[3] - corners[2]) * u;
                const x01 = corners[4] + (corners[5] - corners[4]) * u;
                const x11 = corners[6] + (corners[7] - corners[6]) * u;
                const interpolated = (x00 + (x10 - x00) * v) * (1 - w) + (x01 + (x11 - x01) * v) * w;
                // Shared faces between a near and a far cell must agree; the near cell's exact value wins.
                if (values[index] === 0) values[index] = interpolated;
              }
            }
          }
        }
      }
    }
  }

  // One vertex per fine cell that the surface crosses.
  const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cellIndex = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const positions: number[] = [];
  const vertexFields: Field[] = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const corner = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const value = values[fineIndex(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = value;
          if (value < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, count = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += (a & 1) + (((b & 1) - (a & 1)) * t);
          sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
          sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
          count++;
        }
        cellVertex[cellIndex(i, j, k)] = positions.length / 3;
        const coarseCell = Math.floor(i / COARSE_STEP) + cx * (Math.floor(j / COARSE_STEP) + cy * Math.floor(k / COARSE_STEP));
        vertexFields.push(localFields.get(coarseCell) ?? field);
        positions.push(minX + (i + sx / count) * voxel, minY + (j + sy / count) * voxel, minZ + (k + sz / count) * voxel);
      }
    }
  }

  // A quad across every grid edge with a sign change, joining the four cells around that edge.
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Wound so the face normal points out of the solid (toward increasing distance).
    if (flip) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = values[fineIndex(i, j, k)] < 0;
        if (i < nx - 1 && inside !== (values[fineIndex(i + 1, j, k)] < 0)) {
          quad(cellVertex[cellIndex(i, j - 1, k - 1)], cellVertex[cellIndex(i, j, k - 1)], cellVertex[cellIndex(i, j, k)], cellVertex[cellIndex(i, j - 1, k)], inside);
        }
        if (j < ny - 1 && inside !== (values[fineIndex(i, j + 1, k)] < 0)) {
          quad(cellVertex[cellIndex(i - 1, j, k - 1)], cellVertex[cellIndex(i - 1, j, k)], cellVertex[cellIndex(i, j, k)], cellVertex[cellIndex(i, j, k - 1)], inside);
        }
        if (k < nz - 1 && inside !== (values[fineIndex(i, j, k + 1)] < 0)) {
          quad(cellVertex[cellIndex(i - 1, j - 1, k)], cellVertex[cellIndex(i, j - 1, k)], cellVertex[cellIndex(i, j, k)], cellVertex[cellIndex(i - 1, j, k)], inside);
        }
      }
    }
  }

  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const regions = new Uint8Array(vertexCount);
  const secondaryRegions = new Uint8Array(vertexCount);
  const regionMix = new Float32Array(vertexCount);
  const h = voxel * 0.35;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const local = vertexFields[v];
    const gx = local.distance(x + h, y, z) - local.distance(x - h, y, z);
    const gy = local.distance(x, y + h, z) - local.distance(x, y - h, z);
    const gz = local.distance(x, y, z + h) - local.distance(x, y, z - h);
    const length = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / length;
    normals[v * 3 + 1] = gy / length;
    normals[v * 3 + 2] = gz / length;
    const mix = local.regionMix(x, y, z, voxel * 0.25);
    regions[v] = mix.primary;
    secondaryRegions[v] = mix.secondary;
    regionMix[v] = mix.mix;
  }
  return { positions: new Float32Array(positions), normals, regions, secondaryRegions, regionMix, indices: new Uint32Array(indices) };
}
