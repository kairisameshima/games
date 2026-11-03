import * as THREE from 'three';
import { applyStudioShading, glossyMaterial, matteMaterial, metalMaterial } from '../render/studio';
import { FUSELAGE_LENGTH, STATIONS } from './b17-dimensions';
import { buildCrewFigure, type CrewPose } from './crew';
import { hullHalfWidthAtHeight, hullRing, hullSectionAt, toX } from './hull';
import { part, roundedBox } from './kit';

/**
 * Inside the B-17G, stations from the crew-position diagrams in the pilot's manual: bombardier and navigator in the nose,
 * pilots on the flight deck, the engineer standing in the top turret, the bomb bay between the wing-spar bulkheads,
 * the radio room, the ball turret, two waist gunners and the tail gunner. All heights are model space (metres above the
 * nose-tip axis). The interior is built into every aircraft so it shows through the glazing and the open bomb bay.
 */

const FRAME_SPACING = 0.6;
const FRAME_RADIUS = 0.02;
const FRAME_INSET = 0.035;
const FLOOR_SEGMENT = 0.5;
const FLOOR_THICKNESS = 0.04;
const BOMB_TIER_SPACING = 0.4;
const BOMB_LOWEST_TIER = -0.98;
const BOMB_RACK_OFFSET = 0.3;
const BOMBS_PER_LOAD = 12;

const FLOORS = {
  nose: { start: 0.72, end: 2.95, y: -0.7 },
  cockpit: { start: 3.05, end: 4.7, y: 0.0 },
  flightDeck: { start: 4.7, end: 7.45, y: -0.1 },
  radioRoom: { start: 9.8, end: 10.8, y: -0.82 },
} as const;
/** Behind the radio room the floor follows the hull bottom up toward the tail. */
const WAIST_FLOOR = { start: 10.8, end: 19.6, clearance: 0.33 } as const;
const TAIL_FLOOR = { start: 19.6, end: 21.7, clearance: 0.06 } as const;
const BULKHEADS = [
  { d: STATIONS.bombBay.start, doorBottom: -1.0, doorTop: 1.0 },
  { d: STATIONS.bombBay.end, doorBottom: -1.0, doorTop: 1.0 },
  { d: FLOORS.radioRoom.end, doorBottom: FLOORS.radioRoom.y, doorTop: 0.7 },
] as const;

interface InteriorMaterials {
  skin: THREE.MeshStandardMaterial;
  frame: THREE.Material;
  floor: THREE.Material;
  fitting: THREE.Material;
  equipment: THREE.Material;
  seat: THREE.Material;
  dial: THREE.Material;
  oxygen: THREE.Material;
  extinguisher: THREE.Material;
  rubber: THREE.Material;
}

let sharedMaterials: InteriorMaterials | null = null;

function interiorMaterials(): InteriorMaterials {
  sharedMaterials ??= {
    // Zinc chromate primer on the inside of the skin, seen from within, so only back faces draw.
    skin: applyStudioShading(new THREE.MeshStandardMaterial({ color: '#5f6a45', roughness: 0.78, side: THREE.BackSide, envMapIntensity: 0.5 })),
    frame: metalMaterial('#a7adb3', { roughness: 0.38, metalness: 0.8 }),
    floor: matteMaterial('#7a6446', { roughness: 0.72 }),
    fitting: matteMaterial('#59633c', { roughness: 0.7, side: THREE.DoubleSide }),
    equipment: metalMaterial('#2a2d2b', { roughness: 0.5, metalness: 0.3 }),
    seat: matteMaterial('#3b2f25', { roughness: 0.6 }),
    dial: matteMaterial('#e8e2d0', { roughness: 0.4 }),
    oxygen: glossyMaterial('#c49a3a'),
    extinguisher: glossyMaterial('#b3271e'),
    rubber: matteMaterial('#121316', { roughness: 0.72, envMapIntensity: 0.35 }),
  };
  return sharedMaterials;
}

export interface InteriorHosts {
  /** Static parent, merged per material by the caller. */
  airframe: THREE.Object3D;
  /** Parent for parts that change visibility at runtime. */
  root: THREE.Object3D;
  /** Hull-shaped shells whose inner faces become the interior skin. */
  shells: THREE.BufferGeometry[];
  topTurretYaw: THREE.Object3D;
  ballTurretPitch: THREE.Object3D;
  createBomb: () => THREE.Object3D;
}

