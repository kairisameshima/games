import RAPIER from "@dimforge/rapier3d-compat";

// World units: a coin is 1 wide. The board's open front edge is +z; the drop slot is at the back (-z).
export const BOARD_HALF_WIDTH = 4;
export const FRONT_EDGE_Z = 3;
export const FLOOR_BACK_Z = -9;
const FLOOR_THICKNESS = 0.5;

/** Side walls stop short of the front edge; coins pushed off the sides past them fall into the gutters. */
export const SIDE_WALL_HEIGHT = 3;
export const SIDE_WALL_THICKNESS = 0.2;

export const PUSHER_HALF_DEPTH = 2.5;
export const PUSHER_HEIGHT = 0.7;
/** The pusher's front face sweeps between these, so its back always stays hidden under the back wall. */
const PUSHER_FRONT_RETRACTED_Z = -4.5;
const PUSHER_FRONT_EXTENDED_Z = -2;
const PUSHER_PERIOD_SECONDS = 4;

/** The back wall hangs just above the pusher, so coins riding the pusher get scraped off as it retracts. */
export const BACK_WALL_Z = -5.2;
export const BACK_WALL_BOTTOM_Y = PUSHER_HEIGHT + 0.05;
export const BACK_WALL_TOP_Y = 4;
const BACK_WALL_THICKNESS = 0.2;

export const COIN_RADIUS = 0.5;
export const COIN_THICKNESS = 0.14;
const COIN_BORDER_RADIUS = 0.02;
const COIN_FRICTION = 0.5;
const COIN_RESTITUTION = 0.05;
const COIN_LINEAR_DAMPING = 0.1;
const COIN_ANGULAR_DAMPING = 0.5;

export const DROP_Y = 3.2;
export const DROP_Z = -4.6;
export const DROP_HALF_RANGE = BOARD_HALF_WIDTH - COIN_RADIUS - 0.1;
/** Random sideways offset per drop, so coins held at one spot spread out instead of stacking into a tower. */
const DROP_JITTER = 0.25;

/** A ring that sweeps across the drop slot below the drop point. A dropped coin falling through it earns a slot spin. */
export const GATE_Y = 2.5;
export const GATE_SWING = DROP_HALF_RANGE * 0.9;
const GATE_PERIOD_SECONDS = 3;

/** Slot payouts rain down over the pusher and the back of the floor. */
const SHOWER_Y = 3.6;
const SHOWER_HALF_WIDTH = BOARD_HALF_WIDTH - COIN_RADIUS - 0.2;
const SHOWER_BACK_Z = -4.6;
const SHOWER_FRONT_Z = -2.5;

/** A bomb coin goes off this long after it is tossed, once it has landed in the pile. */
const BOMB_FUSE_SECONDS = 1.2;
const BOMB_TOSS_Y = 2.5;
/** Bombs land in front of the back wall, never behind it. */
const BOMB_TOSS_BACK_Z = BACK_WALL_Z + COIN_RADIUS + 0.2;
export const BOMB_RADIUS = 2.6;
/** A coin weighs about 0.11, so this launches the nearest coins at roughly 4 units per second. */
const BOMB_IMPULSE = 0.45;
/** Share of each bomb push aimed forward (toward the payout edge) rather than straight out. */
const BOMB_FORWARD_BIAS = 0.6;
const BOMB_LIFT = 0.35;

/** Coins below this height have left the board and are scored. */
const FALLEN_Y = -3;
/** A fallen coin counts as won when it left over the front edge, allowing for its tumble. */
const WON_ZONE_Z = FRONT_EDGE_Z - COIN_RADIUS;

const STARTING_COIN_ROWS = 7;
const STARTING_COIN_COLUMNS = 7;
const STARTING_COIN_LAYERS = 2;
const STARTING_COIN_SPACING = 1.05;
const STARTING_FILL_FRONT_Z = 2.4;
const SETTLE_SECONDS = 4;

export const PHYSICS_STEP_SECONDS = 1 / 60;
const SOLVER_ITERATIONS = 8;

export type CoinKind = "normal" | "bomb";

export interface Explosion {
  x: number;
  y: number;
  z: number;
}

export interface StepResult {
  won: number;
  lost: number;
  /** Dropped coins that fell through the gate this step. */
  gateHits: number;
  explosions: Explosion[];
}

/** Things upgrades change about the cabinet. */
export interface MachineSettings {
  /** Where the side walls end, toward the front edge. Past this, coins can slide into the gutters. */
  sideWallEndZ: number;
  /** How far a coin's center may be from the gate's center and still count as through. */
  gateTolerance: number;
}

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

export function pusherFrontZ(timeSeconds: number): number {
  const swing = (1 - Math.cos((2 * Math.PI * timeSeconds) / PUSHER_PERIOD_SECONDS)) / 2;
  return PUSHER_FRONT_RETRACTED_Z + swing * (PUSHER_FRONT_EXTENDED_Z - PUSHER_FRONT_RETRACTED_Z);
}

