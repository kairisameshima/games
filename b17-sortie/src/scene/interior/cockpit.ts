import * as THREE from 'three';
import { STATIONS } from '../b17-dimensions';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { feedGun } from './ammunition';
import { BULKHEADS, COCKPIT, FLIGHT_DECK, FLOORS } from './layout';
import { applyPanelUvs, instrumentPanelTexture, panelOutline, PANEL_HEIGHT, PANEL_WIDTH } from './panels';
import { box, oxygenBottle, rod, type CompartmentContext, type CompartmentResult } from './parts';
import { FACING, palmDown, plantedFoot, pose, seatedPelvis, verticalGrip } from './poses';
import { oxygenStation } from './fittings';
import { addBulkhead, addSparTruss } from './structure';

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);
const WHEEL_TUBE = 0.017;
const FORWARD = new THREE.Vector3(1, 0, 0);
const THROTTLE_COUNT = 4;

function addInstrumentPanel(context: CompartmentContext): void {
  const { parent, materials } = context;
  const face = new THREE.ShapeGeometry(panelOutline(), 24);
  applyPanelUvs(face);
  face.translate(-PANEL_WIDTH / 2, 0, 0);
  face.rotateY(-Math.PI / 2);
  const material = materials.instrumentPanel.clone();
  material.map = instrumentPanelTexture();
  part(parent, face, material, toX(COCKPIT.panelD) - 0.001, COCKPIT.panel.bottomY, 0, { castShadow: false });
  // Backing box, glare shield, and the compass binnacle on top (clock, compass, thermometer).
  // The backing box stops short of the skin, which closes in toward the windscreen above the panel.
  const backingWidth = Math.min(PANEL_WIDTH * 0.96, 2 * (hullHalfWidthAtHeight(COCKPIT.panelD - 0.135, COCKPIT.panel.bottomY + PANEL_HEIGHT * 0.8) - 0.02));
  box(parent, v(COCKPIT.panelD - 0.07, COCKPIT.panel.bottomY + PANEL_HEIGHT * 0.4, 0), [0.13, PANEL_HEIGHT * 0.8, backingWidth], materials.crinkle, 0, 0.01);
  box(parent, v(COCKPIT.panelD - 0.02, COCKPIT.panel.topY + 0.012, 0), [0.12, 0.022, PANEL_WIDTH * 0.62], materials.crinkle, 0, 0.008);
  box(parent, v(COCKPIT.panelD - 0.01, COCKPIT.panel.topY + 0.07, 0), [0.07, 0.09, 0.34], materials.crinkle, 0, 0.012);
  for (const z of [-0.11, 0, 0.11]) {
    const dial = part(parent, new THREE.CircleGeometry(z === 0 ? 0.035 : 0.026, 20), materials.regulatorFace, toX(COCKPIT.panelD + 0.026), COCKPIT.panel.topY + 0.07, z);
    dial.rotation.y = -Math.PI / 2;
  }
}

/** Control pedestal between the seats: throttles, turbo-boost and propeller levers, the AFCE box aft. */
function addPedestal(context: CompartmentContext): THREE.Vector3 {
  const { parent, materials } = context;
  const p = COCKPIT.pedestal;
  const middle = (p.startD + p.endD) / 2;
  box(parent, v(middle, (FLOORS.cockpit.y + p.topY) / 2, 0), [p.endD - p.startD, p.topY - FLOORS.cockpit.y, p.halfWidth * 2], materials.crinkle, 0, 0.015);
  box(parent, v(middle, p.topY + 0.02, 0), [p.endD - p.startD - 0.04, 0.04, p.halfWidth * 2 - 0.02], materials.cockpitGreen, 0, 0.01);
  // Throttles: four levers in a row, knobbed; turbo-boost and mixture levers behind them.
  const throttleD = 3.4;
  for (let lever = 0; lever < THROTTLE_COUNT; lever++) {
    const z = (lever - (THROTTLE_COUNT - 1) / 2) * 0.042;
    rod(parent, v(throttleD + 0.03, p.topY + 0.03, z), v(throttleD - 0.02, p.topY + 0.13, z), 0.006, materials.aluminium, 8);
    part(parent, new THREE.SphereGeometry(0.014, 12, 8), materials.crinkle, toX(throttleD - 0.02), p.topY + 0.135, z);
    rod(parent, v(throttleD + 0.14, p.topY + 0.03, z), v(throttleD + 0.12, p.topY + 0.1, z), 0.005, materials.aluminium, 8);
    part(parent, new THREE.SphereGeometry(0.011, 10, 6), materials.extinguisher, toX(throttleD + 0.12), p.topY + 0.105, z);
  }
  // AFCE (C-1 autopilot) control panel at the aft end, low between the seats.
  box(parent, v(3.72, 0.3, 0), [0.22, 0.2, 0.24], materials.crinkle, 0, 0.012);
  return v(throttleD - 0.02, p.topY + 0.135, 0);
}