export interface CrewStation {
  role: string;
  /** Model-space point the cutaway callout pins to. */
  anchor: THREE.Vector3;
  /** Callouts sit above their anchor, except under the aircraft where they hang below it. */
  placement: 'above' | 'below';
  /** The bomb bay callout also reports how many bombs are still aboard. */
  showsBombLoad: boolean;
}

export interface B17Interior {
  /** Racked bombs in release order: bottom tier first, alternating starboard and port. */
  rackedBombs: THREE.Object3D[];
  stations: CrewStation[];
}

function placeFigure(parent: THREE.Object3D, pose: CrewPose, position: THREE.Vector3, yaw: number, scale = 1): THREE.Group {
  const figure = buildCrewFigure(pose);
  figure.position.copy(position);
  figure.rotation.y = yaw;
  figure.scale.setScalar(scale);
  parent.add(figure);
  return figure;
}

/** Frames as full rings just inside the skin, plus two stringers along the starboard side. */
function addStructure(airframe: THREE.Object3D, materials: InteriorMaterials): void {
  for (let d = 1.2; d < FUSELAGE_LENGTH - 1.0; d += FRAME_SPACING) {
    const curve = new THREE.CatmullRomCurve3(hullRing(d, -FRAME_INSET), true);
    part(airframe, new THREE.TubeGeometry(curve, 64, FRAME_RADIUS, 4, true), materials.frame, 0, 0, 0);
  }
  for (const ringIndex of [8, 24]) {
    const points: THREE.Vector3[] = [];
    for (let d = 3.2; d <= 19.4; d += 0.4) points.push(hullRing(d, -FRAME_INSET - 0.02)[ringIndex]);
    part(airframe, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 2, FRAME_RADIUS * 0.8, 4, false), materials.frame, 0, 0, 0);
  }
}

function addFloor(airframe: THREE.Object3D, materials: InteriorMaterials, start: number, end: number, heightAt: (d: number) => number): void {
  for (let d = start; d < end - 1e-3; d += FLOOR_SEGMENT) {
    const length = Math.min(FLOOR_SEGMENT, end - d);
    const middle = d + length / 2;
    const y = heightAt(middle);
    const halfWidth = Math.min(hullHalfWidthAtHeight(d, y), hullHalfWidthAtHeight(d + length, y)) - 0.04;
    if (halfWidth < 0.15) continue;
    part(airframe, roundedBox(length - 0.01, FLOOR_THICKNESS, halfWidth * 2, 0.012), materials.floor, toX(middle), y - FLOOR_THICKNESS / 2, 0);
  }
}

function addBulkhead(airframe: THREE.Object3D, materials: InteriorMaterials, d: number, doorBottom: number, doorTop: number): void {
  // Shape u runs along −z so the rotation below lands the outline back on +z.
  const outline = new THREE.Shape(hullRing(d, -0.02).map((point) => new THREE.Vector2(-point.z, point.y)));
  const door = new THREE.Path();
  const doorHalfWidth = 0.24;
  door.moveTo(-doorHalfWidth, doorBottom);
  door.lineTo(doorHalfWidth, doorBottom);
  door.lineTo(doorHalfWidth, doorTop - doorHalfWidth);
  door.absarc(0, doorTop - doorHalfWidth, doorHalfWidth, 0, Math.PI, false);
  door.lineTo(-doorHalfWidth, doorBottom);
  outline.holes.push(door);
  const geometry = new THREE.ShapeGeometry(outline, 12);
  geometry.rotateY(Math.PI / 2);
  part(airframe, geometry, materials.fitting, toX(d), 0, 0);
}

