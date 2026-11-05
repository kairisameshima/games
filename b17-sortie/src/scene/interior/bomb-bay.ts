import * as THREE from 'three';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { addM2 } from '../m2';
import { feedGun, receiverSideToward } from './ammunition';
import { BOMB_BAY, BULKHEADS, FLOORS, RADIO_ROOM } from './layout';
import { box, extinguisher, oxygenBottle, pedestalSeat, rod, type CompartmentContext, type CompartmentResult, type CrewStation } from './parts';
import { FACING, knobGrip, palmDown, plantedFoot, pose, seatedPelvis } from './poses';
import { oxygenStation } from './fittings';
import { addBulkhead, addSparTruss } from './structure';

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);
const RACK_UPRIGHT_SPACING = 0.84;
/** AN-M64 suspension lugs are 14 in apart. */
const BOMB_LUG_SPACING = 0.356;

/** The step at the catwalk's forward end, from the front spar bulkhead to `BOMB_BAY.step.endD`, and what is on it. */
function addCatwalkStep(context: CompartmentContext, start: number): void {
  const { parent, materials } = context;
  const step = BOMB_BAY.step;
  const length = step.endD - start;
  const middle = (start + step.endD) / 2;
  const tread = 0.03;
  box(parent, v(middle, step.topY - tread / 2, 0), [length, tread, step.halfWidth * 2], materials.plywood, 0, 0.006);
  // Riser on the aft face down to the catwalk, with the step light in it, lens aft along the catwalk.
  const riserHeight = step.topY - tread - BOMB_BAY.catwalkY;
  box(parent, v(step.endD - 0.01, BOMB_BAY.catwalkY + riserHeight / 2, 0), [0.02, riserHeight, step.halfWidth * 2], materials.frameGreen, 0, 0.004);
  part(parent, new THREE.CylinderGeometry(0.03, 0.034, 0.025, 14), materials.aluminium, toX(step.endD + 0.003), step.topY - 0.12, 0, { rotation: [0, 0, Math.PI / 2] });
  part(parent, new THREE.SphereGeometry(0.022, 12, 8, 0, Math.PI), materials.lampLens, toX(step.endD + 0.016), step.topY - 0.12, 0, { rotation: [0, -Math.PI / 2, 0] });
  // Hand-crank torque connection for the bomb doors: a boss on the tread, starboard.
  part(parent, new THREE.CylinderGeometry(0.025, 0.03, 0.03, 12), materials.gunBlack, toX(middle), step.topY + 0.015, 0.11);
  // Emergency bomb release handle, port, under its hinged guard.
  part(parent, roundedBox(0.1, 0.025, 0.03, 0.008), materials.extinguisher, toX(middle), step.topY + 0.02, -0.11);
  const guard = part(parent, roundedBox(0.16, 0.006, 0.08, 0.002), materials.aluminium, toX(middle), step.topY + 0.05, -0.11);
  guard.rotation.x = -0.25;
}

export interface BombBayResult extends CompartmentResult {
  /** Racked bombs in release order: bottom tier first, alternating starboard and port. */
  rackedBombs: THREE.Object3D[];
}

