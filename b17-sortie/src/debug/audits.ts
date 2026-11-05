import * as THREE from 'three';
import type { B17 } from '../scene/b17';
import { ANTHROPOMETRY, buildSkeleton, type Side } from '../scene/crew/skeleton';
import { HULL_EXPONENT, hullSectionAt, toX } from '../scene/hull';
import { interiorMaterials } from '../scene/interior/materials';

export interface CrewAudit {
  role: string;
  /** How far each wrist and ankle is from where its grip or foothold puts it, centimetres. */
  reachCm: Record<'left' | 'right' | 'leftFoot' | 'rightFoot', number>;
  /** Vertices of the man more than `CREW_SKIN_TOLERANCE` outside the fuselage section. */
  hullOut: number;
}

export interface AuditReport {
  crew: CrewAudit[];
  /** Interior parts outside the skin: material@station → how far the worst vertex is out, centimetres. */
  equipment: Record<string, number>;
}

/** Stations outside these are the nose glazing and the tail cone, which the section function does not describe. */
const AUDITED_STATIONS = { crew: [0.8, 22.6], equipment: [0.5, 22.6] } as const;
const CREW_SKIN_TOLERANCE = 0.01;
const EQUIPMENT_SKIN_TOLERANCE = 0.012;
/** The engineer's head is up in the top turret's dome, outside the fuselage section. */
const TOP_TURRET_VOLUME = { from: 4.6, to: 5.75, halfWidth: 0.55, belowTop: 0.05 } as const;
/** The tail gunner's cab raises the top of the section over these stations. */
const TAIL_CAB = { from: 19.45, to: 21.9, halfWidth: 0.38, top: 0.86 } as const;
/** Where the wrist sits behind the grip: along the fingers by this fraction of the palm, and off the palm. */
const WRIST_BEHIND_GRIP = { palmFraction: 0.55, offPalm: 0.025 } as const;

/** How far a point in fuselage space is outside the fuselage section, metres; negative inside. */
function outsideSkin(point: THREE.Vector3): number {
  const d = toX(point.x);
  const section = hullSectionAt(d);
  const inTailCab = d > TAIL_CAB.from && d < TAIL_CAB.to && Math.abs(point.z) < TAIL_CAB.halfWidth;
  const top = inTailCab ? Math.max(section.top, TAIL_CAB.top) : section.top;
  const middle = (top + section.bottom) / 2;
  const halfHeight = (top - section.bottom) / 2;
  const radius = (Math.abs(point.z) / section.halfWidth) ** HULL_EXPONENT + (Math.abs(point.y - middle) / halfHeight) ** HULL_EXPONENT;
  return (radius ** (1 / HULL_EXPONENT) - 1) * Math.min(section.halfWidth, halfHeight);
}

/** The suffix a replacement figure's role carries in the audit, to tell it from the man's usual figure. */
const REACTION_SUFFIX = ' · No. 3 hit';

function auditCrew(ship: B17): CrewAudit[] {
  ship.root.updateMatrixWorld(true);
  const toFuselage = ship.root.matrixWorld.clone().invert();
  const vertex = new THREE.Vector3();
  const figures = [
    ...ship.crew.map((figure) => ({ ...figure, label: figure.station.member.role })),
    ...ship.crewReactions.map(({ reacting }) => ({ ...reacting, label: reacting.station.member.role + REACTION_SUFFIX })),
  ];
  return figures.map(({ station, mesh, label }) => {
    const { pose, role } = station.member;
    const skeleton = buildSkeleton(pose);
    const reach = (side: Side): number => {
      const hand = pose.hands[side];
      const wristTarget = hand.grip.clone()
        .addScaledVector(hand.fingers.clone().normalize(), -ANTHROPOMETRY.palm * WRIST_BEHIND_GRIP.palmFraction)
        .addScaledVector(hand.palm.clone().normalize(), -WRIST_BEHIND_GRIP.offPalm);
      return skeleton.wrist[side].distanceTo(wristTarget);
    };
    const toCm = (metres: number) => Math.round(metres * 1000) / 10;
    const toSkin = new THREE.Matrix4().multiplyMatrices(toFuselage, mesh.matrixWorld);
    const positions = mesh.geometry.getAttribute('position');
    let hullOut = 0;
    for (let index = 0; index < positions.count; index += 3) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(toSkin);
      const d = toX(vertex.x);
      if (d < AUDITED_STATIONS.crew[0] || d > AUDITED_STATIONS.crew[1] || role === 'Ball turret gunner') continue;
      const inTopTurret = d > TOP_TURRET_VOLUME.from && d < TOP_TURRET_VOLUME.to && Math.abs(vertex.z) < TOP_TURRET_VOLUME.halfWidth
        && vertex.y > hullSectionAt(d).top - TOP_TURRET_VOLUME.belowTop;
      if (!inTopTurret && outsideSkin(vertex) > CREW_SKIN_TOLERANCE) hullOut++;
    }
    return {
      role: label,
      reachCm: {
        left: toCm(reach('left')),
        right: toCm(reach('right')),
        leftFoot: toCm(skeleton.ankle.left.distanceTo(pose.feet.left.ankle)),
        rightFoot: toCm(skeleton.ankle.right.distanceTo(pose.feet.right.ankle)),
      },
      hullOut,
    };
  });
}

/**
 * Interior fittings outside the skin, by material and station. The turrets stand outside it by design, and they turn,
 * so they are left out.
 */
function auditEquipment(ship: B17): Record<string, number> {
  const materials = interiorMaterials();
  const structural = new Set<THREE.Material>([materials.skin, materials.frame, materials.frameGreen, materials.turretLining]);
  const names = new Map<THREE.Material, string>(Object.entries(materials).filter(([, material]) => !structural.has(material)).map(([name, material]) => [material, name]));
  const crewMeshes = new Set<THREE.Object3D>(ship.crew.map(({ mesh }) => mesh));
  const turrets: THREE.Object3D[] = [ship.topTurret.yaw, ship.ballTurret.yaw, ship.chinTurret];
  ship.root.updateMatrixWorld(true);
  const toFuselage = ship.root.matrixWorld.clone().invert();
  const vertex = new THREE.Vector3();
  const worst: Record<string, number> = {};
  ship.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || crewMeshes.has(object)) return;
    const name = names.get(object.material);
    if (!name) return;
    for (let parent: THREE.Object3D | null = object; parent && parent !== ship.root; parent = parent.parent) {
      if (turrets.includes(parent)) return;
    }
    const toSkin = new THREE.Matrix4().multiplyMatrices(toFuselage, object.matrixWorld);
    const positions = object.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(toSkin);
      const d = toX(vertex.x);
      if (d < AUDITED_STATIONS.equipment[0] || d > AUDITED_STATIONS.equipment[1]) continue;
      const excess = outsideSkin(vertex);
      if (excess <= EQUIPMENT_SKIN_TOLERANCE) continue;
      const key = `${name}@${d.toFixed(1)}`;
      worst[key] = Math.max(worst[key] ?? 0, Math.round(excess * 1000) / 10);
    }
  });
  return worst;
}

/**
 * Geometry audits run in the dev page by `scripts/audit.ts`: how far each man's hands and feet miss their targets and
 * what of him pokes out through the skin, on the lead, whose men are built in full; and which interior fittings poke
 * out, on a wingman, which carries no cutaway.
 */
export function runAudits(lead: B17, wingman: B17): AuditReport {
  return { crew: auditCrew(lead), equipment: auditEquipment(wingman) };
}