function addNose(airframe: THREE.Object3D, materials: InteriorMaterials): CrewStation[] {
  const floorY = FLOORS.nose.y;
  // Navigator's table along the port wall, facing outboard; his windows are above it.
  const navigatorD = 2.25;
  part(airframe, roundedBox(0.62, 0.03, 0.3, 0.01), materials.fitting, toX(navigatorD), floorY + 0.55, -0.66);
  part(airframe, roundedBox(0.05, 0.55, 0.05, 0.01), materials.fitting, toX(navigatorD), floorY + 0.27, -0.66);
  part(airframe, roundedBox(0.3, 0.2, 0.22, 0.03), materials.equipment, toX(navigatorD + 0.45), floorY + 0.67, -0.68);
  placeFigure(airframe, 'seated', new THREE.Vector3(toX(navigatorD), floorY, -0.3), Math.PI / 2);
  // Bombardier on his seat behind the Norden sight, knees either side of it.
  const bombardierD = 1.15;
  part(airframe, roundedBox(0.3, 0.06, 0.34, 0.02), materials.seat, toX(bombardierD), floorY + 0.42, 0);
  placeFigure(airframe, 'seated', new THREE.Vector3(toX(bombardierD), floorY, 0), 0);
  // Ammunition boxes for the cheek and chin guns.
  for (const z of [-0.45, 0.45]) part(airframe, roundedBox(0.36, 0.24, 0.2, 0.02), materials.fitting, toX(2.7), floorY + 0.12, z);
  return [
    { role: 'Bombardier · Norden sight', anchor: new THREE.Vector3(toX(bombardierD), floorY + 1.1, 0), placement: 'above', showsBombLoad: false },
    { role: 'Navigator', anchor: new THREE.Vector3(toX(navigatorD), floorY + 1.1, -0.3), placement: 'above', showsBombLoad: false },
  ];
}

function addCockpit(airframe: THREE.Object3D, materials: InteriorMaterials): CrewStation[] {
  const floorY = FLOORS.cockpit.y;
  const seatD = 3.85;
  const panelD = 3.2;
  const panelY = 0.85;
  part(airframe, roundedBox(0.05, 0.42, 1.2, 0.02), materials.equipment, toX(panelD), panelY, 0);
  part(airframe, roundedBox(0.2, 0.05, 1.24, 0.02), materials.equipment, toX(panelD) + 0.07, panelY + 0.23, 0);
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 7; column++) {
      const dial = part(airframe, new THREE.CircleGeometry(0.045, 16), materials.dial, toX(panelD) - 0.027, panelY + 0.1 - row * 0.17, -0.48 + column * 0.16);
      dial.rotation.y = -Math.PI / 2;
    }
  }
  // Throttle pedestal between the seats.
  part(airframe, roundedBox(0.4, 0.42, 0.22, 0.04), materials.equipment, toX(3.5), floorY + 0.21, 0);
  // US practice: pilot in the left (port) seat, co-pilot in the right.
  for (const z of [-0.38, 0.38]) {
    part(airframe, roundedBox(0.44, 0.08, 0.44, 0.03), materials.seat, toX(seatD), floorY + 0.44, z);
    part(airframe, roundedBox(0.08, 0.62, 0.44, 0.03), materials.seat, toX(seatD + 0.24), floorY + 0.78, z);
    part(airframe, new THREE.CylinderGeometry(0.025, 0.03, 0.72, 10), materials.equipment, toX(3.45), floorY + 0.36, z);
    const wheel = part(airframe, new THREE.TorusGeometry(0.13, 0.018, 8, 24, Math.PI * 1.3), materials.equipment, toX(3.42), floorY + 0.8, z);
    wheel.rotation.set(Math.PI * 1.35, Math.PI / 2, 0);
    placeFigure(airframe, 'seated', new THREE.Vector3(toX(seatD), floorY, z), 0);
  }
  return [{ role: 'Pilot and co-pilot', anchor: new THREE.Vector3(toX(seatD), floorY + 1.15, 0), placement: 'above', showsBombLoad: false }];
}

function addFlightDeck(airframe: THREE.Object3D, materials: InteriorMaterials, topTurretYaw: THREE.Object3D): CrewStation[] {
  const floorY = FLOORS.flightDeck.y;
  // The engineer stands on the turret platform; he turns with the turret, so he hangs off its yaw group.
  const engineer = buildCrewFigure('standing');
  engineer.position.set(0, floorY - topTurretYaw.position.y, 0);
  topTurretYaw.add(engineer);
  part(airframe, new THREE.CylinderGeometry(0.34, 0.34, 0.05, 24), materials.equipment, topTurretYaw.position.x, floorY + 0.02, 0);
  // Oxygen bottles racked on the port wall behind the turret, and a fire extinguisher.
  for (let bottle = 0; bottle < 4; bottle++) {
    const bottleMesh = part(airframe, new THREE.CapsuleGeometry(0.1, 0.42, 6, 14), materials.oxygen, toX(6.2 + bottle * 0.28), 0.45, -0.82);
    bottleMesh.rotation.x = 0.1;
  }
  part(airframe, new THREE.CapsuleGeometry(0.06, 0.28, 6, 12), materials.extinguisher, toX(7.15), floorY + 0.25, 0.62);
  return [{ role: 'Flight engineer · top turret', anchor: new THREE.Vector3(topTurretYaw.position.x, topTurretYaw.position.y + 0.1, 0), placement: 'above', showsBombLoad: false }];
}

