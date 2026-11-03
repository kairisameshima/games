import * as THREE from 'three';

/**
 * Signed-distance primitives for the crew figures. Distances are in metres in the figure's own space. Every primitive
 * carries a surface region (which colour, roughness and sheen it gets) and a smooth-union radius, so clothing, gear and
 * anatomy blend into one continuous surface the way cloth drapes over a body.
 */

export type Vec3 = readonly [number, number, number];

/** Which part's mesh a primitive belongs to: the head and hands are meshed at a finer voxel size than the body. */
export type MeshPart = 'body' | 'head' | 'leftHand' | 'rightHand';

export interface SurfaceDetail {
  /** Wrinkle depth in metres. */
  amplitude: number;
  /** Wrinkles per metre. */
  frequency: number;
  /**
   * Below 1, wrinkles on a limb stretch round it: across the axis they vary at this fraction of `frequency`, so a
   * sleeve or trouser leg gets the compression creases cloth makes round a bent limb instead of isotropic crumple.
   */
  creaseStretch?: number;
}

export interface PrimitiveOptions {
  region: number;
  part: MeshPart;
  /** Smooth-union radius against everything added before this primitive. */
  blend?: number;
  /** Carve this shape out instead of adding it. */
  subtract?: boolean;
  /** Surface-detail displacement: cloth wrinkles, quilting, crumpled leather. */
  detail?: SurfaceDetail;
  /** Small layered items (straps, buckles, lenses) win the region vote on a near tie. */
  priority?: number;
}

export abstract class Primitive {
  readonly region: number;
  readonly part: MeshPart;
  readonly blend: number;
  readonly subtract: boolean;
  readonly detail: SurfaceDetail | null;
  readonly priority: number;
  /** Bounding sphere, used to skip primitives that cannot affect a sample. */
  abstract readonly centre: Vec3;
  abstract readonly radius: number;

  constructor(options: PrimitiveOptions) {
    this.region = options.region;
    this.part = options.part;
    this.blend = options.blend ?? 0;
    this.subtract = options.subtract ?? false;
    this.detail = options.detail ?? null;
    this.priority = options.priority ?? 0;
  }

  abstract distance(x: number, y: number, z: number): number;

  /** Distance including surface detail. */
  surfaceDistance(x: number, y: number, z: number): number {
    const base = this.distance(x, y, z);
    if (!this.detail || base > this.detail.amplitude * 4) return base;
    return base + this.detail.amplitude * this.wrinkle(x, y, z, this.detail);
  }

  protected wrinkle(x: number, y: number, z: number, detail: SurfaceDetail): number {
    return wrinkleNoise(x * detail.frequency, y * detail.frequency, z * detail.frequency);
  }
}

/** Rotation stored as the three axes of the primitive's local frame, so world points project onto them directly. */
export class Frame {
  constructor(readonly x: Vec3, readonly y: Vec3, readonly z: Vec3) {}

  static fromQuaternion(quaternion: THREE.Quaternion): Frame {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements;
    return new Frame([m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]);
  }

  static fromMatrix(matrix: THREE.Matrix4): Frame {
    const m = matrix.elements;
    const normalise = (a: number, b: number, c: number): Vec3 => {
      const length = Math.hypot(a, b, c) || 1;
      return [a / length, b / length, c / length];
    };
    return new Frame(normalise(m[0], m[1], m[2]), normalise(m[4], m[5], m[6]), normalise(m[8], m[9], m[10]));
  }

  static readonly identity = new Frame([1, 0, 0], [0, 1, 0], [0, 0, 1]);
}

/** Round cone between two points: limbs, fingers, straps, hoses. Exact distance (Quilez). */
export class RoundCone extends Primitive {
  readonly centre: Vec3;
  readonly radius: number;
  private readonly ax: number; private readonly ay: number; private readonly az: number;
  private readonly bax: number; private readonly bay: number; private readonly baz: number;
  private readonly l2: number; private readonly rr: number; private readonly a2: number; private readonly il2: number;

  constructor(a: Vec3, b: Vec3, private readonly r1: number, private readonly r2: number, options: PrimitiveOptions) {
    super(options);
    this.ax = a[0]; this.ay = a[1]; this.az = a[2];
    this.bax = b[0] - a[0]; this.bay = b[1] - a[1]; this.baz = b[2] - a[2];
    this.l2 = Math.max(this.bax * this.bax + this.bay * this.bay + this.baz * this.baz, 1e-10);
    this.rr = r1 - r2;
    this.a2 = this.l2 - this.rr * this.rr;
    this.il2 = 1 / this.l2;
    this.centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    this.radius = Math.sqrt(this.l2) / 2 + Math.max(r1, r2);
  }

