import * as THREE from 'three';
import type { B17 } from './b17';

/** The cut plane sweeps from outside the starboard skin to the centreline, so the skin peels away rather than popping. */
const CUT_START_Z = 1.6;
const CUT_END_Z = 0.02;
const SWEEP_SECONDS = 1.4;
/** Starboard-wall equipment disappears once the plane has swept past the wall it hangs on. */
const HIDE_WALL_AT = 0.35;

/**
 * Starboard-half cutaway of one aircraft. The fuselage skin and the parts mounted on it get private copies of their
 * materials with two clipping planes; together (`clipIntersection`) they remove only the slab between the cut plane and
 * the starboard skin, so the wings, nacelles and the interior stay whole. Planes are world space, so they follow the
 * aircraft every frame.
 */
export class Cutaway {
  private readonly localPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), CUT_START_Z), new THREE.Plane(new THREE.Vector3(0, 0, 1), -CUT_START_Z)];
  private readonly worldPlanes = [new THREE.Plane(), new THREE.Plane()];
  /** Clipped meshes and whether they skipped ambient occlusion before the cut (glass always does). */
  private progress = 0;
  private open = false;

  constructor(private readonly aircraft: B17) {
    const clones = new Map<THREE.Material, THREE.Material>();
    for (const material of aircraft.cutawayMaterials) {
      // Material.clone() drops shader patches; carry over the original's (studio shading, window holes).
      const clone = material.clone();
      clone.onBeforeCompile = material.onBeforeCompile;
      clone.customProgramCacheKey = material.customProgramCacheKey;
      clone.clippingPlanes = this.worldPlanes;
      clone.clipIntersection = true;
      clone.clipShadows = true;
      clones.set(material, clone);
    }
    aircraft.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const clone = clones.get(object.material);
      if (!clone) return;
      object.material = clone;
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 0 with the skin intact, 1 fully cut. */
  get amount(): number {
    return THREE.MathUtils.smoothstep(this.progress, 0, 1);
  }

  setOpen(open: boolean): void {
    this.open = open;
  }

  update(deltaSec: number): void {
    const step = deltaSec / SWEEP_SECONDS;
    this.progress = THREE.MathUtils.clamp(this.progress + (this.open ? step : -step), 0, 1);
    const cutZ = THREE.MathUtils.lerp(CUT_START_Z, CUT_END_Z, this.amount);
    this.localPlanes[0].constant = cutZ;
    const matrix = this.aircraft.root.matrixWorld;
    this.localPlanes.forEach((plane, index) => this.worldPlanes[index].copy(plane).applyMatrix4(matrix));
    for (const object of this.aircraft.cutawayHidden) object.visible = this.amount < HIDE_WALL_AT;
  }
}
