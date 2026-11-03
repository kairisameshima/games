import * as THREE from 'three';
import { STATIONS } from '../b17-dimensions';
import { ballShellGeometry } from '../ball-turret';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part } from '../kit';
import { addM2, M2_BACKPLATE, M2_GRIPS, m2Feedway, m2Point } from '../m2';
import { BULKHEADS, TAIL, WAIST } from './layout';
import { ammunitionFeed, box, oxygenBottle, pedestalSeat, regulator, rod, type CompartmentContext, type CompartmentResult } from './parts';
import { FACING, plantedFoot, pose, verticalGrip } from './poses';
import { tailFloorHeight, waistFloorHeight } from './structure';

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);
const AFT = new THREE.Vector3(-1, 0, 0);
/** Waist gun on its K-6 mount in the window: the gun, the mount post, and its ammunition box and feed chute. */
function addWaistGun(context: CompartmentContext, d: number, side: 1 | -1): { grips: [THREE.Vector3, THREE.Vector3]; yaw: number } {
  const { parent: compartment, materials } = context;
  // The gun stays visible in a cutaway even on the starboard side: the gunner is holding it.
  const parent = new THREE.Group();
  parent.userData.staysInCutaway = true;
  compartment.add(parent);
  const mount = v(d, WAIST.gunY, side * (hullSectionAt(d).halfWidth - 0.04));
  // The forward (starboard) gun swings aft and the aft (port) gun forward, so the two gunners, who stand back to back
  // near the centreline with the grips 0.6 m inboard of the mounts, are not in each other's way.
  const outward = new THREE.Vector3(side > 0 ? -0.35 : 0.35, -0.1, side).normalize();
  addM2(parent, mount, outward, 'flexible');
  // Mount post down to the window sill, then the yoke up to the trunnions.
  const sill = mount.clone().add(new THREE.Vector3(0, -0.36, 0)).addScaledVector(outward, 0.04);
  rod(parent, sill, mount.clone().add(new THREE.Vector3(0, -0.1, 0)), 0.022, materials.aluminium);
  for (const offset of [-0.065, 0.065]) {
    const trunnion = m2Point(mount, outward, new THREE.Vector3(-0.05, -0.03, offset));
    rod(parent, mount.clone().add(new THREE.Vector3(0, -0.1, 0)), trunnion, 0.01, materials.aluminium, 8);
  }
  // Ammunition box on the floor against the wall aft of the window; the belt enters the receiver on its aft side.
  const floor = waistFloorHeight(d + 0.7);
  const ammunition = v(d + 0.7, floor + 0.2, side * (hullHalfWidthAtHeight(d + 0.7, floor) - 0.12));
  const aftSide = m2Point(mount, outward, new THREE.Vector3(0, 0, 1)).sub(mount).dot(ammunition.clone().sub(mount)) > 0 ? 1 : -1;
  const feedway = m2Point(mount, outward, m2Feedway(aftSide));
  ammunitionFeed(compartment, materials, ammunition, [0.34, 0.4, 0.2], 0, [
    ammunition.clone().add(new THREE.Vector3(0, 0.2, 0)),
    ammunition.clone().lerp(feedway, 0.5).add(new THREE.Vector3(0, 0.2, 0)),
    feedway,
  ]);
  // The gunner faces the window: his yaw turns him to look out along the gun.
  return { grips: [m2Point(mount, outward, M2_GRIPS.left), m2Point(mount, outward, M2_GRIPS.right)], yaw: Math.atan2(-outward.z, outward.x) };
}

