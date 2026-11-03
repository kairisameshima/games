import * as THREE from 'three';
import { meshField, type SurfaceMesh } from './mesher';
import { REGION, crewMaterial, regionLook } from './regions';
import { Ellipsoid, Field, Frame, RoundBox, RoundCone, Torus, type MeshPart, type Primitive, type PrimitiveOptions, type SurfaceDetail, type Vec3 } from './sdf';
import { ANTHROPOMETRY, buildSkeleton, type Joint, type Pose, type Side, type Skeleton } from './skeleton';

/**
 * Crew figures as signed-distance sculptures: anatomy from the posed skeleton, then each garment and piece of gear as
 * shapes smooth-unioned over it, meshed with surface nets (body at 11 mm, head and hands at 5 mm) into one mesh per man.
 */

export type UpperGarment = 'b3' | 'a2' | 'heatedSuit';
export type LowerGarment = 'a3' | 'wool' | 'heatedSuit';

export interface Outfit {
  /** B-3 sheepskin jacket, A-2 horsehide jacket, or the F-3 heated suit worn alone (ball turret). */
  upper: UpperGarment;
  lower: LowerGarment;
  /** M1 flyer's vest: front and back armour panels. */
  flakVest: boolean;
  /** M3 groin apron hung from the vest; waist and tail gunners stood or knelt in it. */
  flakApron: boolean;
  /** M4 steel helmet over the leather helmet, worn on the bomb run. */
  flakHelmet: boolean;
  /** B-4 life vest, worn under the harness on over-water missions. */
  lifeVest: boolean;
  /** QAC chest-type parachute harness (the pack itself was stowed at the station). */
  harness: boolean;
  goggles: 'down' | 'up';
  /** A-14 demand oxygen mask, on above 10,000 ft. */
  oxygenMask: boolean;
}

export interface CrewMember {
  role: string;
  pose: Pose;
  outfit: Outfit;
  /** Where the oxygen hose plugs into the station's regulator, in figure space. */
  regulator: THREE.Vector3 | null;
  /** Varies face shape between the men. */
  faceSeed: number;
  /**
   * Height as a fraction of the 1.75 m figure the skeleton is built for. The pose is authored at full size and the
   * finished mesh scaled about its host's origin, so a short man's targets are given divided by his stature.
   */
  stature?: number;
}

export type FigureDetail = 'high' | 'low';

const VOXEL: Record<FigureDetail, Record<MeshPart, number>> = {
  high: { body: 0.011, head: 0.005, leftHand: 0.005, rightHand: 0.005 },
  low: { body: 0.03, head: 0.014, leftHand: 0.014, rightHand: 0.014 },
};

const BULK: Record<UpperGarment | LowerGarment, number> = { b3: 0.03, a2: 0.012, heatedSuit: 0.01, a3: 0.026, wool: 0.008 };
const UPPER_REGION: Record<UpperGarment, number> = { b3: REGION.sheepskinLeather, a2: REGION.horsehide, heatedSuit: REGION.heatedSuit };
const LOWER_REGION: Record<LowerGarment, number> = { a3: REGION.sheepskinLeather, wool: REGION.wool, heatedSuit: REGION.heatedSuit };

/** Wrinkle character per material: depth (m) and creases per metre. */
const DETAIL: Record<string, SurfaceDetail> = {
  leather: { amplitude: 0.0028, frequency: 40 },
  wool: { amplitude: 0.0022, frequency: 55 },
  leatherSleeve: { amplitude: 0.0045, frequency: 34, creaseStretch: 0.3 },
  woolSleeve: { amplitude: 0.0035, frequency: 42, creaseStretch: 0.3 },
  fleece: { amplitude: 0.003, frequency: 140 },
  canvas: { amplitude: 0.002, frequency: 70 },
  suede: { amplitude: 0.0018, frequency: 90 },
};

