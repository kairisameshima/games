import * as THREE from 'three';
import { matteMaterial } from '../render/studio';
import type { B17 } from './b17';
import { figureMesh, type CrewMember, type Outfit } from './crew/figure';
import { meshFigureInWorker } from './crew/figure-pool';
import type { HandTarget, Pose, Side } from './crew/skeleton';
import { FACING, plantedFoot, pose } from './interior/poses';

/**
 * The prologue on the hardstand: the lead stands on its wheels on a painted card on the studio floor while four of the
 * crew walk out to it, the officers up through the forward entrance hatch under the nose and the gunners in by the
 * main door aft; then the engines start and the animator runs it along the card, lifts it off and flies it round onto
 * its display stand, the undercarriage folding away as it climbs. Every man is a set of replacement figures, one per
 * pose, swapped exposure by exposure.
 */

/** Film seconds of the prologue's beats. */
const BEATS = { boardingEnds: 8.5, enginesStart: 9, rollStart: 10.5, liftOff: 13.5, docked: 20.5 } as const;
export const PROLOGUE_LIFT_OFF_SECONDS = BEATS.liftOff;
export const PROLOGUE_ENGINES_START_SECONDS = BEATS.enginesStart;

/** Where the hardstand's centre is on the studio floor, world units, clear of the cloud deck and the lamp. */
const HARDSTAND_ORIGIN = new THREE.Vector3(-12, 0, 11);
/** The painted card: concrete pan radius and the taxiway's length and width out of it, model metres. */
const HARDSTAND_CARD = { radius: 14, taxiLength: 24, taxiWidth: 9 } as const;

/**
 * The take-off run and climb in world units from the run's start: along the taxiway, off, and a climbing turn to port
 * that brings it in over its stand; the path ends on the lead's slot, arriving level and heading forward.
 */
const FLIGHT_PATH = [
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 0, 0), new THREE.Vector3(9, 0.25, -0.4),
  new THREE.Vector3(11.4, 1.7, -3.2), new THREE.Vector3(11.2, 3.0, -7.0), new THREE.Vector3(10.6, 3.6, -9.9),
];
/** Climb attitude; bank per radian of turn per world unit flown, and the most it banks. */
const CLIMB_PITCH = 0.12;
const BANK_PER_TURN_RATE = 2.2;
const MAX_BANK = 0.5;
/** How far ahead along the path the turn rate is measured, as a fraction of the path. */
const TURN_SAMPLE = 0.02;
/** Over the end of the run in, yaw and bank settle to the slot's level pose. */
const SETTLE_FROM = 0.86;

/** A walking man changes pose every this many film seconds, a stride each. */
const STRIDE_SECONDS = 0.42;
const STRIDE_LENGTH = 0.62;
/** He holds the climbing-in pose this long, then is gone inside. */
const ENTRY_SECONDS = 1.0;

const GROUND_OUTFIT: Outfit = {
  upper: 'a2', lower: 'wool', flakVest: false, flakApron: false, flakHelmet: false, lifeVest: false, harness: true, goggles: 'up', oxygenMask: false,
};

interface Boarder {
  role: string;
  faceSeed: number;
  /** Where he sets off from, in the hardstand's model-metre frame. */
  start: THREE.Vector2;
  entry: 'forwardHatch' | 'mainDoor';
  delay: number;
}

const BOARDERS: Boarder[] = [
  { role: 'Pilot', faceSeed: 21, start: new THREE.Vector2(13, -6), entry: 'forwardHatch', delay: 0.5 },
  { role: 'Navigator', faceSeed: 22, start: new THREE.Vector2(14.5, -4.2), entry: 'forwardHatch', delay: 1.6 },
  { role: 'Waist gunner', faceSeed: 23, start: new THREE.Vector2(-12, 9.5), entry: 'mainDoor', delay: 0.2 },
  { role: 'Tail gunner', faceSeed: 24, start: new THREE.Vector2(-14, 7.5), entry: 'mainDoor', delay: 1.2 },
];

