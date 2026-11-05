import * as THREE from 'three';
import { addVirtualLight, glassMaterial, matteMaterial, type VirtualLight } from '../render/studio';
import { cottonMaterial, cottonTuftGeometry, type CottonMaterial } from '../render/miniature';
import { PALETTE } from './palette';
import { MAX_STOP_MOTION_FPS } from './stop-motion';
import { handCutFlashTextures } from './textures';

// Flak: an 88 mm burst is a split-second flash, then a black, ragged smoke cluster that hangs where it burst; on the
// stop-motion set, a hand-cut paper flash, then tufts of cotton dyed near black, hung from the rig on a fine wire.

const FLAK_POOL_SIZE = 14;
const FLAK_PUFFS = 7;
const FLAK_FLASH_SECONDS = 0.16;
const FLAK_LIFETIME_SECONDS = 7;
const FLAK_SMOKE_COLOR = '#17181b';
/** Filaments per unit tuft and the halo's reach in tuft radii. */
const FLAK_COTTON = { frequency: 12, fuzz: 0.25, shells: 3 } as const;
/** World height of the rig that bursts and fighters hang from, above the set. */
export const RIG_HEIGHT = 16;
/** Fishing-line wire: radius in world units, its colour, and the smoke density below which a burst is taken down off it. */
export const RIG_WIRE = { radius: 0.0035, colour: '#c9ccd0', takenDownBelow: 0.12 } as const;

interface FlakBurst {
  group: THREE.Group;
  puffs: THREE.Mesh[];
  puffOffsets: THREE.Vector3[];
  smoke: CottonMaterial;
  /** One replacement piece per child; an exposure shows one of them. */
  flash: THREE.Group;
  wire: THREE.Mesh;
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
  private random = mulberry(1943);
  /** Bursts set off since the last `takeBurstCount`, for the foley. */
  private burstCount = 0;