  distance(x: number, y: number, z: number): number {
    const pax = x - this.ax, pay = y - this.ay, paz = z - this.az;
    const yy = pax * this.bax + pay * this.bay + paz * this.baz;
    const zz = yy - this.l2;
    const qx = pax * this.l2 - this.bax * yy, qy = pay * this.l2 - this.bay * yy, qz = paz * this.l2 - this.baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * this.l2;
    const z2 = zz * zz * this.l2;
    const k = Math.sign(this.rr) * this.rr * this.rr * x2;
    if (Math.sign(zz) * this.a2 * z2 > k) return Math.sqrt(x2 + z2) * this.il2 - this.r2;
    if (Math.sign(yy) * this.a2 * y2 < k) return Math.sqrt(x2 + y2) * this.il2 - this.r1;
    return (Math.sqrt(x2 * this.a2 * this.il2) + yy * this.rr) * this.il2 - this.r1;
  }

  protected override wrinkle(x: number, y: number, z: number, detail: SurfaceDetail): number {
    const stretch = detail.creaseStretch ?? 1;
    if (stretch === 1) return super.wrinkle(x, y, z, detail);
    const along = ((x - this.ax) * this.bax + (y - this.ay) * this.bay + (z - this.az) * this.baz) * Math.sqrt(this.il2);
    const across = detail.frequency * stretch;
    return wrinkleNoise(along * detail.frequency, x * across + y * across * 0.5, z * across - y * across * 0.5);
  }
}

/** Oriented ellipsoid (Quilez's bound), optionally cut by a plane in its local frame: helmets with a face opening. */
export class Ellipsoid extends Primitive {
  readonly radius: number;

  constructor(
    readonly centre: Vec3,
    private readonly radii: Vec3,
    private readonly frame: Frame,
    options: PrimitiveOptions,
    /** Keep only the side of this local plane where dot(n, p) <= offset. */
    private readonly cut: { normal: Vec3; offset: number } | null = null,
  ) {
    super(options);
    this.radius = Math.max(radii[0], radii[1], radii[2]);
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.centre[0], dy = y - this.centre[1], dz = z - this.centre[2];
    const f = this.frame;
    const lx = dx * f.x[0] + dy * f.x[1] + dz * f.x[2];
    const ly = dx * f.y[0] + dy * f.y[1] + dz * f.y[2];
    const lz = dx * f.z[0] + dy * f.z[1] + dz * f.z[2];
    const [rx, ry, rz] = this.radii;
    const k0 = Math.hypot(lx / rx, ly / ry, lz / rz);
    const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz));
    const ellipsoid = k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
    if (!this.cut) return ellipsoid;
    const plane = lx * this.cut.normal[0] + ly * this.cut.normal[1] + lz * this.cut.normal[2] - this.cut.offset;
    return Math.max(ellipsoid, plane);
  }
}

/** Oriented rounded box: flak plates, boot soles, buckles, chest packs. */
export class RoundBox extends Primitive {
  readonly radius: number;

  constructor(
    readonly centre: Vec3,
    private readonly half: Vec3,
    private readonly rounding: number,
    private readonly frame: Frame,
    options: PrimitiveOptions,
  ) {
    super(options);
    this.radius = Math.hypot(half[0], half[1], half[2]);
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.centre[0], dy = y - this.centre[1], dz = z - this.centre[2];
    const f = this.frame;
    const qx = Math.abs(dx * f.x[0] + dy * f.x[1] + dz * f.x[2]) - this.half[0] + this.rounding;
    const qy = Math.abs(dx * f.y[0] + dy * f.y[1] + dz * f.y[2]) - this.half[1] + this.rounding;
    const qz = Math.abs(dx * f.z[0] + dy * f.z[1] + dz * f.z[2]) - this.half[2] + this.rounding;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - this.rounding;
  }
}

/** Oriented torus in its local xz-plane: collars, cuffs, goggle rims, helmet bands. Minor radius may differ across it. */
export class Torus extends Primitive {
  readonly radius: number;

