import * as THREE from 'three';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import type { InteriorMaterials } from './materials';
import { rod } from './parts';

/**
 * The small fittings the Pilot's Manual lists at every crew station (sections IV to XI): interphone jack boxes, A-12
 * oxygen regulators with their indicator panels, portable "walk-around" oxygen units, suit heater outlets with their
 * rheostats, dome and table lamps, first-aid kits, the red emergency release handles at windows and hatches, and the
 * electrical conduit, oxygen tubing and control cables that run the length of the fuselage.
 *
 * Every fitting is built facing local +x (its face, knobs and dials on that side), then turned to face the cabin.
 */

/** A point on the cabin wall: station `d`, height `y`, starboard (+1) or port (−1). */
export interface WallSpot {
  d: number;
  y: number;
  side: 1 | -1;
}

/**
 * Group for a fitting mounted flat on the wall at `spot`, its +x facing inboard, standing `depth` off the skin. The
 * skin curves in above and below the spot, so the fitting stands off from the narrowest point over its height
 * (`below` to `above`, relative to the spot).
 */
function onWall(parent: THREE.Object3D, spot: WallSpot, depth: number, below: number, above: number): THREE.Group {
  const group = new THREE.Group();
  let narrowest = Infinity;
  for (let step = 0; step <= 4; step++) narrowest = Math.min(narrowest, hullHalfWidthAtHeight(spot.d, spot.y - below + ((above + below) * step) / 4));
  const wall = narrowest - 0.012;
  group.position.set(toX(spot.d), spot.y, spot.side * (wall - depth / 2));
  // Object3D yaw θ turns local +x to (cos θ, 0, −sin θ): +π/2 faces −z (inboard from starboard), −π/2 faces +z.
  group.rotation.y = (spot.side * Math.PI) / 2;
  parent.add(group);
  return group;
}

/** Group for a fitting on a bulkhead at station `d`, its +x facing `facing` (+1 aft, −1 forward along the fuselage). */
function onBulkhead(parent: THREE.Object3D, d: number, y: number, z: number, facing: 1 | -1, depth: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(toX(d + (facing * depth) / 2), y, z);
  // Aft is −x in model space.
  group.rotation.y = facing > 0 ? Math.PI : 0;
  parent.add(group);
  return group;
}

/** Round instrument face on the fitting's +x side. */
function dial(group: THREE.Object3D, materials: InteriorMaterials, x: number, y: number, z: number, radius: number): void {
  part(group, new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.008, 20), materials.crinkle, x, y, z, { rotation: [0, 0, Math.PI / 2] });
  part(group, new THREE.CircleGeometry(radius, 20), materials.dialFace, x + 0.0045, y, z, { rotation: [0, Math.PI / 2, 0] });
}

/** Knob sticking out of a face along +x. */
function knob(group: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, radius: number, length: number): void {
  part(group, new THREE.CylinderGeometry(radius, radius * 1.1, length, 12), material, x + length / 2, y, z, { rotation: [0, 0, Math.PI / 2] });
}

/** A-12 demand regulator, and above it the indicator panel: flow blinker and cylinder pressure gauge. */
export function oxygenStation(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot): void {
  const group = onWall(parent, spot, 0.05, 0.13, 0.18);
  part(group, roundedBox(0.05, 0.16, 0.12, 0.012), materials.crinkle, 0, 0, 0);
  const face = part(group, new THREE.PlaneGeometry(0.11, 0.11), materials.regulatorFace, 0.0255, 0.015, 0);
  face.rotation.y = Math.PI / 2;
  // Hose coupling below the face, where the mask hose plugs in.
  part(group, new THREE.CylinderGeometry(0.014, 0.016, 0.06, 12), materials.rubber, 0.02, -0.1, 0);
  // Indicator panel.
  part(group, roundedBox(0.016, 0.075, 0.15, 0.006), materials.crinkle, -0.015, 0.14, 0);
  dial(group, materials, -0.005, 0.14, -0.035, 0.022);
  dial(group, materials, -0.005, 0.14, 0.035, 0.022);
}

/** Interphone jack box (BC-366): selector switch, volume control, headset and microphone jacks. */
export function jackBox(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot): void {
  const group = onWall(parent, spot, 0.055, 0.05, 0.05);
  part(group, roundedBox(0.055, 0.1, 0.085, 0.008), materials.crinkle, 0, 0, 0);
  knob(group, materials.bakelite, 0.027, 0.02, -0.018, 0.012, 0.018);
  knob(group, materials.bakelite, 0.027, 0.02, 0.022, 0.009, 0.014);
  for (const z of [-0.018, 0.018]) knob(group, materials.brass, 0.027, -0.028, z, 0.006, 0.012);
  // Headset cord coiled down from the jack.
  rod(group, new THREE.Vector3(0.04, -0.028, -0.018), new THREE.Vector3(0.06, -0.2, -0.03), 0.004, materials.rubber, 6);
}