/** One pilot's control column, wheel, rudder pedals, seat with armour. Returns the wheel grips and pedal centres. */
function addPilotControls(context: CompartmentContext, side: 1 | -1): { leftGrip: THREE.Vector3; rightGrip: THREE.Vector3; pedals: [THREE.Vector3, THREE.Vector3]; seat: THREE.Vector3 } {
  const { parent, materials } = context;
  const z = side * COCKPIT.column.z;
  const wheelCentre = v(COCKPIT.wheel.d, COCKPIT.wheel.y, z);
  rod(parent, v(COCKPIT.column.d, FLOORS.cockpit.y, z), wheelCentre.clone().add(new THREE.Vector3(0.03, -0.02, 0)), 0.026, materials.cockpitGreen);
  part(parent, new THREE.CylinderGeometry(0.045, 0.045, 0.06, 16), materials.crinkle, wheelCentre.x, wheelCentre.y, z).rotation.z = Math.PI / 2;
  // The B-17's wheel is open at the bottom: an arc from about 8 o'clock over the top to 4 o'clock, with two spokes.
  const rim = new THREE.TorusGeometry(COCKPIT.wheel.radius, WHEEL_TUBE, 10, 40, Math.PI * 1.3);
  rim.rotateZ(-Math.PI * 0.15);
  rim.rotateY(Math.PI / 2);
  part(parent, rim, materials.crinkle, wheelCentre.x, wheelCentre.y, z);
  for (const angle of [Math.PI * 0.85, Math.PI * 0.15]) {
    rod(parent, wheelCentre, wheelCentre.clone().add(new THREE.Vector3(0, Math.sin(angle) * COCKPIT.wheel.radius, Math.cos(angle) * COCKPIT.wheel.radius)), 0.012, materials.crinkle, 8);
  }
  const gripHeight = COCKPIT.wheel.y + 0.02;
  const gripOffset = Math.sqrt(COCKPIT.wheel.radius ** 2 - 0.02 ** 2);
  const leftGrip = v(COCKPIT.wheel.d, gripHeight, z - gripOffset);
  const rightGrip = v(COCKPIT.wheel.d, gripHeight, z + gripOffset);

  const pedals: [THREE.Vector3, THREE.Vector3] = [v(COCKPIT.pedals.d, COCKPIT.pedals.y, z - 0.1), v(COCKPIT.pedals.d, COCKPIT.pedals.y, z + 0.1)];
  for (const pedal of pedals) {
    const plate = part(parent, roundedBox(0.03, 0.2, 0.09, 0.01), materials.aluminium, pedal.x, pedal.y, pedal.z);
    plate.rotation.z = 0.35;
    rod(parent, pedal.clone().add(new THREE.Vector3(0.05, -0.05, 0)), v(COCKPIT.pedals.d - 0.1, FLOORS.cockpit.y, pedal.z), 0.012, materials.cockpitGreen, 8);
  }

  // Seat: cushion, back cushion, and the armour plate with its head shield behind.
  const seat = v(COCKPIT.seat.d, COCKPIT.seat.cushionY, z);
  box(parent, seat.clone().add(new THREE.Vector3(0, -0.04, 0)), [0.46, 0.08, 0.46], materials.seatCushion, 0, 0.03);
  box(parent, v(COCKPIT.seat.d + 0.22, COCKPIT.seat.cushionY + 0.32, z), [0.08, 0.56, 0.44], materials.seatCushion, 0, 0.03);
  box(parent, v(COCKPIT.armourD, COCKPIT.seat.cushionY + 0.38, z), [0.014, 0.82, 0.5], materials.armour, 0, 0.005);
  for (const offset of [-0.18, 0.18]) {
    for (const along of [-0.15, 0.15]) rod(parent, seat.clone().add(new THREE.Vector3(along, -0.08, offset)), v(COCKPIT.seat.d - along, FLOORS.cockpit.y, z + offset), 0.012, materials.cockpitGreen, 8);
  }
  // Side console on the wall beside each pilot; the skin narrows forward and upward, so its forward top edge sets the inset.
  const wall = side * (hullHalfWidthAtHeight(3.45, 0.81) - 0.05);
  box(parent, v(3.7, 0.7, wall), [0.5, 0.22, 0.08], materials.crinkle, 0, 0.012);
  oxygenStation(parent, materials, { d: 4.05, y: 0.82, side });
  return { leftGrip, rightGrip, pedals, seat };
}