const isLeather = (garment: UpperGarment | LowerGarment): boolean => garment === 'b3' || garment === 'a3' || garment === 'a2';
const garmentDetail = (garment: UpperGarment | LowerGarment): SurfaceDetail => (isLeather(garment) ? DETAIL.leather : DETAIL.wool);
const sleeveDetail = (garment: UpperGarment | LowerGarment): SurfaceDetail => (isLeather(garment) ? DETAIL.leatherSleeve : DETAIL.woolSleeve);

const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function at(joint: Joint, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(joint.frame).add(joint.position);
}

function frameOf(joint: Joint): Frame {
  return Frame.fromMatrix(joint.frame);
}

/** A frame whose local y runs along `axis`: rings round a limb, straps round a thigh. */
function frameAlong(axis: THREE.Vector3, hint = new THREE.Vector3(1, 0, 0)): Frame {
  const y = axis.clone().normalize();
  const x = hint.clone().addScaledVector(y, -hint.dot(y));
  if (x.lengthSq() < 1e-6) x.set(0, 0, 1).addScaledVector(y, -y.z);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new Frame(vec(x), vec(y), vec(z));
}

function frameRotated(joint: Joint, euler: THREE.Euler): Frame {
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(joint.frame).multiply(new THREE.Quaternion().setFromEuler(euler));
  return Frame.fromQuaternion(quaternion);
}

class FigureBuilder {
  readonly primitives: Primitive[] = [];
  private readonly upperBulk: number;
  private readonly lowerBulk: number;
  private readonly upperRegion: number;
  private readonly lowerRegion: number;

  constructor(private readonly skeleton: Skeleton, private readonly member: CrewMember) {
    this.upperBulk = BULK[member.outfit.upper];
    this.lowerBulk = BULK[member.outfit.lower];
    this.upperRegion = UPPER_REGION[member.outfit.upper];
    this.lowerRegion = LOWER_REGION[member.outfit.lower];
  }

  private add(primitive: Primitive): void {
    this.primitives.push(primitive);
  }

  private options(region: number, part: MeshPart, blend: number, detail?: SurfaceDetail, priority = 0): PrimitiveOptions {
    return { region, part, blend, detail, priority };
  }

  build(): void {
    this.torso();
    for (const side of ['left', 'right'] as const) {
      this.arm(side);
      this.leg(side);
      this.hand(side);
    }
    this.garmentDetails();
    this.head();
    this.gear();
  }

  private torso(): void {
    const { pelvis, lumbar, chest, neck } = this.skeleton;
    const ub = this.upperBulk, lb = this.lowerBulk;
    const upper = this.member.outfit.upper, lower = this.member.outfit.lower;
    this.add(new Ellipsoid(vec(at(pelvis, -0.01, -0.01, 0)), [0.112 + lb, 0.115 + lb * 0.5, 0.165 + lb], frameOf(pelvis), this.options(this.lowerRegion, 'body', 0.03, garmentDetail(lower))));
    this.add(new Ellipsoid(vec(at(lumbar, 0.0, 0.03, 0)), [0.1 + ub, 0.12, 0.145 + ub], frameOf(lumbar), this.options(this.upperRegion, 'body', 0.07, garmentDetail(upper))));
    this.add(new Ellipsoid(vec(at(chest, 0.005, 0.035, 0)), [0.118 + ub, 0.16, 0.16 + ub], frameOf(chest), this.options(this.upperRegion, 'body', 0.07, garmentDetail(upper))));
    // Shoulder girdle and the trapezius slope into the neck.
    this.add(new Ellipsoid(vec(at(neck, -0.025, -0.055, 0)), [0.095 + ub, 0.07, 0.19 + ub], frameOf(chest), this.options(this.upperRegion, 'body', 0.06, garmentDetail(upper))));
    this.add(new RoundCone(vec(at(neck, -0.01, -0.03, 0)), vec(at(neck, 0.01, 0.09, 0)), 0.058, 0.052, this.options(REGION.skin, 'body', 0.03)));
  }