/** Electric suit heater receptacle with its rheostat. */
export function suitHeaterOutlet(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot): void {
  const group = onWall(parent, spot, 0.04, 0.045, 0.045);
  part(group, roundedBox(0.04, 0.09, 0.07, 0.006), materials.crinkle, 0, 0, 0);
  knob(group, materials.bakelite, 0.02, 0.02, 0, 0.014, 0.016);
  knob(group, materials.brass, 0.02, -0.025, 0, 0.008, 0.01);
}

/** A-4 portable "walk-around" oxygen unit in its wall bracket: small yellow cylinder, regulator head and gauge. */
export function portableOxygen(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot): void {
  const group = onWall(parent, spot, 0.12, 0.16, 0.2);
  part(group, new THREE.CapsuleGeometry(0.05, 0.2, 6, 14), materials.oxygen, 0.005, 0, 0);
  part(group, new THREE.CylinderGeometry(0.022, 0.026, 0.05, 12), materials.crinkle, 0.005, 0.175, 0);
  dial(group, materials, 0.028, 0.175, 0, 0.014);
  for (const y of [-0.08, 0.08]) part(group, new THREE.TorusGeometry(0.053, 0.005, 6, 20), materials.aluminium, 0.005, y, 0, { rotation: [Math.PI / 2, 0, 0] });
  part(group, roundedBox(0.012, 0.24, 0.05, 0.003), materials.aluminium, -0.052, 0, 0);
}

/** Aeronautic first-aid kit clipped to a wall or bulkhead. */
function firstAidKitBody(group: THREE.Group, materials: InteriorMaterials): void {
  part(group, roundedBox(0.07, 0.17, 0.24, 0.01), materials.ammunitionBox, 0, 0, 0);
  const lid = part(group, new THREE.PlaneGeometry(0.2, 0.15), materials.firstAidLid, 0.0355, 0, 0);
  lid.rotation.y = Math.PI / 2;
}

export function firstAidKitOnBulkhead(parent: THREE.Object3D, materials: InteriorMaterials, d: number, y: number, z: number, facing: 1 | -1): void {
  firstAidKitBody(onBulkhead(parent, d, y, z, facing, 0.07), materials);
}

/** Ceiling dome light, its lens looking down, and its switch box. */
export function domeLight(parent: THREE.Object3D, materials: InteriorMaterials, d: number, z = 0): void {
  const top = hullSectionAt(d).top - 0.075;
  part(parent, new THREE.CylinderGeometry(0.06, 0.07, 0.035, 20), materials.crinkle, toX(d), top, z);
  part(parent, new THREE.SphereGeometry(0.048, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), materials.lampLens, toX(d), top - 0.015, z, { castShadow: false });
}

/** Gooseneck lamp on a wall bracket over a table (navigator, radio operator). */
export function tableLamp(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot, reach: number): void {
  const group = onWall(parent, spot, 0.03, 0.04, 0.08);
  part(group, roundedBox(0.03, 0.07, 0.05, 0.006), materials.crinkle, 0, 0, 0);
  const elbow = new THREE.Vector3(reach * 0.6, 0.06, 0);
  const head = new THREE.Vector3(reach, -0.02, 0);
  rod(group, new THREE.Vector3(0.01, 0.02, 0), elbow, 0.006, materials.crinkle, 8);
  rod(group, elbow, head, 0.006, materials.crinkle, 8);
  part(group, new THREE.ConeGeometry(0.04, 0.06, 16, 1, true), materials.crinkle, head.x, head.y - 0.02, 0, { rotation: [0, 0, 0] });
  part(group, new THREE.CircleGeometry(0.03, 16), materials.lampLens, head.x, head.y - 0.045, 0, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
}

/** Red emergency release bar along a window's forward edge, or a red handle on a hatch rim. */
export function emergencyRelease(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot, length: number): void {
  const group = onWall(parent, spot, 0.03, length / 2 + 0.01, length / 2 + 0.01);
  part(group, roundedBox(0.02, length, 0.02, 0.006), materials.extinguisher, 0.005, 0, 0);
  for (const end of [-1, 1]) part(group, roundedBox(0.03, 0.02, 0.018, 0.004), materials.aluminium, -0.006, (end * length) / 2, 0);
}

/** Hand crank and its extension clipped flat to a wall or bulkhead: the cranks for flaps, gear and doors. */
export function handCranksOnBulkhead(parent: THREE.Object3D, materials: InteriorMaterials, d: number, y: number, z: number, facing: 1 | -1): void {
  const group = onBulkhead(parent, d, y, z, facing, 0.04);
  for (const [offset, length] of [[-0.06, 0.42], [0.06, 0.36]] as const) {
    rod(group, new THREE.Vector3(0.01, -length / 2, offset), new THREE.Vector3(0.01, length / 2, offset), 0.008, materials.crinkle, 8);
    rod(group, new THREE.Vector3(0.01, length / 2, offset), new THREE.Vector3(0.01, length / 2, offset + 0.08), 0.008, materials.crinkle, 8);
    part(group, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), materials.bakelite, 0.03, length / 2, offset + 0.08, { rotation: [0, 0, Math.PI / 2] });
  }
  for (const y of [-0.12, 0.12]) part(group, roundedBox(0.02, 0.025, 0.2, 0.004), materials.aluminium, -0.01, y, 0);
}

