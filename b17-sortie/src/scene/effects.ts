import * as THREE from 'three';
import { addVirtualLight, applyStudioShading, type VirtualLight } from '../render/studio';
import { PALETTE } from './palette';

// Flak: an 88 mm burst is a split-second flash, then a black, ragged smoke cluster that hangs where it burst.

const FLAK_POOL_SIZE = 14;
const FLAK_PUFFS = 7;
const FLAK_FLASH_SECONDS = 0.16;
const FLAK_LIFETIME_SECONDS = 7;

interface FlakBurst {
  group: THREE.Group;
  puffs: THREE.Mesh[];
  puffOffsets: THREE.Vector3[];
  smoke: THREE.MeshStandardMaterial;
  flash: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  light: VirtualLight;
  age: number;
  active: boolean;
  size: number;
}

export interface FlakSpawnZone {
  centre: THREE.Vector3;
  /** Bursts never appear closer than this to the centre, so the hero model stays clear. */
  minimumDistance: number;
  halfExtents: THREE.Vector3;
}

export class FlakField {
  readonly root = new THREE.Group();
  private readonly bursts: FlakBurst[] = [];
  private spawnAccumulator = 0;
  private readonly flashColor = new THREE.Color(PALETTE.flakFlash);
  private random = mulberry(1943);

  constructor() {
    const puffGeometry = new THREE.IcosahedronGeometry(1, 1);
    const flashGeometry = new THREE.IcosahedronGeometry(1, 2);
    for (let index = 0; index < FLAK_POOL_SIZE; index++) {
      const group = new THREE.Group();
      group.visible = false;
      const smoke = applyStudioShading(new THREE.MeshStandardMaterial({
        color: '#17181b', roughness: 0.95, flatShading: true, transparent: true, opacity: 0, depthWrite: false, envMapIntensity: 0.3,
      }));
      const puffs: THREE.Mesh[] = [];
      const puffOffsets: THREE.Vector3[] = [];
      for (let puff = 0; puff < FLAK_PUFFS; puff++) {
        const mesh = new THREE.Mesh(puffGeometry, smoke);
        mesh.castShadow = false;
        mesh.userData.skipAmbientOcclusion = true;
        group.add(mesh);
        puffs.push(mesh);
        puffOffsets.push(new THREE.Vector3());
      }
      const flashMaterial = new THREE.MeshBasicMaterial({ color: this.flashColor.clone().multiplyScalar(6), transparent: true, fog: false, depthWrite: false });
      const flash = new THREE.Mesh(flashGeometry, flashMaterial);
      group.add(flash);
      const light = addVirtualLight(new THREE.Vector3(), PALETTE.flakFlash, 3.2, 0);
      this.root.add(group);
      this.bursts.push({ group, puffs, puffOffsets, smoke, flash, flashMaterial, light, age: 0, active: false, size: 1 });
    }
  }

  /** `intensity` is bursts per second; the burst field drifts aft at the formation's speed. */
  update(deltaSec: number, intensity: number, driftSpeed: number, zone: FlakSpawnZone): void {
    this.spawnAccumulator += deltaSec * intensity;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawn(zone);
    }
    for (const burst of this.bursts) {
      if (!burst.active) continue;
      burst.age += deltaSec;
      const age = burst.age;
      if (age > FLAK_LIFETIME_SECONDS) {
        burst.active = false;
        burst.group.visible = false;
        burst.light.intensity = 0;
        continue;
      }
      burst.group.position.x -= driftSpeed * deltaSec;
      const flashT = Math.min(age / FLAK_FLASH_SECONDS, 1);
      burst.flash.visible = flashT < 1;
      burst.flash.scale.setScalar(burst.size * (0.25 + flashT * 0.35));
      burst.flashMaterial.opacity = 1 - flashT;
      burst.light.position.copy(burst.group.position);
      burst.light.intensity = (1 - flashT) * 3.5;
      // Smoke blooms out fast, then slowly spreads and thins.
      const growth = 1 - Math.exp(-age * 5);
      const spread = 1 + age * 0.08;
      burst.puffs.forEach((puff, index) => {
        puff.position.copy(burst.puffOffsets[index]).multiplyScalar(growth * spread);
        puff.scale.setScalar(burst.size * (0.12 + growth * 0.22) * spread);
      });
      burst.smoke.opacity = Math.min(1, age * 8) * (1 - THREE.MathUtils.smoothstep(age, FLAK_LIFETIME_SECONDS * 0.45, FLAK_LIFETIME_SECONDS)) * 0.92;
      burst.smoke.color.setScalar(0.04 + age * 0.012);
    }
  }

  private spawn(zone: FlakSpawnZone): void {
    const burst = this.bursts.find((candidate) => !candidate.active);
    if (!burst) return;
    const position = new THREE.Vector3();
    for (let attempt = 0; attempt < 12; attempt++) {
      position.set(
        zone.centre.x + (this.random() * 2 - 1) * zone.halfExtents.x,
        zone.centre.y + (this.random() * 2 - 1) * zone.halfExtents.y,
        zone.centre.z + (this.random() * 2 - 1) * zone.halfExtents.z,
      );
      if (position.distanceTo(zone.centre) > zone.minimumDistance) break;
    }
    burst.group.position.copy(position);
    burst.group.visible = true;
    burst.active = true;
    burst.age = 0;
    burst.size = 0.8 + this.random() * 0.6;
    burst.puffOffsets.forEach((offset, index) => {
      if (index === 0) offset.set(0, 0, 0);
      else offset.set(this.random() - 0.5, (this.random() - 0.5) * 0.7, this.random() - 0.5).multiplyScalar(0.9 * burst.size);
    });
  }

  reset(): void {
    for (const burst of this.bursts) {
      burst.active = false;
      burst.group.visible = false;
      burst.light.intensity = 0;
    }
    this.spawnAccumulator = 0;
    this.random = mulberry(1943);
  }
}

