import * as THREE from 'three';
import { STATIONS } from '../b17-dimensions';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { feedGun } from './ammunition';
import { BULKHEADS, COCKPIT, FLIGHT_DECK, FLOORS } from './layout';
import { applyPanelUvs, instrumentPanelTexture, panelOutline, PANEL_HEIGHT, PANEL_WIDTH } from './panels';
import { box, oxygenBottle, regulator, rod, type CompartmentContext, type CompartmentResult } from './parts';
import { FACING, palmDown, plantedFoot, pose, seatedPelvis, verticalGrip } from './poses';
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
  regulator(parent, materials, v(4.05, 0.85, side * (hullHalfWidthAtHeight(4.05, 0.95) - 0.05)), side > 0 ? -Math.PI / 2 : Math.PI / 2);
  return { leftGrip, rightGrip, pedals, seat };
}

/**
 * The Sperry top turret's interior, carried by the turret's yaw group: the engineer's platform, the K-3 computing sight
 * in front of his face, the two hand grips under it, and the ammunition boxes either side.
 */
function addTopTurretBasket(context: CompartmentContext): { leftGrip: THREE.Vector3; rightGrip: THREE.Vector3; platformY: number } {
  const { topTurretYaw, materials } = context;
  const platformY = FLIGHT_DECK.platformY - topTurretYaw.position.y;
  part(topTurretYaw, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 28), materials.aluminium, 0, platformY - 0.015, 0);
  rod(topTurretYaw, new THREE.Vector3(-0.22, platformY, 0), new THREE.Vector3(-0.3, 0.02, 0), 0.03, materials.aluminium);
  // Ammunition boxes either side below the guns, chutes rising to each gun's outboard feedway. The chutes are routed
  // with the guns level; the belts ride with the guns.
  const pitch = context.topTurretPitch;
  for (const side of [-1, 1] as const) {
    const gunInPitch = new THREE.Vector3(0, 0, (side * STATIONS.topTurret.gunSpacing) / 2);
    const belt = feedGun(materials, {
      boxParent: topTurretYaw,
      box: { centre: new THREE.Vector3(-0.04, -0.42, side * 0.36), size: [0.26, 0.3, 0.13], material: materials.ammunitionBox },
      gun: { origin: gunInPitch.clone().add(pitch.position), direction: FORWARD, side },
      beltGun: { parent: pitch, gun: { origin: gunInPitch, direction: FORWARD, side } },
    });
    // Empty cases drop out of the receivers through the basket onto the flight deck.
    context.guns.push({ gun: context.topTurretGuns[side < 0 ? 0 : 1], belt, caseFloorY: FLOORS.flightDeck.y });
  }
  // Computing sight: housing, reflector glass, and the hand grips below.
  part(topTurretYaw, roundedBox(0.12, 0.13, 0.1, 0.015), materials.crinkle, 0.24, 0.17, 0);
  part(topTurretYaw, roundedBox(0.004, 0.07, 0.07, 0.002), materials.glass, 0.18, 0.25, 0).rotation.z = -0.5;
  rod(topTurretYaw, new THREE.Vector3(0.24, 0.1, 0), new THREE.Vector3(0.24, -0.08, 0), 0.02, materials.crinkle);
  part(topTurretYaw, roundedBox(0.06, 0.03, 0.3, 0.01), materials.crinkle, 0.24, -0.1, 0);
  const leftGrip = new THREE.Vector3(0.21, -0.08, -0.15);
  const rightGrip = new THREE.Vector3(0.21, -0.08, 0.15);
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
  regulator(parent, materials, v(5.3, 0.9, hullHalfWidthAtHeight(5.3, 0.9) - 0.04), -Math.PI / 2);
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