function waistGunner(role: string, gun: { grips: [THREE.Vector3, THREE.Vector3]; yaw: number }, d: number, side: 1 | -1, faceSeed: number): CrewMember {
  const floor = waistFloorHeight(d);
  const forward = new THREE.Vector3(Math.cos(gun.yaw), 0, -Math.sin(gun.yaw));
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  const [leftGrip, rightGrip] = gun.grips;
  const gripCentre = leftGrip.clone().add(rightGrip).multiplyScalar(0.5);
  // Stand a forearm's reach behind the grips, feet apart and staggered for the kick of the gun.
  const pelvis = gripCentre.clone().addScaledVector(forward, -0.42);
  pelvis.y = floor + 0.93;
  const foot = (along: number, lateral: number) => pelvis.clone().addScaledVector(forward, along).addScaledVector(right, lateral).setY(floor + 0.075);
  return {
    role,
    pose: pose({
      pelvis,
      yaw: gun.yaw,
      spineBend: 0.32,
      headPitch: -0.12,
      hands: {
        left: verticalGrip(leftGrip, 'left', gun.yaw, { curl: 0.9, inward: 0.1, elbowOut: 0.9 }),
        right: verticalGrip(rightGrip, 'right', gun.yaw, { curl: 0.9, inward: 0.1, elbowOut: 0.9 }),
      },
      feet: {
        left: plantedFoot(foot(0.12, -0.17), gun.yaw, { toeOut: 0.3 }),
        right: plantedFoot(foot(-0.16, 0.17), gun.yaw, { toeOut: -0.35 }),
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: true, flakHelmet: true, lifeVest: true, harness: true, goggles: 'down', oxygenMask: true },
    regulator: v(d - 0.5, floor + 1.0, side * (hullHalfWidthAtHeight(d - 0.5, floor + 1.0) - 0.07)),
    faceSeed,
  };
}

export function buildWaistAndTail(context: CompartmentContext): CompartmentResult {
  const { parent, materials, ballTurretPitch } = context;

  // Ball turret support column from the roof down to the azimuth ring in the floor.
  const ball = STATIONS.ballTurret;
  const ballFloor = waistFloorHeight(ball.d);
  rod(parent, v(ball.d, hullSectionAt(ball.d).top - 0.04, 0), v(ball.d, ballFloor, 0), 0.06, materials.aluminium);
  part(parent, new THREE.TorusGeometry(0.4, 0.035, 8, 40), materials.aluminium, toX(ball.d), ballFloor + 0.03, 0).rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) rod(parent, v(ball.d, hullSectionAt(ball.d).top - 0.1, 0), v(ball.d + side * 0.45, ballFloor + 0.04, 0), 0.025, materials.aluminium);

  // The ball turret's own interior: shell lining, ammunition boxes either side of the gunner, the sight.
  // Lining stops at the front window and the glazed sides, so the gunner can be seen through them.
  part(ballTurretPitch, ballShellGeometry(ball.radius - 0.012), materials.turretLining, 0, 0, 0, { castShadow: false });
  // Ammunition boxes along the sides above the guns, inboard of the glazed side wheels.
  for (const side of [-1, 1]) part(ballTurretPitch, new THREE.BoxGeometry(0.26, 0.12, 0.08), materials.ammunitionBox, -0.12, 0.17, side * 0.31);
  // Sperry K-4 sight hangs in front of his face; the grips flank it, ahead of his shoulders.
  part(ballTurretPitch, new THREE.BoxGeometry(0.1, 0.1, 0.09), materials.crinkle, 0.08, 0.26, 0);
  part(ballTurretPitch, new THREE.BoxGeometry(0.004, 0.06, 0.06), materials.glass, 0.025, 0.3, 0);
  const ballGrips = [new THREE.Vector3(0.1, 0.2, -0.1), new THREE.Vector3(0.1, 0.2, 0.1)] as const;
  for (const grip of ballGrips) rod(ballTurretPitch, grip.clone().add(new THREE.Vector3(0, -0.05, 0)), grip.clone().add(new THREE.Vector3(0, 0.05, 0)), 0.015, materials.rubber, 10);

  const starboardGun = addWaistGun(context, WAIST.starboardGunD, 1);
  const portGun = addWaistGun(context, WAIST.portGunD, -1);
  regulator(parent, materials, v(WAIST.starboardGunD - 0.5, 0.15, hullHalfWidthAtHeight(WAIST.starboardGunD - 0.5, 0.15) - 0.04), -Math.PI / 2);
  regulator(parent, materials, v(WAIST.portGunD - 0.5, 0.15, -hullHalfWidthAtHeight(WAIST.portGunD - 0.5, 0.15) + 0.04), Math.PI / 2);
  for (let bottle = 0; bottle < 3; bottle++) {
    const d = 12.0 + bottle * 0.25;
    oxygenBottle(parent, materials, v(d, waistFloorHeight(d) + 0.12, -hullHalfWidthAtHeight(d, waistFloorHeight(d) + 0.12) + 0.13), new THREE.Vector3(1, 0, 0), 0.4, 0.09);
  }
  // Entrance door frame on the starboard side, aft of the window.
  const door = WAIST.door;
  const doorTop = 0.55;
  const doorBottom = waistFloorHeight(door.end) + 0.05;
  for (const d of [door.start, door.end]) rod(parent, v(d, doorBottom, hullHalfWidthAtHeight(d, doorBottom) - 0.03), v(d, doorTop, hullHalfWidthAtHeight(d, doorTop) - 0.03), 0.018, materials.aluminium);
  rod(parent, v(door.start, doorTop, hullHalfWidthAtHeight(door.start, doorTop) - 0.03), v(door.end, doorTop, hullHalfWidthAtHeight(door.end, doorTop) - 0.03), 0.018, materials.aluminium);
  // Tail wheel well housing, with the retracted wheel inside it.
  const wellFloor = waistFloorHeight(WAIST.tailwheelD);
  box(parent, v(WAIST.tailwheelD, wellFloor + 0.18, 0), [0.62, 0.36, 0.42], materials.aluminium, 0, 0.02);
  // Bulkhead at the start of the tail section, cut down to a crawl hole over the wheel well.
  rod(parent, v(BULKHEADS.waistToTail, wellFloor + 0.4, -0.3), v(BULKHEADS.waistToTail, wellFloor + 0.4, 0.3), 0.02, materials.aluminium);

  // Tail gunner's position: knee pads, bicycle seat, armour plate, the twin guns' grips and the reflector sight.
  const tailFloor = tailFloorHeight(TAIL.gunnerD);
  for (const side of [-1, 1]) box(parent, v(TAIL.gunnerD + 0.12, tailFloor + 0.03, side * 0.12), [0.32, 0.06, 0.16], materials.seatCushion, 0, 0.02);
  const seat = v(TAIL.gunnerD - 0.2, tailFloor + 0.4, 0);
  pedestalSeat(parent, materials, seat, tailFloor, { radius: 0.11 });
  const armourFloor = tailFloorHeight(TAIL.armourD);
  box(parent, v(TAIL.armourD, armourFloor + 0.32, 0), [0.02, 0.5, Math.min(0.6, (hullHalfWidthAtHeight(TAIL.armourD, armourFloor + 0.32) - 0.03) * 2)], materials.armour, 0, 0.005);
  const gripY = tailFloor + 0.62;
  const tailGrips = [v(TAIL.gripD, gripY, -0.12), v(TAIL.gripD, gripY, 0.12)] as const;
  // Twin guns in the Cheyenne mount, receivers inside the housing; links run from his grips back to each backplate.
  const tailGuns = TAIL.gunSpacing.map((z) => v(TAIL.gunMuzzleD - 0.92, TAIL.gunY, z));
  tailGuns.forEach((origin, index) => {
    addM2(parent, origin, AFT, 'turret');
    rod(parent, tailGrips[index].clone().add(new THREE.Vector3(-0.03, 0.04, 0)), m2Point(origin, AFT, M2_BACKPLATE), 0.012, materials.gunBlack, 8);
  });
  rod(parent, tailGrips[0].clone().add(new THREE.Vector3(-0.03, 0, 0)), tailGrips[1].clone().add(new THREE.Vector3(-0.03, 0, 0)), 0.015, materials.gunBlack);
  for (const grip of tailGrips) rod(parent, grip.clone().add(new THREE.Vector3(0, -0.06, 0)), grip.clone().add(new THREE.Vector3(0, 0.06, 0)), 0.016, materials.rubber, 10);
  box(parent, v(TAIL.gripD + 0.06, gripY + 0.24, 0), [0.1, 0.1, 0.08], materials.crinkle, 0, 0.012);
  part(parent, new THREE.BoxGeometry(0.004, 0.07, 0.07), materials.glass, toX(TAIL.gripD + 0.02), gripY + 0.32, 0);
  for (const side of [-1, 1]) {
    const ammunition = v(20.35, tailFloorHeight(20.35) + 0.18, side * (hullHalfWidthAtHeight(20.56, tailFloorHeight(20.35) + 0.03) - 0.08));
    // Each gun feeds from its outboard side.
    const gun = tailGuns[side < 0 ? 0 : 1];
    const feedway = m2Point(gun, AFT, m2Feedway(side < 0 ? 1 : -1));
    ammunitionFeed(parent, materials, ammunition, [0.42, 0.3, 0.13], 0, [ammunition.clone().add(new THREE.Vector3(0, 0.15, 0)), v(21.3, gripY + 0.2, side * 0.2), feedway.clone().add(new THREE.Vector3(0.15, 0.05, 0)), feedway]);
  }
  regulator(parent, materials, v(TAIL.gunnerD - 0.4, tailFloor + 0.45, hullHalfWidthAtHeight(TAIL.gunnerD - 0.4, tailFloor + 0.45) - 0.04), -Math.PI / 2);

  const aft = FACING.aft;
  const tailGunner: CrewMember = {
    role: 'Tail gunner',
    pose: pose({
      pelvis: seat.clone().add(new THREE.Vector3(-0.04, 0.1, 0)),
      yaw: aft,
      pelvisTilt: -0.1,
      spineBend: 0.32,
      headPitch: 0.1,
      hands: {
        // Facing aft, his left hand is on the starboard grip.
        left: verticalGrip(tailGrips[1], 'left', aft, { curl: 0.9, inward: 0.15 }),
        right: verticalGrip(tailGrips[0], 'right', aft, { curl: 0.9, inward: 0.15 }),
      },
      // Kneeling: knees on the pads ahead of him, shins back along the floor, feet behind the seat.
      feet: {
        left: { ankle: v(TAIL.gunnerD - 0.36, tailFloor + 0.08, 0.13), toes: new THREE.Vector3(1, -0.55, 0), sole: new THREE.Vector3(-0.5, -0.5, 0).normalize().negate(), kneePole: new THREE.Vector3(-1, -0.1, 0) },
        right: { ankle: v(TAIL.gunnerD - 0.36, tailFloor + 0.08, -0.13), toes: new THREE.Vector3(1, -0.55, 0), sole: new THREE.Vector3(-0.5, -0.5, 0).normalize().negate(), kneePole: new THREE.Vector3(-1, -0.1, 0) },
      },
    }),
    outfit: { upper: 'b3', lower: 'a3', flakVest: true, flakApron: true, flakHelmet: true, lifeVest: true, harness: true, goggles: 'down', oxygenMask: true },
    regulator: v(TAIL.gunnerD - 0.4, tailFloor + 0.37, hullHalfWidthAtHeight(TAIL.gunnerD - 0.4, tailFloor + 0.37) - 0.08),
    faceSeed: 9,
  };

  // Ball turret gunner, folded in the ball: back against the rear armour, knees drawn up between the guns, feet in the
  // heel rests either side of the sighting window.
  const ballGunner: CrewMember = {
    role: 'Ball turret gunner',
    pose: pose({
      pelvis: new THREE.Vector3(-0.25, -0.27, 0),
      yaw: FACING.forward,
      pelvisTilt: 0.35,
      spineBend: 0.75,
      headPitch: 0.55,
      hands: {
        left: verticalGrip(ballGrips[0], 'left', FACING.forward, { curl: 0.9, inward: 0.2, elbowOut: 0.25 }),
        right: verticalGrip(ballGrips[1], 'right', FACING.forward, { curl: 0.9, inward: 0.2, elbowOut: 0.25 }),
      },
      feet: {
        left: { ankle: new THREE.Vector3(0.33, 0, -0.13), toes: new THREE.Vector3(0.3, -1, 0), sole: new THREE.Vector3(1, 0.2, 0).normalize(), kneePole: new THREE.Vector3(0.3, 1, -0.15) },
        right: { ankle: new THREE.Vector3(0.33, 0, 0.13), toes: new THREE.Vector3(0.3, -1, 0), sole: new THREE.Vector3(1, 0.2, 0).normalize(), kneePole: new THREE.Vector3(0.3, 1, 0.15) },
      },
    }),
    outfit: { upper: 'heatedSuit', lower: 'heatedSuit', flakVest: false, flakApron: false, flakHelmet: false, lifeVest: false, harness: true, goggles: 'down', oxygenMask: true },
    regulator: new THREE.Vector3(-0.15, -0.35, 0.3),
    faceSeed: 8,
  };

  return {
    crew: [
      { member: ballGunner, host: ballTurretPitch, label: 'Ball turret gunner', placement: 'below' },
      { member: waistGunner('Right waist gunner', starboardGun, WAIST.starboardGunD, 1, 7), host: null, label: 'Waist gunners', placement: 'above' },
      { member: waistGunner('Left waist gunner', portGun, WAIST.portGunD, -1, 10), host: null, label: 'Waist gunners', placement: 'above' },
      { member: tailGunner, host: null, label: 'Tail gunner', placement: 'above' },
    ],
    stations: [],
  };
}