/** Catwalk on the keel beam, the two vertical racks with their shackles, and the twelve 500 lb bombs. */
export function buildBombBay(context: CompartmentContext): BombBayResult {
  const { parent, root, materials, createBomb } = context;
  const start = BULKHEADS.frontSpar + 0.08;
  const end = BULKHEADS.rearSpar - 0.08;
  const middle = (start + end) / 2;
  const length = end - start;
  const bay = BOMB_BAY;

  // Keel beam with the catwalk on top and V-braces down to the floor frames.
  box(parent, v(middle, bay.catwalkY - 0.012, 0), [length + 0.1, 0.024, bay.catwalkHalfWidth * 2], materials.plywood, 0, 0.006);
  box(parent, v(middle, bay.catwalkY - 0.12, 0), [length + 0.1, 0.2, 0.05], materials.aluminium, 0, 0.008);
  for (let d = start + 0.2; d < end; d += 0.55) {
    for (const side of [-1, 1]) rod(parent, v(d, bay.catwalkY - 0.2, 0), v(d, hullSectionAt(d).bottom + 0.12, side * 0.28), 0.014, materials.aluminium, 8);
  }
  addCatwalkStep(context, start);
  // Bomb racks: a vertical rack each side of the catwalk, its two uprights on the bay floor frames and up to the roof.
  // The bombs hang outboard of it on their sides, lugs inboard, each in a B-7 shackle bolted to the rack.
  const topTierY = bay.lowestTierY + (bay.tiers - 1) * bay.tierSpacing;
  for (const side of [-1, 1]) {
    const z = side * bay.rackFrameZ;
    for (const d of [middle - RACK_UPRIGHT_SPACING / 2, middle + RACK_UPRIGHT_SPACING / 2]) {
      rod(parent, v(d, bay.catwalkY, z), v(d, topTierY + 0.3, z), 0.022, materials.aluminium);
    }
    // Rope hand-line along the rack at shoulder height, for crossing the bay.
    rod(parent, v(start, 0.25, side * (bay.rackFrameZ - 0.03)), v(end, 0.25, side * (bay.rackFrameZ - 0.03)), 0.007, materials.chartPaper, 6);
    for (let tier = 0; tier < bay.tiers; tier++) {
      const y = bay.lowestTierY + tier * bay.tierSpacing;
      // Rack rail between the uprights, the shackle on it, and its two hooks through the bomb's lugs.
      box(parent, v(middle, y, z), [RACK_UPRIGHT_SPACING, 0.04, 0.03], materials.aluminium, 0, 0.006);
      box(parent, v(middle, y, side * (bay.rackFrameZ + 0.025)), [0.42, 0.07, 0.03], materials.gunBlack, 0, 0.008);
      for (const along of [-BOMB_LUG_SPACING / 2, BOMB_LUG_SPACING / 2]) {
        const hook = part(parent, new THREE.TorusGeometry(0.02, 0.005, 6, 12, Math.PI), materials.gunBlack, toX(middle + along), y, side * (bay.rackFrameZ + 0.045));
        hook.rotation.set(Math.PI / 2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
  }
  const rackedBombs: THREE.Object3D[] = [];
  for (let index = 0; index < bay.tiers * 2; index++) {
    const bomb = createBomb();
    const side = index % 2 === 0 ? 1 : -1;
    bomb.position.set(toX(middle), bay.lowestTierY + (index >> 1) * bay.tierSpacing, side * bay.rackZ);
    // Lugs (the bomb's +y) turned inboard to the rack.
    bomb.rotation.x = (-side * Math.PI) / 2;
    // Hidden one by one as the bombs drop, so no merge may fold it in.
    bomb.userData.unmerged = true;
    root.add(bomb);
    rackedBombs.push(bomb);
  }
  // Rear spar bulkhead No. 6 with the door from the catwalk into the radio room.
  addBulkhead(parent, materials.bulkheadWeb, BULKHEADS.rearSpar, { bottom: FLOORS.radioRoom.y, top: 0.55, halfWidth: 0.22 });
  addSparTruss(parent, materials.aluminium, BULKHEADS.rearSpar - 0.03, 0.85, -0.95);
  const stations: CrewStation[] = [{
    role: 'Bomb bay', anchor: v(middle, bay.lowestTierY + 2 * bay.tierSpacing, 0), placement: 'above', showsBombLoad: true,
  }];
  return { crew: [], stations, rackedBombs };
}

/**
 * Radio room: the operator's table at the forward port corner with the BC-348 receiver and the Morse key, the liaison
 * transmitter (BC-375) and its tuning units on the aft bulkhead, the gun in the roof hatch, ammunition and oxygen.
 */
export function buildRadioRoom(context: CompartmentContext): CompartmentResult {
  const { parent, materials } = context;
  const floor = FLOORS.radioRoom.y;
  const table = RADIO_ROOM.table;
  const wallZ = -hullHalfWidthAtHeight((table.start + table.end) / 2, table.topY) + 0.03;
  const tableMiddle = (table.start + table.end) / 2;
  box(parent, v(tableMiddle, table.topY - 0.012, (wallZ + table.innerZ) / 2), [table.end - table.start, 0.024, Math.abs(wallZ - table.innerZ)], materials.plywood, 0, 0.006);
  for (const d of [table.start + 0.04, table.end - 0.04]) rod(parent, v(d, table.topY - 0.02, table.innerZ + 0.04), v(d, floor, table.innerZ + 0.04), 0.012, materials.aluminium);
  // Receiver on the table against the bulkhead, its face toward the operator.
  const receiver = v(table.start + 0.14, table.topY + 0.13, (wallZ + table.innerZ) / 2 - 0.05);
  box(parent, receiver, [0.24, 0.26, 0.42], materials.crinkle, 0, 0.01);
  const face = part(parent, new THREE.PlaneGeometry(0.42, 0.21), materials.radioFace, receiver.x - 0.121, receiver.y, receiver.z);
  face.rotation.y = -Math.PI / 2;
  // Command sets on a shelf above, and the Morse key on the table.
  box(parent, v(table.start + 0.1, table.topY + 0.48, receiver.z), [0.2, 0.18, 0.5], materials.crinkle, 0, 0.01);
  const key = v(table.end - 0.16, table.topY + 0.015, -0.4);
  box(parent, key, [0.1, 0.02, 0.06], materials.crinkle, 0, 0.004);
  rod(parent, key.clone().add(new THREE.Vector3(0.03, 0.01, 0)), key.clone().add(new THREE.Vector3(-0.04, 0.03, 0)), 0.004, materials.brass, 6);
  part(parent, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), materials.crinkle, key.x - 0.04, key.y + 0.038, key.z);

  // Liaison transmitter and the stack of tuning units on the aft bulkhead.
  const transmitter = RADIO_ROOM.transmitter;
  box(parent, v(transmitter.d - 0.14, floor + 0.62, transmitter.z), [0.26, 0.5, 0.52], materials.crinkle, 0, 0.012);
  const txFace = part(parent, new THREE.PlaneGeometry(0.5, 0.25), materials.radioFace, toX(transmitter.d - 0.27) - 0.001, floor + 0.7, transmitter.z);
  txFace.rotation.y = -Math.PI / 2;
  for (let unit = 0; unit < 3; unit++) box(parent, v(transmitter.d - 0.1, floor + 0.13 + unit * 0.13, 0.4), [0.2, 0.11, 0.34], materials.crinkle, 0, 0.01);

  // Radio-room gun on its mount in the roof hatch, stowed pointing aft; its ammunition box below.
  const hatchD = 9.5;
  const roof = hullSectionAt(hatchD).top;
  const mount = v(hatchD - 0.1, roof - 0.12, 0);
  const elevation = new THREE.Vector3(-0.8, 0.6, 0);
  const gun = addM2(parent, mount, elevation, 'flexible');
  rod(parent, v(hatchD - 0.1, roof - 0.02, 0), mount.clone().add(new THREE.Vector3(0, -0.05, 0)), 0.02, materials.aluminium);
  const ammunitionBox = v(hatchD - 0.2, floor + 0.15, 0.55);
  const belt = feedGun(materials, {
    boxParent: parent,
    box: { centre: ammunitionBox, size: [0.3, 0.28, 0.16], material: materials.ammunitionBox },
    gun: { origin: mount, direction: elevation, side: receiverSideToward(mount, elevation, ammunitionBox) },
  });
  context.guns.push({ gun, belt, caseFloorY: floor, casesBagged: false });

  // Oxygen bottles under the starboard wall, a regulator for the operator, extinguisher on the forward bulkhead.
  for (let bottle = 0; bottle < 2; bottle++) {
    oxygenBottle(parent, materials, v(9.15 + bottle * 0.22, floor + 0.2, hullHalfWidthAtHeight(9.15, floor + 0.2) - 0.14), new THREE.Vector3(1, 0, 0), 0.42, 0.09);
  }
  oxygenStation(parent, materials, { d: 9.35, y: 0.25, side: -1 });
  extinguisher(parent, materials, v(BULKHEADS.rearSpar + 0.08, floor, 0.45));
  // Radio-room / waist bulkhead No. 7 with its door.
  addBulkhead(parent, materials.bulkheadWeb, BULKHEADS.radioToWaist, { bottom: floor, top: 0.95, halfWidth: 0.26 });

  const seat = v(RADIO_ROOM.operatorSeat.d, RADIO_ROOM.operatorSeat.cushionY, RADIO_ROOM.operatorSeat.z);
  pedestalSeat(parent, materials, seat, floor, { back: { yaw: FACING.forward, height: 0.32 } });
  const yaw = FACING.forward;
  const operator: CrewMember = {
    role: 'Radio operator',
    pose: pose({
      pelvis: seatedPelvis(seat, yaw),
      yaw,
      spineBend: 0.35,
      headPitch: 0.25,
      headYaw: 0.15,
      hands: {
        right: palmDown(key.clone().add(new THREE.Vector3(-0.03, 0.05, 0.01)), 'right', yaw, { curl: 0.45, fingerDrop: 0.4 }),
        left: knobGrip(receiver.clone().add(new THREE.Vector3(-0.15, -0.03, 0.12)), 'left', yaw, new THREE.Vector3(1, 0, 0), 0.6),
      },
      feet: {
        left: plantedFoot(v(9.15, floor + 0.075, -0.52), yaw, { toeOut: 0.1 }),
        right: plantedFoot(v(9.15, floor + 0.075, -0.3), yaw, { toeOut: -0.1 }),
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: false, flakHelmet: false, lifeVest: true, harness: true, goggles: 'up', oxygenMask: true },
    regulator: v(9.35, 0.17, -hullHalfWidthAtHeight(9.35, 0.17) + 0.08),
    faceSeed: 6,
  };
  return { crew: [{ member: operator, host: null, label: 'Radio operator', placement: 'above' }], stations: [] };
}
