import * as THREE from 'three';
import type { CrewStation } from '../scene/interior';

/** Leader lengths alternate along the fuselage so neighbouring stations' chips do not overlap. */
const LEADER_PIXELS = [30, 78] as const;

interface Callout {
  station: CrewStation;
  element: HTMLElement;
  text: HTMLElement;
}

/** Cutaway labels: a dot on each crew station, a leader line, and a chip naming the station. */
export class Callouts {
  private readonly callouts: Callout[];
  private readonly world = new THREE.Vector3();
  private readonly starboard = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly rootQuaternion = new THREE.Quaternion();

  /**
   * `root` is the aircraft; a station's anchor is in its `space` if it has one, else in the root. `fadeOnPortSide`
   * hides a callout when the camera swings round to the side the cutaway leaves whole.
   */
  constructor(container: HTMLElement, private readonly root: THREE.Object3D, stations: CrewStation[], private readonly fadeOnPortSide = true) {
    this.callouts = stations.map((station, index) => {
      const element = document.createElement('div');
      element.className = `callout is-${station.placement}`;
      element.style.setProperty('--leader', `${LEADER_PIXELS[index % LEADER_PIXELS.length]}px`);
      const text = document.createElement('span');
      text.textContent = station.role;
      element.append(text, document.createElement('i'));
      container.append(element);
      return { station, element, text };
    });
  }

  /** `visibility` fades every callout; each also fades out when the camera swings round to the uncut port side. */
  update(camera: THREE.Camera, width: number, height: number, visibility: number, bombsAboard: number): void {
    this.root.getWorldQuaternion(this.rootQuaternion);
    this.starboard.set(0, 0, 1).applyQuaternion(this.rootQuaternion);
    for (const callout of this.callouts) {
      (callout.station.space ?? this.root).localToWorld(this.world.copy(callout.station.anchor));
      const facing = this.toCamera.subVectors(camera.position, this.world).normalize().dot(this.starboard);
      const opacity = this.fadeOnPortSide ? visibility * THREE.MathUtils.smoothstep(facing, 0.05, 0.3) : visibility;
      this.world.project(camera);
      const onScreen = this.world.z < 1 && Math.abs(this.world.x) < 1.05 && Math.abs(this.world.y) < 1.05;
      const shown = opacity > 0.01 && onScreen;
      callout.element.style.display = shown ? '' : 'none';
      if (!shown) continue;
      const x = (this.world.x * 0.5 + 0.5) * width;
      const y = (-this.world.y * 0.5 + 0.5) * height;
      callout.element.style.opacity = opacity.toFixed(3);
      callout.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const label = callout.station.showsBombLoad ? `${callout.station.role} · ${bombsAboard} × 500 lb` : callout.station.role;
      if (callout.text.textContent !== label) callout.text.textContent = label;
    }
  }
}
