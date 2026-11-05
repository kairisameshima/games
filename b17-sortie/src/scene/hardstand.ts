import * as THREE from 'three';
import { matteMaterial } from '../render/studio';
import type { B17 } from './b17';
import { figureMesh, type CrewMember, type Outfit } from './crew/figure';
import { meshFigureInWorker } from './crew/figure-pool';
import type { HandTarget, Pose, Side } from './crew/skeleton';
import { FACING, knobGrip, palmDown, plantedFoot, pose } from './interior/poses';
import { CircuitPath } from './circuit';

/**
 * The prologue on the hardstand: the lead stands on its wheels on a painted card on the studio floor while four of the
 * crew walk out to it, the officers up through the forward entrance hatch under the nose and the gunners in by the
 * main door aft; then the engines start and the animator runs it along the card, lifts it off and flies it round onto
 * its display stand, the undercarriage folding away as it climbs. Every man is a set of replacement figures, one per
 * pose, swapped exposure by exposure. At the end of the mission it comes back: off its stand, round onto a long final
 * approach with the wheels down, onto the taxiway and back to the pan, where it is swung round to stand as it started
 * and its engines are cut.
 */

/** Film seconds of the prologue's beats. */
const BEATS = { boardingEnds: 8.5, enginesStart: 9, rollStart: 12.3, liftOff: 15.3, docked: 22.3 } as const;
export const PROLOGUE_LIFT_OFF_SECONDS = BEATS.liftOff;

/**
 * The engines start one at a time in the order 1, 2, 3, 4, this far apart; each is cranked over by its starter for
 * `crank` seconds, turning its propeller slowly, before it catches with a cough of smoke.
 */
const ENGINE_START = { interval: 0.75, crank: 0.55 } as const;
export type EngineStart = 'cold' | 'cranking' | 'running';

/** Where the hardstand's centre is on the studio floor, world units, clear of the cloud deck and the lamp. */
const HARDSTAND_ORIGIN = new THREE.Vector3(-12, 0, 11);
/** The painted card: concrete pan radius and the taxiway's length and width out of it, model metres. */
const HARDSTAND_CARD = { radius: 14, taxiLength: 24, taxiWidth: 9 } as const;

/**
 * The take-off, in world units from the run's start, laid out as a circuit (see `CircuitPath`): the run and climb-out
 * along the taxiway's line, a climbing quarter turn to port, a straight leg, and a quarter turn to starboard onto a
 * short straight run in to the lead's slot, so it arrives level and heading forward. Turns of `radius`; `climbOut` is
 * the height reached by the end of the first turn and `legRise` the fraction of the slot's height by the end of the leg.
 */
const TAKEOFF_CIRCUIT = { radius: 2.5, final: 2, climbOut: 1, legRise: 0.85 } as const;
/** World units either side of lift-off over which the nose comes up off the ground into the climb. */
const ROTATION_DISTANCE = 1;
/**
 * The way home, in world units from the run's start, laid out as a pilot flies a circuit so the animator can chart it
 * evenly: straight on ahead of the box from the slot, a level-banked half circle to starboard onto the taxiway's line,
 * and a straight final down onto its far end. `turnX` is where the turn begins; its radius brings the ship out of it on
 * the taxiway's centreline. The height falls through `turnEntryDrop` by the turn, to `finalHeight` coming out of it,
 * and to the ground at `touchdownX`.
 */
const LANDING_CIRCUIT = { turnX: 24, touchdownX: 10, turnEntryDrop: 0.3, finalHeight: 1.2 } as const;
/**
 * Seconds of the landing: it leaves its stand, the wheels come down, it touches down; the roll-out, the swing round on
 * the pan, the engines being cut one by one (1, 2, 4: No. 3 is feathered) and the crew climbing out follow at the pace
 * the touchdown speed sets.
 */
const LANDING_BEATS = { leave: 0.5, gearDown: [3, 5.5], touchdown: 9, swingDelay: 0.4, swingSeconds: 2, cutDelay: 0.8, cutInterval: 0.6, deplaneDelay: 0.5, chiefDelay: 0.5 } as const;
/** World units it takes to come up to speed leaving its stand, from a standstill. */
const APPROACH_EASE_DISTANCE = 3;
/** Over this much of the final before touchdown, world units, the nose comes up from the glide into the three-point attitude. */
const FLARE_DISTANCE = 3;
/** The glide is drawn at this fraction of the path's angle: a model swooping at the true angle reads as a dive. */
const GLIDE_PITCH_FRACTION = 0.5;
/** World units over which the bank rolls in entering a turn and out leaving it. */
const BANK_RAMP = 4;
/** No. 3, by engine number less one: feathered over the target, so never cut on the pan. */
const FEATHERED_ENGINE = 2;
/** Engines still running on the pan, cut one by one. */
const ENGINES_CUT = 3;