  private arm(side: Side): void {
    const s = this.skeleton;
    const ub = this.upperBulk;
    const region = this.upperRegion;
    const detail = garmentDetail(this.member.outfit.upper);
    const sleeve = sleeveDetail(this.member.outfit.upper);
    this.add(new Ellipsoid(vec(s.shoulder[side]), [0.068 + ub, 0.07 + ub * 0.6, 0.066 + ub], frameOf(s.chest), this.options(region, 'body', 0.05, detail)));
    this.add(new RoundCone(vec(s.shoulder[side]), vec(s.elbow[side]), 0.06 + ub * 0.9, 0.048 + ub * 0.8, this.options(region, 'body', 0.035, sleeve)));
    this.add(new RoundCone(vec(s.elbow[side]), vec(s.wrist[side]), 0.048 + ub * 0.8, 0.039 + ub * 0.6, this.options(region, 'body', 0.025, sleeve)));
    if (this.member.outfit.upper === 'a2') {
      const forearm = s.wrist[side].clone().sub(s.elbow[side]).normalize();
      this.add(new Torus(vec(s.wrist[side].clone().addScaledVector(forearm, -0.03)), 0.038, 0.014, frameAlong(forearm), this.options(REGION.knit, 'body', 0.008, DETAIL.wool, 1)));
    }
  }

  private leg(side: Side): void {
    const s = this.skeleton;
    const lb = this.lowerBulk;
    const region = this.lowerRegion;
    const detail = garmentDetail(this.member.outfit.lower);
    const trouser = sleeveDetail(this.member.outfit.lower);
    const shinAxis = s.knee[side].clone().sub(s.ankle[side]).normalize();
    this.add(new RoundCone(vec(s.hip[side]), vec(s.knee[side]), 0.082 + lb, 0.056 + lb, this.options(region, 'body', 0.05, trouser)));
    this.add(new Ellipsoid(vec(s.knee[side]), [0.058 + lb, 0.06 + lb, 0.058 + lb], frameAlong(shinAxis), this.options(region, 'body', 0.03, detail)));
    // The trouser leg ends inside the boot shaft.
    const bootTop = s.ankle[side].clone().addScaledVector(shinAxis, 0.19);
    this.add(new RoundCone(vec(s.knee[side]), vec(bootTop), 0.054 + lb, 0.048 + lb, this.options(region, 'body', 0.03, trouser)));

    // A-6 boot: fleece-lined suede shaft, rounded foot, rubber sole.
    const footFrame = Frame.fromMatrix(s.footFrame[side]);
    const sole = new THREE.Vector3().setFromMatrixColumn(s.footFrame[side], 1);
    this.add(new RoundCone(vec(s.ankle[side].clone().addScaledVector(sole, -0.03)), vec(bootTop), 0.06, 0.063, this.options(REGION.bootSuede, 'body', 0.02, DETAIL.suede)));
    this.add(new Torus(vec(bootTop), 0.06, 0.016, frameAlong(shinAxis), this.options(REGION.shearling, 'body', 0.01, DETAIL.fleece, 1)));
    const heel = s.heel[side].clone().addScaledVector(sole, 0.045);
    const ball = s.ball[side].clone().addScaledVector(sole, 0.04);
    const toe = s.toe[side].clone().addScaledVector(sole, 0.035);
    this.add(new RoundCone(vec(heel), vec(ball), 0.05, 0.046, this.options(REGION.bootSuede, 'body', 0.025, DETAIL.suede)));
    this.add(new RoundCone(vec(ball), vec(toe), 0.046, 0.034, this.options(REGION.bootSuede, 'body', 0.015, DETAIL.suede)));
    const soleCentre = s.heel[side].clone().add(s.toe[side]).multiplyScalar(0.5).addScaledVector(sole, 0.008);
    this.add(new RoundBox(vec(soleCentre), [ANTHROPOMETRY.footLength * 0.6, 0.009, 0.05], 0.008, footFrame, this.options(REGION.blackRubber, 'body', 0.004, undefined, 1)));
  }