/**
 * The Sperry A-1A's basket, hung from the turret ring and turning with it (AN 11-45C-1; Hangar Thirteen, "Lucky
 * Thirteen's Turrets In Detail"), in turret space: y up from the ring, +x forward.
 */
const TOP_TURRET_BASKET = {
  /** The tub under the ring, its sheet cut to a lattice of triangles to save weight; clear of the skin at its top. */
  tub: { radius: 0.45, top: -0.08, bottom: -0.3, rim: 0.035, struts: 24, strutWidth: 0.03, strutThickness: 0.006 },
  /** The V of rails either side of the gunner, from the tub's rim down to the platform, aft of his hips. */
  rail: { x: -0.12, topZ: 0.38, bottomZ: 0.22, radius: 0.018 },
  /** The stainless ammunition can on each rail, forward of it under the tub, so its chute rises inside the dome. */
  can: { centre: new THREE.Vector3(0.05, -0.5, 0.34), size: [0.26, 0.3, 0.12] as [number, number, number] },
  /** The padded sling seat behind the gunner's hips, hung from the rails by a strap at each end. */
  seat: { centre: new THREE.Vector3(-0.19, -0.47, 0), size: [0.15, 0.045, 0.26] as [number, number, number], strapRadius: 0.011 },
  /**
   * Each gun's spent-round bag: its mouth under the gun's ejection port, the bag running aft and outboard round the
   * gunner's elbow and down beside the rail.
   */
  bag: {
    path: [new THREE.Vector3(0.04, 0.06, 0.2), new THREE.Vector3(-0.1, -0.02, 0.26), new THREE.Vector3(-0.24, -0.3, 0.34), new THREE.Vector3(-0.27, -0.8, 0.32)],
    mouthRadius: 0.055,
    radius: 0.048,
  },
  /** The lightened platform of SP-1653 on: an hourglass across the turret, a lobe under each foot. */
  platform: { centreX: -0.04, lobeHalfLength: 0.17, waistHalfLength: 0.07, lobeZ: 0.14, endRadius: 0.12, thickness: 0.025 },
  /** The stirrups on the platform: a heel cup and a toe strap for each boot, clamped to the rail at its height. */
  stirrup: { toeX: 0.05, heelX: -0.135, footZ: 0.12, strapRadius: 0.085, strapRise: 1.6, strap: 0.009, cup: [0.015, 0.05, 0.1] as [number, number, number] },
  /** The double power unit hung under the platform: the motor across it, a hydraulic transmission at each end. */
  powerUnit: { x: 0.06, drop: 0.09, motorRadius: 0.05, motorLength: 0.15, transmission: [0.09, 0.1, 0.07] as [number, number, number] },
  /** The oxygen swivel under the platform's centre, down to its bearing on the flight deck. */
  swivel: { radius: 0.03 },
} as const;