type BoarderPose = 'strideLeft' | 'strideRight' | 'entry';

interface BoarderRig {
  boarder: Boarder;
  group: THREE.Group;
  meshes: Record<BoarderPose, THREE.Mesh>;
  /** Where he stands to climb in, and which way he faces there. */
  entrySpot: THREE.Vector2;
  entryYaw: number;
}

export interface PrologueFrame {
  /** World pose of the lead's holder. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  gearExtension: number;
  enginesRunning: boolean;
  /** The crew inside show once the last man is aboard. */
  crewAboard: boolean;
  finished: boolean;
}

export class Hardstand {
  readonly root = new THREE.Group();
  private readonly rigs: BoarderRig[];
  private readonly path: THREE.CatmullRomCurve3;
  private readonly frame: PrologueFrame = {
    position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YZX'), gearExtension: 1, enginesRunning: false, crewAboard: false, finished: false,
  };
  private readonly tangent = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  /** World offset of the take-off run's start: the ship's holder on its wheels at the hardstand. */
  private readonly groundOrigin: THREE.Vector3;

  /** `lead` is the ship that stands here; `slot` its holder's place in the formation, which the path ends on. */
  constructor(private readonly lead: B17, scale: number, slot: THREE.Vector3) {
    const { ground, entries } = lead.landingGear;
    this.root.position.copy(HARDSTAND_ORIGIN);
    this.root.scale.setScalar(scale);
    this.root.add(buildCard());
    this.groundOrigin = HARDSTAND_ORIGIN.clone().add(new THREE.Vector3(0, ground.height * scale, 0));
    this.path = new THREE.CatmullRomCurve3([...FLIGHT_PATH, slot.clone().sub(this.groundOrigin)], false, 'centripetal');

    const onGround = new THREE.Matrix4().makeRotationZ(ground.pitch).setPosition(0, ground.height, 0);
    const hatch = entries.forwardHatch.clone().applyMatrix4(onGround);
    const door = entries.mainDoor.clone().applyMatrix4(onGround);
    this.rigs = BOARDERS.map((boarder) => {
      const forwardHatch = boarder.entry === 'forwardHatch';
      // Under the hatch he faces forward and reaches up into it; at the door he faces it from starboard.
      const entrySpot = forwardHatch ? new THREE.Vector2(hatch.x - 0.15, hatch.z) : new THREE.Vector2(door.x, door.z + 0.45);
      const entryYaw = forwardHatch ? FACING.forward : FACING.port;
      const member = (bodyPose: Pose): CrewMember => ({ role: boarder.role, pose: bodyPose, outfit: GROUND_OUTFIT, regulator: null, faceSeed: boarder.faceSeed });
      const entryPose = forwardHatch ? reachUpPose(hatch.y) : stepUpPose(door.y);
      const meshes = {
        strideLeft: stridePose('left'), strideRight: stridePose('right'), entry: entryPose,
      };
      const group = new THREE.Group();
      const built = Object.fromEntries(Object.entries(meshes).map(([name, bodyPose]) => {
        const figure = member(bodyPose);
        const mesh = figureMesh(figure, 'high', new THREE.BufferGeometry());
        void meshFigureInWorker(figure, 'high').then((geometry) => {
          mesh.geometry.dispose();
          mesh.geometry = geometry;
        });
        mesh.visible = false;
        group.add(mesh);
        return [name, mesh];
      })) as Record<BoarderPose, THREE.Mesh>;
      this.root.add(group);
      return { boarder, group, meshes: built, entrySpot, entryYaw };
    });
  }