  private hand(side: Side): void {
    const s = this.skeleton;
    const part: MeshPart = side === 'left' ? 'leftHand' : 'rightHand';
    const frame = s.handFrame[side];
    const handFrame = Frame.fromMatrix(frame);
    const x = new THREE.Vector3().setFromMatrixColumn(frame, 0);
    const y = new THREE.Vector3().setFromMatrixColumn(frame, 1);
    const z = new THREE.Vector3().setFromMatrixColumn(frame, 2);
    const wrist = s.wrist[side];
    const forearm = wrist.clone().sub(s.elbow[side]).normalize();
    const glove = this.options(REGION.gloveLeather, part, 0.012, DETAIL.leather);
    // Gauntlet over the sleeve end.
    this.add(new RoundCone(vec(wrist.clone().addScaledVector(forearm, -0.085)), vec(wrist.clone().addScaledVector(x, 0.012)), 0.052, 0.04, this.options(REGION.gloveLeather, part, 0.01, DETAIL.leather)));
    this.add(new RoundBox(vec(wrist.clone().addScaledVector(x, 0.052).addScaledVector(y, -0.003)), [0.05, 0.017, 0.044], 0.015, handFrame, glove));

    // Thumb on the medial side: −z for the right hand (palm down, fingers forward), +z for the left.
    const thumbSide = side === 'right' ? -1 : 1;
    const curl = s.hand[side].curl;
    const fingers: { across: number; lengths: [number, number, number] }[] = [
      { across: 0.031, lengths: [0.044, 0.026, 0.02] },
      { across: 0.01, lengths: [0.048, 0.029, 0.021] },
      { across: -0.011, lengths: [0.045, 0.027, 0.02] },
      { across: -0.03, lengths: [0.036, 0.021, 0.018] },
    ];
    for (const finger of fingers) {
      let joint = wrist.clone().addScaledVector(x, 0.096).addScaledVector(z, thumbSide * finger.across).addScaledVector(y, -0.002);
      let direction = x.clone();
      const bends = [1.25, 1.55, 1.05];
      finger.lengths.forEach((length, index) => {
        // Curl rotates the finger about the knuckle line toward the palm (−y).
        direction = direction.applyAxisAngle(z, -bends[index] * curl).normalize();
        const next = joint.clone().addScaledVector(direction, length);
        const radius = 0.0118 - index * 0.0007;
        this.add(new RoundCone(vec(joint), vec(next), radius, radius - 0.0006, glove));
        joint = next;
      });
    }
    const thumbBase = wrist.clone().addScaledVector(x, 0.03).addScaledVector(z, thumbSide * 0.034).addScaledVector(y, -0.012);
    const open = x.clone().multiplyScalar(0.55).addScaledVector(z, thumbSide * 0.75).addScaledVector(y, -0.3).normalize();
    const closed = x.clone().multiplyScalar(0.8).addScaledVector(z, -thumbSide * 0.15).addScaledVector(y, -0.58).normalize();
    let thumbJoint = thumbBase;
    [0.042, 0.032, 0.027].forEach((length, index) => {
      const direction = open.clone().lerp(closed, THREE.MathUtils.clamp(curl * (0.5 + index * 0.35), 0, 1)).normalize();
      const next = thumbJoint.clone().addScaledVector(direction, length);
      this.add(new RoundCone(vec(thumbJoint), vec(next), 0.0135 - index * 0.0008, 0.0125 - index * 0.0008, glove));
      thumbJoint = next;
    });
  }