/** Most nose-up in the climb; bank per radian of turn per world unit flown, and the most it banks. */
const CLIMB_PITCH = 0.12;
const BANK_PER_TURN_RATE = 2.2;
const MAX_BANK = 0.5;

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

export interface HardstandFrame {
  /** World pose of the lead's holder. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  gearExtension: number;
  /** Each engine's state, by engine number less one (No. 1, the port outboard, first). */
  engines: EngineStart[];
  /** The crew inside show once the last man is aboard. */
  crewAboard: boolean;
  finished: boolean;
}

export class Hardstand {
  readonly root = new THREE.Group();
  private readonly rigs: BoarderRig[];
  /** The crew chief on his work stand at the tally, there from the swing round on the pan. */
  private readonly crewChief: THREE.Group;
  private readonly takeoff: CircuitPath;
  /** How far along the take-off it lifts off: where it is at the lift-off beat. */
  private readonly liftOffAt: number;
  private readonly landingPath: CircuitPath;
  /** The landing's steady speed, world units a second, from the end of its ease to touchdown. */
  private readonly landingSpeed: number;
  /** When the roll-out is done, seconds after the lead left its stand. */
  readonly rolledOutSeconds: number;
  private readonly frame: HardstandFrame = {
    position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YZX'), gearExtension: 1, engines: ['cold', 'cold', 'cold', 'cold'], crewAboard: false, finished: false,
  };
  /** World offset of the take-off run's start: the ship's holder on its wheels at the hardstand. */
  private readonly groundOrigin: THREE.Vector3;