/** Alarm bell on the forward wall of the radio room. */
export function alarmBellOnBulkhead(parent: THREE.Object3D, materials: InteriorMaterials, d: number, y: number, z: number, facing: 1 | -1): void {
  const group = onBulkhead(parent, d, y, z, facing, 0.05);
  part(group, new THREE.SphereGeometry(0.045, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.extinguisher, 0, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
  part(group, new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8), materials.brass, 0.05, 0, 0, { rotation: [0, 0, Math.PI / 2] });
}

/** Fuse box: hinged crinkle-finish cover with a latch. */
export function fuseBoxOnBulkhead(parent: THREE.Object3D, materials: InteriorMaterials, d: number, y: number, z: number, facing: 1 | -1): void {
  const group = onBulkhead(parent, d, y, z, facing, 0.06);
  part(group, roundedBox(0.06, 0.2, 0.16, 0.01), materials.crinkle, 0, 0, 0);
  part(group, roundedBox(0.012, 0.03, 0.02, 0.003), materials.aluminium, 0.034, 0, 0.06);
}

/**
 * Systems running along one wall: an electrical conduit and an oxygen line above the windows, and (`withCables`) the
 * paired control cables in their pulley brackets higher up, from station `start` to `end`. Each run keeps a fixed height as a
 * fraction of the section's half-height above its middle, so it follows the fuselage's taper.
 */
export function wallRuns(parent: THREE.Object3D, materials: InteriorMaterials, start: number, end: number, side: 1 | -1, withCables: boolean): void {
  const runs: { level: number; radius: number; material: THREE.Material; inset: number }[] = [
    { level: 0.66, radius: 0.011, material: materials.crinkle, inset: 0.05 },
    { level: 0.7, radius: 0.007, material: materials.aluminium, inset: 0.045 },
    { level: 0.8, radius: 0.0025, material: materials.gunBlack, inset: 0.06 },
    { level: 0.82, radius: 0.0025, material: materials.gunBlack, inset: 0.06 },
  ].slice(0, withCables ? 4 : 2);
  const at = (d: number, level: number, inset: number) => {
    const section = hullSectionAt(d);
    const y = (section.top + section.bottom) / 2 + level * (section.top - section.bottom) / 2;
    return new THREE.Vector3(toX(d), y, side * (hullHalfWidthAtHeight(d, y) - inset));
  };
  const samples = Math.max(2, Math.ceil((end - start) / 0.25));
  for (const run of runs) {
    const points = Array.from({ length: samples + 1 }, (_, index) => at(start + ((end - start) * index) / samples, run.level, run.inset));
    part(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), samples * 2, run.radius, 6, false), run.material, 0, 0, 0);
  }
  // Clips on the conduit and oxygen line at every frame, and a pulley bracket for the cables every third frame.
  for (let d = Math.ceil(start * 2) / 2; d < end; d += 0.5) {
    const clip = at(d, 0.68, 0.04);
    part(parent, roundedBox(0.015, 0.06, 0.02, 0.004), materials.aluminium, clip.x, clip.y, clip.z);
    if (!withCables || Math.round(d * 2) % 3 !== 0) continue;
    const pulley = at(d, 0.81, 0.06);
    part(parent, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14), materials.aluminium, pulley.x, pulley.y, pulley.z, { rotation: [0, 0, Math.PI / 2] });
    rod(parent, pulley, at(d, 0.81, 0.01), 0.004, materials.aluminium, 6);
  }
}

