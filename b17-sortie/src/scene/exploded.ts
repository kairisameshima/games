import * as THREE from 'three';
import { ASSEMBLY_LABEL, type AssemblyId, type Assemblies } from './assemblies';
import type { CrewStation } from './interior';

const SWEEP_SECONDS = 1.6;
/** Labels sit this far above (or below) their assembly's bounds. */
const LABEL_CLEARANCE = 0.12;
/** An outboard label sits this fraction of the surface's span out from its middle. */
const OUTBOARD_FRACTION = 0.3;

/** Exploded view of one aircraft: its assemblies slide apart along their fitting lines and back. */
export class ExplodedView {
  private progress = 0;
  private open = false;

  constructor(private readonly assemblies: Assemblies) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** 0 assembled, 1 fully exploded, eased. */
  get amount(): number {
    return THREE.MathUtils.smootherstep(this.progress, 0, 1);
  }

  setOpen(open: boolean): void {
    this.open = open;
  }

  update(deltaSec: number): void {
    const step = deltaSec / SWEEP_SECONDS;
    this.progress = THREE.MathUtils.clamp(this.progress + (this.open ? step : -step), 0, 1);
    this.assemblies.setExplosion(this.amount);
  }

  /** One callout per assembly, pinned over (or under) the middle of its bounds; built with the aircraft at rest. */
  labels(root: THREE.Object3D): CrewStation[] {
    root.updateMatrixWorld(true);
    const rootInverse = root.matrixWorld.clone().invert();
    const stations: CrewStation[] = [];
    for (const [id, group] of this.assemblies.groups) {
      const bounds = new THREE.Box3().setFromObject(group).applyMatrix4(rootInverse);
      if (bounds.isEmpty()) continue;
      const { label, below, outboard } = ASSEMBLY_LABEL[id as AssemblyId];
      const centre = bounds.getCenter(new THREE.Vector3());
      const z = outboard ? centre.z + Math.sign(centre.z) * (bounds.max.z - bounds.min.z) * OUTBOARD_FRACTION : centre.z;
      const anchor = new THREE.Vector3(centre.x, below ? bounds.min.y - LABEL_CLEARANCE : bounds.max.y + LABEL_CLEARANCE, z);
      stations.push({ role: label, anchor, space: group, placement: below ? 'below' : 'above', showsBombLoad: false });
    }
    return stations;
  }
}
