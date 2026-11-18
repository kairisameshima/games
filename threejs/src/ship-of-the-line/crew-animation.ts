import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CREW_COUNT, type CrewMember, type CrewRole } from "./types";
import {
  SAILOR_HAND_GRIP,
  sailorClothingGeometry, sailorFaceGeometry, sailorHairGeometry, sailorHandGeometry,
  sailorHatGeometry, sailorHeadGeometry, sailorLimbGeometry, sailorShoeGeometry,
  sailorPelvisGeometry, sailorTorsoGeometry, sailorUniformGeometry, type HatKind, type UniformKind,
} from "./crew-geometry";

export interface CrewAnimationState {
  time: number;
  crew: readonly CrewMember[];
}

export interface ArmPose {
  shoulder: THREE.Vector3;
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
  flexion: number;
}

export const MAX_ELBOW_FLEXION = 150 * Math.PI / 180;

const ROLE_COLORS: Record<CrewRole, number> = {
  gunner: 0xc8b398,
  topman: 0x749dad,
  marine: 0xb24736,
  carpenter: 0xc5a264,
  "powder runner": 0xa49ab3,
  officer: 0x243b55,
  sailor: 0xddd7b9,
};
const SKIN_TONES = [0xd7b594, 0xc29471, 0xaa7756, 0x8d5e43, 0x6a4533, 0xe0bda0] as const;
const HAIR_TONES = [0x30271e, 0x513b28, 0x846443, 0x945b37, 0xaaa394, 0x47423b] as const;
const TROUSER_TONES = [0x263943, 0x625446, 0xb4ac8e, 0x626b6a] as const;
const ROLE_HATS: Record<CrewRole, HatKind> = {
  gunner: "cap", topman: "cap", marine: "marine", carpenter: "round",
  "powder runner": "cap", officer: "officer", sailor: "round",
};
const BOOT = 0x241e1a;
const SELECTED_APPEARANCE_FLAG = 0x2000000;
const SELECTED_CLOTH_COLOR = new THREE.Color(0xf0ca67);
const SELECTION_TINT_WEIGHT = .82;

// Skeleton proportions in metres; a standing figure is roughly 1.8m, matching human scale.
const HIP_HEIGHT = 0.92;
const UPPER_LEG = 0.46;
const LOWER_LEG = 0.42;
const HIP_SPACING = 0.12;
const TORSO_HEIGHT = 0.56;
const SHOULDER_SPACING = 0.21;
const UPPER_ARM = 0.32;
const LOWER_ARM = 0.3;
const HAND_LENGTH = 0.13;
const HEAD_RADIUS = 0.135;
const ROD_SHAFT_LENGTH = 1.3;
const ROD_SHAFT_START = -.3;
const ROD_REAR_GRIP_Z = ROD_SHAFT_START + .035;
const ROD_FRONT_GRIP_Z = ROD_REAR_GRIP_Z + .2;
const ROD_GRIP_HEIGHT = TORSO_HEIGHT * .5;
const ROD_BASE_REACH = .25 - ROD_REAR_GRIP_Z;
const ROD_STROKE = .07;
const ROD_LEFT_CONTACT = new THREE.Vector3(0, 0, ROD_FRONT_GRIP_Z);
const ROD_RIGHT_CONTACT = new THREE.Vector3(0, 0, ROD_REAR_GRIP_Z);
const CHARGE_LEFT_CONTACT = new THREE.Vector3(-.16, -.055, -.055);
const CHARGE_RIGHT_CONTACT = new THREE.Vector3(.16, -.055, -.055);
const ROD_GRIP_TILT = 20 * Math.PI / 180;
const ROD_LEFT_HAND_ROTATION = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, -Math.PI / 2, Math.PI / 2, "ZXY"))
  .premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -ROD_GRIP_TILT, 0)));
const ROD_RIGHT_HAND_ROTATION = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, Math.PI / 2, -Math.PI / 2, "ZXY"))
  .premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ROD_GRIP_TILT, 0)));
const CHARGE_HAND_ROTATION = new THREE.Quaternion();
const ARM_REACH_MARGIN = .001;

// Gait is distance-driven: these are animation cycles per metre of actual travel, not per second,
// so a stalled or queued crew member never appears to slide or moonwalk in place.
const STRIDE_FREQUENCY = (Math.PI * 2) / 1.0;
const STAIR_FREQUENCY = (Math.PI * 2) / 0.62;
const CLIMB_STEP_DISTANCE = .5;
const CLIMB_GRIP_FRACTION = .7;
const CLIMB_HAND_HEIGHT = 2;
const CLIMB_GRIP_DEPTH = .55;
const CLIMB_RELEASE_DISTANCE = .08;
const TOOL_ELBOW_POLE = new THREE.Vector3(1, -.5, 0);
const CLIMB_ELBOW_POLE = new THREE.Vector3(.15, -1, 0);
const CLIMB_HAND_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
const YARD_FREQUENCY = (Math.PI * 2) / 0.8;

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const UNIFORM_CUFF_SCALE = new THREE.Vector3(.74, 1, .74);

function material(color: number, vertexColors = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, vertexColors, roughness: .85, metalness: .05 });
}

function hash(id: number): number {
  const s = Math.sin(id * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

type ToolKind = "none" | "musket" | "rammer" | "hammer" | "bucket" | "charge";

function selectTool(crew: CrewMember): ToolKind {
  if (crew.carrying) return "charge";
  if (crew.role === "marine") return "musket";
  if (crew.task === "sponge" || crew.task === "ram") return "rammer";
  if (crew.task === "repair hull") return "hammer";
  if (crew.task === "fight fire") return "bucket";
  return "none";
}

function musketGeometry(): THREE.BufferGeometry {
  const stock = new THREE.BoxGeometry(0.05, 0.07, 0.34).translate(0, -0.02, -0.1);
  const barrel = new THREE.CylinderGeometry(0.014, 0.016, 0.78, 6)
    .rotateX(Math.PI / 2)
    .translate(0, 0.01, 0.32);
  return mergeGeometries([stock, barrel]) as THREE.BufferGeometry;
}
function rammerGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.022, 0.022, ROD_SHAFT_LENGTH, 6)
    .rotateX(Math.PI / 2)
    .translate(0, 0, ROD_SHAFT_START + ROD_SHAFT_LENGTH / 2);
  const head = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10)
    .rotateX(Math.PI / 2)
    .translate(0, 0, 1);
  return mergeGeometries([shaft, head]) as THREE.BufferGeometry;
}
function hammerGeometry(): THREE.BufferGeometry {
  const handle = new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6).translate(0, -0.17, 0);
  const head = new THREE.BoxGeometry(0.2, 0.07, 0.07).translate(0, -0.34, 0);
  return mergeGeometries([handle, head]) as THREE.BufferGeometry;
}
function bucketGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.14, 0.11, 0.22, 10, 1, true).translate(0, -0.33, 0);
  const base = new THREE.CylinderGeometry(0.11, 0.11, 0.02, 10).translate(0, -0.43, 0);
  const handle = new THREE.TorusGeometry(0.13, 0.012, 4, 10, Math.PI)
    .rotateZ(Math.PI / 2)
    .translate(0, -0.2, 0);
  return mergeGeometries([body, base, handle]) as THREE.BufferGeometry;
}
function chargeGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.075, 0.075, 0.42, 10).rotateZ(Math.PI / 2);
}