  private garmentDetails(): void {
    const { lumbar, chest, neck } = this.skeleton;
    const ub = this.upperBulk;
    const outfit = this.member.outfit;
    if (outfit.upper === 'b3') {
      // The B-3's deep shearling collar, standing at the back and rolled open at the throat, with lapels.
      this.add(new Torus(vec(at(neck, -0.02, -0.035, 0)), 0.1, 0.05, frameRotated(neck, new THREE.Euler(0, 0, -0.45)), this.options(REGION.shearling, 'body', 0.025, DETAIL.fleece, 1), 1.18));
      for (const side of [-1, 1]) {
        this.add(new Ellipsoid(vec(at(chest, 0.112 + ub, 0.1, side * 0.075)), [0.022, 0.085, 0.058], frameRotated(chest, new THREE.Euler(side * 0.35, 0, -0.15)), this.options(REGION.shearling, 'body', 0.02, DETAIL.fleece, 1)));
      }
      this.add(new Torus(vec(at(lumbar, -0.005, -0.035, 0)), 0.1 + ub, 0.022, frameOf(lumbar), this.options(REGION.sheepskinLeather, 'body', 0.012, DETAIL.leather), (0.15 + ub) / (0.1 + ub)));
    } else if (outfit.upper === 'a2') {
      // Shirt-style leather collar and knit waistband.
      for (const side of [-1, 1]) {
        this.add(new Ellipsoid(vec(at(neck, 0.035, -0.03, side * 0.05)), [0.012, 0.055, 0.045], frameRotated(neck, new THREE.Euler(side * 0.5, 0, -0.5)), this.options(REGION.horsehide, 'body', 0.012, DETAIL.leather, 1)));
      }
      this.add(new Torus(vec(at(lumbar, -0.005, -0.03, 0)), 0.1 + ub, 0.025, frameOf(lumbar), this.options(REGION.knit, 'body', 0.012, DETAIL.wool, 1), (0.145 + ub) / (0.1 + ub)));
    } else {
      this.add(new Torus(vec(at(neck, -0.005, -0.02, 0)), 0.062, 0.018, frameOf(neck), this.options(REGION.heatedSuit, 'body', 0.012, DETAIL.wool), 1.15));
    }
  }

