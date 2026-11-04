import * as THREE from 'three';
import type { Hotspot } from '../scene/interior/hotspots';

/** Hotspots show only when the camera is this close to them, in world units: inside or just outside the cut. */
const NEAR_DISTANCE = 3.2;

interface Marker { hotspot: Hotspot; element: HTMLElement }

/**
 * Cutaway hotspots: a small ring on each named fitting; hovering one shows what it is and the figure it was modelled
 * from. They show only near the camera, so a wide shot of the cutaway stays clean.
 */
export class Hotspots {
  private readonly markers: Marker[];
  private readonly world = new THREE.Vector3();

  constructor(container: HTMLElement, private readonly root: THREE.Object3D, hotspots: Hotspot[]) {
    this.markers = hotspots.map((hotspot) => {
      const element = document.createElement('div');
      element.className = 'hotspot';
      const label = document.createElement('span');
      label.append(document.createTextNode(hotspot.label), Object.assign(document.createElement('em'), { textContent: hotspot.source }));
      element.append(label);
      container.append(element);
      return { hotspot, element };
    });
  }

  /** `visibility` is the cutaway's openness, 0 to 1. */
  update(camera: THREE.Camera, width: number, height: number, visibility: number): void {
    for (const marker of this.markers) {
      this.root.localToWorld(this.world.copy(marker.hotspot.anchor));
      const near = 1 - THREE.MathUtils.smoothstep(camera.position.distanceTo(this.world), NEAR_DISTANCE * 0.7, NEAR_DISTANCE);
      const opacity = visibility * near;
      this.world.project(camera);
      const shown = opacity > 0.01 && this.world.z < 1 && Math.abs(this.world.x) < 1 && Math.abs(this.world.y) < 1;
      marker.element.style.display = shown ? '' : 'none';
      if (!shown) continue;
      marker.element.style.opacity = opacity.toFixed(3);
      marker.element.style.transform = `translate(${((this.world.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-this.world.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
    }
  }
}