  /** The prologue at film time `time`: poses the boarding men and says where the lead is. */
  update(time: number): PrologueFrame {
    for (const rig of this.rigs) this.poseBoarder(rig, time);
    const frame = this.frame;
    frame.enginesRunning = time >= BEATS.enginesStart;
    frame.crewAboard = time >= BEATS.boardingEnds;
    frame.finished = time >= BEATS.docked;
    const { ground } = this.lead.landingGear;
    const run = THREE.MathUtils.clamp((time - BEATS.rollStart) / (BEATS.docked - BEATS.rollStart), 0, 1);
    // Accelerating along the card, then a steady climb and an easing in onto the stand.
    const along = THREE.MathUtils.smootherstep(run, 0, 1) ** 1.3;
    this.path.getPointAt(along, frame.position).add(this.groundOrigin);
    this.path.getTangentAt(along, this.tangent);
    this.path.getTangentAt(Math.min(along + TURN_SAMPLE, 1), this.ahead);
    const airborne = THREE.MathUtils.smoothstep(time, BEATS.liftOff - 0.6, BEATS.liftOff + 0.8);
    const settle = THREE.MathUtils.smoothstep(along, SETTLE_FROM, 1);
    const yaw = Math.atan2(-this.tangent.z, this.tangent.x) * (1 - settle);
    const turnRate = (Math.atan2(-this.ahead.z, this.ahead.x) - Math.atan2(-this.tangent.z, this.tangent.x)) / (TURN_SAMPLE * this.path.getLength());
    const climb = Math.asin(THREE.MathUtils.clamp(this.tangent.y, -1, 1));
    const pitch = THREE.MathUtils.lerp(ground.pitch, Math.min(climb, CLIMB_PITCH), airborne) * (1 - settle);
    // A turn to port puts the port wing down, which is negative bank.
    const bank = THREE.MathUtils.clamp(-turnRate * BANK_PER_TURN_RATE, -MAX_BANK, MAX_BANK) * airborne * (1 - settle);
    frame.rotation.set(bank, yaw, pitch, 'YZX');
    frame.gearExtension = 1 - THREE.MathUtils.smoothstep(time, BEATS.liftOff + 1.2, BEATS.liftOff + 4);
    return frame;
  }

  /** Hides the boarding men and the card once the ship has gone. */
  setShown(shown: boolean): void {
    this.root.visible = shown;
  }

  private poseBoarder(rig: BoarderRig, time: number): void {
    const local = time - rig.boarder.delay;
    const distance = rig.boarder.start.distanceTo(rig.entrySpot);
    const walkSeconds = Math.ceil(distance / STRIDE_LENGTH) * STRIDE_SECONDS;
    for (const mesh of Object.values(rig.meshes)) mesh.visible = false;
    if (local > walkSeconds + ENTRY_SECONDS) return;
    if (local >= walkSeconds) {
      rig.group.position.set(rig.entrySpot.x, 0, rig.entrySpot.y);
      rig.group.rotation.y = rig.entryYaw;
      rig.meshes.entry.visible = true;
      return;
    }
    // Stride by stride: each replacement figure is held while he covers one step; before setting off he waits.
    const stride = Math.floor(Math.max(local, 0) / STRIDE_SECONDS);
    const covered = Math.min((stride * STRIDE_SECONDS / walkSeconds) * distance, distance);
    const at = rig.boarder.start.clone().lerp(rig.entrySpot, covered / distance);
    const direction = rig.entrySpot.clone().sub(rig.boarder.start);
    rig.group.position.set(at.x, 0, at.y);
    rig.group.rotation.y = Math.atan2(-direction.y, direction.x);
    (stride % 2 === 0 ? rig.meshes.strideLeft : rig.meshes.strideRight).visible = true;
  }
}

/** The hardstand card: a concrete pan and the taxiway out of it, painted flat on board. */
function buildCard(): THREE.Group {
  const card = new THREE.Group();
  const concrete = matteMaterial('#8f8d86', { roughness: 0.95 });
  const pan = new THREE.Mesh(new THREE.CircleGeometry(HARDSTAND_CARD.radius, 48), concrete);
  pan.rotation.x = -Math.PI / 2;
  pan.position.y = 0.02;
  pan.receiveShadow = true;
  const taxiway = new THREE.Mesh(new THREE.PlaneGeometry(HARDSTAND_CARD.taxiLength, HARDSTAND_CARD.taxiWidth), concrete);
  taxiway.rotation.x = -Math.PI / 2;
  taxiway.position.set(HARDSTAND_CARD.radius + HARDSTAND_CARD.taxiLength / 2 - 2, 0.02, 0);
  taxiway.receiveShadow = true;
  card.add(pan, taxiway);
  return card;
}

