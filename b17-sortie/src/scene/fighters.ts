import * as THREE from 'three';
import { matteMaterial } from '../render/studio';
import { RIG_HEIGHT, RIG_WIRE } from './effects';
import { buildFw190, type Fw190 } from './fw190';

/**
 * The fighter attack: Fw 190s making head-on passes through the box, the way the Jagdwaffe took on B-17 formations from
 * 1943, then breaking away below or past it. On the set each is a model hung from the rig on two fine wires, moved
 * along its pass a step an exposure.
 */

interface FighterPass {
  /** Which model flies it. */
  fighter: number;
  /** Sortie seconds the pass starts, and how long it takes. */
  start: number;
  duration: number;
  /** World points from in front of the box, through it and away. */
  path: THREE.Vector3[];
  /** Roll the pilot adds over the pass, keyed by how far along it (radians, positive right wing down). */
  roll: readonly (readonly [number, number])[];
  /** How far along the pass the box's gunners hit it, where they do: from there it smokes and goes down to the floor. */
  hitAt?: number;
}

const FIGHTER_COUNT = 3;

/** Four passes inside the gunfire window, each threaded between the ships, their stands and their wings. */
const PASSES: FighterPass[] = [
  // High from twelve o'clock between the lead and the high wingman, then rolling away under the box.
  {
    fighter: 0, start: 11.0, duration: 3.6,
    path: [new THREE.Vector3(30, 8, -10), new THREE.Vector3(14, 6.6, -6), new THREE.Vector3(4, 5.6, -3.6), new THREE.Vector3(-8, 4.1, -3.6), new THREE.Vector3(-18, 3, -6), new THREE.Vector3(-50, 1.5, -7)],
    roll: [[0, 0], [0.52, 0], [0.66, Math.PI], [0.84, Math.PI], [1, Math.PI * 2]],
  },
  // Level from eleven o'clock, under the lead's port wing, breaking low and wide to port.
  {
    fighter: 1, start: 12.7, duration: 3.6,
    path: [new THREE.Vector3(30, 1.6, -1), new THREE.Vector3(14, 1.6, -2), new THREE.Vector3(4, 1.6, -2.8), new THREE.Vector3(-4, 1.5, -3.6), new THREE.Vector3(-12, 1.4, -8.5), new THREE.Vector3(-40, 2.2, -11)],
    roll: [[0, 0], [0.5, 0], [0.62, -0.9], [1, -0.4]],
  },
  // From one o'clock high, over the lead's tail, and away past the low wingman.
  {
    fighter: 2, start: 15.9, duration: 3.6,
    path: [new THREE.Vector3(30, 7, -13), new THREE.Vector3(14, 6.4, -7), new THREE.Vector3(5, 6.2, -1.4), new THREE.Vector3(-4, 6.1, 0.6), new THREE.Vector3(-14, 4.6, 2.5), new THREE.Vector3(-45, 2.5, 6)],
    roll: [[0, 0], [0.55, 0.3], [0.8, 1.2], [1, 0.8]],
  },
  // The first fighter back round: diving in from the starboard bow, outside the lead's starboard wingtip. The box's
  // gunners hit it as it breaks; it rolls over trailing smoke and goes down onto the set floor.
  {
    fighter: 0, start: 19.4, duration: 4.6,
    path: [
      new THREE.Vector3(30, 11, 8), new THREE.Vector3(16, 8.5, 5), new THREE.Vector3(7, 5.6, 3.5), new THREE.Vector3(-1, 4, 7),
      new THREE.Vector3(-7, 2.2, 10), new THREE.Vector3(-11, 0.8, 12), new THREE.Vector3(-13, 0.15, 13),
    ],
    roll: [[0, 0], [0.4, -0.5], [0.5, 0.4], [1, Math.PI * 3]],
    hitAt: 0.42,
  },
];