export class PusherMachine {
  readonly world: RAPIER.World;
  readonly coins: RAPIER.RigidBody[] = [];
  private readonly coinKinds = new Map<number, CoinKind>();
  private readonly pusher: RAPIER.RigidBody;
  private sideWalls: RAPIER.RigidBody[] = [];
  private settings: MachineSettings;
  private elapsedSeconds = 0;
  /** Dropped coins still above the gate. */
  private readonly gateCandidates: RAPIER.RigidBody[] = [];
  private readonly bombFuses = new Map<RAPIER.RigidBody, number>();

  /** Call initPhysics() first. The board starts full of settled coins, like a real machine. */
  constructor(settings: MachineSettings, random: () => number) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_STEP_SECONDS;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this.settings = settings;
    this.buildCabinet();
    this.pusher = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PUSHER_HEIGHT / 2, this.pusherCenterZ()),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BOARD_HALF_WIDTH - 0.05, PUSHER_HEIGHT / 2, PUSHER_HALF_DEPTH),
      this.pusher,
    );
    this.fillBoard(random);
    for (let elapsed = 0; elapsed < SETTLE_SECONDS; elapsed += PHYSICS_STEP_SECONDS) this.step();
  }

  get pusherZ(): number {
    return this.pusher.translation().z;
  }

  get gateX(): number {
    return Math.sin((2 * Math.PI * this.elapsedSeconds) / GATE_PERIOD_SECONDS) * GATE_SWING;
  }

  get sideWallEndZ(): number {
    return this.settings.sideWallEndZ;
  }

  get gateTolerance(): number {
    return this.settings.gateTolerance;
  }

  coinKind(coin: RAPIER.RigidBody): CoinKind {
    return this.coinKinds.get(coin.handle) ?? "normal";
  }

  applySettings(settings: MachineSettings): void {
    const wallsMoved = settings.sideWallEndZ !== this.settings.sideWallEndZ;
    this.settings = settings;
    if (wallsMoved) this.buildSideWalls();
  }

  private pusherCenterZ(): number {
    return pusherFrontZ(this.elapsedSeconds) - PUSHER_HALF_DEPTH;
  }

  private addFixedBox(halfExtents: [number, number, number], center: [number, number, number]): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...center));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(...halfExtents), body);
    return body;
  }

  private buildCabinet(): void {
    const floorHalfDepth = (FRONT_EDGE_Z - FLOOR_BACK_Z) / 2;
    this.addFixedBox([BOARD_HALF_WIDTH, FLOOR_THICKNESS / 2, floorHalfDepth], [0, -FLOOR_THICKNESS / 2, FLOOR_BACK_Z + floorHalfDepth]);
    const backWallHalfHeight = (BACK_WALL_TOP_Y - BACK_WALL_BOTTOM_Y) / 2;
    this.addFixedBox(
      [BOARD_HALF_WIDTH, backWallHalfHeight, BACK_WALL_THICKNESS / 2],
      [0, BACK_WALL_BOTTOM_Y + backWallHalfHeight, BACK_WALL_Z],
    );
    this.buildSideWalls();
  }

  private buildSideWalls(): void {
    for (const wall of this.sideWalls) this.world.removeRigidBody(wall);
    const wallHalfDepth = (this.settings.sideWallEndZ - FLOOR_BACK_Z) / 2;
    this.sideWalls = [-1, 1].map((side) =>
      this.addFixedBox(
        [SIDE_WALL_THICKNESS / 2, SIDE_WALL_HEIGHT / 2, wallHalfDepth],
        [side * (BOARD_HALF_WIDTH + SIDE_WALL_THICKNESS / 2), SIDE_WALL_HEIGHT / 2, FLOOR_BACK_Z + wallHalfDepth],
      ),
    );
  }

  private addCoin(x: number, y: number, z: number, tilt: number, ccd: boolean): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) })
        .setLinearDamping(COIN_LINEAR_DAMPING)
        .setAngularDamping(COIN_ANGULAR_DAMPING)
        .setCcdEnabled(ccd),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.roundCylinder(
        COIN_THICKNESS / 2 - COIN_BORDER_RADIUS,
        COIN_RADIUS - COIN_BORDER_RADIUS,
        COIN_BORDER_RADIUS,
      )
        .setFriction(COIN_FRICTION)
        .setRestitution(COIN_RESTITUTION),
      body,
    );
    this.coins.push(body);
    return body;
  }

  private removeCoin(index: number): void {
    const coin = this.coins[index];
    this.coinKinds.delete(coin.handle);
    this.bombFuses.delete(coin);
    this.world.removeRigidBody(coin);
    this.coins.splice(index, 1);
  }

  private fillBoard(random: () => number): void {
    for (let layer = 0; layer < STARTING_COIN_LAYERS; layer++) {
      for (let row = 0; row < STARTING_COIN_ROWS; row++) {
        for (let column = 0; column < STARTING_COIN_COLUMNS; column++) {
          const x = (column - (STARTING_COIN_COLUMNS - 1) / 2) * STARTING_COIN_SPACING + (random() - 0.5) * 0.4;
          const z = STARTING_FILL_FRONT_Z - row * STARTING_COIN_SPACING + (random() - 0.5) * 0.4;
          // Coins behind the pusher's front face start on top of it.
          const floorY = z < pusherFrontZ(0) ? PUSHER_HEIGHT : 0;
          this.addCoin(x, floorY + 0.2 + layer * 0.3, z, (random() - 0.5) * 0.3, false);
        }
      }
    }
  }

  /** Drops a coin into the slot. `slotX` runs from -1 (left) to 1 (right). */
  dropCoin(slotX: number, random: () => number): void {
    const jittered = Math.max(-1, Math.min(1, slotX)) * DROP_HALF_RANGE + (random() - 0.5) * 2 * DROP_JITTER;
    const x = Math.max(-DROP_HALF_RANGE, Math.min(DROP_HALF_RANGE, jittered));
    this.gateCandidates.push(this.addCoin(x, DROP_Y, DROP_Z, (random() - 0.5) * 0.6, true));
  }

  /** The raccoon tosses a bomb coin onto the pile at a board position; it goes off after its fuse. */
  tossBomb(x: number, z: number): void {
    const clampedX = Math.max(-DROP_HALF_RANGE, Math.min(DROP_HALF_RANGE, x));
    const clampedZ = Math.max(BOMB_TOSS_BACK_Z, Math.min(FRONT_EDGE_Z - COIN_RADIUS, z));
    const bomb = this.addCoin(clampedX, BOMB_TOSS_Y, clampedZ, 0, true);
    this.coinKinds.set(bomb.handle, "bomb");
    this.bombFuses.set(bomb, BOMB_FUSE_SECONDS);
  }

  /** Drops one payout coin at a random spot over the back of the board. */
  dropShowerCoin(random: () => number): void {
    const x = (random() * 2 - 1) * SHOWER_HALF_WIDTH;
    const z = SHOWER_BACK_Z + random() * (SHOWER_FRONT_Z - SHOWER_BACK_Z);
    this.addCoin(x, SHOWER_Y, z, (random() - 0.5) * 1.2, true);
  }

  private countGateHits(): number {
    let hits = 0;
    const gateX = this.gateX;
    for (let index = this.gateCandidates.length - 1; index >= 0; index--) {
      const position = this.gateCandidates[index].translation();
      if (position.y > GATE_Y) continue;
      if (Math.abs(position.x - gateX) <= this.settings.gateTolerance) hits += 1;
      this.gateCandidates.splice(index, 1);
    }
    return hits;
  }

  /** Pushes every coin near the bomb outward and toward the payout edge, then removes the bomb. */
  private explode(bomb: RAPIER.RigidBody): Explosion {
    const center = bomb.translation();
    for (const coin of this.coins) {
      if (coin === bomb) continue;
      const position = coin.translation();
      const dx = position.x - center.x;
      const dz = position.z - center.z;
      const distance = Math.hypot(dx, dz);
      if (distance > BOMB_RADIUS) continue;
      const strength = BOMB_IMPULSE * (1 - distance / BOMB_RADIUS);
      const outwardX = distance > 0 ? dx / distance : 0;
      const outwardZ = distance > 0 ? dz / distance : 1;
      coin.applyImpulse(
        {
          x: strength * outwardX * (1 - BOMB_FORWARD_BIAS),
          y: strength * BOMB_LIFT,
          z: strength * (outwardZ * (1 - BOMB_FORWARD_BIAS) + BOMB_FORWARD_BIAS),
        },
        true,
      );
    }
    this.removeCoin(this.coins.indexOf(bomb));
    return { x: center.x, y: center.y, z: center.z };
  }

  private burnFuses(): Explosion[] {
    const explosions: Explosion[] = [];
    for (const [bomb, secondsLeft] of this.bombFuses) {
      if (secondsLeft > PHYSICS_STEP_SECONDS) {
        this.bombFuses.set(bomb, secondsLeft - PHYSICS_STEP_SECONDS);
        continue;
      }
      explosions.push(this.explode(bomb));
    }
    return explosions;
  }

  /** Advances one physics step and removes coins that left the board. */
  step(): StepResult {
    this.elapsedSeconds += PHYSICS_STEP_SECONDS;
    this.pusher.setNextKinematicTranslation({ x: 0, y: PUSHER_HEIGHT / 2, z: this.pusherCenterZ() });
    this.world.step();

    const result: StepResult = { won: 0, lost: 0, gateHits: this.countGateHits(), explosions: this.burnFuses() };
    for (let index = this.coins.length - 1; index >= 0; index--) {
      const coin = this.coins[index];
      const position = coin.translation();
      if (position.y > FALLEN_Y) continue;
      if (position.z > WON_ZONE_Z && Math.abs(position.x) < BOARD_HALF_WIDTH + COIN_RADIUS) result.won += 1;
      else result.lost += 1;
      this.removeCoin(index);
    }
    return result;
  }
}