function addBombBay(airframe: THREE.Object3D, root: THREE.Object3D, materials: InteriorMaterials, createBomb: () => THREE.Object3D): { stations: CrewStation[]; rackedBombs: THREE.Object3D[] } {
  const bay = STATIONS.bombBay;
  const bayMid = (bay.start + bay.end) / 2;
  const centreX = toX(bayMid);
  // Narrow catwalk along the keel, between the two vertical bomb racks.
  part(airframe, roundedBox(bay.end - bay.start, 0.05, 0.22, 0.015), materials.floor, centreX, -1.07, 0);
  const topTierY = BOMB_LOWEST_TIER + ((BOMBS_PER_LOAD / 2) - 1) * BOMB_TIER_SPACING;
  for (const side of [1, -1]) {
    const postZ = side * (BOMB_RACK_OFFSET + 0.22);
    for (const offset of [-0.35, 0.35]) {
      const postHeight = topTierY - BOMB_LOWEST_TIER + 0.6;
      part(airframe, roundedBox(0.06, postHeight, 0.06, 0.015), materials.frame, centreX + offset, BOMB_LOWEST_TIER - 0.15 + postHeight / 2, postZ);
    }
    for (let tier = 0; tier < BOMBS_PER_LOAD / 2; tier++) {
      const shackleY = BOMB_LOWEST_TIER + tier * BOMB_TIER_SPACING + 0.2;
      part(airframe, roundedBox(0.76, 0.03, 0.24, 0.01), materials.frame, centreX, shackleY, side * (BOMB_RACK_OFFSET + 0.1));
    }
  }
  const rackedBombs: THREE.Object3D[] = [];
  for (let index = 0; index < BOMBS_PER_LOAD; index++) {
    const bomb = createBomb();
    const side = index % 2 === 0 ? 1 : -1;
    bomb.position.set(centreX, BOMB_LOWEST_TIER + (index >> 1) * BOMB_TIER_SPACING, side * BOMB_RACK_OFFSET);
    root.add(bomb);
    rackedBombs.push(bomb);
  }
  return {
    stations: [{ role: 'Bomb bay', anchor: new THREE.Vector3(centreX, BOMB_LOWEST_TIER + 2 * BOMB_TIER_SPACING, 0), placement: 'above', showsBombLoad: true }],
    rackedBombs,
  };
}

function addRadioRoom(airframe: THREE.Object3D, materials: InteriorMaterials): CrewStation[] {
  const floorY = FLOORS.radioRoom.y;
  const operatorD = 10.35;
  // Desk against the rear spar bulkhead with the command and liaison sets stacked on it.
  part(airframe, roundedBox(0.4, 0.04, 0.55, 0.01), materials.fitting, toX(9.98), floorY + 0.72, -0.3);
  part(airframe, roundedBox(0.28, 0.32, 0.5, 0.02), materials.equipment, toX(9.9), floorY + 0.9, -0.3);
  part(airframe, roundedBox(0.26, 0.22, 0.42, 0.02), materials.equipment, toX(9.9), floorY + 1.17, -0.3);
  for (let dial = 0; dial < 3; dial++) {
    const face = part(airframe, new THREE.CircleGeometry(0.035, 12), materials.dial, toX(9.9) - 0.141, floorY + 0.94, -0.45 + dial * 0.15);
    face.rotation.y = -Math.PI / 2;
  }
  part(airframe, roundedBox(0.4, 0.06, 0.4, 0.02), materials.seat, toX(operatorD), floorY + 0.44, -0.3);
  placeFigure(airframe, 'seated', new THREE.Vector3(toX(operatorD), floorY, -0.3), 0);
  return [{ role: 'Radio operator', anchor: new THREE.Vector3(toX(operatorD), floorY + 1.1, -0.3), placement: 'above', showsBombLoad: false }];
}