// Contrails: one camera-facing ribbon per engine, laid down from the turbosupercharger exhaust and left to drift
// aft with the air. A ribbon reads as a continuous condensation trail where sprites read as dotted lines.

const CONTRAIL_LIFETIME_SECONDS = 7;
const CONTRAIL_SAMPLE_SECONDS = 0.05;
const CONTRAIL_POINTS = Math.ceil(CONTRAIL_LIFETIME_SECONDS / CONTRAIL_SAMPLE_SECONDS) + 2;
const CONTRAIL_BIRTH_WIDTH = 0.025;
const CONTRAIL_SPREAD_PER_SECOND = 0.07;

const CONTRAIL_VERTEX_SHADER = /* glsl */ `
  attribute float aAcross;
  attribute float aAlpha;
  varying float vAcross;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vAcross = aAcross;
    vAlpha = aAlpha;
  }`;

const CONTRAIL_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAcross;
  varying float vAlpha;
  void main() {
    float alpha = exp(-vAcross * vAcross * 3.2) * vAlpha * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }`;

interface TrailPoint { position: THREE.Vector3; age: number }

export class Contrails {
  readonly mesh: THREE.Mesh;
  private readonly trails: TrailPoint[][];
  private readonly sinceSample: number[];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly tangent = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(private readonly emitterCount: number) {
    this.trails = Array.from({ length: emitterCount }, () => []);
    this.sinceSample = new Array<number>(emitterCount).fill(0);
    const vertexCount = emitterCount * CONTRAIL_POINTS * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.alphas = new Float32Array(vertexCount);
    const across = new Float32Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex++) across[vertex] = vertex % 2 === 0 ? -1 : 1;
    const indices: number[] = [];
    for (let emitter = 0; emitter < emitterCount; emitter++) {
      for (let point = 0; point < CONTRAIL_POINTS - 1; point++) {
        const a = (emitter * CONTRAIL_POINTS + point) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geometry.setIndex(indices);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.86, 0.9, 0.96) }, uOpacity: { value: 0.55 } },
      vertexShader: CONTRAIL_VERTEX_SHADER,
      fragmentShader: CONTRAIL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.skipAmbientOcclusion = true;
  }

  /** Studio is cream, where pale trails vanish, so they darken there. */
  setStudioMode(studio: boolean): void {
    const color = this.material.uniforms.uColor.value as THREE.Color;
    if (studio) color.setRGB(0.5, 0.53, 0.58);
    else color.setRGB(0.86, 0.9, 0.96);
    this.material.uniforms.uOpacity.value = studio ? 0.42 : 0.55;
  }

  /** `emitters` are this frame's world-space exhaust positions, one per engine, in a fixed order. */
  update(deltaSec: number, driftSpeed: number, emitters: THREE.Vector3[], cameraPosition: THREE.Vector3): void {
    for (let emitter = 0; emitter < this.emitterCount; emitter++) {
      const trail = this.trails[emitter];
      for (const point of trail) {
        point.age += deltaSec;
        point.position.x -= driftSpeed * deltaSec;
      }
      while (trail.length > 0 && trail[trail.length - 1].age > CONTRAIL_LIFETIME_SECONDS) trail.pop();
      this.sinceSample[emitter] += deltaSec;
      if (trail.length < 2 || this.sinceSample[emitter] >= CONTRAIL_SAMPLE_SECONDS) {
        this.sinceSample[emitter] = 0;
        trail.unshift({ position: emitters[emitter].clone(), age: 0 });
        if (trail.length > CONTRAIL_POINTS) trail.pop();
      }
      // The head always sits on the exhaust, so the trail stays attached as the aircraft moves.
      trail[0].position.copy(emitters[emitter]);
      this.writeRibbon(emitter, trail, cameraPosition);
    }
    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  private writeRibbon(emitter: number, trail: TrailPoint[], cameraPosition: THREE.Vector3): void {
    for (let point = 0; point < CONTRAIL_POINTS; point++) {
      const vertex = (emitter * CONTRAIL_POINTS + point) * 2;
      // Slots past the end of a young trail collapse onto its last sample with zero alpha.
      const sampleIndex = Math.min(point, trail.length - 1);
      const sample = trail[sampleIndex];
      const neighbour = trail[Math.min(sampleIndex + 1, trail.length - 1)];
      const previous = trail[Math.max(sampleIndex - 1, 0)];
      this.tangent.subVectors(neighbour.position, previous.position);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(1, 0, 0);
      this.toCamera.subVectors(cameraPosition, sample.position);
      this.side.crossVectors(this.tangent, this.toCamera).normalize();
      const halfWidth = CONTRAIL_BIRTH_WIDTH + sample.age * CONTRAIL_SPREAD_PER_SECOND;
      // Condensation forms a short way behind the exhaust, then the trail spreads and thins out.
      const alpha = point >= trail.length
        ? 0
        : THREE.MathUtils.smoothstep(sample.age, 0.04, 0.45) * (1 - THREE.MathUtils.smoothstep(sample.age, 2.2, CONTRAIL_LIFETIME_SECONDS)) * (1 - sample.age * 0.06);
      for (const [offset, sign] of [[0, -1], [1, 1]] as const) {
        const index = (vertex + offset) * 3;
        this.positions[index] = sample.position.x + this.side.x * halfWidth * sign;
        this.positions[index + 1] = sample.position.y + this.side.y * halfWidth * sign;
        this.positions[index + 2] = sample.position.z + this.side.z * halfWidth * sign;
        this.alphas[vertex + offset] = alpha;
      }
    }
  }

  reset(): void {
    for (const trail of this.trails) trail.length = 0;
  }
}

// Falling bombs, released in train from the bay.

const BOMB_GRAVITY = 3.2;
const BOMB_DRAG = 0.55;

interface FallingBomb { object: THREE.Object3D; velocity: THREE.Vector3; age: number }

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class BombTrain {
  readonly root = new THREE.Group();
  private readonly pitchAxis = new THREE.Vector3();
  private readonly falling: FallingBomb[] = [];

  constructor(private readonly createBomb: () => THREE.Object3D, private readonly floorClearance: number) {}

  release(worldPosition: THREE.Vector3, worldQuaternion: THREE.Quaternion, scale: number): void {
    const object = this.createBomb();
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
    object.scale.setScalar(scale);
    this.root.add(object);
    this.falling.push({ object, velocity: new THREE.Vector3(0, -0.15, 0), age: 0 });
  }

  update(deltaSec: number): void {
    for (let index = this.falling.length - 1; index >= 0; index--) {
      const bomb = this.falling[index];
      bomb.age += deltaSec;
      bomb.velocity.y -= BOMB_GRAVITY * deltaSec;
      // Drag slows the bomb against the bomber, so the stick trails aft as it falls.
      bomb.velocity.x -= BOMB_DRAG * deltaSec;
      bomb.object.position.addScaledVector(bomb.velocity, deltaSec);
      // Nose drops as it falls: pitch about the horizontal axis across the bomb, whatever its roll on the rack was.
      const axis = this.pitchAxis.set(1, 0, 0).applyQuaternion(bomb.object.quaternion).cross(WORLD_UP).negate().normalize();
      bomb.object.rotateOnWorldAxis(axis, 0.35 * deltaSec);
      if (bomb.object.position.y < this.floorClearance) {
        this.root.remove(bomb.object);
        this.falling.splice(index, 1);
      }
    }
  }

  reset(): void {
    for (const bomb of this.falling) this.root.remove(bomb.object);
    this.falling.length = 0;
  }
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