/** Bank per unit of turn rate (radians per world unit flown), and the most a turn alone banks the fighter. */
const BANK_PER_TURN_RATE = 3;
const MAX_TURN_BANK = 0.9;
/** How far ahead along a pass the turn rate is measured. */
const TURN_SAMPLE = 0.02;
/** Along its pass a fighter fires from here to here: closing, before it reaches the box. */
const FIRING = [0.12, 0.42] as const;
/** On an exposure while firing, the chance each gun's flash is up. */
const FLASH_CHANCE = 0.55;
/** Where the rig's two wires are tied on, over each wing, model metres. */
const WIRE_ANCHORS = [new THREE.Vector3(0.6, 0.2, -1.8), new THREE.Vector3(0.6, 0.2, 1.8)] as const;

/** The smoke streams from the engine, under the cowling, model metres. */
const SMOKE_FROM = new THREE.Vector3(2.4, -0.5, 0);
/** How far the hit engine's propeller windmills round each exposure. */
const WINDMILL_TURN = 0.35;
/** A pass that ended longer ago than this before an update was skipped over (a jump), not flown: no crash. */
const CRASH_WINDOW_SECONDS = 0.5;

interface FighterRig {
  model: Fw190;
  wires: THREE.Mesh[];
}

interface PreparedPass extends FighterPass {
  curve: THREE.CatmullRomCurve3;
  length: number;
}

export class FighterAttack {
  readonly root = new THREE.Group();
  private readonly rigs: FighterRig[];
  private readonly passes: PreparedPass[];
  private readonly tangent = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  /** World positions of the fighters on a pass this exposure, for the gunners to track. */
  private readonly flying: THREE.Vector3[] = [];
  /** Where the hit fighter's smoke streams from this exposure, while it is going down. */
  private readonly smokePoint = new THREE.Vector3();
  private smokingNow = false;
  /** Where the hit fighter struck the floor, until `takeCrash` collects it. */
  private crash: THREE.Vector3 | null = null;
  /** The sortie time of the last update, to see a pass end between two exposures. */
  private lastTime = -Infinity;
  /** Some fighter's guns flashed this exposure. */
  firing = false;

  constructor(scale: number) {
    const wireGeometry = new THREE.CylinderGeometry(RIG_WIRE.radius, RIG_WIRE.radius, 1, 5, 1, true).translate(0, 0.5, 0);
    const wireMaterial = matteMaterial(RIG_WIRE.colour, { roughness: 0.3, envMapIntensity: 1.2 });
    this.rigs = Array.from({ length: FIGHTER_COUNT }, () => {
      const model = buildFw190();
      model.root.scale.setScalar(scale);
      model.root.visible = false;
      model.root.rotation.order = 'YZX';
      const wires = WIRE_ANCHORS.map(() => {
        const wire = new THREE.Mesh(wireGeometry, wireMaterial);
        wire.castShadow = false;
        wire.visible = false;
        this.root.add(wire);
        return wire;
      });
      this.root.add(model.root);
      return { model, wires };
    });
    this.passes = PASSES.map((pass) => {
      const curve = new THREE.CatmullRomCurve3(pass.path, false, 'centripetal');
      return { ...pass, curve, length: curve.getLength() };
    });
  }