/** Red pull handle hanging from the ceiling: the life raft releases and the radio hatch's emergency releases. */
function ceilingHandle(parent: THREE.Object3D, materials: InteriorMaterials, d: number, z: number): void {
  const top = hullSectionAt(d).top - 0.03;
  rod(parent, new THREE.Vector3(toX(d), top, z), new THREE.Vector3(toX(d), top - 0.08, z), 0.004, materials.aluminium, 6);
  part(parent, roundedBox(0.07, 0.016, 0.016, 0.005), materials.extinguisher, toX(d), top - 0.085, z);
}

/** Relief tube: a funnel on its hose, clipped to the wall. */
function reliefTube(parent: THREE.Object3D, materials: InteriorMaterials, spot: WallSpot): void {
  const group = onWall(parent, spot, 0.08, 0.26, 0.1);
  part(group, new THREE.ConeGeometry(0.04, 0.09, 14, 1, true), materials.aluminium, 0, 0.05, 0, { rotation: [Math.PI, 0, 0] });
  rod(group, new THREE.Vector3(0, 0.005, 0), new THREE.Vector3(-0.02, -0.25, 0), 0.008, materials.rubber, 8);
}

/** Hand fuel transfer pump: barrel, lever and its hose, on a bulkhead. */
function handFuelPump(parent: THREE.Object3D, materials: InteriorMaterials, d: number, y: number, z: number, facing: 1 | -1): void {
  const group = onBulkhead(parent, d, y, z, facing, 0.08);
  part(group, new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16), materials.aluminium, 0, 0, 0);
  rod(group, new THREE.Vector3(0.02, 0.08, 0), new THREE.Vector3(0.12, 0.2, 0), 0.008, materials.aluminium, 8);
  part(group, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), materials.bakelite, 0.12, 0.2, 0, { rotation: [Math.PI / 2, 0, 0] });
  rod(group, new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0.05, -0.3, 0.1), 0.01, materials.rubber, 8);
}

/** Emergency bomb release handle under its hinged guard, on the step at the forward end of the catwalk. */
function emergencyBombRelease(parent: THREE.Object3D, materials: InteriorMaterials, position: THREE.Vector3): void {
  part(parent, roundedBox(0.12, 0.012, 0.1, 0.004), materials.crinkle, position.x, position.y, position.z);
  part(parent, roundedBox(0.04, 0.06, 0.02, 0.005), materials.extinguisher, position.x, position.y + 0.035, position.z);
  const guard = part(parent, roundedBox(0.1, 0.004, 0.08, 0.002), materials.aluminium, position.x - 0.03, position.y + 0.07, position.z);
  guard.rotation.z = 0.5;
}

export interface StationFittingSpots {
  bulkheads: { noseToCockpit: number; frontSpar: number; rearSpar: number; radioToWaist: number };
  floors: { nose: number; radioRoom: number; catwalk: number };
  waistFloorAt: (d: number) => number;
  tailFloorAt: (d: number) => number;
  radioHatch: { start: number; end: number; halfWidth: number };
  waist: { starboardWindow: [number, number]; portWindow: [number, number]; door: [number, number]; windowMiddleY: number };
  tailGunnerD: number;
}

/**
 * The fittings at each station, placed where the Pilot's Manual puts them: the bombardier's two jack boxes and suit
 * heater on the right wall; the navigator's lamp over his table and the fuse box in the compartment's right rear
 * corner; the pilots' jack boxes and heater outlets; the bomb bay's dome lights, relief tube, hand fuel pump and the
 * emergency bomb release on the catwalk step; the radio room's alarm bell, table lamp, jack boxes, hand cranks and the
 * red release handles round the top hatch and for the life rafts; the waist's dome lights, jack boxes, rheostats,
 * walk-around bottles, first-aid kit and the red release bars on each window's forward edge; the tail gunner's jack
 * box, heater and dome light. Plus the conduit, oxygen line and control cables along both walls.
 */