/** Where a rail is at height `y` in turret space, for a basket whose platform is at `platformY`. */
function railPoint(side: 1 | -1, y: number, platformY: number): THREE.Vector3 {
  const { tub } = TOP_TURRET_BASKET;
  const { x, topZ, bottomZ } = TOP_TURRET_BASKET.rail;
  const along = (tub.bottom - y) / (tub.bottom - platformY);
  return new THREE.Vector3(x, y, side * THREE.MathUtils.lerp(topZ, bottomZ, along));
}

/** The platform's half-length fore and aft at `z` across it: the waist on the centreline, the lobes either side. */
function platformHalfLength(z: number): number {
  const { lobeHalfLength, waistHalfLength, lobeZ, endRadius } = TOP_TURRET_BASKET.platform;
  const across = Math.abs(z);
  if (across <= lobeZ) return THREE.MathUtils.lerp(waistHalfLength, lobeHalfLength, THREE.MathUtils.smoothstep(across, 0, lobeZ));
  return lobeHalfLength * Math.sqrt(Math.max(1 - ((across - lobeZ) / endRadius) ** 2, 0));
}

function platformGeometry(): THREE.BufferGeometry {
  const { lobeZ, endRadius, thickness } = TOP_TURRET_BASKET.platform;
  const reach = lobeZ + endRadius;
  const steps = 24;
  const zs = Array.from({ length: steps + 1 }, (_, step) => THREE.MathUtils.lerp(-reach, reach, step / steps));
  // The outline in the shape's (x, y) plane, y standing for z: forward edge port to starboard, back edge returning.
  const outline = [...zs.map((z) => new THREE.Vector2(platformHalfLength(z), z)), ...zs.reverse().map((z) => new THREE.Vector2(-platformHalfLength(z), z))];
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: thickness, bevelEnabled: false });
  // Shape y onto z, the extrusion downward from the top face.
  return geometry.rotateX(Math.PI / 2);
}

/** A flat strut of the tub's lattice, lying in the tub's wall from `from` to `to`. */
function latticeStrut(parent: THREE.Object3D, material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3): void {
  const { strutWidth, strutThickness } = TOP_TURRET_BASKET.tub;
  const along = to.clone().sub(from);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  const outward = new THREE.Vector3(middle.x, 0, middle.z).normalize();
  const length = along.length();
  along.normalize();
  const across = new THREE.Vector3().crossVectors(along, outward).normalize();
  const strut = part(parent, roundedBox(strutWidth, length, strutThickness, 0.002), material, middle.x, middle.y, middle.z);
  strut.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, along, new THREE.Vector3().crossVectors(across, along)));
}

/**
 * The Sperry A-1A's basket, carried by the turret's yaw group: the lattice tub under the ring, the V rails down to the
 * hourglass platform with its stirrups, the stainless ammunition cans on the rails, the sling seat, a spent-round bag
 * under each gun, the double power unit under the platform, and the K-3 computing sight with the hand grips under it.
 */
