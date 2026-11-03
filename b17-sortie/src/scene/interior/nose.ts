import * as THREE from 'three';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, toX } from '../hull';
import { part } from '../kit';
import { addM2, m2Feedway, m2Point } from '../m2';
import { BULKHEADS, FLOORS, NOSE } from './layout';
import { ammunitionFeed, box, extinguisher, pedestalSeat, regulator, rod, type CompartmentContext, type CompartmentResult } from './parts';
import { FACING, knobGrip, palmDown, plantedFoot, pose, seatedPelvis } from './poses';
import { addBulkhead } from './structure';

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);

/** Norden M-9 sight head on its C-1 autopilot stabilizer, on the floor mount over the optical flat. */
function addBombsight(context: CompartmentContext): { leftKnob: THREE.Vector3; rightKnob: THREE.Vector3; eyepiece: THREE.Vector3 } {
  const { parent, materials } = context;
  const floor = FLOORS.nose.y;
  const d = NOSE.bombsight.d;
  for (const z of [-0.12, 0.12]) rod(parent, v(d, floor, z), v(d, -0.36, z), 0.022, materials.aluminium);
  box(parent, v(d, -0.37, 0), [0.3, 0.025, 0.3], materials.aluminium);
  // Stabilizer: gyro housing, servo motors, and the clutch levers on its sides.
  box(parent, v(d, -0.28, 0), [0.34, 0.15, 0.27], materials.crinkle, 0, 0.02);
  part(parent, new THREE.CylinderGeometry(0.07, 0.07, 0.08, 20), materials.aluminium, toX(d + 0.06), -0.17, -0.07);
  for (const z of [-0.145, 0.145]) part(parent, new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16), materials.aluminium, toX(d), -0.28, z).rotation.x = Math.PI / 2;
  // Sight head with its telescope housing and the eyepiece rising aft toward the bombardier.
  box(parent, v(d + 0.04, -0.1, 0), [0.28, 0.16, 0.18], materials.crinkle, 0, 0.02);
  part(parent, new THREE.CylinderGeometry(0.04, 0.045, 0.2, 16), materials.crinkle, toX(d - 0.06), -0.12, 0);
  const eyepiece = v(NOSE.bombsight.eyepieceD, NOSE.bombsight.eyepieceY, 0);
  rod(parent, v(d + 0.12, -0.04, 0), eyepiece, 0.024, materials.crinkle);
  part(parent, new THREE.CylinderGeometry(0.028, 0.022, 0.03, 16), materials.rubber, eyepiece.x - 0.01, eyepiece.y + 0.005, 0);
  // Rate and displacement knobs either side of the sight head.
  const knobs = { leftKnob: v(d + 0.06, -0.1, -0.115), rightKnob: v(d + 0.06, -0.1, 0.115) };
  for (const knob of [knobs.leftKnob, knobs.rightKnob]) {
    part(parent, new THREE.CylinderGeometry(0.028, 0.028, 0.03, 18), materials.aluminium, knob.x, knob.y, knob.z).rotation.x = Math.PI / 2;
  }
  return { ...knobs, eyepiece };
}

/** Cheek gun on its socket mount in the window, its ammunition box on the floor and the feed chute up to the receiver. */
function addCheekGun(context: CompartmentContext, d: number, side: 1 | -1): void {
  const { parent: compartment, materials } = context;
  // The barrel is outside the skin, so the gun stays when the cutaway hides the starboard wall's equipment.
  const parent = new THREE.Group();
  parent.userData.staysInCutaway = true;
  compartment.add(parent);
  const mount = v(d, 0.05, side * (hullHalfWidthAtHeight(d, 0.05) - 0.02));
  // The gun points forward and out; its receiver runs back inside the nose.
  const direction = new THREE.Vector3(1, -0.05, side * 0.32);
  addM2(parent, mount, direction, 'flexible');
  // Boxes against the wall are inset from the skin at their bottom edge, where the nose is narrowest.
  const ammunition = v(d + 0.15, FLOORS.nose.y + 0.14, side * (hullHalfWidthAtHeight(d, FLOORS.nose.y) - 0.1));
  const nearSide = m2Point(mount, direction, new THREE.Vector3(0, 0, 1)).sub(mount).dot(ammunition.clone().sub(mount)) > 0 ? 1 : -1;
  const feedway = m2Point(mount, direction, m2Feedway(nearSide));
  ammunitionFeed(compartment, materials, ammunition, [0.3, 0.28, 0.16], 0, [ammunition.clone().add(new THREE.Vector3(0, 0.14, 0)), feedway.clone().add(new THREE.Vector3(0, -0.15, 0)), feedway]);
}