/** Open hand hanging at his side or swinging, palm in toward his leg. */
function hangingHand(grip: THREE.Vector3, side: Side): HandTarget {
  const s = side === 'right' ? 1 : -1;
  return { grip, fingers: new THREE.Vector3(0.15, -1, 0).normalize(), palm: new THREE.Vector3(0, 0, -s), curl: 0.4, elbowPole: new THREE.Vector3(-1, 0, s * 0.3).normalize() };
}

/** Mid-stride with `leading` foot forward and the opposite arm swung forward. */
function stridePose(leading: Side): Pose {
  const lead = leading === 'left' ? -1 : 1;
  const foot = (side: Side) => {
    const s = side === 'right' ? 1 : -1;
    const forward = s === lead ? 0.27 : -0.27;
    return plantedFoot(new THREE.Vector3(forward, 0.075, s * 0.1), FACING.forward);
  };
  const hand = (side: Side) => {
    const s = side === 'right' ? 1 : -1;
    const forward = s === lead ? -0.16 : 0.18;
    return hangingHand(new THREE.Vector3(forward, 0.8, s * 0.23), side);
  };
  return pose({
    pelvis: new THREE.Vector3(0, 0.9, 0), yaw: FACING.forward, spineBend: 0.05,
    hands: { left: hand('left'), right: hand('right') },
    feet: { left: foot('left'), right: foot('right') },
  });
}

/** Under the forward hatch, both hands up on its coaming for the swing in; `hatchY` is its height over the ground. */
function reachUpPose(hatchY: number): Pose {
  const gripY = Math.min(hatchY, 2.0);
  const grip = (side: Side): HandTarget => {
    const s = side === 'right' ? 1 : -1;
    return { grip: new THREE.Vector3(0.12, gripY, s * 0.2), fingers: new THREE.Vector3(0.3, 1, 0).normalize(), palm: new THREE.Vector3(1, 0, 0), curl: 0.8, elbowPole: new THREE.Vector3(0, 0, s) };
  };
  return pose({
    pelvis: new THREE.Vector3(0, 0.95, 0), yaw: FACING.forward, headPitch: -0.35,
    hands: { left: grip('left'), right: grip('right') },
    feet: { left: plantedFoot(new THREE.Vector3(0, 0.075, -0.11), FACING.forward), right: plantedFoot(new THREE.Vector3(0.05, 0.075, 0.11), FACING.forward) },
  });
}

/** At the main door: left foot up on the step, right hand on the door frame; `sillY` is the sill's height. */
function stepUpPose(sillY: number): Pose {
  const step = Math.min(sillY * 0.5, 0.5);
  return pose({
    pelvis: new THREE.Vector3(0.08, 0.95, 0), yaw: FACING.forward, spineBend: 0.2,
    hands: {
      left: hangingHand(new THREE.Vector3(0.05, 0.85, -0.25), 'left'),
      right: { grip: new THREE.Vector3(0.38, Math.min(sillY + 0.7, 1.6), 0.25), fingers: new THREE.Vector3(0, 1, 0), palm: new THREE.Vector3(1, 0, 0), curl: 0.8, elbowPole: new THREE.Vector3(0, -1, 1).normalize() },
    },
    feet: {
      left: plantedFoot(new THREE.Vector3(0.3, step + 0.075, -0.1), FACING.forward, { kneeForward: 1.2 }),
      right: plantedFoot(new THREE.Vector3(-0.12, 0.075, 0.1), FACING.forward),
    },
  });
}
