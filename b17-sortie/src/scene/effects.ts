import * as THREE from 'three';
import { addVirtualLight, type VirtualLight } from '../render/studio';
import { cottonMaterial, cottonTuftGeometry, type CottonMaterial } from '../render/miniature';
import { PALETTE } from './palette';
import { STOP_MOTION_FPS } from './stop-motion';

// Flak: an 88 mm burst is a split-second flash, then a black, ragged smoke cluster that hangs where it burst; on the
// stop-motion set, tufts of cotton dyed near black.

const FLAK_POOL_SIZE = 14;
const FLAK_PUFFS = 7;
const FLAK_FLASH_SECONDS = 0.16;
const FLAK_LIFETIME_SECONDS = 7;
const FLAK_SMOKE_COLOR = '#17181b';
/** Filaments per unit tuft and the halo's reach in tuft radii. */
const FLAK_COTTON = { frequency: 12, fuzz: 0.25, shells: 3 } as const;

interface FlakBurst {
  group: THREE.Group;
  puffs: THREE.Mesh[];
  puffOffsets: THREE.Vector3[];
  smoke: CottonMaterial;
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
    const puffGeometry = cottonTuftGeometry(3, { detail: 5, shellDetail: 3, shells: FLAK_COTTON.shells });
    const flashGeometry = new THREE.IcosahedronGeometry(1, 2);
    for (let index = 0; index < FLAK_POOL_SIZE; index++) {
      const group = new THREE.Group();
      group.visible = false;
      const smoke = cottonMaterial({ color: FLAK_SMOKE_COLOR, frequency: FLAK_COTTON.frequency, fuzz: FLAK_COTTON.fuzz });
      const puffs: THREE.Mesh[] = [];
      const puffOffsets: THREE.Vector3[] = [];
      for (let puff = 0; puff < FLAK_PUFFS; puff++) {
        const mesh = new THREE.Mesh(puffGeometry, smoke);
        mesh.castShadow = false;
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

  /** `deltaSec` is the time a stop-motion exposure covers (0 between exposures); `intensity` is bursts per second. */
  update(deltaSec: number, intensity: number, driftSpeed: number, zone: FlakSpawnZone): void {
    if (deltaSec <= 0) return;
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
      const density = Math.min(1, age * 8) * (1 - THREE.MathUtils.smoothstep(age, FLAK_LIFETIME_SECONDS * 0.45, FLAK_LIFETIME_SECONDS));
      burst.smoke.wisp.value = 1 - density;
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

// Contrails: cotton wool pulled out behind each turbosupercharger exhaust, one tuft laid down per stop-motion exposure
// and left to drift aft with the air. Near the engine the tufts are drawn out thin, the way pulled cotton strings out;
// further back they fatten and loosen, then thin to wisps.

const CONTRAIL_LIFETIME_SECONDS = 7;
const CONTRAIL_POINTS = Math.ceil(CONTRAIL_LIFETIME_SECONDS * STOP_MOTION_FPS) + 2;
const CONTRAIL_BIRTH_RADIUS = 0.028;
const CONTRAIL_SPREAD_PER_SECOND = 0.07;
/** A tuft stretches to overlap its older neighbour by this much of the gap, so the trail reads as one strand. */
const CONTRAIL_OVERLAP = 0.75;
/** Filaments per world unit, the halo's reach in tuft radii, and its shells. */
const CONTRAIL_COTTON = { frequency: 40, fuzz: 0.35, shells: 3 } as const;
/** Tufts sit off the trail's line by up to this fraction of their radius, so it reads as torn wool, not a rope. */
const CONTRAIL_SCATTER = 0.35;
/** Boil: how far each tuft turns about the trail between exposures. */
const CONTRAIL_ROLL_BOIL = 0.18;
const CONTRAIL_COLOR = { lab: '#e8edf5', studio: '#9aa0a8' } as const;

interface TrailPoint {
  position: THREE.Vector3;
  age: number;
  roll: number;
  /** Per-tuft girth across and up, and its offset off the trail's line in its own frame, in radii. */
  lump: THREE.Vector2;
  scatter: THREE.Vector2;
}

export class Contrails {
  readonly mesh: THREE.InstancedMesh;
  private readonly trails: TrailPoint[][];
  private readonly wisps: THREE.InstancedBufferAttribute;
  private readonly material: CottonMaterial;
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly roll = new THREE.Quaternion();
  private readonly orientation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly offset = new THREE.Vector3();
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly emitterCount: number) {
    this.trails = Array.from({ length: emitterCount }, () => []);
    this.material = cottonMaterial({ color: CONTRAIL_COLOR.lab, instanced: true, frequency: CONTRAIL_COTTON.frequency, fuzz: CONTRAIL_COTTON.fuzz });
    const geometry = cottonTuftGeometry(5, { detail: 2, shellDetail: 1, shells: CONTRAIL_COTTON.shells, lumpiness: 0.16 });
    const count = emitterCount * CONTRAIL_POINTS;
    this.wisps = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aWisp', this.wisps);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // A thousand tufts with their shells would double the shadow pass for shadows lost under the clouds' own.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    for (let index = 0; index < count; index++) this.mesh.setMatrixAt(index, Contrails.hidden);
  }

  /** Studio is cream, where white cotton vanishes, so the trails go grey there. */
  setStudioMode(studio: boolean): void {
    this.material.color.set(studio ? CONTRAIL_COLOR.studio : CONTRAIL_COLOR.lab);
  }

  /**
   * `exposureSec` is the time a stop-motion exposure covers this frame (0 between exposures); `emitters` are this
   * frame's world-space exhaust positions, one per engine, in a fixed order. The newest tuft stays on its exhaust every
   * frame, so the trail stays attached to the smoothly flying model.
   */
  update(exposureSec: number, driftSpeed: number, emitters: THREE.Vector3[], random: () => number): void {
    for (let emitter = 0; emitter < this.emitterCount; emitter++) {
      const trail = this.trails[emitter];
      if (exposureSec > 0) {
        for (const point of trail) {
          point.age += exposureSec;
          point.position.x -= driftSpeed * exposureSec;
          point.roll += (random() - 0.5) * CONTRAIL_ROLL_BOIL;
        }
        while (trail.length > 0 && trail[trail.length - 1].age > CONTRAIL_LIFETIME_SECONDS) trail.pop();
        trail.unshift({
          position: emitters[emitter].clone(), age: 0, roll: random() * Math.PI * 2,
          lump: new THREE.Vector2(0.7 + random() * 0.6, 0.7 + random() * 0.6),
          scatter: new THREE.Vector2((random() - 0.5) * 2 * CONTRAIL_SCATTER, (random() - 0.5) * 2 * CONTRAIL_SCATTER),
        });
        if (trail.length > CONTRAIL_POINTS) trail.pop();
      }
      if (trail.length > 0) trail[0].position.copy(emitters[emitter]);
      this.writeTrail(emitter, trail);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.wisps.needsUpdate = true;
  }

  private writeTrail(emitter: number, trail: TrailPoint[]): void {
    for (let slot = 0; slot < CONTRAIL_POINTS; slot++) {
      const index = emitter * CONTRAIL_POINTS + slot;
      const point = trail[slot];
      if (!point || trail.length < 2) {
        this.mesh.setMatrixAt(index, Contrails.hidden);
        continue;
      }
      const older = trail[Math.min(slot + 1, trail.length - 1)];
      const newer = trail[Math.max(slot - 1, 0)];
      this.tangent.subVectors(newer.position, older.position);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(1, 0, 0);
      this.tangent.normalize();
      this.up.set(0, 1, 0);
      if (Math.abs(this.tangent.y) > 0.95) this.up.set(0, 0, 1);
      this.side.crossVectors(this.tangent, this.up).normalize();
      this.up.crossVectors(this.side, this.tangent);
      this.basis.makeBasis(this.tangent, this.up, this.side);
      this.orientation.setFromRotationMatrix(this.basis).multiply(this.roll.setFromAxisAngle(X_AXIS, point.roll));
      const radius = CONTRAIL_BIRTH_RADIUS + point.age * CONTRAIL_SPREAD_PER_SECOND;
      const gap = point.position.distanceTo(older.position);
      this.scale.set(Math.max(radius, gap * CONTRAIL_OVERLAP), radius * point.lump.x, radius * point.lump.y);
      // The newest tuft stays on the exhaust; the rest scatter off the line as they grow.
      const scatter = slot === 0 ? 0 : radius;
      this.offset.copy(this.up).multiplyScalar(point.scatter.x * scatter).addScaledVector(this.side, point.scatter.y * scatter).add(point.position);
      this.matrix.compose(this.offset, this.orientation, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
      // Condensation forms a short way behind the exhaust, so the newest tufts are only a few strands; old ones fray.
      const forming = 1 - THREE.MathUtils.smoothstep(point.age, 0.02, 0.4);
      const fraying = THREE.MathUtils.smoothstep(point.age, 2.5, CONTRAIL_LIFETIME_SECONDS);
      this.wisps.setX(index, Math.max(forming * 0.8, fraying));
    }
  }

  reset(): void {
    for (const trail of this.trails) trail.length = 0;
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

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