function addNavigatorStation(context: CompartmentContext): { table: THREE.Vector3; chart: THREE.Vector3 } {
  const { parent, materials } = context;
  const table = NOSE.navigatorTable;
  // The nose narrows forward, so the table's forward corner sets how far out it reaches.
  const wallZ = -hullHalfWidthAtHeight(table.start, table.topY) + 0.02;
  const depth = Math.abs(wallZ - table.innerZ);
  const middle = (table.start + table.end) / 2;
  box(parent, v(middle, table.topY - 0.012, (wallZ + table.innerZ) / 2), [table.end - table.start, 0.024, depth], materials.cockpitGreen, 0, 0.006);
  // Chart, plotter and the drift meter on the floor by his feet.
  const chart = v(middle, table.topY + 0.002, (wallZ + table.innerZ) / 2);
  part(parent, new THREE.PlaneGeometry(0.62, depth - 0.08), materials.chartPaper, chart.x, chart.y, chart.z).rotation.x = -Math.PI / 2;
  box(parent, chart.clone().add(new THREE.Vector3(0.08, 0.003, 0.03)), [0.2, 0.004, 0.08], materials.glass, 0.4, 0.002);
  for (const d of [table.start + 0.05, table.end - 0.05]) rod(parent, v(d, table.topY - 0.02, table.innerZ + 0.04), v(d, FLOORS.nose.y, table.innerZ + 0.04), 0.012, materials.aluminium);
  // Navigator's instrument panel between his windows: airspeed, altimeter, compass, clock.
  const panelZ = -hullHalfWidthAtHeight(2.04, 0.5) + 0.03;
  box(parent, v(2.22, 0.42, panelZ), [0.36, 0.16, 0.03], materials.crinkle, 0, 0.008);
  for (let dial = 0; dial < 4; dial++) part(parent, new THREE.CircleGeometry(0.03, 20), materials.regulatorFace, toX(2.09 + dial * 0.087), 0.42, panelZ + 0.017);
  // B-5 drift meter on its floor pedestal ahead of the table.
  rod(parent, v(1.66, FLOORS.nose.y, -0.42), v(1.66, -0.18, -0.42), 0.05, materials.crinkle);
  part(parent, new THREE.CylinderGeometry(0.035, 0.03, 0.08, 14), materials.rubber, toX(1.66), -0.15, -0.42);
  regulator(parent, materials, v(2.55, 0.25, -hullHalfWidthAtHeight(2.55, 0.25) + 0.04), -Math.PI / 2);
  return { table: v(middle, table.topY, table.innerZ), chart };
}