  /**
   * Poses every fighter for sortie time `time`. Propellers and muzzle flashes change only on exposures the animator
   * moved (`deltaSec` > 0).
   */
  update(time: number, deltaSec: number, random: () => number): void {
    this.flying.length = 0;
    this.smokingNow = false;
    if (deltaSec > 0) this.firing = false;
    for (const pass of this.passes) {
      // A hit fighter that reached the end of its pass since the last exposure has hit the floor there.
      const end = pass.start + pass.duration;
      if (pass.hitAt !== undefined && this.lastTime < end && time >= end && time - this.lastTime < CRASH_WINDOW_SECONDS) {
        this.crash = pass.path[pass.path.length - 1].clone();
      }
    }
    this.lastTime = time;
    for (const rig of this.rigs) {
      rig.model.root.visible = false;
      for (const wire of rig.wires) wire.visible = false;
    }
    for (const pass of this.passes) {
      const along = (time - pass.start) / pass.duration;
      if (along < 0 || along > 1) continue;
      const rig = this.rigs[pass.fighter];
      this.posePass(rig, pass, along);
      const { root, propeller, flashes } = rig.model;
      root.visible = true;
      root.updateMatrixWorld(true);
      this.flying.push(root.position);
      const hit = pass.hitAt !== undefined && along >= pass.hitAt;
      if (hit) {
        this.smokingNow = true;
        root.localToWorld(this.smokePoint.copy(SMOKE_FROM));
      }
      if (deltaSec > 0) {
        // A hit engine windmills slowly; a running one strobes to a new angle each exposure.
        propeller.rotation.x = hit ? propeller.rotation.x + WINDMILL_TURN : random() * Math.PI * 2;
        const firing = !hit && along >= FIRING[0] && along <= FIRING[1];
        for (const flash of flashes) flash.visible = firing && random() < FLASH_CHANCE;
        if (flashes.some((flash) => flash.visible)) this.firing = true;
      }
      rig.wires.forEach((wire, index) => {
        root.localToWorld(this.anchor.copy(WIRE_ANCHORS[index]));
        wire.position.copy(this.anchor);
        wire.scale.set(1, Math.max(RIG_HEIGHT - this.anchor.y, 0), 1);
        wire.visible = true;
      });
    }
  }

  /** Where the hit fighter's smoke comes from, written to `out`; false while no fighter is going down. */
  smoke(out: THREE.Vector3): boolean {
    if (this.smokingNow) out.copy(this.smokePoint);
    return this.smokingNow;
  }

  /** Where the hit fighter struck the floor, once, since the last call; null if it has not. */
  takeCrash(): THREE.Vector3 | null {
    const crash = this.crash;
    this.crash = null;
    return crash;
  }

  /** The nearest fighter on a pass to `from` within `range`, written to `out`; false when none is. */
  nearest(from: THREE.Vector3, range: number, out: THREE.Vector3): boolean {
    let best = range;
    let found = false;
    for (const position of this.flying) {
      const distance = position.distanceTo(from);
      if (distance >= best) continue;
      best = distance;
      out.copy(position);
      found = true;
    }
    return found;
  }

  private posePass(rig: FighterRig, pass: PreparedPass, along: number): void {
    const { root } = rig.model;
    pass.curve.getPointAt(along, root.position);
    pass.curve.getTangentAt(along, this.tangent);
    pass.curve.getTangentAt(Math.min(along + TURN_SAMPLE, 1), this.ahead);
    const heading = Math.atan2(-this.tangent.z, this.tangent.x);
    // Flying toward −x the heading sits at ±π, so the change is taken the short way round.
    const turn = THREE.MathUtils.euclideanModulo(Math.atan2(-this.ahead.z, this.ahead.x) - heading + Math.PI, Math.PI * 2) - Math.PI;
    const turnRate = turn / (TURN_SAMPLE * pass.length);
    // A turn to port puts the port wing down, which is negative bank.
    const turnBank = THREE.MathUtils.clamp(-turnRate * BANK_PER_TURN_RATE, -MAX_TURN_BANK, MAX_TURN_BANK);
    const climb = Math.asin(THREE.MathUtils.clamp(this.tangent.y, -1, 1));
    root.rotation.set(turnBank + scriptedRoll(pass.roll, along), heading, climb);
  }
}

/** The pilot's roll at `along`, eased between its keys. */
function scriptedRoll(keys: readonly (readonly [number, number])[], along: number): number {
  for (let index = 0; index < keys.length - 1; index++) {
    const [from, fromRoll] = keys[index];
    const [to, toRoll] = keys[index + 1];
    if (along <= to) return THREE.MathUtils.lerp(fromRoll, toRoll, THREE.MathUtils.smoothstep(along, from, to));
  }
  return keys[keys.length - 1][1];
}