interface LimbChain {
  hip: THREE.Object3D;
  mid: THREE.Object3D;
  end: THREE.Object3D;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  tip: THREE.Object3D;
}

function setElbowFlexion(arm: LimbChain, radians: number): void {
  // Bones point down -Y; forward elbow flexion is negative rotation about local X.
  arm.mid.rotation.set(-radians, 0, 0);
}

function makeChain(
  parent: THREE.Object3D,
  lateral: number,
  upperLen: number,
  lowerLen: number,
  tip: THREE.Vector3,
): LimbChain {
  const hip = new THREE.Object3D();
  hip.position.set(lateral, 0, 0);
  parent.add(hip);
  const upper = new THREE.Object3D();
  upper.position.set(0, -upperLen / 2, 0);
  hip.add(upper);
  const mid = new THREE.Object3D();
  mid.position.set(0, -upperLen, 0);
  hip.add(mid);
  const lower = new THREE.Object3D();
  lower.position.set(0, -lowerLen / 2, 0);
  mid.add(lower);
  const end = new THREE.Object3D();
  end.position.set(0, -lowerLen, 0);
  mid.add(end);
  const tipNode = new THREE.Object3D();
  tipNode.position.copy(tip);
  end.add(tipNode);
  return { hip, mid, end, upper, lower, tip: tipNode };
}

interface Rig {
  root: THREE.Object3D;
  torso: THREE.Object3D;
  torsoVisual: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  hat: THREE.Object3D;
  legL: LimbChain;
  legR: LimbChain;
  armL: LimbChain;
  armR: LimbChain;
  gripR: THREE.Object3D;
  gripTwo: THREE.Object3D;
}
function makeRig(): Rig {
  const root = new THREE.Object3D();
  const torso = new THREE.Object3D();
  root.add(torso);
  const torsoVisual = new THREE.Object3D();
  torsoVisual.position.set(0, TORSO_HEIGHT / 2, 0);
  torso.add(torsoVisual);
  const neck = new THREE.Object3D();
  neck.position.set(0, TORSO_HEIGHT, 0);
  torso.add(neck);
  const head = new THREE.Object3D();
  head.position.set(0, HEAD_RADIUS + 0.02, 0);
  neck.add(head);
  const hat = new THREE.Object3D();
  hat.position.set(0, HEAD_RADIUS * 2 + 0.03, 0);
  neck.add(hat);
  const legL = makeChain(root, -HIP_SPACING, UPPER_LEG, LOWER_LEG, new THREE.Vector3(0, -0.035, 0.09));
  const legR = makeChain(root, HIP_SPACING, UPPER_LEG, LOWER_LEG, new THREE.Vector3(0, -0.035, 0.09));
  const armL = makeChain(torso, -SHOULDER_SPACING, UPPER_ARM, LOWER_ARM, new THREE.Vector3(0, -HAND_LENGTH / 2, 0));
  const armR = makeChain(torso, SHOULDER_SPACING, UPPER_ARM, LOWER_ARM, new THREE.Vector3(0, -HAND_LENGTH / 2, 0));
  armL.hip.position.y = TORSO_HEIGHT * 0.94;
  armR.hip.position.y = TORSO_HEIGHT * 0.94;
  const gripR = new THREE.Object3D();
  gripR.position.set(0, -0.03, 0.05);
  armR.end.add(gripR);
  const gripTwo = new THREE.Object3D();
  gripTwo.position.set(0, TORSO_HEIGHT * 0.78, 0.3);
  torso.add(gripTwo);
  return { root, torso, torsoVisual, neck, head, hat, legL, legR, armL, armR, gripR, gripTwo };
}

export class CrewAnimator {
  readonly pickable: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly face: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly neck: THREE.InstancedMesh;
  private readonly pelvis: THREE.InstancedMesh;
  private readonly clothing: THREE.InstancedMesh;
  private readonly hats: Record<HatKind, THREE.InstancedMesh>;
  private readonly uniforms: Record<UniformKind, THREE.InstancedMesh>;
  private readonly upperArm: THREE.InstancedMesh;
  private readonly forearm: THREE.InstancedMesh;
  private readonly leftHand: THREE.InstancedMesh;
  private readonly rightHand: THREE.InstancedMesh;
  private readonly sleeveCuff: THREE.InstancedMesh;
  private readonly upperLeg: THREE.InstancedMesh;
  private readonly lowerLeg: THREE.InstancedMesh;
  private readonly foot: THREE.InstancedMesh;
  private readonly musket: THREE.InstancedMesh;
  private readonly rammer: THREE.InstancedMesh;
  private readonly hammer: THREE.InstancedMesh;
  private readonly bucket: THREE.InstancedMesh;
  private readonly charge: THREE.InstancedMesh;
  private readonly singleMeshes: THREE.InstancedMesh[];
  private readonly pairMeshes: THREE.InstancedMesh[];
  private readonly toolMeshes: Record<Exclude<ToolKind, "none">, THREE.InstancedMesh>;
  private readonly rig = makeRig();
  private readonly color = new THREE.Color();
  private readonly cuffMatrix = new THREE.Matrix4();
  private readonly upperJointMatrix = new THREE.Matrix4();
  private readonly lowerJointMatrix = new THREE.Matrix4();
  private readonly ikContact = new THREE.Vector3();
  private readonly ikWrist = new THREE.Vector3();
  private readonly ikDirection = new THREE.Vector3();
  private readonly ikPole = new THREE.Vector3();
  private readonly ikElbow = new THREE.Vector3();
  private readonly ikUpper = new THREE.Vector3();
  private readonly ikLower = new THREE.Vector3();
  private readonly ikAxisX = new THREE.Vector3();
  private readonly ikAxisY = new THREE.Vector3();
  private readonly ikAxisZ = new THREE.Vector3();
  private readonly ikBasis = new THREE.Matrix4();
  private readonly ikHandRotation = new THREE.Quaternion();
  private readonly climbTorsoInverse = new THREE.Quaternion();
  private readonly climbElbowPole = new THREE.Vector3();
  private readonly allMeshes: readonly THREE.InstancedMesh[];
  private readonly toolEntries: readonly [Exclude<ToolKind, "none">, THREE.InstancedMesh][];
  private readonly hatEntries: readonly [HatKind, THREE.InstancedMesh][];
  private readonly uniformEntries: readonly [UniformKind, THREE.InstancedMesh][];
  private readonly coloredMeshes: readonly THREE.InstancedMesh[];
  private readonly appearances: Int32Array;
  private colorsDirty = false;
  private selectedId: number | null = null;
  private readonly footPositions: Float64Array;
  private readonly swingStarts: Float64Array;
  private readonly swingTargets: Float64Array;
  private readonly footPhase: Float64Array;
  private lastTime = 0;
  private poseDelta = 0;