  private head(): void {
    const { head } = this.skeleton;
    const frame = frameOf(head);
    const seed = this.member.faceSeed;
    const jitter = (index: number) => Math.sin(seed * 12.9898 + index * 78.233) * 0.5 + 0.5;
    const skin = (blend: number) => this.options(REGION.skin, 'head', blend);
    // Cranium, jaw and chin, cheekbones, brow, nose, ears.
    this.add(new Ellipsoid(vec(at(head, -0.008, 0.012, 0)), [0.097, 0.102, 0.077], frame, skin(0)));
    this.add(new Ellipsoid(vec(at(head, 0.035, -0.055, 0)), [0.068, 0.06, 0.056 + jitter(1) * 0.008], frame, skin(0.04)));
    this.add(new Ellipsoid(vec(at(head, 0.07, -0.088, 0)), [0.028, 0.026, 0.03], frame, skin(0.03)));
    for (const side of [-1, 1]) {
      this.add(new Ellipsoid(vec(at(head, 0.062, -0.012, side * 0.045)), [0.03, 0.022, 0.026], frame, skin(0.03)));
      this.add(new Ellipsoid(vec(at(head, -0.01, -0.005, side * 0.078)), [0.024, 0.032, 0.01], frame, skin(0.012)));
      // Eyes sit a few millimetres back in their sockets under the brow.
      this.add(new Ellipsoid(vec(at(head, 0.083, 0.017, side * 0.031)), [0.009, 0.0075, 0.012], frame, this.options(REGION.eye, 'head', 0.003, undefined, 2)));
    }
    this.add(new Ellipsoid(vec(at(head, 0.078, 0.032, 0)), [0.022, 0.013, 0.058], frame, skin(0.025)));
    const noseLength = 0.04 + jitter(2) * 0.012;
    this.add(new RoundCone(vec(at(head, 0.088, 0.018, 0)), vec(at(head, 0.088 + noseLength * 0.5, 0.018 - noseLength, 0)), 0.008, 0.012, skin(0.012)));

    const outfit = this.member.outfit;
    // A-11 intermediate helmet: leather over the crown and ears, open at the face, with earphone cups.
    const helmetLeather = this.options(REGION.helmetLeather, 'head', 0.008, DETAIL.leather);
    this.add(new Ellipsoid(vec(at(head, -0.01, 0.014, 0)), [0.106, 0.114, 0.088], frame, helmetLeather, { normal: [0.9, -0.43, 0], offset: 0.048 }));
    for (const side of [-1, 1]) {
      this.add(new Ellipsoid(vec(at(head, -0.008, -0.02, side * 0.088)), [0.04, 0.046, 0.022], frame, this.options(REGION.helmetLeather, 'head', 0.012, DETAIL.leather, 1)));
      if (!outfit.oxygenMask) {
        this.add(new RoundCone(vec(at(head, -0.005, -0.065, side * 0.082)), vec(at(head, 0.045, -0.12, side * 0.02)), 0.006, 0.006, this.options(REGION.webbing, 'head', 0.004, undefined, 2)));
      }
    }

    if (outfit.oxygenMask) {
      // A-14 mask over nose and mouth, its straps to the helmet, and the hose inlet below.
      this.add(new Ellipsoid(vec(at(head, 0.103, -0.048, 0)), [0.04, 0.054, 0.046], frame, this.options(REGION.maskRubber, 'head', 0.012, undefined, 2)));
      this.add(new RoundCone(vec(at(head, 0.13, -0.075, 0)), vec(at(head, 0.142, -0.105, 0)), 0.019, 0.017, this.options(REGION.maskRubber, 'head', 0.008, undefined, 2)));
      for (const side of [-1, 1]) {
        this.add(new RoundCone(vec(at(head, 0.095, -0.03, side * 0.04)), vec(at(head, 0.0, -0.005, side * 0.09)), 0.006, 0.006, this.options(REGION.maskRubber, 'head', 0.004, undefined, 2)));
      }
    }

    // B-8 goggles: down over the eyes, or pushed up on the helmet.
    const down = outfit.goggles === 'down';
    const goggleFrame = down ? frameRotated(head, new THREE.Euler(0, 0, -Math.PI / 2)) : frameRotated(head, new THREE.Euler(0, 0, -Math.PI / 2 + 1.0));
    for (const side of [-1, 1]) {
      const centre = down ? at(head, 0.092, 0.017, side * 0.033) : at(head, 0.065, 0.098, side * 0.033);
      this.add(new Torus(vec(centre), 0.021, 0.0065, goggleFrame, this.options(REGION.bakelite, 'head', 0.004, undefined, 3), 0.86));
      // The lens sits just proud of the rim, along the direction the goggles face (the rim frame's y).
      const lensCentre = centre.clone().addScaledVector(new THREE.Vector3(...goggleFrame.y), 0.004);
      this.add(new Ellipsoid(vec(lensCentre), [0.021, 0.004, 0.018], goggleFrame, this.options(REGION.lens, 'head', 0.002, undefined, 4)));
    }
    this.add(new Torus(vec(at(head, -0.01, down ? 0.02 : 0.06, 0)), 0.105, 0.006, down ? frame : frameRotated(head, new THREE.Euler(0, 0, -0.35)), this.options(REGION.webbing, 'head', 0.003, undefined, 2), 0.84));

    if (outfit.flakHelmet) {
      // M4 steel helmet: a deep dome sitting over the leather helmet, with hinged ear flaps.
      this.add(new Ellipsoid(vec(at(head, -0.012, 0.03, 0)), [0.13, 0.125, 0.112], frame, this.options(REGION.helmetSteel, 'head', 0.004, undefined, 2), { normal: [0.25, -1, 0], offset: 0.0 }));
      for (const side of [-1, 1]) {
        this.add(new RoundBox(vec(at(head, -0.015, -0.025, side * 0.106)), [0.038, 0.034, 0.005], 0.004, frameRotated(head, new THREE.Euler(side * 0.12, 0, 0)), this.options(REGION.helmetSteel, 'head', 0.003, undefined, 2)));
      }
    }
  }