function addWaistAndTail(airframe: THREE.Object3D, materials: InteriorMaterials, ballTurretPitch: THREE.Object3D): CrewStation[] {
  const ball = STATIONS.ballTurret;
  // The gunner rides inside the ball, so he turns and tilts with it.
  part(ballTurretPitch, new THREE.SphereGeometry(ball.radius - 0.01, 32, 20), materials.skin, 0, 0, 0, { castShadow: false });
  const gunner = buildCrewFigure('curled');
  gunner.scale.setScalar(0.92);
  ballTurretPitch.add(gunner);

  const waistFloor = (d: number) => hullSectionAt(d).bottom + WAIST_FLOOR.clearance;
  const starboardD = (STATIONS.waistWindowStarboard.start + STATIONS.waistWindowStarboard.end) / 2;
  const portD = (STATIONS.waistWindowPort.start + STATIONS.waistWindowPort.end) / 2;
  // The waist gunners stand staggered so they do not back into each other.
  placeFigure(airframe, 'standing', new THREE.Vector3(toX(starboardD), waistFloor(starboardD), 0.42), -Math.PI / 2, 0.95);
  placeFigure(airframe, 'standing', new THREE.Vector3(toX(portD), waistFloor(portD), -0.42), Math.PI / 2, 0.95);
  for (const [d, z] of [[12.6, 0.62], [15.2, -0.62], [12.9, -0.6]] as const) {
    part(airframe, roundedBox(0.4, 0.26, 0.22, 0.02), materials.fitting, toX(d), waistFloor(d) + 0.13, z);
  }
  // Tailwheel, retracted into its well under the crawlway.
  const tailwheelD = 17.4;
  part(airframe, new THREE.TorusGeometry(0.2, 0.075, 10, 24), materials.rubber, toX(tailwheelD), hullSectionAt(tailwheelD).bottom + 0.2, 0);

  const tailFloor = (d: number) => hullSectionAt(d).bottom + TAIL_FLOOR.clearance;
  const tailGunnerD = 20.85;
  placeFigure(airframe, 'kneeling', new THREE.Vector3(toX(tailGunnerD), tailFloor(tailGunnerD), 0), Math.PI, 0.9);
  const waistD = (starboardD + portD) / 2;
  return [
    { role: 'Ball turret gunner', anchor: new THREE.Vector3(toX(ball.d), ball.h, 0), placement: 'below', showsBombLoad: false },
    { role: 'Waist gunners', anchor: new THREE.Vector3(toX(waistD), waistFloor(waistD) + 1.45, 0), placement: 'above', showsBombLoad: false },
    { role: 'Tail gunner', anchor: new THREE.Vector3(toX(tailGunnerD), tailFloor(tailGunnerD) + 1.0, 0), placement: 'above', showsBombLoad: false },
  ];
}

export function buildInterior(hosts: InteriorHosts): B17Interior {
  const materials = interiorMaterials();
  const { airframe } = hosts;
  for (const shell of hosts.shells) part(airframe, shell, materials.skin, 0, 0, 0, { castShadow: false });
  addStructure(airframe, materials);
  for (const floor of Object.values(FLOORS)) addFloor(airframe, materials, floor.start, floor.end, () => floor.y);
  addFloor(airframe, materials, WAIST_FLOOR.start, WAIST_FLOOR.end, (d) => hullSectionAt(d).bottom + WAIST_FLOOR.clearance);
  addFloor(airframe, materials, TAIL_FLOOR.start, TAIL_FLOOR.end, (d) => hullSectionAt(d).bottom + TAIL_FLOOR.clearance);
  for (const bulkhead of BULKHEADS) addBulkhead(airframe, materials, bulkhead.d, bulkhead.doorBottom, bulkhead.doorTop);

  const bombBay = addBombBay(airframe, hosts.root, materials, hosts.createBomb);
  const stations = [
    ...addNose(airframe, materials),
    ...addCockpit(airframe, materials),
    ...addFlightDeck(airframe, materials, hosts.topTurretYaw),
    ...bombBay.stations,
    ...addRadioRoom(airframe, materials),
    ...addWaistAndTail(airframe, materials, hosts.ballTurretPitch),
  ];
  return { rackedBombs: bombBay.rackedBombs, stations };
}