function addTopTurretBasket(context: CompartmentContext): { leftGrip: THREE.Vector3; rightGrip: THREE.Vector3; platformY: number } {
  const { topTurretYaw, materials } = context;
  const { tub, rail, can, seat, bag, platform, stirrup, powerUnit, swivel } = TOP_TURRET_BASKET;
  const platformY = FLIGHT_DECK.platformY - topTurretYaw.position.y;

  // The tub: a rim top and bottom, joined by a zigzag of struts that leaves the triangular lightening holes.
  for (const y of [tub.top - tub.rim / 2, tub.bottom + tub.rim / 2]) {
    part(topTurretYaw, new THREE.CylinderGeometry(tub.radius, tub.radius, tub.rim, 40, 1, true), materials.frameGreen, 0, y, 0, { castShadow: false });
  }
  const strutTop = tub.top - tub.rim;
  const strutBottom = tub.bottom + tub.rim;
  for (let index = 0; index < tub.struts; index++) {
    const angle = (index / tub.struts) * Math.PI * 2;
    const next = ((index + 1) / tub.struts) * Math.PI * 2;
    const [fromY, toY] = index % 2 === 0 ? [strutTop, strutBottom] : [strutBottom, strutTop];
    latticeStrut(topTurretYaw, materials.frameGreen, new THREE.Vector3(Math.cos(angle) * tub.radius, fromY, Math.sin(angle) * tub.radius), new THREE.Vector3(Math.cos(next) * tub.radius, toY, Math.sin(next) * tub.radius));
  }

  // The platform and its stirrups, the rails, and the swivel and power unit under it.
  part(topTurretYaw, platformGeometry(), materials.aluminium, platform.centreX, platformY, 0);
  for (const side of [-1, 1] as const) {
    rod(topTurretYaw, railPoint(side, tub.bottom, platformY), railPoint(side, platformY, platformY), rail.radius, materials.aluminium);
    const strap = part(topTurretYaw, new THREE.TorusGeometry(stirrup.strapRadius, stirrup.strap, 6, 12, Math.PI), materials.duck, stirrup.toeX, platformY, side * stirrup.footZ);
    strap.rotation.y = Math.PI / 2;
    // Arched high enough to clear the boot over its instep.
    strap.scale.y = stirrup.strapRise;
    const cup = new THREE.Vector3(stirrup.heelX, platformY + stirrup.cup[1] / 2, side * stirrup.footZ);
    box(topTurretYaw, cup, stirrup.cup, materials.aluminium, 0, 0.004);
    // The stirrup's bar runs out to its clamp on the rail; the clamp slides to set the gunner's height.
    const clamp = railPoint(side, platformY + 0.12, platformY);
    rod(topTurretYaw, cup.clone().setY(platformY + 0.03).setZ(side * (stirrup.footZ + stirrup.cup[2] / 2)), clamp, 0.008, materials.aluminium);
    box(topTurretYaw, clamp, [0.05, 0.04, 0.05], materials.crinkle, 0, 0.006);
  }
  const floorY = FLOORS.flightDeck.y - topTurretYaw.position.y;
  const underside = platformY - platform.thickness;
  rod(topTurretYaw, new THREE.Vector3(platform.centreX, underside, 0), new THREE.Vector3(platform.centreX, floorY, 0), swivel.radius, materials.crinkle);
  const unitY = platformY - powerUnit.drop;
  part(topTurretYaw, new THREE.CylinderGeometry(powerUnit.motorRadius, powerUnit.motorRadius, powerUnit.motorLength, 18), materials.crinkle, powerUnit.x, unitY, 0, { rotation: [Math.PI / 2, 0, 0] });
  for (const side of [-1, 1]) {
    const transmission = new THREE.Vector3(powerUnit.x, unitY, side * (powerUnit.motorLength / 2 + powerUnit.transmission[2] / 2));
    box(topTurretYaw, transmission, powerUnit.transmission, materials.crinkle, 0, 0.01);
    rod(topTurretYaw, transmission.clone().setY(unitY + powerUnit.transmission[1] / 2), transmission.clone().setY(underside), 0.012, materials.crinkle);
  }

  // Sling seat behind his hips, a strap from each end up to the rail.
  box(topTurretYaw, seat.centre, seat.size, materials.seatCushion, 0, 0.015);
  for (const side of [-1, 1] as const) {
    const end = seat.centre.clone().add(new THREE.Vector3(0, 0, (side * seat.size[2]) / 2));
    rod(topTurretYaw, end, railPoint(side, seat.centre.y + 0.08, platformY), seat.strapRadius, materials.duck, 6);
  }

  // The ammunition cans on the rails, chutes rising to each gun's outboard feedway. The chutes are routed with the guns
  // level; the belts ride with the guns. The cases fall into the bags under the guns.
  const pitch = context.topTurretPitch;
  for (const side of [-1, 1] as const) {
    const gunInPitch = new THREE.Vector3(0, 0, (side * STATIONS.topTurret.gunSpacing) / 2);
    const belt = feedGun(materials, {
      boxParent: topTurretYaw,
      box: { centre: can.centre.clone().setZ(side * can.centre.z), size: can.size, material: materials.aluminium },
      gun: { origin: gunInPitch.clone().add(pitch.position), direction: FORWARD, side },
      beltGun: { parent: pitch, gun: { origin: gunInPitch, direction: FORWARD, side } },
    });
    const path = bag.path.map((point) => point.clone().setZ(side * point.z));
    context.guns.push({ gun: context.topTurretGuns[side < 0 ? 0 : 1], belt, caseFloorY: topTurretYaw.position.y + path[0].y, casesBagged: true });
    const curve = new THREE.CatmullRomCurve3(path);
    part(topTurretYaw, new THREE.TubeGeometry(curve, 24, bag.radius, 10, false), materials.duck, 0, 0, 0);
    // A stiffened mouth to catch the cases, and the bag's closed bottom.
    part(topTurretYaw, new THREE.TorusGeometry(bag.mouthRadius, 0.007, 6, 16), materials.crinkle, path[0].x, path[0].y, path[0].z, { rotation: [Math.PI / 2, 0, 0] });
    const end = path[path.length - 1];
    part(topTurretYaw, new THREE.SphereGeometry(bag.radius, 10, 6), materials.duck, end.x, end.y, end.z);
  }

  // Computing sight: housing, reflector glass, and the hand grips below.
  part(topTurretYaw, roundedBox(0.12, 0.13, 0.1, 0.015), materials.crinkle, 0.24, 0.29, 0);
  part(topTurretYaw, roundedBox(0.004, 0.07, 0.07, 0.002), materials.glass, 0.18, 0.37, 0).rotation.z = -0.5;
  rod(topTurretYaw, new THREE.Vector3(0.24, 0.22, 0), new THREE.Vector3(0.24, 0.04, 0), 0.02, materials.crinkle);
  part(topTurretYaw, roundedBox(0.06, 0.03, 0.3, 0.01), materials.crinkle, 0.24, 0.02, 0);
  const leftGrip = new THREE.Vector3(0.21, 0.04, -0.15);
  const rightGrip = new THREE.Vector3(0.21, 0.04, 0.15);
  for (const grip of [leftGrip, rightGrip]) rod(topTurretYaw, grip.clone().add(new THREE.Vector3(0, -0.07, 0)), grip.clone().add(new THREE.Vector3(0, 0.05, 0)), 0.016, materials.rubber, 10);
  return { leftGrip, rightGrip, platformY };
}