  private gear(): void {
    const { chest, neck, pelvis } = this.skeleton;
    const outfit = this.member.outfit;
    const ub = this.upperBulk, lb = this.lowerBulk;
    const chestFrame = frameOf(chest);

    if (outfit.lifeVest) {
      // B-4: the yellow collar shows above the flak vest; the chest lobes sit under it.
      this.add(new Torus(vec(at(neck, -0.01, -0.02, 0)), 0.088, 0.03, frameRotated(neck, new THREE.Euler(0, 0, -0.3)), this.options(REGION.lifeVest, 'body', 0.015, DETAIL.canvas, 1), 1.2));
      for (const side of [-1, 1]) {
        this.add(new Ellipsoid(vec(at(chest, 0.112 + ub, 0.03, side * 0.075)), [0.04, 0.1, 0.07], chestFrame, this.options(REGION.lifeVest, 'body', 0.02, DETAIL.canvas, 1)));
      }
    }

    if (outfit.harness) {
      const webbing = this.options(REGION.webbing, 'body', 0.006, DETAIL.canvas, 2);
      for (const side of [-1, 1]) {
        const back = at(chest, -0.12 - ub, 0.1, side * 0.085);
        const top = at(chest, -0.01, 0.2 + ub * 0.6, side * 0.1);
        const front = at(chest, 0.125 + ub, 0.1, side * 0.09);
        const ring = at(chest, 0.132 + ub, -0.03, side * 0.095);
        this.add(new RoundCone(vec(back), vec(top), 0.013, 0.013, webbing));
        this.add(new RoundCone(vec(top), vec(front), 0.013, 0.013, webbing));
        this.add(new RoundCone(vec(front), vec(ring), 0.013, 0.013, webbing));
        this.add(new Torus(vec(ring), 0.018, 0.005, chestFrame, this.options(REGION.hardware, 'body', 0.002, undefined, 3)));
      }
      this.add(new RoundCone(vec(at(chest, 0.135 + ub, 0.0, -0.1)), vec(at(chest, 0.135 + ub, 0.0, 0.1)), 0.012, 0.012, webbing));
      // Leg straps round the tops of the thighs.
      for (const side of ['left', 'right'] as const) {
        const thighAxis = this.skeleton.knee[side].clone().sub(this.skeleton.hip[side]).normalize();
        const centre = this.skeleton.hip[side].clone().addScaledVector(thighAxis, 0.13);
        this.add(new Torus(vec(centre), 0.086 + lb, 0.011, frameAlong(thighAxis), webbing));
      }
    }

    if (outfit.flakVest) {
      // M1 flyer's vest: overlapping steel plates sewn into canvas, front and back, hung from the shoulders.
      const canvas = this.options(REGION.flakCanvas, 'body', 0.02, { amplitude: 0.003, frequency: 38 }, 1);
      this.add(new RoundBox(vec(at(chest, 0.142 + ub, -0.06, 0)), [0.024, 0.215, 0.165], 0.022, chestFrame, canvas));
      this.add(new RoundBox(vec(at(chest, -0.13 - ub, -0.04, 0)), [0.022, 0.22, 0.17], 0.022, chestFrame, canvas));
      for (const side of [-1, 1]) {
        this.add(new RoundCone(vec(at(chest, -0.09 - ub, 0.18, side * 0.1)), vec(at(chest, 0.11 + ub, 0.17, side * 0.1)), 0.026, 0.026, canvas));
      }
      // Quick-release cord and the red pull tab are too small at this scale; the front flap seam is not.
      this.add(new RoundBox(vec(at(chest, 0.168 + ub, 0.09, 0)), [0.004, 0.012, 0.12], 0.003, chestFrame, this.options(REGION.webbing, 'body', 0.003, undefined, 2)));
    }

    if (outfit.flakApron) {
      this.add(new RoundBox(vec(at(pelvis, 0.13 + lb, -0.14, 0)), [0.022, 0.17, 0.15], 0.02, frameOf(pelvis), this.options(REGION.flakCanvas, 'body', 0.015, { amplitude: 0.003, frequency: 38 }, 1)));
    }

    if (outfit.oxygenMask) this.oxygenHose();
  }

