import * as THREE from 'three';
import { hullHalfWidthAtHeight, toX } from './hull';
import { BELT_PITCH } from './interior/ammunition';
import { M2_BARREL_RECOIL, M2_BOLT_TRAVEL, M2_EJECTION_PORT, M2_MUZZLE, M2_ROUNDS_PER_SECOND, type M2Gun } from './m2';

/** A gun as the gunnery drives it: the gun, its exposed belt, and where its empty cases go. */
export interface MountedGun {
  gun: M2Gun;
  belt: THREE.Group | null;
  /**
   * Ship-space height of the floor its cases fall onto (waist, nose, radio room, flight deck), or null where the cases
   * and links leave through chutes into the slipstream (ball, chin and tail guns).
   */
  caseFloorY: number | null;
}

/** Every fifth round in the belt is a tracer (see the belt order in `interior/ammunition.ts`). */
const TRACER_EVERY = 5;
/** Spent cases stay this long, on a floor or in the air, then go. */
const CASE_LIFETIME = 30;
const GRAVITY = 9.81;
const MAX_INSIDE_CASES = 2400;
const MAX_OVERBOARD_CASES = 6000;
const MAX_TRACERS = 400;
/**
 * Tracers are slowed for display. At the real 2,900 ft/s a round crosses the whole set in under a frame, so the eye
 * would never see the streak; at this speed a burst reads as the bright dashes air gunners described.
 */
const TRACER_SPEED_WORLD = 42;
const TRACER_LENGTH_WORLD = 1.3;
const TRACER_LIFETIME = 1.1;
/** Gunners fired in short bursts: 1/2 to 2 s of fire in a window, the window passing to the next with a gap. */
const BURST_WINDOW = 2.4;
const CASE_EJECT_SPEED = 2.2;
const FLASH_SECONDS = 0.025;
const FLASH_LIGHT_INTENSITY = 0.25;

interface GunState {
  mounted: MountedGun;
  seed: number;
  burstWindow: number;
  lastShot: number;
  barrelRest: THREE.Vector3 | null;
  boltRest: THREE.Vector3 | null;
  beltRest: THREE.Vector3 | null;
  flashTimer: number;
}

/** `space`: for a case inside the aircraft, the assembly whose (model-space) frame its position is in. */
interface Case { position: THREE.Vector3; velocity: THREE.Vector3; spinAxis: THREE.Vector3; spin: number; orientation: THREE.Quaternion; age: number; resting: boolean; floorY: number; space: THREE.Object3D | null }
interface Tracer { position: THREE.Vector3; direction: THREE.Vector3; age: number }

interface ShipGuns {
  root: THREE.Object3D;
  guns: GunState[];
  insideCases: Case[];
  insideMesh: THREE.InstancedMesh;
  light: THREE.PointLight;
}

/** The exploded-view assembly an object is carried in. */
function assemblyOf(object: THREE.Object3D): THREE.Object3D {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.userData.isAssembly) return node;
  throw new Error('Gun is not in an assembly');
}

/** Deterministic hash → [0, 1) for a gun and a burst window, so a phase replays the same way. */
function hash(seed: number, window: number, channel: number): number {
  let state = (seed * 374761393 + window * 668265263 + channel * 2147483647) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 1274126177);
  state ^= state >>> 16;
  return (state >>> 0) / 4294967296;
}

function caseGeometry(): THREE.BufferGeometry {
  // .50 BMG case: 99 mm long, 20.4 mm head, necked to 14.4 mm; axis along y, head at the origin.
  const profile = [[0, 0], [10.2, 0], [10.2, 4], [9.2, 77], [7.2, 83.5], [7.2, 99], [6.2, 99]].map(([radius, along]) => new THREE.Vector2(radius / 1000, along / 1000));
  return new THREE.LatheGeometry(profile, 8).translate(0, -0.05, 0);
}

const brassMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: '#c09a55', metalness: 1, roughness: 0.32 });

/**
 * Defensive fire for the formation: every M2 fires short bursts while `gunfire` is up. Each shot cycles the gun (barrel
 * recoil, bolt stud running back in its slot, belt stepping one link), shows the muzzle flash, sends a tracer every
 * fifth round, and drops a spent case: onto the floor inside, or overboard to fall to the studio floor.
 */