export function buildNose(context: CompartmentContext): CompartmentResult {
  const { parent, materials } = context;
  const floor = FLOORS.nose.y;
  const sight = addBombsight(context);

  // Bombardier's seat, his control panel on the port wall, the chin turret control stowed to starboard.
  const seat = v(NOSE.bombardierSeat.d, NOSE.bombardierSeat.cushionY, 0);
  pedestalSeat(parent, materials, seat, floor, { back: { yaw: FACING.forward, height: 0.22 } });
  const panelZ = -hullHalfWidthAtHeight(0.93, 0.12) + 0.04;
  box(parent, v(1.1, 0.0, panelZ), [0.34, 0.24, 0.05], materials.crinkle, 0, 0.01);
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 4; column++) {
      part(parent, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), materials.aluminium, toX(0.98 + column * 0.08), 0.05 - row * 0.09, panelZ + 0.035).rotation.x = Math.PI / 2;
    }
  }
  const chin = NOSE.chinControl;
  rod(parent, v(chin.d + 0.25, 0.25, hullHalfWidthAtHeight(chin.d + 0.25, 0.25) - 0.03), v(chin.d, chin.y + 0.08, chin.z), 0.02, materials.aluminium);
  box(parent, v(chin.d, chin.y, chin.z), [0.12, 0.14, 0.2], materials.crinkle, 0, 0.02);
  for (const offset of [-0.13, 0.13]) rod(parent, v(chin.d, chin.y, chin.z + offset * 0.6), v(chin.d, chin.y, chin.z + offset), 0.016, materials.rubber);
  // Below the starboard cheek gun's receiver, so his hose does not run through it.
  regulator(parent, materials, v(1.35, -0.25, hullHalfWidthAtHeight(1.35, -0.25) - 0.04), -Math.PI / 2);

  addCheekGun(context, NOSE.cheekGuns.starboardD, 1);
  addCheekGun(context, NOSE.cheekGuns.portD, -1);
  const navigator = addNavigatorStation(context);
  pedestalSeat(parent, materials, v(NOSE.navigatorSeat.d, NOSE.navigatorSeat.cushionY, NOSE.navigatorSeat.z), floor, { radius: 0.17 });

  // Bulkhead No. 4 with the crawlway opening under the cockpit floor; fire extinguisher beside it.
  addBulkhead(parent, materials.bulkheadWeb, BULKHEADS.noseToCockpit, { bottom: FLOORS.crawlway.y, top: FLOORS.cockpit.y - 0.04, halfWidth: 0.3 });
  extinguisher(parent, materials, v(BULKHEADS.noseToCockpit - 0.06, floor, 0.45));
  // Chin turret ammunition boxes either side of the floor ahead of the navigator.
  for (const side of [-1, 1]) box(parent, v(1.62, floor + 0.12, side * (hullHalfWidthAtHeight(1.44, floor) - 0.09)), [0.36, 0.24, 0.14], materials.ammunitionBox);

  const bombardierYaw = FACING.forward;
  const bombardier: CrewMember = {
    role: 'Bombardier',
    pose: pose({
      pelvis: seatedPelvis(seat, bombardierYaw),
      yaw: bombardierYaw,
      pelvisTilt: -0.12,
      spineBend: 0.95,
      headPitch: 0.55,
      hands: {
        left: knobGrip(sight.leftKnob.clone().add(new THREE.Vector3(0, 0, -0.03)), 'left', bombardierYaw, new THREE.Vector3(0, 0, 1)),
        right: knobGrip(sight.rightKnob.clone().add(new THREE.Vector3(0, 0, 0.03)), 'right', bombardierYaw, new THREE.Vector3(0, 0, -1)),
      },
      feet: {
        left: plantedFoot(v(0.86, floor + 0.075, -0.2), bombardierYaw, { toeOut: 0.25 }),
        right: plantedFoot(v(0.86, floor + 0.075, 0.2), bombardierYaw, { toeOut: -0.25 }),
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: false, flakHelmet: true, lifeVest: true, harness: true, goggles: 'up', oxygenMask: true },
    regulator: v(1.35, -0.33, hullHalfWidthAtHeight(1.35, -0.33) - 0.08),
    faceSeed: 1,
  };

  const navigatorYaw = FACING.port;
  const navigatorSeat = v(NOSE.navigatorSeat.d, NOSE.navigatorSeat.cushionY, NOSE.navigatorSeat.z);
  const navigatorMember: CrewMember = {
    role: 'Navigator',
    pose: pose({
      pelvis: seatedPelvis(navigatorSeat, navigatorYaw),
      yaw: navigatorYaw,
      spineBend: 0.45,
      headPitch: 0.45,
      headYaw: -0.15,
      hands: {
        right: palmDown(navigator.chart.clone().add(new THREE.Vector3(0.14, 0.03, -0.02)), 'right', navigatorYaw, { curl: 0.6 }),
        left: palmDown(navigator.chart.clone().add(new THREE.Vector3(-0.17, 0.025, 0.01)), 'left', navigatorYaw, { curl: 0.12, splay: 0.1 }),
      },
      feet: {
        right: plantedFoot(v(2.12, floor + 0.075, -0.48), navigatorYaw, { toeOut: 0.1 }),
        left: plantedFoot(v(2.38, floor + 0.075, -0.48), navigatorYaw, { toeOut: -0.1 }),
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: false, flakHelmet: false, lifeVest: true, harness: true, goggles: 'up', oxygenMask: true },
    regulator: v(2.55, 0.17, -hullHalfWidthAtHeight(2.55, 0.17) + 0.07),
    faceSeed: 2,
  };

  return {
    crew: [
      { member: bombardier, host: null, label: 'Bombardier · Norden sight', placement: 'above' },
      { member: navigatorMember, host: null, label: 'Navigator', placement: 'above' },
    ],
    stations: [],
  };
}