  /** Corrugated hose from the mask inlet, clipped to the chest, then down to the station's regulator. */
  private oxygenHose(): void {
    const { head, chest } = this.skeleton;
    const ub = this.upperBulk;
    const inlet = at(head, 0.142, -0.11, 0);
    const clip = at(chest, 0.16 + ub, 0.02, 0.07);
    const end = this.member.regulator ?? at(chest, 0.1 + ub, -0.25, 0.14);
    const sag = clip.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -0.12, 0));
    const curve = new THREE.CatmullRomCurve3([inlet, inlet.clone().lerp(clip, 0.5).add(new THREE.Vector3(0.03, -0.02, 0)), clip, sag, end]);
    const segments = Math.max(4, Math.ceil(curve.getLength() / 0.04));
    const points = curve.getSpacedPoints(segments);
    for (let index = 0; index < segments; index++) {
      const part: MeshPart = index < 2 ? 'head' : 'body';
      this.add(new RoundCone(vec(points[index]), vec(points[index + 1]), 0.012, 0.012, this.options(REGION.maskRubber, part, 0.006, { amplitude: 0.0025, frequency: 160 }, 2)));
    }
  }
}

interface Mesh { positions: number[]; normals: number[]; colors: number[]; surface: number[]; indices: number[] }

function appendSurface(target: Mesh, surface: SurfaceMesh): void {
  const base = target.positions.length / 3;
  for (let index = 0; index < surface.positions.length; index++) {
    target.positions.push(surface.positions[index]);
    target.normals.push(surface.normals[index]);
  }
  for (let vertex = 0; vertex < surface.regions.length; vertex++) {
    const look = regionLook(surface.regions[vertex]);
    const other = regionLook(surface.secondaryRegions[vertex]);
    const t = surface.regionMix[vertex];
    const color = look.color.lerp(other.color, t);
    target.colors.push(color.r, color.g, color.b);
    target.surface.push(THREE.MathUtils.lerp(look.roughness, other.roughness, t), THREE.MathUtils.lerp(look.metalness, other.metalness, t));
  }
  for (const index of surface.indices) target.indices.push(base + index);
}

/** The posed figure as primitives, before meshing: also what the fit audit tests against the hull. */
export function figurePrimitives(member: CrewMember): Primitive[] {
  const builder = new FigureBuilder(buildSkeleton(member.pose), member);
  builder.build();
  return builder.primitives;
}

/** A meshed figure as flat arrays: built in a worker, turned into geometry on the main thread. */
export interface FigureArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  surface: Float32Array;
  index: Uint32Array;
}

export function buildFigureArrays(member: CrewMember, detail: FigureDetail): FigureArrays {
  const primitives = figurePrimitives(member);
  const mesh: Mesh = { positions: [], normals: [], colors: [], surface: [], indices: [] };
  for (const part of ['body', 'head', 'leftHand', 'rightHand'] as const) {
    const field = new Field(primitives.filter((primitive) => primitive.part === part));
    if (field.primitives.length === 0) continue;
    appendSurface(mesh, meshField(field, field.bounds(), VOXEL[detail][part]));
  }
  return {
    position: new Float32Array(mesh.positions),
    normal: new Float32Array(mesh.normals),
    color: new Float32Array(mesh.colors),
    surface: new Float32Array(mesh.surface),
    index: new Uint32Array(mesh.indices),
  };
}

export function figureGeometry(arrays: FigureArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.color, 3));
  geometry.setAttribute('aSurface', new THREE.BufferAttribute(arrays.surface, 2));
  geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** One man's mesh; `geometry` may still be empty while his figure is meshed in a worker. */
export function figureMesh(member: CrewMember, detail: FigureDetail, geometry: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, crewMaterial());
  mesh.name = member.role;
  mesh.scale.setScalar(member.stature ?? 1);
  mesh.castShadow = detail === 'high';
  mesh.receiveShadow = true;
  return mesh;
}