export function buildCockpit(context: CompartmentContext): CompartmentResult {
  const { parent, materials } = context;
  addInstrumentPanel(context);
  const throttles = addPedestal(context);
  const pilot = addPilotControls(context, -1);
  const copilot = addPilotControls(context, 1);
  // Overhead radio control boxes between the pilots.
  box(parent, v(3.95, hullSectionAt(3.95).top - 0.06, 0), [0.32, 0.06, 0.24], materials.crinkle, 0, 0.01);

  // Flight deck: oxygen bottles on the port wall behind the turret, the hydraulic panel on the bulkhead.
  for (let bottle = 0; bottle < 4; bottle++) {
    const d = FLIGHT_DECK.oxygenBottlesD - 0.9 + bottle * 0.2;
    oxygenBottle(parent, materials, v(d, 0.5, -hullHalfWidthAtHeight(d, 0.5) + 0.13), new THREE.Vector3(0, 1, 0), 0.48, 0.09);
  }
  box(parent, v(BULKHEADS.frontSpar - 0.05, 0.55, 0.5), [0.06, 0.4, 0.3], materials.crinkle, 0, 0.01);
  oxygenStation(parent, materials, { d: 5.3, y: 0.9, side: 1 });
  addBulkhead(parent, materials.bulkheadWeb, BULKHEADS.frontSpar, { bottom: FLOORS.flightDeck.y, top: 1.05, halfWidth: 0.24 });
  addSparTruss(parent, materials.aluminium, BULKHEADS.frontSpar + 0.03, 0.95, -0.95);

  const basket = addTopTurretBasket(context);
  const yaw = FACING.forward;
  const pilotMember: CrewMember = {
    role: 'Pilot',
    pose: pose({
      pelvis: seatedPelvis(pilot.seat, yaw),
      yaw,
      pelvisTilt: 0.15,
      spineBend: 0.12,
      headPitch: 0.05,
      hands: {
        left: verticalGrip(pilot.leftGrip, 'left', yaw, { curl: 0.85, inward: 0.3 }),
        right: verticalGrip(pilot.rightGrip, 'right', yaw, { curl: 0.85, inward: 0.3 }),
      },
      feet: {
        left: plantedFoot(pilot.pedals[0].clone().add(new THREE.Vector3(-0.06, 0.06, 0)), yaw, { sole: new THREE.Vector3(0.6, 0.8, 0) }),
        right: plantedFoot(pilot.pedals[1].clone().add(new THREE.Vector3(-0.06, 0.06, 0)), yaw, { sole: new THREE.Vector3(0.6, 0.8, 0) }),
      },
    }),
    outfit: { upper: 'a2', lower: 'wool', flakVest: true, flakApron: false, flakHelmet: true, lifeVest: true, harness: true, goggles: 'up', oxygenMask: true },
    regulator: v(4.05, 0.77, -(hullHalfWidthAtHeight(4.05, 0.77) - 0.06)),
    faceSeed: 3,
  };
  const copilotMember: CrewMember = {
    role: 'Co-pilot',
    pose: pose({
      pelvis: seatedPelvis(copilot.seat, yaw),
      yaw,
      pelvisTilt: 0.15,
      spineBend: 0.18,
      spineTwist: 0.12,
      spineSide: -0.06,
      headYaw: 0.25,
      hands: {
        // Over the starboard levers of the throttle quadrant: the inboard ones are the pilot's.
        left: palmDown(throttles.clone().add(new THREE.Vector3(0.01, 0.025, 0.06)), 'left', yaw, { curl: 0.55, splay: -0.35 }),
        right: verticalGrip(copilot.rightGrip, 'right', yaw, { curl: 0.85, inward: 0.3 }),
      },
      feet: {
        left: plantedFoot(copilot.pedals[0].clone().add(new THREE.Vector3(-0.06, 0.06, 0)), yaw, { sole: new THREE.Vector3(0.6, 0.8, 0) }),
        right: plantedFoot(copilot.pedals[1].clone().add(new THREE.Vector3(-0.06, 0.06, 0)), yaw, { sole: new THREE.Vector3(0.6, 0.8, 0) }),
      },
    }),
    outfit: { upper: 'b3', lower: 'wool', flakVest: true, flakApron: false, flakHelmet: true, lifeVest: true, harness: true, goggles: 'up', oxygenMask: true },
    regulator: v(4.05, 0.77, hullHalfWidthAtHeight(4.05, 0.77) - 0.06),
    faceSeed: 4,
  };
  // The engineer stands on the turret platform in turret space; his eye level is the sight's.
  const engineerFeetY = basket.platformY + 0.075;
  const engineer: CrewMember = {
    role: 'Flight engineer',
    pose: pose({
      pelvis: new THREE.Vector3(-0.06, basket.platformY + 0.93, 0),
      yaw,
      spineBend: 0.18,
      headPitch: -0.05,
      hands: {
        left: verticalGrip(basket.leftGrip, 'left', yaw, { curl: 0.85, inward: 0.15, elbowOut: 0.35 }),
        right: verticalGrip(basket.rightGrip, 'right', yaw, { curl: 0.85, inward: 0.15, elbowOut: 0.35 }),
      },
      feet: {
        left: plantedFoot(new THREE.Vector3(-0.05, engineerFeetY, -0.12), yaw, { toeOut: 0.2 }),
        right: plantedFoot(new THREE.Vector3(-0.05, engineerFeetY, 0.12), yaw, { toeOut: -0.2 }),
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: false, flakHelmet: false, lifeVest: true, harness: true, goggles: 'down', oxygenMask: true },
    regulator: new THREE.Vector3(-0.2, -0.35, -0.3),
    faceSeed: 5,
  };
  return {
    crew: [
      { member: pilotMember, host: null, label: 'Pilot and co-pilot', placement: 'above' },
      { member: copilotMember, host: null, label: 'Pilot and co-pilot', placement: 'above' },
      { member: engineer, host: context.topTurretYaw, label: 'Flight engineer · top turret', placement: 'above' },
    ],
    stations: [],
  };
}