  constructor(parent: THREE.Object3D, count: number = CREW_COUNT) {
    this.appearances = new Int32Array(count).fill(-1);
    this.footPositions = new Float64Array(count * 6);
    this.swingStarts = new Float64Array(count * 6);
    this.swingTargets = new Float64Array(count * 6);
    this.footPhase = new Float64Array(count * 2).fill(-1);
    this.pickable = new THREE.InstancedMesh(sailorTorsoGeometry(TORSO_HEIGHT), material(0xffffff), count);
    this.pickable.name = `${count} individually simulated crew`;
    this.pickable.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 60);
    this.head = new THREE.InstancedMesh(sailorHeadGeometry(HEAD_RADIUS), material(0xffffff), count);
    this.face = new THREE.InstancedMesh(sailorFaceGeometry(HEAD_RADIUS), material(0xffffff, true), count);
    this.hair = new THREE.InstancedMesh(sailorHairGeometry(HEAD_RADIUS), material(0xffffff), count);
    this.neck = new THREE.InstancedMesh(new THREE.CylinderGeometry(.052, .057, .09, 10).translate(0, .035, 0), material(0xffffff), count);
    this.pelvis = new THREE.InstancedMesh(sailorPelvisGeometry(), material(0xffffff), count);
    this.clothing = new THREE.InstancedMesh(sailorClothingGeometry(TORSO_HEIGHT), material(0xffffff, true), count);
    this.hats = {
      cap: new THREE.InstancedMesh(sailorHatGeometry("cap"), material(0xffffff, true), count),
      round: new THREE.InstancedMesh(sailorHatGeometry("round"), material(0xffffff, true), count),
      officer: new THREE.InstancedMesh(sailorHatGeometry("officer"), material(0xffffff, true), count),
      marine: new THREE.InstancedMesh(sailorHatGeometry("marine"), material(0xffffff, true), count),
    };
    this.uniforms = {
      officer: new THREE.InstancedMesh(sailorUniformGeometry("officer", TORSO_HEIGHT), material(0xffffff, true), count),
      marine: new THREE.InstancedMesh(sailorUniformGeometry("marine", TORSO_HEIGHT), material(0xffffff, true), count),
      carpenter: new THREE.InstancedMesh(sailorUniformGeometry("carpenter", TORSO_HEIGHT), material(0xffffff, true), count),
    };
    this.hatEntries = Object.entries(this.hats) as [HatKind, THREE.InstancedMesh][];
    this.uniformEntries = Object.entries(this.uniforms) as [UniformKind, THREE.InstancedMesh][];
    for (const [kind, mesh] of this.hatEntries) {
      mesh.name = `${kind} crew hats`;
      (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      mesh.count = 0;
    }
    for (const [kind, mesh] of this.uniformEntries) {
      mesh.name = `${kind} uniform details`;
      mesh.count = 0;
    }
    this.upperLeg = new THREE.InstancedMesh(sailorLimbGeometry("thigh", UPPER_LEG), material(0xffffff), count * 2);
    this.lowerLeg = new THREE.InstancedMesh(sailorLimbGeometry("calf", LOWER_LEG), material(0xffffff), count * 2);
    this.foot = new THREE.InstancedMesh(sailorShoeGeometry(), material(BOOT), count * 2);
    this.upperArm = new THREE.InstancedMesh(sailorLimbGeometry("upper-arm", UPPER_ARM), material(0xffffff), count * 2);
    this.forearm = new THREE.InstancedMesh(sailorLimbGeometry("forearm", LOWER_ARM), material(0xffffff), count * 2);
    this.sleeveCuff = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .061, .035, 10)
      .translate(0, -UPPER_ARM / 2 + .018, 0), material(0xe0d8bc), count * 2);
    this.leftHand = new THREE.InstancedMesh(sailorHandGeometry(-1), material(0xffffff), count);
    this.rightHand = new THREE.InstancedMesh(sailorHandGeometry(1), material(0xffffff), count);
    this.leftHand.name = "crew left hand";
    this.rightHand.name = "crew right hand";
    this.musket = new THREE.InstancedMesh(musketGeometry(), material(0x3a2c1e), count);
    this.rammer = new THREE.InstancedMesh(rammerGeometry(), material(0x8a6a42), count);
    this.hammer = new THREE.InstancedMesh(hammerGeometry(), material(0x5a4530), count);
    this.bucket = new THREE.InstancedMesh(bucketGeometry(), material(0x6b5a3c), count);
    this.charge = new THREE.InstancedMesh(chargeGeometry(), material(0xc9b98a), count);
    this.singleMeshes = [this.pickable, this.head, this.face, this.hair, this.neck,
      this.pelvis, this.clothing, this.leftHand, this.rightHand];
    this.pairMeshes = [this.upperArm, this.forearm, this.sleeveCuff, this.upperLeg, this.lowerLeg, this.foot];
    this.coloredMeshes = [this.pickable, this.head, this.hair, this.neck, this.pelvis,
      this.leftHand, this.rightHand, this.upperArm, this.forearm, this.upperLeg, this.lowerLeg];
    this.toolMeshes = {
      musket: this.musket,
      rammer: this.rammer,
      hammer: this.hammer,
      bucket: this.bucket,
      charge: this.charge,
    };
    this.toolEntries = Object.entries(this.toolMeshes) as [Exclude<ToolKind, "none">, THREE.InstancedMesh][];
    for (const [kind, mesh] of this.toolEntries) mesh.name = `crew ${kind}`;
    this.allMeshes = [...this.singleMeshes, ...this.pairMeshes, ...this.toolEntries.map(([,mesh]) => mesh),
      ...this.hatEntries.map(([,mesh]) => mesh), ...this.uniformEntries.map(([,mesh]) => mesh)];
    for (const mesh of this.allMeshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
  }

  // Seeking invalidates world-space foot plants from the preceding playback position.
  resetPoseHistory(): void {
    this.footPhase.fill(-1);
    this.lastTime = 0;
  }

  // The rig is reused for every sailor, so diagnostics must read the rendered instances.
  readArmPose(crewId: number, side: "left" | "right", result: ArmPose): void {
    const index = crewId * 2 + (side === "left" ? 0 : 1);
    this.upperArm.getMatrixAt(index, this.upperJointMatrix);
    this.forearm.getMatrixAt(index, this.lowerJointMatrix);
    result.shoulder.set(0, UPPER_ARM / 2, 0).applyMatrix4(this.upperJointMatrix);
    result.elbow.set(0, -UPPER_ARM / 2, 0).applyMatrix4(this.upperJointMatrix);
    result.wrist.set(0, -LOWER_ARM / 2, 0).applyMatrix4(this.lowerJointMatrix);
    this.upperJointMatrix.invert().multiply(this.lowerJointMatrix);
    const relative = this.upperJointMatrix.elements;
    result.flexion = -Math.atan2(relative[6], relative[5]);
  }

  update(state: CrewAnimationState, ceiling: number, selectedId: number | null): void {
    this.selectedId = selectedId;
    this.poseDelta = Math.min(.1,Math.max(0,state.time-this.lastTime));
    this.lastTime = state.time;
    this.colorsDirty = false;
    for (const [,mesh] of this.hatEntries) mesh.count = 0;
    for (const [,mesh] of this.uniformEntries) mesh.count = 0;
    for (const crew of state.crew) {
      const visible = crew.health > 0 && crew.position.y < ceiling;
      if (!visible) {
        this.hideAll(crew.id);
        continue;
      }
      const tool = selectTool(crew);
      this.applyPose(crew, state, tool);
      this.rig.root.updateMatrixWorld(true);
      this.writeBody(crew);
      this.writeTool(crew.id, tool);
    }
    for (const mesh of this.allMeshes)
      mesh.instanceMatrix.needsUpdate = true;
    if (this.colorsDirty) for (const mesh of this.coloredMeshes)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private hideAll(id: number): void {
    for (const mesh of this.singleMeshes) mesh.setMatrixAt(id, HIDE);
    for (const mesh of this.pairMeshes) {
      mesh.setMatrixAt(id * 2, HIDE);
      mesh.setMatrixAt(id * 2 + 1, HIDE);
    }
    for (const [,mesh] of this.toolEntries) mesh.setMatrixAt(id,HIDE);
  }

  private writeAppearance(crew: CrewMember): void {
    const selected = crew.id === this.selectedId;
    const signature = ROLE_COLORS[crew.role] + (crew.health < 35 ? 0x1000000 : 0)
      + (selected ? SELECTED_APPEARANCE_FLAG : 0);
    if (this.appearances[crew.id] === signature) return;
    this.appearances[crew.id] = signature;
    this.colorsDirty = true;
    const dye = .91 + hash(crew.id * 2.171) * .15;
    this.color.setHex(ROLE_COLORS[crew.role]).multiplyScalar(dye * (crew.health < 35 ? .6 : 1));
    if (selected) this.color.lerp(SELECTED_CLOTH_COLOR, SELECTION_TINT_WEIGHT);
    this.pickable.setColorAt(crew.id, this.color);
    for (let side = 0; side < 2; side++) this.upperArm.setColorAt(crew.id * 2 + side, this.color);
    if (crew.role === "officer" || crew.role === "marine") {
      for (let side = 0; side < 2; side++) this.forearm.setColorAt(crew.id * 2 + side, this.color);
    }
    this.color.setHex(SKIN_TONES[Math.floor(hash(crew.id * 1.731 + .17) * SKIN_TONES.length)]);
    this.head.setColorAt(crew.id, this.color);
    this.neck.setColorAt(crew.id, this.color);
    this.leftHand.setColorAt(crew.id, this.color);
    this.rightHand.setColorAt(crew.id, this.color);
    if (crew.role !== "officer" && crew.role !== "marine") {
      for (let side = 0; side < 2; side++) this.forearm.setColorAt(crew.id * 2 + side, this.color);
    }
    this.color.setHex(HAIR_TONES[Math.floor(hash(crew.id * 4.113 + .83) * HAIR_TONES.length)]);
    this.hair.setColorAt(crew.id, this.color);
    const trousers = crew.role === "officer" || crew.role === "marine" ? 0xc7bfa7
      : TROUSER_TONES[Math.floor(hash(crew.id * 3.17 + .4) * TROUSER_TONES.length)];
    this.color.setHex(trousers);
    this.pelvis.setColorAt(crew.id, this.color);
    for (let side = 0; side < 2; side++) {
      this.upperLeg.setColorAt(crew.id * 2 + side, this.color);
      this.lowerLeg.setColorAt(crew.id * 2 + side, this.color);
    }
  }

  private writeBody(crew: CrewMember): void {
    const rig = this.rig;
    this.pickable.setMatrixAt(crew.id, rig.torsoVisual.matrixWorld);
    this.writeAppearance(crew);
    this.head.setMatrixAt(crew.id, rig.head.matrixWorld);
    this.face.setMatrixAt(crew.id, rig.head.matrixWorld);
    this.hair.setMatrixAt(crew.id, rig.head.matrixWorld);
    this.neck.setMatrixAt(crew.id, rig.neck.matrixWorld);
    this.pelvis.setMatrixAt(crew.id, rig.root.matrixWorld);
    this.clothing.setMatrixAt(crew.id, rig.torsoVisual.matrixWorld);
    const hat = this.hats[ROLE_HATS[crew.role]];
    hat.setMatrixAt(hat.count++, rig.hat.matrixWorld);
    if (crew.role === "officer" || crew.role === "marine" || crew.role === "carpenter") {
      const uniform = this.uniforms[crew.role];
      uniform.setMatrixAt(uniform.count++, rig.torsoVisual.matrixWorld);
    }
    this.upperArm.setMatrixAt(crew.id * 2, rig.armL.upper.matrixWorld);
    this.upperArm.setMatrixAt(crew.id * 2 + 1, rig.armR.upper.matrixWorld);
    this.forearm.setMatrixAt(crew.id * 2, rig.armL.lower.matrixWorld);
    this.forearm.setMatrixAt(crew.id * 2 + 1, rig.armR.lower.matrixWorld);
    this.leftHand.setMatrixAt(crew.id, rig.armL.tip.matrixWorld);
    this.rightHand.setMatrixAt(crew.id, rig.armR.tip.matrixWorld);
    if (crew.role === "officer" || crew.role === "marine") {
      this.cuffMatrix.copy(rig.armL.lower.matrixWorld).scale(UNIFORM_CUFF_SCALE);
      this.sleeveCuff.setMatrixAt(crew.id * 2, this.cuffMatrix);
      this.cuffMatrix.copy(rig.armR.lower.matrixWorld).scale(UNIFORM_CUFF_SCALE);
      this.sleeveCuff.setMatrixAt(crew.id * 2 + 1, this.cuffMatrix);
    } else {
      this.sleeveCuff.setMatrixAt(crew.id * 2, rig.armL.upper.matrixWorld);
      this.sleeveCuff.setMatrixAt(crew.id * 2 + 1, rig.armR.upper.matrixWorld);
    }
    this.upperLeg.setMatrixAt(crew.id * 2, rig.legL.upper.matrixWorld);
    this.upperLeg.setMatrixAt(crew.id * 2 + 1, rig.legR.upper.matrixWorld);
    this.lowerLeg.setMatrixAt(crew.id * 2, rig.legL.lower.matrixWorld);
    this.lowerLeg.setMatrixAt(crew.id * 2 + 1, rig.legR.lower.matrixWorld);
    this.foot.setMatrixAt(crew.id * 2, rig.legL.tip.matrixWorld);
    this.foot.setMatrixAt(crew.id * 2 + 1, rig.legR.tip.matrixWorld);
  }

  private writeTool(id: number, tool: ToolKind): void {
    for (const [kind, mesh] of this.toolEntries)
      mesh.setMatrixAt(
        id,
        kind === tool ? (kind === "rammer" || kind === "charge" ? this.rig.gripTwo : this.rig.gripR).matrixWorld : HIDE,
      );
  }

  private plantFeet(crew: CrewMember, phase: number, frequency: number, speedBlend: number): void {
    const walking = crew.locomotion === "walk";
    const stride = Math.PI * 2 / (STRIDE_FREQUENCY * frequency);
    const sine = Math.sin(crew.heading), cosine = Math.cos(crew.heading);
    const lead = Math.min(.36,stride*.32);
    const ground = crew.position.y+.03;
    for(let side=0;side<2;side++) {
      const foot=crew.id*2+side,offset=foot*3,lateral=side===0?-HIP_SPACING:HIP_SPACING;
      const cycle=crew.gait/stride+phase/(Math.PI*2)+side*.5;
      const fraction=cycle-Math.floor(cycle),previous=this.footPhase[foot];
      const reset=previous<0||Math.hypot(this.footPositions[offset]-crew.position.x,this.footPositions[offset+2]-crew.position.z)>1.35;
      if(reset) {
        const along=walking?(fraction<.55?lead-fraction*stride:-.34):0;
        this.footPositions[offset]=crew.position.x+cosine*lateral+sine*along;
        this.footPositions[offset+1]=ground;
        this.footPositions[offset+2]=crew.position.z-sine*lateral+cosine*along;
        this.swingTargets[offset]=this.footPositions[offset];
        this.swingTargets[offset+1]=ground;
        this.swingTargets[offset+2]=this.footPositions[offset+2];
      }
      if(walking&&fraction<.55) {
        if(!reset&&(previous>=.55||fraction<previous-.5)) {
          this.footPositions[offset]=this.swingTargets[offset];
          this.footPositions[offset+2]=this.swingTargets[offset+2];
        }
        this.footPositions[offset+1]=ground;
      } else if(walking) {
        if(reset||previous<.55) {
          this.swingStarts[offset]=this.footPositions[offset];
          this.swingStarts[offset+1]=ground;
          this.swingStarts[offset+2]=this.footPositions[offset+2];
        }
        const along=lead+(1-fraction)*stride;
        this.swingTargets[offset]=crew.position.x+cosine*lateral+sine*along;
        this.swingTargets[offset+1]=ground;
        this.swingTargets[offset+2]=crew.position.z-sine*lateral+cosine*along;
        const t=(fraction-.55)/.45,eased=t*t*(3-2*t);
        this.footPositions[offset]=this.swingStarts[offset]+(this.swingTargets[offset]-this.swingStarts[offset])*eased;
        this.footPositions[offset+1]=ground+Math.sin(t*Math.PI)*(.08+.055*speedBlend);
        this.footPositions[offset+2]=this.swingStarts[offset+2]+(this.swingTargets[offset+2]-this.swingStarts[offset+2])*eased;
      } else {
        this.footPositions[offset+1]+=(ground-this.footPositions[offset+1])*Math.min(1,this.poseDelta*15);
      }
      this.footPhase[foot]=fraction;
      this.solveFoot(side===0?this.rig.legL:this.rig.legR,this.footPositions[offset],this.footPositions[offset+1],this.footPositions[offset+2],lateral);
    }
  }

  private solveFoot(leg: LimbChain, x: number, y: number, z: number, lateral: number): void {
    const root=this.rig.root;
    const sine=Math.sin(root.rotation.y),cosine=Math.cos(root.rotation.y),roll=root.rotation.z;
    const dx=x-root.position.x,dz=z-root.position.z,dy=y+.035-root.position.y;
    const flatX=dx*cosine-dz*sine;
    const targetX=flatX*Math.cos(roll)+dy*Math.sin(roll)-lateral;
    const targetY=-flatX*Math.sin(roll)+dy*Math.cos(roll);
    const targetZ=dx*sine+dz*cosine-.09;
    const length=Math.min(UPPER_LEG+LOWER_LEG-.001,Math.max(.08,Math.hypot(targetX,targetY,targetZ)));
    const hipAngle=Math.acos(Math.max(-1,Math.min(1,(UPPER_LEG*UPPER_LEG+length*length-LOWER_LEG*LOWER_LEG)/(2*UPPER_LEG*length))));
    const kneeAngle=Math.PI-Math.acos(Math.max(-1,Math.min(1,(UPPER_LEG*UPPER_LEG+LOWER_LEG*LOWER_LEG-length*length)/(2*UPPER_LEG*LOWER_LEG))));
    leg.hip.rotation.set(Math.atan2(-targetZ,Math.hypot(targetX,targetY))-hipAngle,0,Math.atan2(targetX,-targetY),"ZYX");
    leg.mid.rotation.set(kneeAngle,0,0);
    leg.end.quaternion.copy(leg.hip.quaternion).multiply(leg.mid.quaternion).invert();
  }

  private gripWithHand(arm: LimbChain, contact: THREE.Vector3, handRotation: THREE.Quaternion, pole: THREE.Vector3 = TOOL_ELBOW_POLE): void {
    this.ikWrist.copy(arm.tip.position).add(SAILOR_HAND_GRIP)
      .applyQuaternion(handRotation).negate().add(contact);
    this.ikDirection.subVectors(this.ikWrist, arm.hip.position);
    const distance = THREE.MathUtils.clamp(this.ikDirection.length(),
      Math.abs(UPPER_ARM - LOWER_ARM) + ARM_REACH_MARGIN, UPPER_ARM + LOWER_ARM - ARM_REACH_MARGIN);
    this.ikDirection.normalize();
    this.ikWrist.copy(arm.hip.position).addScaledVector(this.ikDirection, distance);
    const along = (UPPER_ARM * UPPER_ARM - LOWER_ARM * LOWER_ARM + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));

    // Choose the elbow's bend plane explicitly instead of folding through the chest.
    this.ikPole.copy(pole);
    this.ikPole.x *= arm.hip.position.x < 0 ? -1 : 1;
    this.ikPole.addScaledVector(this.ikDirection, -this.ikPole.dot(this.ikDirection)).normalize();
    this.ikElbow.copy(arm.hip.position).addScaledVector(this.ikDirection, along).addScaledVector(this.ikPole, bend);
    this.ikUpper.subVectors(this.ikElbow, arm.hip.position).normalize();
    this.ikLower.subVectors(this.ikWrist, this.ikElbow).normalize();
    this.ikAxisY.copy(this.ikUpper).negate();
    this.ikAxisZ.copy(this.ikLower).addScaledVector(this.ikUpper, -this.ikUpper.dot(this.ikLower)).normalize();
    this.ikAxisX.crossVectors(this.ikAxisY, this.ikAxisZ).normalize();
    this.ikAxisZ.crossVectors(this.ikAxisX, this.ikAxisY).normalize();
    this.ikBasis.makeBasis(this.ikAxisX, this.ikAxisY, this.ikAxisZ);
    arm.hip.quaternion.setFromRotationMatrix(this.ikBasis);
    setElbowFlexion(arm, Math.acos(THREE.MathUtils.clamp(this.ikUpper.dot(this.ikLower), -1, 1)));
    arm.end.quaternion.copy(arm.hip.quaternion).multiply(arm.mid.quaternion).invert().multiply(handRotation);
  }

  private poseClimbingArm(arm: LimbChain, cycle: number, stride: number, descending: boolean): void {
    const low = CLIMB_HAND_HEIGHT - stride * CLIMB_GRIP_FRACTION;
    const direction = descending ? 1 : -1;
    let height = descending ? low + stride * cycle : CLIMB_HAND_HEIGHT - stride * cycle;
    let depth = CLIMB_GRIP_DEPTH;
    if (cycle > CLIMB_GRIP_FRACTION) {
      const recovery = (cycle - CLIMB_GRIP_FRACTION) / (1 - CLIMB_GRIP_FRACTION);
      const start = descending ? CLIMB_HAND_HEIGHT : low;
      const end = descending ? low : CLIMB_HAND_HEIGHT;
      const tangent = direction * stride * (1 - CLIMB_GRIP_FRACTION);
      height = start + (end - start) * recovery * recovery * (3 - 2 * recovery)
        + tangent * recovery * (1 - recovery) * (1 - 2 * recovery);
      depth -= Math.sin(recovery * Math.PI) * CLIMB_RELEASE_DISTANCE;
    }
    // Vertical travel keeps the supporting hand at a fixed height even on a sloping shroud.
    this.ikContact.set(arm.hip.position.x, height - HIP_HEIGHT, depth).applyQuaternion(this.climbTorsoInverse);
    this.gripWithHand(arm, this.ikContact, this.ikHandRotation, this.climbElbowPole);
  }

  private applyPose(crew: CrewMember, state: CrewAnimationState, tool: ToolKind): void {
    const rig = this.rig;
    const phase = hash(crew.id) * Math.PI * 2;
    const freq = 0.85 + hash(crew.id * 7.13) * 0.3;
    const injured = crew.health > 0 && crew.health < 40;
    const weakLeft = crew.id % 2 === 0;
    const speedBlend = Math.min(1, crew.speed / 1.6);
    const rod = tool === "rammer";

    // IK uses ZYX; restore the authored pose order before reusing the rig for another sailor.
    rig.legL.hip.rotation.set(0, 0, 0, "XYZ");
    rig.legR.hip.rotation.set(0, 0, 0, "XYZ");
    rig.legL.mid.rotation.set(0, 0, 0);
    rig.legR.mid.rotation.set(0, 0, 0);
    rig.legL.end.rotation.set(0, 0, 0);
    rig.legR.end.rotation.set(0, 0, 0);
    rig.armL.hip.rotation.set(0, 0, 0, "XYZ");
    rig.armR.hip.rotation.set(0, 0, 0, "XYZ");
    rig.armL.mid.rotation.set(0, 0, 0);
    rig.armR.mid.rotation.set(0, 0, 0);
    rig.armL.end.rotation.set(0,0,0);
    rig.armR.end.rotation.set(0,0,0);
    rig.torso.rotation.set(0, 0, 0);
    rig.neck.rotation.set(0, 0, 0);
    rig.gripR.rotation.set(0, 0, 0);
    rig.gripTwo.rotation.set(0, 0, 0);
    rig.gripTwo.position.set(0, rod ? ROD_GRIP_HEIGHT : TORSO_HEIGHT * .78, rod ? ROD_BASE_REACH : .3);
    let crouch = 0,
      sit = 0,
      bob = 0,
      rootRoll = 0;

    switch (crew.locomotion) {
      case "walk": {
        const gaitPhase = crew.gait * STRIDE_FREQUENCY * freq + phase;
        const swing = Math.sin(gaitPhase);
        const amp = (0.45 + speedBlend * 0.4) * (injured ? 0.7 : 1);
        rig.legL.hip.rotation.x = swing * amp * (injured && weakLeft ? 0.55 : 1);
        rig.legR.hip.rotation.x = -swing * amp * (injured && !weakLeft ? 0.55 : 1);
        rig.legL.mid.rotation.x = Math.max(0, swing) * 0.95 + 0.08;
        rig.legR.mid.rotation.x = Math.max(0, -swing) * 0.95 + 0.08;
        rig.legL.end.rotation.x = -swing * 0.3;
        rig.legR.end.rotation.x = swing * 0.3;
        rig.armL.hip.rotation.x = -swing * amp * 0.55;
        rig.armR.hip.rotation.x = swing * amp * 0.55;
        setElbowFlexion(rig.armL, 0.22);
        setElbowFlexion(rig.armR, 0.22);
        bob = Math.abs(swing) * 0.045 * speedBlend;
        rootRoll = Math.sin(gaitPhase) * 0.035 * speedBlend;
        crouch = .38;
        if (injured) rig.torso.rotation.x = 0.12;
        break;
      }
      case "stairs": {
        const stepPhase = crew.gait * STAIR_FREQUENCY * freq + phase;
        const swing = Math.sin(stepPhase);
        const rising = crew.velocity.y >= 0;
        rig.torso.rotation.x = rising ? 0.45 : 0.3;
        rig.legL.hip.rotation.x = swing > 0 ? -swing * 1.35 : -swing * .25;
        rig.legR.hip.rotation.x = swing < 0 ? swing * 1.35 : swing * .25;
        rig.legL.mid.rotation.x = Math.max(0.25, swing * 1.5);
        rig.legR.mid.rotation.x = Math.max(0.25, -swing * 1.5);
        rig.armL.hip.rotation.x = -0.9 + swing * 0.25;
        rig.armR.hip.rotation.x = -0.9 - swing * 0.25;
        setElbowFlexion(rig.armL, 1.1);
        setElbowFlexion(rig.armR, 1.1);
        bob = Math.abs(swing) * 0.03;
        break;
      }
      case "climb": {
        const stride = CLIMB_STEP_DISTANCE / freq;
        const descending = crew.velocity.y < 0;
        const cycle = (descending ? -crew.position.y : crew.position.y) / stride + phase / (Math.PI * 2);
        const swing = Math.sin(cycle * Math.PI * 2) * (descending ? -1 : 1);
        rig.torso.rotation.x = .55;
        rig.legL.hip.rotation.x = -.75 - swing * .5;
        rig.legR.hip.rotation.x = -.75 + swing * .5;
        rig.legL.mid.rotation.x = 1.1;
        rig.legR.mid.rotation.x = 1.1;
        this.climbTorsoInverse.copy(rig.torso.quaternion).invert();
        // Keep elbows below and in front of the reach, independently of torso lean.
        this.climbElbowPole.copy(CLIMB_ELBOW_POLE).applyQuaternion(this.climbTorsoInverse);
        this.ikHandRotation.copy(this.climbTorsoInverse).multiply(CLIMB_HAND_ROTATION);
        this.poseClimbingArm(rig.armL, cycle - Math.floor(cycle), stride, descending);
        const rightCycle = cycle + .5;
        this.poseClimbingArm(rig.armR, rightCycle - Math.floor(rightCycle), stride, descending);
        break;
      }
      case "yard": {
        const yardPhase = crew.gait * YARD_FREQUENCY * freq + phase;
        const shuffle = Math.sin(yardPhase);
        crouch = 0.55;
        rig.torso.rotation.x = 0.3;
        rig.legL.hip.rotation.x = shuffle * 0.3;
        rig.legR.hip.rotation.x = -shuffle * 0.3;
        rig.legL.mid.rotation.x = 0.55;
        rig.legR.mid.rotation.x = 0.55;
        rig.armL.hip.rotation.z = -1.15;
        rig.armR.hip.rotation.z = 1.15;
        setElbowFlexion(rig.armL, 0.35);
        setElbowFlexion(rig.armR, 0.35);
        bob = Math.sin(yardPhase * 2) * 0.02;
        break;
      }
      case "wait": {
        const kind=crew.route[crew.routeIndex]?.kind;
        if(kind==="climb"||kind==="yard") {
          rig.torso.rotation.x = .55;
          rig.armL.hip.rotation.x = -2.2; rig.armR.hip.rotation.x = -2.2;
          setElbowFlexion(rig.armL, .6); setElbowFlexion(rig.armR, .6);
          rig.legL.hip.rotation.x = -.65; rig.legR.hip.rotation.x = -.65;
          rig.legL.mid.rotation.x = 1; rig.legR.mid.rotation.x = 1;
        } else {
          setElbowFlexion(rig.armL, .18);setElbowFlexion(rig.armR, .18);
          crouch=.16;
        }
        break;
      }
      default: {
        bob = crew.task === "off watch" ? 0 : Math.sin(state.time * 1.1 + phase) * 0.012;
        switch (crew.task) {
          case "off watch": {
            const seated = crew.id % 2 === 0;
            if (seated) {
              sit = 1;
              rig.legL.hip.rotation.x = -1.45;
              rig.legR.hip.rotation.x = -1.45;
              rig.legL.mid.rotation.x = 1.5;
              rig.legR.mid.rotation.x = 1.5;
              rig.legL.end.rotation.x = -.05;
              rig.legR.end.rotation.x = -.05;
              rig.torso.rotation.x = -0.12;
              rig.armL.hip.rotation.x = 0.3;
              rig.armR.hip.rotation.x = 0.3;
              setElbowFlexion(rig.armL, 1.1);
              setElbowFlexion(rig.armR, 1.1);
            } else {
              rig.torso.rotation.x = 0.18;
              rig.armL.hip.rotation.z = -0.1;
              rig.armR.hip.rotation.z = 0.1;
              setElbowFlexion(rig.armL, 0.5);
              setElbowFlexion(rig.armR, 0.5);
              rig.neck.rotation.x = 0.25;
            }
            break;
          }
          case "run out": {
            const t = Math.sin(state.time * 1.6 + phase);
            crouch = 0.25;
            rig.torso.rotation.x = 0.35 + t * 0.1;
            rig.armL.hip.rotation.x = -0.6 + t * 0.3;
            rig.armR.hip.rotation.x = -0.6 + t * 0.3;
            setElbowFlexion(rig.armL, 0.5);
            setElbowFlexion(rig.armR, 0.5);
            break;
          }
          case "sponge":
          case "ram": {
            const t = Math.sin(state.time * (crew.task === "ram" ? 1.8 : 1.3) + phase);
            crouch = 0.2;
            rig.torso.rotation.x = 0.3 + Math.max(0, t) * 0.15;
            rig.gripTwo.position.set(0, ROD_GRIP_HEIGHT, ROD_BASE_REACH + t * ROD_STROKE);
            break;
          }
          case "load": {
            const t = (Math.sin(state.time * 1.1 + phase) + 1) / 2;
            crouch = 0.3 + t * 0.25;
            rig.torso.rotation.x = 0.5 - t * 0.35;
            rig.armL.hip.rotation.x = -0.5 - t * 0.3;
            rig.armR.hip.rotation.x = -0.5 - t * 0.3;
            setElbowFlexion(rig.armL, 1.1 - t * 0.5);
            setElbowFlexion(rig.armR, 1.1 - t * 0.5);
            break;
          }
          case "aim": {
            crouch = 0.25;
            rig.torso.rotation.x = 0.3;
            rig.neck.rotation.x = 0.2;
            rig.armR.hip.rotation.x = -0.75;
            setElbowFlexion(rig.armR, 0.6);
            rig.armL.hip.rotation.x = -0.3;
            setElbowFlexion(rig.armL, 1);
            break;
          }
          case "ready": {
            crouch = 0.12;
            rig.neck.rotation.y = Math.sin(state.time * 0.3 + phase) * 0.4;
            rig.armL.hip.rotation.z = -0.08;
            rig.armR.hip.rotation.z = 0.08;
            break;
          }
          case "haul braces": {
            const t = Math.sin(state.time * 1.4 + phase);
            rig.armL.hip.rotation.z = -1.05;
            rig.armR.hip.rotation.z = 1.05;
            rig.armL.hip.rotation.x = -0.5 + t * 0.6;
            rig.armR.hip.rotation.x = -0.5 + t * 0.6;
            setElbowFlexion(rig.armL, 0.35);
            setElbowFlexion(rig.armR, 0.35);
            rig.torso.rotation.x = -t * 0.18;
            break;
          }
          case "aloft": {
            const t = Math.sin(state.time * 1.5 + phase);
            crouch = 0.3;
            rig.armL.hip.rotation.x = -1.4 + t * 0.3;
            rig.armR.hip.rotation.x = -1.4 - t * 0.3;
            rig.armL.hip.rotation.z = -0.3;
            rig.armR.hip.rotation.z = 0.3;
            setElbowFlexion(rig.armL, 0.5);
            setElbowFlexion(rig.armR, 0.5);
            break;
          }
          case "repair hull": {
            const t = Math.max(0, Math.sin(state.time * 2.1 + phase));
            crouch = 0.3;
            rig.torso.rotation.x = 0.35;
            rig.armR.hip.rotation.x = -1.3 + t * 1.5;
            setElbowFlexion(rig.armR, 0.3 + t * 0.5);
            rig.armL.hip.rotation.x = -0.4;
            setElbowFlexion(rig.armL, 0.8);
            rig.gripR.rotation.x = -t * 0.6;
            break;
          }
          case "pump": {
            const t = Math.sin(state.time * 1.7 + phase);
            crouch = 0.3 + Math.abs(t) * 0.1;
            rig.armL.hip.rotation.x = -0.9 + t * 0.6;
            rig.armR.hip.rotation.x = -0.9 + t * 0.6;
            setElbowFlexion(rig.armL, 0.4);
            setElbowFlexion(rig.armR, 0.4);
            rig.torso.rotation.x = 0.25 - t * 0.1;
            break;
          }
          case "fight fire": {
            const t = Math.sin(state.time * 1.3 + phase);
            const throwPulse = Math.pow(Math.max(0, Math.sin(state.time * 0.45 + phase)), 8);
            rig.armR.hip.rotation.x = -0.6 + t * 0.4 - throwPulse * 0.9;
            setElbowFlexion(rig.armR, 0.9 - throwPulse * 0.5);
            rig.armL.hip.rotation.x = -0.2;
            setElbowFlexion(rig.armL, 0.4);
            rig.torso.rotation.x = throwPulse * 0.3;
            break;
          }
          case "steer": {
            rig.armL.hip.rotation.x = -0.95;
            rig.armR.hip.rotation.x = -0.95;
            rig.armL.hip.rotation.z = -0.2;
            rig.armR.hip.rotation.z = 0.2;
            setElbowFlexion(rig.armL, 0.55);
            setElbowFlexion(rig.armR, 0.55);
            rig.neck.rotation.y = Math.sin(state.time * 0.25 + phase) * 0.3;
            rootRoll = Math.sin(state.time * 0.4 + phase) * 0.03;
            break;
          }
          case "tend wounded": {
            crouch = 0.55;
            rig.torso.rotation.x = 0.55;
            rig.armL.hip.rotation.x = -0.5;
            rig.armR.hip.rotation.x = -0.5;
            setElbowFlexion(rig.armL, 0.6);
            setElbowFlexion(rig.armR, 0.6);
            break;
          }
          default:
            break;
        }
        break;
      }
    }

    if (tool === "charge" || tool === "rammer") {
      this.ikContact.copy(rod ? ROD_LEFT_CONTACT : CHARGE_LEFT_CONTACT)
        .applyQuaternion(rig.gripTwo.quaternion).add(rig.gripTwo.position);
      this.ikHandRotation.copy(rig.gripTwo.quaternion).multiply(rod ? ROD_LEFT_HAND_ROTATION : CHARGE_HAND_ROTATION);
      this.gripWithHand(rig.armL, this.ikContact, this.ikHandRotation);
      this.ikContact.copy(rod ? ROD_RIGHT_CONTACT : CHARGE_RIGHT_CONTACT)
        .applyQuaternion(rig.gripTwo.quaternion).add(rig.gripTwo.position);
      this.ikHandRotation.copy(rig.gripTwo.quaternion).multiply(rod ? ROD_RIGHT_HAND_ROTATION : CHARGE_HAND_ROTATION);
      this.gripWithHand(rig.armR, this.ikContact, this.ikHandRotation);
    }
    if (tool === "musket" && crew.task !== "aim" && crew.task !== "ready") {
      rig.gripR.rotation.x = -0.3;
      rig.gripR.rotation.z = 0.5;
    }

    rig.root.position.set(
      crew.position.x,
      crew.position.y + HIP_HEIGHT - crouch * 0.22 - sit * 0.38 + bob,
      crew.position.z,
    );
    rig.root.rotation.set(0, crew.heading, rootRoll);
    const passage=crew.route[crew.routeIndex]?.kind;
    const grounded=crew.position.y<11&&(crew.locomotion==="walk"||(crew.locomotion==="idle"&&crew.task!=="off watch")||(crew.locomotion==="wait"&&passage!=="climb"&&passage!=="stairs"&&passage!=="yard"));
    if(grounded) this.plantFeet(crew,phase,freq,speedBlend);
    else { this.footPhase[crew.id*2]=-1;this.footPhase[crew.id*2+1]=-1; }
  }
}