export class Gunnery {
  readonly root = new THREE.Group();
  private readonly ships: ShipGuns[] = [];
  private readonly overboard: Case[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly overboardMesh: THREE.InstancedMesh;
  private readonly tracerMesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly scaleVector = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly scratch = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();

  constructor(private readonly modelScale: number) {
    this.overboardMesh = new THREE.InstancedMesh(caseGeometry(), brassMaterial(), MAX_OVERBOARD_CASES);
    this.overboardMesh.count = 0;
    this.overboardMesh.frustumCulled = false;
    this.overboardMesh.castShadow = true;
    const tracerMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.2, 1.1, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    });
    // Unit streak along +y, head at the origin and tail below it.
    const streak = new THREE.CylinderGeometry(0.012, 0.004, 1, 6, 1).translate(0, -0.5, 0);
    this.tracerMesh = new THREE.InstancedMesh(streak, tracerMaterial, MAX_TRACERS);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.userData.skipAmbientOcclusion = true;
    this.root.add(this.overboardMesh, this.tracerMesh);
  }

  /** Registers one aircraft's guns. Its inside cases and flash light live in its own space, so they move with it. */
  addShip(aircraftRoot: THREE.Object3D, guns: MountedGun[]): void {
    const shipIndex = this.ships.length;
    const insideMesh = new THREE.InstancedMesh(caseGeometry(), brassMaterial(), MAX_INSIDE_CASES);
    insideMesh.count = 0;
    insideMesh.frustumCulled = false;
    insideMesh.castShadow = true;
    insideMesh.receiveShadow = true;
    aircraftRoot.add(insideMesh);
    // Reach of the flash's light in world units: about 2 m on the model.
    const light = new THREE.PointLight('#ffb766', 0, 0.6, 2);
    aircraftRoot.add(light);
    this.ships.push({
      root: aircraftRoot,
      guns: guns.map((mounted, index) => ({ mounted, seed: shipIndex * 97 + index * 13 + 7, burstWindow: -1, lastShot: -1, barrelRest: null, boltRest: null, beltRest: null, flashTimer: 0 })),
      insideCases: [],
      insideMesh,
      light,
    });
  }

  /** Advance one ship's guns to its mission time `time`; `gunfire` 0..1 is how hard the box is fighting. */
  updateShip(shipIndex: number, time: number, gunfire: number, deltaSec: number): void {
    const ship = this.ships[shipIndex];
    // Parents too: the formation holder was just posed for this frame.
    ship.root.updateWorldMatrix(true, true);
    let flashes = 0;
    const flashCentre = this.scratch.set(0, 0, 0);
    for (const state of ship.guns) {
      const cycle = this.stepGun(ship, state, time, gunfire, deltaSec);
      this.poseGun(state, cycle);
      if (state.flashTimer > 0) {
        flashes++;
        flashCentre.add(ship.root.worldToLocal(state.mounted.gun.flash.getWorldPosition(new THREE.Vector3())));
      }
    }
    ship.light.intensity = flashes > 0 ? FLASH_LIGHT_INTENSITY * Math.min(flashes, 3) : 0;
    if (flashes > 0) ship.light.position.copy(flashCentre.divideScalar(flashes));
    this.stepInsideCases(ship, deltaSec);
  }

  /** Fires due rounds; returns the gun's cycle position 0..1 within the current shot, or null when it is not firing. */
  private stepGun(ship: ShipGuns, state: GunState, time: number, gunfire: number, deltaSec: number): number | null {
    state.flashTimer = Math.max(0, state.flashTimer - deltaSec);
    const window = Math.floor(time / BURST_WINDOW);
    const fires = hash(state.seed, window, 0) < 0.65 * gunfire;
    const start = window * BURST_WINDOW + hash(state.seed, window, 1) * 0.9;
    const end = start + 0.5 + hash(state.seed, window, 2) * 1.2;
    if (!fires || time < start || time >= end) return null;
    const rounds = (time - start) * M2_ROUNDS_PER_SECOND;
    const shot = Math.floor(rounds);
    if (window !== state.burstWindow) {
      state.burstWindow = window;
      state.lastShot = -1;
    }
    // A frame can span several rounds; a paused or rewound clock fires none.
    const first = Math.max(state.lastShot + 1, shot - 2);
    for (let index = first; index <= shot; index++) this.fire(ship, state, index, time - start - index / M2_ROUNDS_PER_SECOND);
    state.lastShot = Math.max(state.lastShot, shot);
    return rounds - shot;
  }

  /**
   * The barrel stands in for the gun's frame: the gun's own group is folded into the airframe merge for hand-held guns,
   * but the barrel is kept live, and it shares gun space (it only slides 29 mm along x).
   */
  private fire(ship: ShipGuns, state: GunState, shotIndex: number, age: number): void {
    const { gun } = state.mounted;
    state.flashTimer = FLASH_SECONDS;
    gun.flash.rotation.x = hash(state.seed, shotIndex, 3) * Math.PI;
    gun.flash.scale.setScalar(0.75 + hash(state.seed, shotIndex, 4) * 0.6);
    gun.barrel.updateMatrixWorld(true);
    if ((shotIndex + state.seed) % TRACER_EVERY === 0) this.spawnTracer(gun, state.seed + shotIndex, age);
    this.ejectCase(ship, state, shotIndex);
  }

  private spawnTracer(gun: M2Gun, seed: number, age: number): void {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    const position = M2_MUZZLE.clone().applyMatrix4(gun.barrel.matrixWorld);
    const direction = new THREE.Vector3(1, 0, 0).transformDirection(gun.barrel.matrixWorld);
    // A few mils of dispersion.
    direction.x += (hash(seed, 1, 5) - 0.5) * 0.008;
    direction.y += (hash(seed, 1, 6) - 0.5) * 0.008;
    direction.z += (hash(seed, 1, 7) - 0.5) * 0.008;
    this.tracers.push({ position, direction: direction.normalize(), age: Math.max(age, 0) });
  }

  private ejectCase(ship: ShipGuns, state: GunState, shotIndex: number): void {
    const { gun, caseFloorY } = state.mounted;
    const port = M2_EJECTION_PORT.clone().applyMatrix4(gun.barrel.matrixWorld);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(gun.barrel.matrixWorld);
    const across = new THREE.Vector3(0, 0, 1).transformDirection(gun.barrel.matrixWorld);
    const jitter = (channel: number) => hash(state.seed, shotIndex, channel) - 0.5;
    const spinAxis = new THREE.Vector3(jitter(8), jitter(9), jitter(10)).normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(this.up, new THREE.Vector3(0, 0, 1).transformDirection(gun.barrel.matrixWorld));
    if (caseFloorY === null) {
      const velocity = down.multiplyScalar(CASE_EJECT_SPEED * this.modelScale).addScaledVector(across, jitter(11) * 0.4 * this.modelScale);
      this.pushCase(this.overboard, MAX_OVERBOARD_CASES, { position: port, velocity, spinAxis, spin: 18 + jitter(12) * 10, orientation, age: 0, resting: false, floorY: 0, space: null });
      return;
    }
    // Inside: in the frame of the gun's assembly, which is model space moved by the exploded view, so the floors are
    // where `caseFloorY` says and a case stays with its compartment. The ship's own small motions are ignored.
    const space = assemblyOf(gun.barrel);
    const inverse = space.matrixWorld.clone().invert();
    const shipQuaternion = ship.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const velocity = down.applyQuaternion(shipQuaternion).multiplyScalar(CASE_EJECT_SPEED).addScaledVector(across.applyQuaternion(shipQuaternion), jitter(11) * 0.6);
    this.pushCase(ship.insideCases, MAX_INSIDE_CASES, {
      position: port.applyMatrix4(inverse), velocity, spinAxis, spin: 18 + jitter(12) * 10,
      orientation: orientation.premultiply(shipQuaternion), age: 0, resting: false, floorY: caseFloorY, space,
    });
  }

  private pushCase(cases: Case[], capacity: number, spent: Case): void {
    if (cases.length >= capacity) cases.shift();
    cases.push(spent);
  }

  /** Recoil, bolt and belt for a cycle position; the rest pose when not firing. */
  private poseGun(state: GunState, cycle: number | null): void {
    const { gun, belt } = state.mounted;
    state.barrelRest ??= gun.barrel.position.clone();
    state.boltRest ??= gun.bolt.position.clone();
    if (belt) state.beltRest ??= belt.position.clone();
    gun.flash.visible = state.flashTimer > 0;
    const phase = cycle ?? 0;
    const firing = cycle !== null;
    // Barrel slams back at the shot and runs out again; the bolt runs back and returns; the belt steps in on the return.
    const recoil = firing ? (phase < 0.12 ? phase / 0.12 : Math.max(0, 1 - (phase - 0.12) / 0.5)) : 0;
    const bolt = firing ? Math.sin(Math.PI * Math.min(phase / 0.85, 1)) : 0;
    const step = firing ? THREE.MathUtils.smoothstep(phase, 0.35, 0.8) : 0;
    this.slide(gun.barrel, state.barrelRest, 0, -M2_BARREL_RECOIL * recoil);
    this.slide(gun.bolt, state.boltRest, 0, -M2_BOLT_TRAVEL * bolt);
    if (belt && state.beltRest) this.slide(belt, state.beltRest, 2, BELT_PITCH * step);
  }

  /** Moves `object` from `rest` along its own local axis (0 x, 2 z) by `distance`. */
  private slide(object: THREE.Object3D, rest: THREE.Vector3, axis: 0 | 2, distance: number): void {
    const direction = axis === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    object.position.copy(rest).addScaledVector(direction.applyQuaternion(object.quaternion), distance);
  }

  private stepInsideCases(ship: ShipGuns, deltaSec: number): void {
    const cases = ship.insideCases;
    for (let index = cases.length - 1; index >= 0; index--) {
      const spent = cases[index];
      spent.age += deltaSec;
      if (spent.age > CASE_LIFETIME) {
        cases.splice(index, 1);
        continue;
      }
      this.integrate(spent, deltaSec, GRAVITY, 0);
    }
    this.writeInstances(ship.insideMesh, cases, 1);
  }

  private integrate(spent: Case, deltaSec: number, gravity: number, airDrift: number): void {
    if (spent.resting || deltaSec === 0) return;
    spent.velocity.y -= gravity * deltaSec;
    // Out in the slipstream a case is swept aft at once.
    if (airDrift > 0) spent.velocity.x += (-airDrift - spent.velocity.x) * Math.min(1, 2.5 * deltaSec);
    spent.position.addScaledVector(spent.velocity, deltaSec);
    spent.orientation.premultiply(this.scratchQuaternion.setFromAxisAngle(spent.spinAxis, spent.spin * deltaSec));
    const radius = 0.0102 * (airDrift > 0 ? this.modelScale : 1);
    if (spent.position.y > spent.floorY + radius) return;
    spent.position.y = spent.floorY + radius;
    // Inside, the floor ends where the skin curves up: a case landing beyond it rolls back against the wall.
    if (airDrift === 0) {
      const halfWidth = hullHalfWidthAtHeight(toX(spent.position.x), spent.floorY + 0.02) - 0.02;
      spent.position.z = THREE.MathUtils.clamp(spent.position.z, -halfWidth, halfWidth);
    }
    if (Math.abs(spent.velocity.y) > 0.6 * Math.sqrt(gravity)) {
      // Bounce off the floor, losing most of the energy.
      spent.velocity.y *= -0.3;
      spent.velocity.x *= 0.5;
      spent.velocity.z *= 0.5;
      spent.spin *= 0.5;
      return;
    }
    // Come to rest lying on its side, at whatever heading it landed.
    spent.resting = true;
    const heading = Math.atan2(spent.spinAxis.x, spent.spinAxis.z);
    spent.orientation.setFromEuler(new THREE.Euler(Math.PI / 2, heading, 0, 'YXZ'));
  }

  private writeInstances(mesh: THREE.InstancedMesh, cases: Case[], scale: number): void {
    this.scaleVector.setScalar(scale);
    cases.forEach((spent, index) => {
      // An assembly sits directly under the aircraft root, so its position is its whole offset in the root's frame.
      const position = spent.space ? this.scratch.addVectors(spent.position, spent.space.position) : spent.position;
      mesh.setMatrixAt(index, this.matrix.compose(position, spent.orientation, this.scaleVector));
    });
    mesh.count = cases.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** World-space effects: tracers and cases falling from the turrets' chutes to the studio floor. */
  update(deltaSec: number, airDrift: number): void {
    for (let index = this.overboard.length - 1; index >= 0; index--) {
      const spent = this.overboard[index];
      spent.age += deltaSec;
      if (spent.age > CASE_LIFETIME) {
        this.overboard.splice(index, 1);
        continue;
      }
      this.integrate(spent, deltaSec, GRAVITY * this.modelScale, airDrift);
    }
    this.writeInstances(this.overboardMesh, this.overboard, this.modelScale);

    for (let index = this.tracers.length - 1; index >= 0; index--) {
      const tracer = this.tracers[index];
      tracer.age += deltaSec;
      if (tracer.age > TRACER_LIFETIME) this.tracers.splice(index, 1);
    }
    this.tracers.forEach((tracer, index) => {
      const travelled = tracer.age * TRACER_SPEED_WORLD;
      const head = this.scratch.copy(tracer.position).addScaledVector(tracer.direction, travelled);
      this.scratchQuaternion.setFromUnitVectors(this.up, tracer.direction);
      this.scaleVector.set(1, Math.min(TRACER_LENGTH_WORLD, travelled), 1);
      this.tracerMesh.setMatrixAt(index, this.matrix.compose(head, this.scratchQuaternion, this.scaleVector));
    });
    this.tracerMesh.count = this.tracers.length;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
  }

  /** Clears tracers when the mission clock jumps; spent cases stay until their 30 s are up. */
  resetTracers(): void {
    this.tracers.length = 0;
    for (const ship of this.ships) for (const state of ship.guns) {
      state.burstWindow = -1;
      state.lastShot = -1;
    }
  }
}