  constructor(
    readonly centre: Vec3,
    private readonly major: number,
    private readonly minor: number,
    private readonly frame: Frame,
    options: PrimitiveOptions,
    /** Squash the ring into an ellipse: scale of the local z axis relative to x. */
    private readonly aspect = 1,
  ) {
    super(options);
    this.radius = major * Math.max(1, aspect) + minor;
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.centre[0], dy = y - this.centre[1], dz = z - this.centre[2];
    const f = this.frame;
    const lx = dx * f.x[0] + dy * f.x[1] + dz * f.x[2];
    const ly = dx * f.y[0] + dy * f.y[1] + dz * f.y[2];
    const lz = (dx * f.z[0] + dy * f.z[1] + dz * f.z[2]) / this.aspect;
    const q = Math.hypot(lx, lz) - this.major;
    return Math.hypot(q, ly) - this.minor;
  }
}

/** Smooth minimum (polynomial, Quilez): blends surfaces within `k` of each other. */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

// Wrinkle noise: value noise on an integer lattice with a quintic fade, summed over two octaves.

function hash(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), ux);
  const x10 = lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), ux);
  const x01 = lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), ux);
  const x11 = lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz) * 2 - 1;
}

/** Ridged noise reads as creases rather than lumps. */
export function wrinkleNoise(x: number, y: number, z: number): number {
  const ridge = 1 - Math.abs(valueNoise(x, y, z));
  const fine = valueNoise(x * 2.3 + 17, y * 2.3 + 5, z * 2.3 + 11);
  return (ridge * ridge - 0.5) * 0.8 + fine * 0.3;
}

export interface FieldSample { distance: number; region: number }

/**
 * Evaluates a list of primitives in order with smooth union (or smooth subtraction). `region` is the primitive whose
 * surface is nearest the sample, so colours follow the outermost layer of clothing.
 */
export class Field {
  private readonly maxBlend: number;

  constructor(readonly primitives: readonly Primitive[]) {
    this.maxBlend = primitives.reduce((largest, primitive) => Math.max(largest, primitive.blend), 0);
  }

  distance(x: number, y: number, z: number): number {
    let d = 1e9;
    for (const primitive of this.primitives) {
      if (!primitive.subtract) {
        const dx = x - primitive.centre[0], dy = y - primitive.centre[1], dz = z - primitive.centre[2];
        const bound = Math.sqrt(dx * dx + dy * dy + dz * dz) - primitive.radius;
        if (bound > d + this.maxBlend) continue;
      }
      const p = primitive.surfaceDistance(x, y, z);
      d = primitive.subtract ? smoothMax(d, -p, primitive.blend) : smoothMin(d, p, primitive.blend);
    }
    return d;
  }

  /**
   * The two regions whose surfaces are nearest the sample, and how much of the second to mix in. Mixing over a few
   * millimetres keeps garment edges soft instead of following the voxel staircase.
   */
  regionMix(x: number, y: number, z: number, softness: number): { primary: number; secondary: number; mix: number } {
    let best = 1e9, bestRegion = 0, second = 1e9, secondRegion = 0;
    for (const primitive of this.primitives) {
      if (primitive.subtract) continue;
      const p = Math.abs(primitive.surfaceDistance(x, y, z)) - primitive.priority * 0.004;
      if (p < best) {
        if (primitive.region !== bestRegion) {
          second = best;
          secondRegion = bestRegion;
        }
        best = p;
        bestRegion = primitive.region;
      } else if (p < second && primitive.region !== bestRegion) {
        second = p;
        secondRegion = primitive.region;
      }
    }
    // Logistic falloff: equal distances mix half and half; a gap of a few `softness` keeps the nearer region pure.
    const mix = second >= 1e8 ? 0 : 1 / (1 + Math.exp((second - best) / softness));
    return { primary: bestRegion, secondary: secondRegion, mix };
  }

  /**
   * The primitives that can matter inside a sphere: since the field is (close to) 1-Lipschitz, nothing whose bounding
   * sphere lies further than `fieldBound + radius` from the centre can win the union there.
   */
  restrict(cx: number, cy: number, cz: number, radius: number, fieldBound: number): Field {
    const reach = fieldBound + radius + this.maxBlend;
    return new Field(this.primitives.filter((primitive) => {
      if (primitive.subtract) return true;
      const dx = cx - primitive.centre[0], dy = cy - primitive.centre[1], dz = cz - primitive.centre[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - primitive.radius - primitive.blend <= reach;
    }));
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const primitive of this.primitives) {
      if (primitive.subtract) continue;
      const [cx, cy, cz] = primitive.centre;
      const r = primitive.radius + primitive.blend;
      box.expandByPoint(new THREE.Vector3(cx - r, cy - r, cz - r));
      box.expandByPoint(new THREE.Vector3(cx + r, cy + r, cz + r));
    }
    return box;
  }
}