  constructor() {
    const puffGeometry = cottonTuftGeometry(3, { detail: 5, shellDetail: 3, shells: FLAK_COTTON.shells });
    const flashPieces = handCutFlashTextures().map((texture) => new THREE.MeshBasicMaterial({
      map: texture, color: new THREE.Color(2.4, 2.1, 1.8), alphaTest: 0.5, side: THREE.DoubleSide, fog: false, toneMapped: false,
    }));
    const flashCard = new THREE.PlaneGeometry(2, 2);
    const wireGeometry = new THREE.CylinderGeometry(RIG_WIRE.radius, RIG_WIRE.radius, 1, 5, 1, true).translate(0, 0.5, 0);
    const wireMaterial = matteMaterial(RIG_WIRE.colour, { roughness: 0.3, envMapIntensity: 1.2 });
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
      // Each paper flash is three cards crossed at right angles, so it reads from any side.
      const flash = new THREE.Group();
      for (const material of flashPieces) {
        const piece = new THREE.Group();
        for (const [x, y] of [[0, 0], [0, Math.PI / 2], [Math.PI / 2, 0]]) {
          const card = new THREE.Mesh(flashCard, material);
          card.rotation.set(x, y, 0);
          piece.add(card);
        }
        flash.add(piece);
      }
      group.add(flash);
      const wire = new THREE.Mesh(wireGeometry, wireMaterial);
      group.add(wire);
      const light = addVirtualLight(new THREE.Vector3(), PALETTE.flakFlash, 3.2, 0);
      this.root.add(group);
      this.bursts.push({ group, puffs, puffOffsets, smoke, flash, wire, light, age: 0, active: false, size: 1 });
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
      // A bigger piece each exposure while it lasts, a different one each time.
      const piece = Math.floor(this.random() * burst.flash.children.length);
      burst.flash.children.forEach((child, index) => { child.visible = index === piece; });
      burst.flash.scale.setScalar(burst.size * (0.3 + flashT * 0.3));
      burst.flash.rotation.set(this.random() * Math.PI, this.random() * Math.PI, 0);
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
      burst.wire.visible = density > RIG_WIRE.takenDownBelow;
      burst.smoke.color.setScalar(0.04 + age * 0.012);
    }
  }

  private spawn(zone: FlakSpawnZone): void {
    const position = new THREE.Vector3();
    for (let attempt = 0; attempt < 12; attempt++) {
      position.set(
        zone.centre.x + (this.random() * 2 - 1) * zone.halfExtents.x,
        zone.centre.y + (this.random() * 2 - 1) * zone.halfExtents.y,
        zone.centre.z + (this.random() * 2 - 1) * zone.halfExtents.z,
      );
      if (position.distanceTo(zone.centre) > zone.minimumDistance) break;
    }
    this.burstAt(position);
  }

  /** A burst at a chosen world position: the one that hits the lead. */
  burstAt(position: THREE.Vector3): void {
    const burst = this.bursts.find((candidate) => !candidate.active);
    if (!burst) return;
    this.burstCount += 1;
    burst.group.position.copy(position);
    burst.group.visible = true;
    burst.wire.scale.set(1, Math.max(RIG_HEIGHT - position.y, 0), 1);
    burst.active = true;
    burst.age = 0;
    burst.size = 0.8 + this.random() * 0.6;
    burst.puffOffsets.forEach((offset, index) => {
      if (index === 0) offset.set(0, 0, 0);
      else offset.set(this.random() - 0.5, (this.random() - 0.5) * 0.7, this.random() - 0.5).multiplyScalar(0.9 * burst.size);
    });
  }

  /** How many bursts went off since the last call. */
  takeBurstCount(): number {
    const count = this.burstCount;
    this.burstCount = 0;
    return count;
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

// Contrails: cotton wool pulled out behind each turbosupercharger exhaust and threaded on an armature wire, the way a
// stop-motion trail is built. Each trail is a fixed set of tufts the animator reuses: every exposure he slides each one
// back along the wire and teases it a little looser, and the one that has thinned out at the tail is pulled off and
// pressed on again at the exhaust. Near the engine the tufts are drawn out thin; further back they fatten and fray.

const CONTRAIL_LIFETIME_SECONDS = 7;
const CONTRAIL_POINTS = Math.ceil(CONTRAIL_LIFETIME_SECONDS * MAX_STOP_MOTION_FPS) + 2;
const CONTRAIL_BIRTH_RADIUS = 0.028;
const CONTRAIL_SPREAD_PER_SECOND = 0.07;
/** A tuft stretches to overlap its older neighbour by this much of the gap, so the trail reads as one strand. */
const CONTRAIL_OVERLAP = 0.75;
/** Filaments per world unit, the halo's reach in tuft radii, and its shells. */
const CONTRAIL_COTTON = { frequency: 40, fuzz: 0.35, shells: 3 } as const;
/** Tufts sit off the wire by up to this fraction of their radius, more as they are teased loose. */
const CONTRAIL_SCATTER = 0.35;
/** Boil: how far each tuft turns about the wire between exposures. */
const CONTRAIL_ROLL_BOIL = 0.18;
const CONTRAIL_COLOR = { lab: '#e8edf5', studio: '#9aa0a8' } as const;
export interface TrailLook {
  colour: { lab: string; studio: string };
  /** Tuft radius as a multiple of a contrail's. */
  girth: number;
}

const CONTRAIL_LOOK: TrailLook = { colour: CONTRAIL_COLOR, girth: 1 };
/** Oil smoke from a hit engine: the same cotton on its wire, dyed charcoal and pulled out thicker. */
export const ENGINE_SMOKE_LOOK: TrailLook = { colour: { lab: '#1e1e20', studio: '#19191b' }, girth: 3.0 };
const ARMATURE_WIRE_RADIUS = 0.003;

interface TrailPoint {
  /** The tuft's instance: the same piece of cotton for as long as it is on the wire. */
  instance: number;
  position: THREE.Vector3;
  age: number;
  roll: number;
  /** Per-tuft girth across and up, and its offset off the wire in its own frame, in radii. */
  lump: THREE.Vector2;
  scatter: THREE.Vector2;
}

export class Contrails {
  readonly root = new THREE.Group();
  private readonly tufts: THREE.InstancedMesh;
  private readonly wire: THREE.InstancedMesh;
  private readonly trails: TrailPoint[][];
  /** Tufts not on a wire, per trail. */
  private readonly spare: number[][];
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

  constructor(private readonly emitterCount: number, private readonly look: TrailLook = CONTRAIL_LOOK) {
    this.trails = Array.from({ length: emitterCount }, () => []);
    this.spare = Array.from({ length: emitterCount }, (_, emitter) => Array.from({ length: CONTRAIL_POINTS }, (__, slot) => emitter * CONTRAIL_POINTS + slot));
    this.material = cottonMaterial({ color: look.colour.lab, instanced: true, frequency: CONTRAIL_COTTON.frequency, fuzz: CONTRAIL_COTTON.fuzz });
    const geometry = cottonTuftGeometry(5, { detail: 2, shellDetail: 1, shells: CONTRAIL_COTTON.shells, lumpiness: 0.16 });
    const count = emitterCount * CONTRAIL_POINTS;
    this.wisps = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aWisp', this.wisps);
    this.tufts = new THREE.InstancedMesh(geometry, this.material, count);
    this.tufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tufts.frustumCulled = false;
    // A thousand tufts with their shells would double the shadow pass for shadows lost under the clouds' own.
    this.tufts.castShadow = false;
    this.tufts.receiveShadow = true;
    // The armature: one unit length of wire per gap between tufts, along +y.
    const wireGeometry = new THREE.CylinderGeometry(ARMATURE_WIRE_RADIUS, ARMATURE_WIRE_RADIUS, 1, 5, 1, true).translate(0, 0.5, 0);
    this.wire = new THREE.InstancedMesh(wireGeometry, matteMaterial('#b9bcc0', { roughness: 0.35, envMapIntensity: 1.2 }), count);
    this.wire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wire.frustumCulled = false;
    for (let index = 0; index < count; index++) {
      this.tufts.setMatrixAt(index, Contrails.hidden);
      this.wire.setMatrixAt(index, Contrails.hidden);
    }
    this.root.add(this.tufts, this.wire);
  }

  /** Studio is cream, where white cotton vanishes, so the trails go grey there. */
  setStudioMode(studio: boolean): void {
    this.material.color.set(studio ? this.look.colour.studio : this.look.colour.lab);
  }

  /**
   * `exposureSec` is the film time an exposure covers this frame (0 between exposures); `emitters` are this frame's
   * world-space exhaust positions, one per engine, in a fixed order. While `emitting` is false no new tufts go on, and
   * the trail drifts off and is taken down.
   */
  update(exposureSec: number, driftSpeed: number, emitters: THREE.Vector3[], random: () => number, emitting = true): void {
    for (let emitter = 0; emitter < this.emitterCount; emitter++) {
      const trail = this.trails[emitter];
      if (exposureSec > 0) {
        for (const point of trail) {
          point.age += exposureSec;
          point.position.x -= driftSpeed * exposureSec;
          point.roll += (random() - 0.5) * CONTRAIL_ROLL_BOIL;
        }
        while (trail.length > 0 && (trail[trail.length - 1].age > CONTRAIL_LIFETIME_SECONDS || this.spare[emitter].length === 0)) {
          this.takeOff(emitter, trail.pop() as TrailPoint);
        }
        if (emitting) trail.unshift({
          instance: this.spare[emitter].pop() as number, position: emitters[emitter].clone(), age: 0, roll: random() * Math.PI * 2,
          lump: new THREE.Vector2(0.7 + random() * 0.6, 0.7 + random() * 0.6),
          scatter: new THREE.Vector2((random() - 0.5) * 2 * CONTRAIL_SCATTER, (random() - 0.5) * 2 * CONTRAIL_SCATTER),
        });
      }
      if (emitting && trail.length > 0) trail[0].position.copy(emitters[emitter]);
      this.writeTrail(trail);
    }
    this.tufts.instanceMatrix.needsUpdate = true;
    this.wire.instanceMatrix.needsUpdate = true;
    this.wisps.needsUpdate = true;
  }

  private takeOff(emitter: number, point: TrailPoint): void {
    this.tufts.setMatrixAt(point.instance, Contrails.hidden);
    this.wire.setMatrixAt(point.instance, Contrails.hidden);
    this.spare[emitter].push(point.instance);
  }

  private writeTrail(trail: TrailPoint[]): void {
    trail.forEach((point, order) => {
      if (trail.length < 2) {
        this.tufts.setMatrixAt(point.instance, Contrails.hidden);
        this.wire.setMatrixAt(point.instance, Contrails.hidden);
        return;
      }
      const older = trail[Math.min(order + 1, trail.length - 1)];
      const newer = trail[Math.max(order - 1, 0)];
      this.tangent.subVectors(newer.position, older.position);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(1, 0, 0);
      this.tangent.normalize();
      this.up.set(0, 1, 0);
      if (Math.abs(this.tangent.y) > 0.95) this.up.set(0, 0, 1);
      this.side.crossVectors(this.tangent, this.up).normalize();
      this.up.crossVectors(this.side, this.tangent);
      this.basis.makeBasis(this.tangent, this.up, this.side);
      this.orientation.setFromRotationMatrix(this.basis).multiply(this.roll.setFromAxisAngle(X_AXIS, point.roll));
      const radius = (CONTRAIL_BIRTH_RADIUS + point.age * CONTRAIL_SPREAD_PER_SECOND) * this.look.girth;
      const gap = point.position.distanceTo(older.position);
      this.scale.set(Math.max(radius, gap * CONTRAIL_OVERLAP), radius * point.lump.x, radius * point.lump.y);
      // The tuft at the exhaust sits on the wire; the rest are teased off it as they loosen.
      const scatter = order === 0 ? 0 : radius;
      this.offset.copy(this.up).multiplyScalar(point.scatter.x * scatter).addScaledVector(this.side, point.scatter.y * scatter).add(point.position);
      this.matrix.compose(this.offset, this.orientation, this.scale);
      this.tufts.setMatrixAt(point.instance, this.matrix);
      // Condensation forms a short way behind the exhaust, so the newest tufts are only a few strands; old ones fray.
      const forming = 1 - THREE.MathUtils.smoothstep(point.age, 0.02, 0.4);
      const fraying = THREE.MathUtils.smoothstep(point.age, 2.5, CONTRAIL_LIFETIME_SECONDS);
      this.wisps.setX(point.instance, Math.max(forming * 0.8, fraying));
      this.writeWire(point, order === trail.length - 1 ? null : older);
    });
  }

  /** The wire from this tuft back to the next older one; the last tuft carries none. */
  private writeWire(point: TrailPoint, older: TrailPoint | null): void {
    if (!older) {
      this.wire.setMatrixAt(point.instance, Contrails.hidden);
      return;
    }
    this.offset.subVectors(older.position, point.position);
    const length = this.offset.length();
    this.orientation.setFromUnitVectors(WORLD_UP, this.offset.divideScalar(Math.max(length, 1e-6)));
    this.matrix.compose(point.position, this.orientation, this.scale.set(1, length, 1));
    this.wire.setMatrixAt(point.instance, this.matrix);
  }

  reset(): void {
    this.trails.forEach((trail, emitter) => {
      for (const point of trail) this.takeOff(emitter, point);
      trail.length = 0;
    });
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

// A burning engine, as a stop-motion fire is built: cotton tufts dyed orange with a grain-of-wheat bulb buried in each,
// so the wool glows from inside, pulled out aft of the cowl and darkening into black-dyed cotton smoke that runs into the
// smoke trail. Every exposure the animator re-teases the tufts, so the flames boil from frame to frame, and the bulbs
// flicker on a dimmer.

interface FireTuft {
  mesh: THREE.Mesh;
  /** Rest place aft of the engine, world units: along the airflow, then up. */
  along: number;
  rise: number;
  radius: number;
}

/** The tufts: flame cores lit brightest, outer flames dimmer, then black smoke, each aft of the last. */
const FIRE_TUFTS = [
  { kind: 'core', along: 0.0, rise: 0.0, radius: 0.06 }, { kind: 'core', along: 0.08, rise: 0.01, radius: 0.075 },
  { kind: 'flame', along: 0.17, rise: 0.02, radius: 0.085 }, { kind: 'flame', along: 0.27, rise: 0.035, radius: 0.09 },
  { kind: 'smoke', along: 0.38, rise: 0.05, radius: 0.1 }, { kind: 'smoke', along: 0.5, rise: 0.07, radius: 0.12 },
  { kind: 'smoke', along: 0.64, rise: 0.09, radius: 0.14 }, { kind: 'smoke', along: 0.8, rise: 0.11, radius: 0.16 },
] as const;
type FireKind = (typeof FIRE_TUFTS)[number]['kind'];

const FIRE_COLOURS: Record<FireKind, { wool: string; bulb: string | null; glow: number }> = {
  core: { wool: '#ffc061', bulb: '#ff9a35', glow: 3.2 },
  flame: { wool: '#d4581f', bulb: '#ff5c18', glow: 1.8 },
  smoke: { wool: '#141415', bulb: null, glow: 0 },
};
/** How far a tuft strays from its rest place and size each exposure, as a fraction of its radius, and how the bulbs flicker. */
const FIRE_BOIL = { place: 0.35, size: 0.25, flicker: 0.45 } as const;
/** The orange light the fire throws on the nacelle and wing. */
const FIRE_LIGHT = { colour: '#ff7a2a', radius: 1.3, intensity: 1.6 } as const;

export class EngineFire {
  readonly root = new THREE.Group();
  private readonly tufts: FireTuft[];
  private readonly materials: Record<FireKind, CottonMaterial>;
  private readonly light: VirtualLight;

  constructor() {
    this.materials = {
      // Packed tight round the bulbs, so the light never shows through gaps worn in the wool.
      core: cottonMaterial({ color: FIRE_COLOURS.core.wool, frequency: FIRE_COTTON.frequency, fuzz: FIRE_COTTON.fuzz, glowColor: FIRE_COLOURS.core.bulb ?? undefined, fray: FIRE_COTTON.fray }),
      flame: cottonMaterial({ color: FIRE_COLOURS.flame.wool, frequency: FIRE_COTTON.frequency, fuzz: FIRE_COTTON.fuzz, glowColor: FIRE_COLOURS.flame.bulb ?? undefined, fray: FIRE_COTTON.fray }),
      smoke: cottonMaterial({ color: FIRE_COLOURS.smoke.wool, frequency: FIRE_COTTON.frequency, fuzz: FIRE_COTTON.fuzz }),
    };
    this.tufts = FIRE_TUFTS.map((spec, index) => {
      const mesh = new THREE.Mesh(cottonTuftGeometry(31 + index * 7, { detail: 4, shellDetail: 2, shells: FIRE_COTTON.shells }), this.materials[spec.kind]);
      mesh.castShadow = false;
      this.root.add(mesh);
      return { mesh, along: spec.along, rise: spec.rise, radius: spec.radius };
    });
    this.light = addVirtualLight(new THREE.Vector3(), FIRE_LIGHT.colour, FIRE_LIGHT.radius, 0);
    this.root.visible = false;
  }

  /**
   * `fire` is how hard it burns (0 out); `source` where the flames leave the nacelle, in world space. Re-teases the
   * tufts and flickers the bulbs only on an exposure that moves the film (`exposureSec` > 0), so held frames hold.
   */
  update(exposureSec: number, fire: number, source: THREE.Vector3, random: () => number): void {
    const burning = fire > 0.02;
    const lighting = burning && !this.root.visible;
    this.root.visible = burning;
    if (!burning) {
      this.light.intensity = 0;
      return;
    }
    this.light.position.copy(source).add(new THREE.Vector3(-0.15, 0.02, 0));
    // A fire first shown on a held frame (a phase jumped to while paused) is still set up once.
    if (exposureSec <= 0 && !lighting) return;
    const boil = () => (random() - 0.5) * 2;
    for (const tuft of this.tufts) {
      const radius = tuft.radius * (0.35 + fire * 0.65);
      tuft.mesh.position.set(
        source.x - tuft.along * fire + boil() * radius * FIRE_BOIL.place,
        source.y + tuft.rise * fire + boil() * radius * FIRE_BOIL.place,
        source.z + boil() * radius * FIRE_BOIL.place,
      );
      tuft.mesh.scale.set(radius * (1.2 + boil() * FIRE_BOIL.size), radius * (1 + boil() * FIRE_BOIL.size), radius * (1 + boil() * FIRE_BOIL.size));
      tuft.mesh.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
    }
    for (const kind of ['core', 'flame'] as const) {
      this.materials[kind].glow.value = FIRE_COLOURS[kind].glow * fire * (1 + boil() * FIRE_BOIL.flicker);
    }
    this.light.intensity = FIRE_LIGHT.intensity * fire * (1 + boil() * FIRE_BOIL.flicker);
  }
}

// Puffs: a single breath of cotton set at a point and teased bigger and thinner over a second or two, then taken away.
// White for the CO2 cloud of an engine's fire extinguisher, black for the cough of an engine catching on start.

export type PuffKind = 'extinguisher' | 'cough';

const PUFF_LOOKS: Record<PuffKind, { colour: string; size: number; life: number; rise: number }> = {
  extinguisher: { colour: '#f2f4f6', size: 0.3, life: 2.8, rise: 0.04 },
  cough: { colour: '#1c1c1d', size: 0.3, life: 1.8, rise: 0.25 },
};
const PUFF_POOL = 8;
const PUFF_TUFTS = 4;

interface Puff {
  group: THREE.Group;
  tufts: THREE.Mesh[];
  offsets: THREE.Vector3[];
  material: CottonMaterial;
  kind: PuffKind;
  age: number;
  /** Whether it drifts aft with the air (in flight) or hangs where it was let off (on the ground). */
  drifts: boolean;
  active: boolean;
}

export class CottonPuffs {
  readonly root = new THREE.Group();
  private readonly puffs: Puff[];

  constructor() {
    const geometry = cottonTuftGeometry(53, { detail: 4, shellDetail: 2, shells: FIRE_COTTON.shells });
    this.puffs = Array.from({ length: PUFF_POOL }, () => {
      const group = new THREE.Group();
      group.visible = false;
      const material = cottonMaterial({ color: PUFF_LOOKS.extinguisher.colour, frequency: FIRE_COTTON.frequency, fuzz: FIRE_COTTON.fuzz });
      const tufts = Array.from({ length: PUFF_TUFTS }, () => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        group.add(mesh);
        return mesh;
      });
      this.root.add(group);
      return { group, tufts, offsets: tufts.map(() => new THREE.Vector3()), material, kind: 'extinguisher' as PuffKind, age: 0, drifts: true, active: false };
    });
  }

  /** Lets off a puff at a world position. */
  emit(kind: PuffKind, position: THREE.Vector3, drifts: boolean, random: () => number): void {
    const puff = this.puffs.find((candidate) => !candidate.active) ?? this.puffs.reduce((oldest, candidate) => (candidate.age > oldest.age ? candidate : oldest));
    puff.kind = kind;
    puff.material.color.set(PUFF_LOOKS[kind].colour);
    puff.age = 0;
    puff.drifts = drifts;
    puff.active = true;
    puff.group.visible = true;
    puff.group.position.copy(position);
    puff.offsets.forEach((offset, index) => {
      if (index === 0) offset.set(0, 0, 0);
      else offset.set(random() - 0.5, (random() - 0.5) * 0.7, random() - 0.5).multiplyScalar(1.4);
    });
    this.place(puff);
  }

  /** Grows, thins and drifts the puffs by an exposure's film time. */
  update(deltaSec: number, driftSpeed: number): void {
    if (deltaSec <= 0) return;
    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.age += deltaSec;
      const look = PUFF_LOOKS[puff.kind];
      if (puff.age > look.life) {
        puff.active = false;
        puff.group.visible = false;
        continue;
      }
      if (puff.drifts) puff.group.position.x -= driftSpeed * deltaSec;
      puff.group.position.y += look.rise * deltaSec;
      this.place(puff);
    }
  }

  reset(): void {
    for (const puff of this.puffs) {
      puff.active = false;
      puff.group.visible = false;
    }
  }

  private place(puff: Puff): void {
    const look = PUFF_LOOKS[puff.kind];
    // Bursts out fast, then keeps spreading slowly while it thins to strands.
    const growth = (1 - Math.exp(-puff.age * 7)) * (1 + puff.age * 0.25);
    const size = look.size * (0.25 + growth * 0.75);
    puff.tufts.forEach((tuft, index) => {
      tuft.position.copy(puff.offsets[index]).multiplyScalar(size);
      tuft.scale.setScalar(size * (index === 0 ? 1 : 0.75));
    });
    puff.material.wisp.value = THREE.MathUtils.smoothstep(puff.age, look.life * 0.4, look.life);
  }
}

/** Filaments per unit tuft, the halo's reach in tuft radii, and its shells. */
const FIRE_COTTON = { frequency: 9, fuzz: 0.28, shells: 3, fray: 0.3 } as const;

// Falling bombs, released in train from the bay; each rides down a clear acrylic rod stood on the set floor, the rig a
// stop-motion animator would hold a falling prop on.

const BOMB_GRAVITY = 3.2;
const BOMB_DRAG = 0.55;

interface FallingBomb { object: THREE.Object3D; rod: THREE.Mesh; velocity: THREE.Vector3; age: number }

const BOMB_ROD_RADIUS = 0.012;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class BombTrain {
  readonly root = new THREE.Group();
  private readonly pitchAxis = new THREE.Vector3();
  private readonly falling: FallingBomb[] = [];

  private readonly rodGeometry = new THREE.CylinderGeometry(BOMB_ROD_RADIUS, BOMB_ROD_RADIUS, 1, 10, 1).translate(0, 0.5, 0);
  private readonly rodMaterial = glassMaterial({ opacity: 0.32, roughness: 0.04, envMapIntensity: 1.4 });

  constructor(private readonly createBomb: () => THREE.Object3D, private readonly floorClearance: number) {}

  /** The rod runs straight up from the set floor to the bomb's middle. */
  private standRod(bomb: FallingBomb): void {
    bomb.rod.position.set(bomb.object.position.x, 0, bomb.object.position.z);
    bomb.rod.scale.set(1, Math.max(bomb.object.position.y, 0.001), 1);
  }

  release(worldPosition: THREE.Vector3, worldQuaternion: THREE.Quaternion, scale: number): void {
    const object = this.createBomb();
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
    object.scale.setScalar(scale);
    const rod = new THREE.Mesh(this.rodGeometry, this.rodMaterial);
    this.root.add(object, rod);
    this.falling.push({ object, rod, velocity: new THREE.Vector3(0, -0.15, 0), age: 0 });
    this.standRod(this.falling[this.falling.length - 1]);
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
      this.standRod(bomb);
      if (bomb.object.position.y < this.floorClearance) {
        this.root.remove(bomb.object, bomb.rod);
        this.falling.splice(index, 1);
      }
    }
  }

  reset(): void {
    for (const bomb of this.falling) this.root.remove(bomb.object, bomb.rod);
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