  /** `lead` is the ship that stands here; `slot` its holder's place in the formation, which the path ends on. */
  constructor(private readonly lead: B17, scale: number, slot: THREE.Vector3) {
    const { ground, entries } = lead.landingGear;
    this.root.position.copy(HARDSTAND_ORIGIN);
    this.root.scale.setScalar(scale);
    this.root.add(buildCard());
    this.groundOrigin = HARDSTAND_ORIGIN.clone().add(new THREE.Vector3(0, ground.height * scale, 0));
    const inSlot = slot.clone().sub(this.groundOrigin);

    const { radius, final, climbOut, legRise } = TAKEOFF_CIRCUIT;
    const run = inSlot.x - 2 * radius - final;
    const leg = -inSlot.z - 2 * radius;
    if (run <= 0 || leg <= 0) throw new Error('The lead\'s slot is too close to the hardstand for the take-off circuit');
    const quarter = (radius * Math.PI) / 2;
    const takeoffLength = run + quarter + leg + quarter + final;
    this.liftOffAt = takeoffLength * THREE.MathUtils.smootherstep((BEATS.liftOff - BEATS.rollStart) / (BEATS.docked - BEATS.rollStart), 0, 1);
    this.takeoff = new CircuitPath(new THREE.Vector3(), 0, [
      { kind: 'straight', length: run },
      { kind: 'turn', radius, angle: Math.PI / 2, side: -1 },
      { kind: 'straight', length: leg },
      { kind: 'turn', radius, angle: Math.PI / 2, side: 1 },
      { kind: 'straight', length: final },
    ], {
      at: [0, this.liftOffAt, run + quarter, run + quarter + leg, takeoffLength],
      height: [0, 0, climbOut, inSlot.y * legRise, inSlot.y],
    });

    // The landing's half circle has the slot's offset from the taxiway's line for its diameter.
    const straight = LANDING_CIRCUIT.turnX - inSlot.x;
    const turnRadius = -inSlot.z / 2;
    const arc = Math.PI * turnRadius;
    const finalLeg = LANDING_CIRCUIT.turnX - LANDING_CIRCUIT.touchdownX;
    this.landingPath = new CircuitPath(inSlot, 0, [
      { kind: 'straight', length: straight },
      { kind: 'turn', radius: turnRadius, angle: Math.PI, side: 1 },
      { kind: 'straight', length: finalLeg },
    ], {
      at: [0, straight, straight + arc, straight + arc + finalLeg],
      height: [inSlot.y, inSlot.y - LANDING_CIRCUIT.turnEntryDrop, LANDING_CIRCUIT.finalHeight, 0],
    });
    // A standstill to steady speed over the ease takes as long as twice its distance at that speed.
    this.landingSpeed = (this.landingPath.length + APPROACH_EASE_DISTANCE) / (LANDING_BEATS.touchdown - LANDING_BEATS.leave);
    // Braking evenly from touchdown speed to a stop in the taxiway's length takes twice that length at that speed.
    this.rolledOutSeconds = LANDING_BEATS.touchdown + (2 * LANDING_CIRCUIT.touchdownX) / this.landingSpeed;

    const onGround = new THREE.Matrix4().makeRotationZ(ground.pitch).setPosition(0, ground.height, 0);
    const hatch = entries.forwardHatch.clone().applyMatrix4(onGround);
    const door = entries.mainDoor.clone().applyMatrix4(onGround);
    // He paints the new bomb where it goes on the tally, so the stand is set by the bomb's decal.
    const newBomb = lead.nextMissionBomb;
    if (!newBomb) throw new Error('The hardstand\'s ship has no mission tally to add to');
    newBomb.geometry.computeBoundingBox();
    const bombOnSkin = newBomb.geometry.boundingBox?.getCenter(new THREE.Vector3());
    if (!bombOnSkin) throw new Error('The mission tally\'s new bomb has no geometry');
    this.crewChief = buildCrewChief(this.root, bombOnSkin.applyMatrix4(onGround));
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
  update(time: number): HardstandFrame {
    for (const rig of this.rigs) this.poseBoarder(rig, time);
    const frame = this.frame;
    frame.engines.forEach((_, engine) => {
      const catches = BEATS.enginesStart + ENGINE_START.crank + engine * ENGINE_START.interval;
      frame.engines[engine] = time >= catches ? 'running' : time >= catches - ENGINE_START.crank ? 'cranking' : 'cold';
    });
    frame.crewAboard = time >= BEATS.boardingEnds;
    frame.finished = time >= BEATS.docked;
    const { ground } = this.lead.landingGear;
    const run = THREE.MathUtils.clamp((time - BEATS.rollStart) / (BEATS.docked - BEATS.rollStart), 0, 1);
    // Accelerating along the card from a standstill, and easing to a stop on the stand.
    const along = this.takeoff.length * THREE.MathUtils.smootherstep(run, 0, 1);
    this.takeoff.point(along, frame.position).add(this.groundOrigin);
    const airborne = THREE.MathUtils.smoothstep(along, this.liftOffAt - ROTATION_DISTANCE, this.liftOffAt + ROTATION_DISTANCE);
    const pitch = THREE.MathUtils.lerp(ground.pitch, Math.min(Math.atan(this.takeoff.slope(along)), CLIMB_PITCH), airborne);
    frame.rotation.set(this.takeoff.bank(along, BANK_PER_TURN_RATE, MAX_BANK, BANK_RAMP), this.takeoff.heading(along), pitch, 'YZX');
    frame.gearExtension = 1 - THREE.MathUtils.smoothstep(time, BEATS.liftOff + 1.2, BEATS.liftOff + 4);
    return frame;
  }

  /**
   * The landing at `time` seconds after the lead leaves its stand: says where it is, its wheels and its engines.
   * The boarding men are not out for it.
   */
  landing(time: number): HardstandFrame {
    const frame = this.frame;
    const { ground } = this.lead.landingGear;
    frame.gearExtension = THREE.MathUtils.smoothstep(time, LANDING_BEATS.gearDown[0], LANDING_BEATS.gearDown[1]);
    const swingStart = this.rolledOutSeconds + LANDING_BEATS.swingDelay;
    const swingEnd = swingStart + LANDING_BEATS.swingSeconds;
    frame.engines.forEach((_, engine) => {
      const cutOrder = engine < FEATHERED_ENGINE ? engine : engine - 1;
      const cut = engine === FEATHERED_ENGINE || time >= swingEnd + LANDING_BEATS.cutDelay + cutOrder * LANDING_BEATS.cutInterval;
      frame.engines[engine] = cut ? 'cold' : 'running';
    });
    frame.finished = time >= swingEnd;
    // Once the last engine is cut the crew climb out and walk back across the card.
    const lastCut = swingEnd + LANDING_BEATS.cutDelay + (ENGINES_CUT - 1) * LANDING_BEATS.cutInterval;
    const deplaneStart = lastCut + LANDING_BEATS.deplaneDelay;
    frame.crewAboard = time < deplaneStart;
    this.crewChief.visible = time >= swingEnd + LANDING_BEATS.chiefDelay;
    for (const rig of this.rigs) this.poseDeplaning(rig, time - deplaneStart - rig.boarder.delay);
    const speed = this.landingSpeed;
    const path = this.landingPath;
    if (time < LANDING_BEATS.touchdown) {
      // Up to speed over the ease from a standstill on its stand, then steady all the way down.
      const flying = Math.max(time - LANDING_BEATS.leave, 0);
      const easeSeconds = (2 * APPROACH_EASE_DISTANCE) / speed;
      const flown = flying < easeSeconds
        ? (speed * speed * flying * flying) / (4 * APPROACH_EASE_DISTANCE)
        : APPROACH_EASE_DISTANCE + speed * (flying - easeSeconds);
      const along = Math.min(flown, path.length);
      path.point(along, frame.position).add(this.groundOrigin);
      const flare = THREE.MathUtils.smoothstep(along, path.length - FLARE_DISTANCE, path.length);
      const pitch = THREE.MathUtils.lerp(Math.atan(path.slope(along)) * GLIDE_PITCH_FRACTION, ground.pitch, flare);
      frame.rotation.set(path.bank(along, BANK_PER_TURN_RATE, MAX_BANK, BANK_RAMP), path.heading(along), pitch);
      return frame;
    }
    // Rolling out down the taxiway to the pan, braking evenly to a stop, then swung round on it to face out as it started.
    const rolling = Math.min(time - LANDING_BEATS.touchdown, this.rolledOutSeconds - LANDING_BEATS.touchdown);
    const rolled = speed * rolling - (speed * speed * rolling * rolling) / (4 * LANDING_CIRCUIT.touchdownX);
    frame.position.set(LANDING_CIRCUIT.touchdownX - rolled, 0, 0).add(this.groundOrigin);
    const swung = THREE.MathUtils.smoothstep(time, swingStart, swingEnd);
    frame.rotation.set(0, -Math.PI + Math.PI * swung, ground.pitch);
    return frame;
  }

  /** Hides the boarding men and the card once the ship has gone. */
  setShown(shown: boolean): void {
    this.root.visible = shown;
    // The crew chief is only out after a mission; the landing shows him.
    if (!shown) this.crewChief.visible = false;
  }

  /** Walking out from where he set off to the ship and climbing in, `local` seconds after he sets off. */
  private poseBoarder(rig: BoarderRig, time: number): void {
    const local = time - rig.boarder.delay;
    const walkSeconds = this.walkSeconds(rig);
    for (const mesh of Object.values(rig.meshes)) mesh.visible = false;
    if (local > walkSeconds + ENTRY_SECONDS) return;
    if (local >= walkSeconds) {
      this.showEntry(rig);
      return;
    }
    this.showStride(rig, rig.boarder.start, rig.entrySpot, Math.max(local, 0), walkSeconds);
  }

  /** The reverse after the mission: climbing out, then walking back the way he came and off the card. */
  private poseDeplaning(rig: BoarderRig, local: number): void {
    const walkSeconds = this.walkSeconds(rig);
    for (const mesh of Object.values(rig.meshes)) mesh.visible = false;
    if (local < 0 || local > ENTRY_SECONDS + walkSeconds) return;
    if (local < ENTRY_SECONDS) {
      this.showEntry(rig);
      return;
    }
    this.showStride(rig, rig.entrySpot, rig.boarder.start, local - ENTRY_SECONDS, walkSeconds);
  }

  private walkSeconds(rig: BoarderRig): number {
    return Math.ceil(rig.boarder.start.distanceTo(rig.entrySpot) / STRIDE_LENGTH) * STRIDE_SECONDS;
  }

  private showEntry(rig: BoarderRig): void {
    rig.group.position.set(rig.entrySpot.x, 0, rig.entrySpot.y);
    rig.group.rotation.y = rig.entryYaw;
    rig.meshes.entry.visible = true;
  }

  /** Stride by stride from `from` to `to`: each replacement figure is held while he covers one step. */
  private showStride(rig: BoarderRig, from: THREE.Vector2, to: THREE.Vector2, walked: number, walkSeconds: number): void {
    const distance = from.distanceTo(to);
    const stride = Math.floor(walked / STRIDE_SECONDS);
    const covered = Math.min((stride * STRIDE_SECONDS / walkSeconds) * distance, distance);
    const at = from.clone().lerp(to, covered / distance);
    const direction = to.clone().sub(from);
    rig.group.position.set(at.x, 0, at.y);
    rig.group.rotation.y = Math.atan2(-direction.y, direction.x);
    (stride % 2 === 0 ? rig.meshes.strideLeft : rig.meshes.strideRight).visible = true;
  }
}

/**
 * The crew chief's work stand off the port side under the mission tally: a platform at the height his brush hand needs,
 * `brushReach` below the tally, standing `offSkin` out from the skin, with legs and a rail.
 */
/** His hand is this far off the skin: the brush's length. */
const BRUSH_LENGTH = 0.18;
const WORK_STAND = { brushReach: 1.7, offSkin: 0.55, platform: [0.7, 0.05, 0.55] as [number, number, number], leg: 0.03, rail: 0.02 } as const;

/**
 * The crew chief at the tally after the mission, on his work stand, brush to the skin at `skin` (where the new bomb
 * goes, in the card's frame) and his other hand on the rail; a yellow paint can by his feet.
 */
function buildCrewChief(root: THREE.Object3D, skin: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.visible = false;
  const platformY = skin.y - WORK_STAND.brushReach;
  const standZ = skin.z - WORK_STAND.offSkin;
  const steel = matteMaterial('#5d6150', { roughness: 0.7 });
  const [width, thickness, depth] = WORK_STAND.platform;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), steel);
  platform.position.set(skin.x, platformY - thickness / 2, standZ);
  group.add(platform);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(WORK_STAND.leg, WORK_STAND.leg, platformY, 6), steel);
    leg.position.set(skin.x + (dx * width) / 2.2, platformY / 2, standZ + (dz * depth) / 2.2);
    group.add(leg);
  }
  // The rail along the stand's outer edge, away from the ship.
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(WORK_STAND.rail, WORK_STAND.rail, width, 6), steel);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(skin.x, platformY + 1, standZ - depth / 2);
  group.add(rail);
  for (const dx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(WORK_STAND.rail, WORK_STAND.rail, 1, 6), steel);
    post.position.set(skin.x + (dx * width) / 2, platformY + 0.5, standZ - depth / 2);
    group.add(post);
  }
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), matteMaterial('#d9a62b', { roughness: 0.5 }));
  can.position.set(skin.x + 0.22, platformY + 0.06, standZ + 0.12);
  group.add(can);

  // Facing the ship: his figure's forward (+x) turned onto +z. The brush hand is at the skin, a little forward of him.
  const facing = FACING.starboard;
  const brush = new THREE.Vector3(WORK_STAND.offSkin - BRUSH_LENGTH, WORK_STAND.brushReach, 0);
  const member: CrewMember = {
    role: 'Crew chief', outfit: GROUND_OUTFIT, regulator: null, faceSeed: 31,
    pose: pose({
      pelvis: new THREE.Vector3(0, 0.95, 0), yaw: FACING.forward, spineBend: 0.08, headPitch: -0.25,
      hands: {
        right: knobGrip(brush, 'right', FACING.forward, new THREE.Vector3(1, 0, 0), 0.75),
        left: palmDown(new THREE.Vector3(-0.2, 1, -0.3), 'left', FACING.forward),
      },
      feet: { left: plantedFoot(new THREE.Vector3(0, 0.075, -0.12), FACING.forward), right: plantedFoot(new THREE.Vector3(0.06, 0.075, 0.12), FACING.forward) },
    }),
  };
  const figure = figureMesh(member, 'high', new THREE.BufferGeometry());
  void meshFigureInWorker(member, 'high').then((geometry) => {
    figure.geometry.dispose();
    figure.geometry = geometry;
  });
  const holder = new THREE.Group();
  // The brush, from his hand to the skin.
  const brushStick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, BRUSH_LENGTH, 8), matteMaterial('#7a4f2a', { roughness: 0.6 }));
  brushStick.rotation.z = -Math.PI / 2;
  brushStick.position.set(WORK_STAND.offSkin - BRUSH_LENGTH / 2, WORK_STAND.brushReach, 0);
  holder.add(brushStick);
  holder.position.set(skin.x, platformY, standZ);
  holder.rotation.y = facing;
  holder.add(figure);
  group.add(holder);
  root.add(group);
  return group;
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