export function addStationFittings(parent: THREE.Object3D, materials: InteriorMaterials, spots: StationFittingSpots): void {
  const { bulkheads, floors, waist } = spots;
  // Nose: bombardier on the right wall, navigator on the left.
  for (const d of [1.55, 1.72]) jackBox(parent, materials, { d, y: 0.2, side: 1 });
  suitHeaterOutlet(parent, materials, { d: 1.62, y: -0.32, side: 1 });
  portableOxygen(parent, materials, { d: 2.42, y: -0.38, side: 1 });
  tableLamp(parent, materials, { d: 1.98, y: 0.62, side: -1 }, 0.22);
  jackBox(parent, materials, { d: 2.62, y: 0.42, side: -1 });
  suitHeaterOutlet(parent, materials, { d: 2.66, y: -0.22, side: -1 });
  fuseBoxOnBulkhead(parent, materials, bulkheads.noseToCockpit, -0.05, 0.45, -1);
  domeLight(parent, materials, 1.95);
  // Pilots' compartment: a jack box and heater outlet on each side wall behind the seats.
  for (const side of [-1, 1] as const) {
    jackBox(parent, materials, { d: 4.32, y: 0.55, side });
    suitHeaterOutlet(parent, materials, { d: 4.46, y: 0.35, side });
  }
  // Flight deck: the engineer's jack box on the wall left of the turret.
  jackBox(parent, materials, { d: 5.35, y: 0.62, side: -1 });
  // Bomb bay.
  for (const z of [-0.32, 0.32]) domeLight(parent, materials, bulkheads.rearSpar - 0.35, z);
  reliefTube(parent, materials, { d: bulkheads.rearSpar - 0.25, y: -0.25, side: -1 });
  handFuelPump(parent, materials, bulkheads.rearSpar, -0.45, -0.38, -1);
  emergencyBombRelease(parent, materials, new THREE.Vector3(toX(bulkheads.frontSpar + 0.12), floors.catwalk + 0.006, 0.05));
  // Radio room.
  alarmBellOnBulkhead(parent, materials, bulkheads.rearSpar, 0.42, -0.45, 1);
  tableLamp(parent, materials, { d: 8.85, y: 0.42, side: -1 }, 0.26);
  jackBox(parent, materials, { d: 9.7, y: 0.0, side: -1 });
  for (const d of [9.45, 10.2]) jackBox(parent, materials, { d, y: 0.1, side: 1 });
  handCranksOnBulkhead(parent, materials, bulkheads.radioToWaist, 0.25, 0.42, -1);
  for (const d of [spots.radioHatch.start + 0.25, spots.radioHatch.end - 0.25]) {
    for (const z of [-spots.radioHatch.halfWidth, spots.radioHatch.halfWidth]) ceilingHandle(parent, materials, d, z);
  }
  for (const d of [spots.radioHatch.end + 0.1, spots.radioHatch.end + 0.22]) ceilingHandle(parent, materials, d, 0.22);
  portableOxygen(parent, materials, { d: 10.3, y: -0.45, side: -1 });
  // Waist.
  for (const d of [12.3, 15.2]) domeLight(parent, materials, d);
  domeLight(parent, materials, 11.5);
  emergencyRelease(parent, materials, { d: waist.starboardWindow[0] + 0.04, y: waist.windowMiddleY, side: 1 }, 0.6);
  emergencyRelease(parent, materials, { d: waist.portWindow[0] + 0.04, y: waist.windowMiddleY, side: -1 }, 0.6);
  emergencyRelease(parent, materials, { d: waist.door[0] - 0.05, y: 0.15, side: 1 }, 0.3);
  for (const [d, side] of [[12.62, 1], [15.0, -1]] as const) {
    jackBox(parent, materials, { d, y: 0.55, side });
    suitHeaterOutlet(parent, materials, { d, y: 0.3, side });
    portableOxygen(parent, materials, { d, y: spots.waistFloorAt(d) + 0.45, side });
  }
  firstAidKitOnBulkhead(parent, materials, bulkheads.radioToWaist, -0.35, -0.4, 1);
  // Tail.
  const tailFloor = spots.tailFloorAt(spots.tailGunnerD);
  jackBox(parent, materials, { d: 20.45, y: tailFloor + 0.6, side: -1 });
  suitHeaterOutlet(parent, materials, { d: spots.tailGunnerD - 0.15, y: tailFloor + 0.55, side: 1 });
  domeLight(parent, materials, 21.35);
  // Systems along both walls, nose and from the radio room aft.
  for (const side of [-1, 1] as const) {
    // The elevator and rudder cables run aft from the pilots' controls; the nose carries only conduit and oxygen line.
    wallRuns(parent, materials, 1.0, bulkheads.noseToCockpit - 0.1, side, false);
    wallRuns(parent, materials, bulkheads.rearSpar + 0.1, 20.6, side, true);
  }
}
