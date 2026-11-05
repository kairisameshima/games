import * as THREE from 'three';
import { STATIONS } from '../b17-dimensions';
import { BALL, ballGunOrigin, ballShellGeometry, ballTurretCentre, ballWindowMaskMaterial } from '../ball-turret';
import type { CrewMember } from '../crew/figure';
import { hullHalfWidthAtHeight, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { addM2, M2_BACKPLATE, M2_GRIPS, m2Point } from '../m2';
import { beltFromAbove, feedGun, receiverSideToward } from './ammunition';
import { oxygenStation, type WallSpot } from './fittings';
import { BULKHEADS, TAIL, WAIST } from './layout';
import { box, oxygenBottle, pedestalSeat, rod, type CompartmentContext, type CompartmentResult } from './parts';
import { FACING, plantedFoot, pose, verticalGrip } from './poses';
import { tailFloorHeight, waistFloorHeight } from './structure';

const v = (d: number, y: number, z: number) => new THREE.Vector3(toX(d), y, z);
const BALL_FORWARD = new THREE.Vector3(1, 0, 0);
/** Ammunition boxes: length along the fuselage, height, depth out from the wall. */
const WAIST_AMMUNITION_BOX: [number, number, number] = [0.3, 0.6, 0.2];
const TAIL_AMMUNITION_BOX: [number, number, number] = [0.6, 0.45, 0.15];

const BALL_RING_MOUNTS = 20;
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
  const gun = addM2(parent, mount, outward, 'flexible');
  // Mount post down to the window sill, then the yoke up to the trunnions.
  const sill = mount.clone().add(new THREE.Vector3(0, -0.36, 0)).addScaledVector(outward, 0.04);
  rod(parent, sill, mount.clone().add(new THREE.Vector3(0, -0.1, 0)), 0.022, materials.aluminium);
  for (const offset of [-0.065, 0.065]) {
    const trunnion = m2Point(mount, outward, new THREE.Vector3(-0.05, -0.03, offset));
    rod(parent, mount.clone().add(new THREE.Vector3(0, -0.1, 0)), trunnion, 0.01, materials.aluminium, 8);
  }
  // Ammunition box standing on the floor against the wall aft of the window, its chute sagging up to the receiver's
  // aft side (Pilot's Manual figure 76). Box and chute stay with the gun in a cutaway.
  const floor = waistFloorHeight(d + 0.7);
  const ammunitionBox = v(d + 0.7, floor + WAIST_AMMUNITION_BOX[1] / 2, side * (hullHalfWidthAtHeight(d + 0.7, floor) - WAIST_AMMUNITION_BOX[2] / 2 - 0.03));
  const belt = feedGun(materials, {
    boxParent: parent,
    box: { centre: ammunitionBox, size: WAIST_AMMUNITION_BOX, material: materials.aluminium },
    gun: { origin: mount, direction: outward, side: receiverSideToward(mount, outward, ammunitionBox) },
  });
  // The waist floor was ankle-deep in brass after a long fight.
  context.guns.push({ gun, belt, caseFloorY: waistFloorHeight(d), casesBagged: false, interrupted: null });
  // The gunner faces the window: his yaw turns him to look out along the gun.
  return { grips: [m2Point(mount, outward, M2_GRIPS.left), m2Point(mount, outward, M2_GRIPS.right)], yaw: Math.atan2(-outward.z, outward.x) };
}

/** Each waist gunner's regulator, on the wall clear of his window: forward of the starboard one, aft of the port one. */
function waistOxygenSpot(side: 1 | -1): WallSpot {
  return side > 0 ? { d: WAIST.starboardGunD - 0.8, y: 0.12, side } : { d: WAIST.portGunD + 0.7, y: 0.12, side };
}

/** Where a mask hose plugs into the regulator at `spot`: the coupling under its face. */
function hoseCoupling(spot: WallSpot): THREE.Vector3 {
  const y = spot.y - 0.12;
  return v(spot.d, y, spot.side * (hullHalfWidthAtHeight(spot.d, y) - 0.06));
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
    regulator: hoseCoupling(waistOxygenSpot(side)),
    faceSeed,
  };
}

/** 5 ft 4 in: ball turret gunners were chosen from the shortest men in a crew. */
const BALL_GUNNER_STATURE = 0.93;
/** Heel rests either side of the sighting window, high in the front of the ball (pitch frame, metres). */
const BALL_HEEL_REST = new THREE.Vector3(0.38, 0.06, 0.12);

/**
 * Inside the ball, in its pitch frame: lining, the armour seat, the two ammunition boxes in front of the gunner with
 * chutes to the outboard side of each gun, the K-4 computing sight in his line of sight, the hand control and limit
 * unit above his face, the hydraulic power unit, heel rests and the foot range pedal. Outside the ball: the fixed
 * azimuth ring gear on its Lord shock mounts, and the A-2A support column down from the roof. Returns the hand grips.
 */
function addBallTurretInterior(context: CompartmentContext): [THREE.Vector3, THREE.Vector3] {
  const { parent, materials, ballTurretPitch: pitch } = context;
  const centre = ballTurretCentre();
  const ringProfile = [
    new THREE.Vector2(BALL.ringGear.innerRadius, BALL.ringGear.bottom), new THREE.Vector2(BALL.ringGear.outerRadius, BALL.ringGear.bottom),
    new THREE.Vector2(BALL.ringGear.outerRadius, BALL.ringGear.top), new THREE.Vector2(BALL.ringGear.innerRadius, BALL.ringGear.top),
  ];
  part(parent, new THREE.LatheGeometry([...ringProfile, ringProfile[0]], 96), materials.aluminium, centre.x, centre.y, centre.z);
  for (let mount = 0; mount < BALL_RING_MOUNTS; mount++) {
    const angle = (mount / BALL_RING_MOUNTS) * Math.PI * 2;
    const radius = BALL.ringGear.outerRadius + 0.012;
    part(parent, new THREE.CylinderGeometry(0.018, 0.02, 0.04, 12), materials.rubber, centre.x + Math.cos(angle) * radius, centre.y + BALL.ringGear.top + 0.02, Math.sin(angle) * radius);
  }
  rod(parent, v(STATIONS.ballTurret.d, hullSectionAt(STATIONS.ballTurret.d).top - 0.04, 0), centre.clone().add(new THREE.Vector3(0, BALL.collectorTop, 0)), 0.045, materials.aluminium);

  part(pitch, ballShellGeometry(BALL.radius - 0.012), ballWindowMaskMaterial(materials.turretLining), 0, 0, 0, { castShadow: false });
  // Armour-plate seat pan and the pad on the door behind his back.
  const seat = part(pitch, roundedBox(0.26, 0.025, 0.3, 0.01), materials.armour, -0.12, -0.47, 0);
  seat.rotation.z = 0.35;
  const backPad = part(pitch, roundedBox(0.04, 0.3, 0.28, 0.015), materials.seatCushion, -0.46, -0.16, 0);
  backPad.rotation.z = -0.6;
  // Ammunition boxes filling the top of the ball in front of him: forward for the right gun (445 rounds), rear for the
  // left (571). Each feeds its gun's outboard side, the belt coming down into the feedway from above.
  for (const [side, x, length] of [[1, 0.235, 0.13], [-1, 0.09, 0.15]] as const) {
    const belt = feedGun(materials, {
      boxParent: pitch,
      box: {
        centre: new THREE.Vector3(x, 0.26, 0), size: [length, 0.22, 0.46], material: materials.ammunitionBox,
        throat: { at: new THREE.Vector3(0, -0.04, side * 0.23), facing: new THREE.Vector3(0, -0.3, side).normalize() },
      },
      gun: { origin: ballGunOrigin(side), direction: BALL_FORWARD, side, approach: beltFromAbove(side) },
      rise: 0.25,
    });
    // Cases and links leave the ball through chutes into the slipstream.
    context.guns.push({ gun: context.ballTurretGuns[side < 0 ? 0 : 1], belt, caseFloorY: null, casesBagged: false, interrupted: null });
  }
  // K-4 computing sight hanging under the boxes, its reflector glass on the line from his eye to the window.
  part(pitch, roundedBox(0.17, 0.13, 0.12, 0.01), materials.crinkle, -0.1, 0.09, 0);
  const reflector = part(pitch, new THREE.PlaneGeometry(0.09, 0.07), materials.glass, -0.17, -0.0, 0);
  reflector.rotation.set(0, -Math.PI / 2, 0.6);
  // Hand control and limit unit above his face, its two grips hanging from it, firing switches on top.
  part(pitch, roundedBox(0.12, 0.08, 0.18, 0.012), materials.crinkle, -0.27, 0.27, 0);
  const grips: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-0.27, 0.17, -0.11), new THREE.Vector3(-0.27, 0.17, 0.11)];
  for (const grip of grips) {
    rod(pitch, grip.clone().add(new THREE.Vector3(0, 0.08, 0)), grip.clone().add(new THREE.Vector3(0, -0.055, 0)), 0.016, materials.rubber, 10);
    part(pitch, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), materials.extinguisher, grip.x + 0.012, grip.y + 0.06, grip.z);
  }
  // Hydraulic power unit against the left end bell, above the gun.
  part(pitch, roundedBox(0.18, 0.13, 0.12, 0.012), materials.crinkle, -0.08, 0.28, -0.3);
  // Heel rests and, under the left foot, the foot range control pedal.
  for (const side of [-1, 1] as const) {
    const rest = part(pitch, roundedBox(0.03, 0.1, 0.09, 0.008), materials.aluminium, BALL_HEEL_REST.x + 0.07, BALL_HEEL_REST.y - 0.03, side * BALL_HEEL_REST.z);
    rest.rotation.z = 0.2;
  }
  part(pitch, roundedBox(0.04, 0.03, 0.08, 0.006), materials.rubber, BALL_HEEL_REST.x + 0.02, BALL_HEEL_REST.y - 0.1, -BALL_HEEL_REST.z);
  // A-12 oxygen regulator under the seat.
  part(pitch, roundedBox(0.1, 0.06, 0.1, 0.01), materials.oxygen, -0.14, -0.49, 0.1);
  return grips;
}

export function buildWaistAndTail(context: CompartmentContext): CompartmentResult {
  const { parent, materials, ballTurretPitch } = context;

  const ballGrips = addBallTurretInterior(context);

  const starboardGun = addWaistGun(context, WAIST.starboardGunD, 1);
  const portGun = addWaistGun(context, WAIST.portGunD, -1);
  for (const side of [-1, 1] as const) oxygenStation(parent, materials, waistOxygenSpot(side));
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
  const tailGunHandles = tailGuns.map((origin, index) => {
    const handle = addM2(parent, origin, AFT, 'turret');
    rod(parent, tailGrips[index].clone().add(new THREE.Vector3(-0.03, 0.04, 0)), m2Point(origin, AFT, M2_BACKPLATE), 0.012, materials.gunBlack, 8);
    return handle;
  });
  rod(parent, tailGrips[0].clone().add(new THREE.Vector3(-0.03, 0, 0)), tailGrips[1].clone().add(new THREE.Vector3(-0.03, 0, 0)), 0.015, materials.gunBlack);
  for (const grip of tailGrips) rod(parent, grip.clone().add(new THREE.Vector3(0, -0.06, 0)), grip.clone().add(new THREE.Vector3(0, 0.06, 0)), 0.016, materials.rubber, 10);
  box(parent, v(TAIL.gripD + 0.06, gripY + 0.24, 0), [0.1, 0.1, 0.08], materials.crinkle, 0, 0.012);
  part(parent, new THREE.BoxGeometry(0.004, 0.07, 0.07), materials.glass, toX(TAIL.gripD + 0.02), gripY + 0.32, 0);
  for (const side of [-1, 1]) {
    // Tall boxes on the floor against each wall ahead of him (Pilot's Manual figure 78), feed tracks running aft
    // along the wall to each gun's outboard side.
    const [length, height, depth] = TAIL_AMMUNITION_BOX;
    const boxD = TAIL.ammunitionD + length / 2;
    const boxFloor = tailFloorHeight(boxD);
    const gun = tailGuns[side < 0 ? 0 : 1];
    const feedSide = receiverSideToward(gun, AFT, v(boxD, 0, side));
    const trackD = TAIL.gunnerD + 0.3;
    const trackY = tailFloorHeight(trackD) + 0.55;
    const belt = feedGun(materials, {
      boxParent: parent,
      box: {
        // Against the wall where it is narrowest round the box: the hull tapers aft and curves in under the floor.
        centre: v(boxD, boxFloor + height / 2, side * (Math.min(
          ...[TAIL.ammunitionD, TAIL.ammunitionD + length].flatMap((d) => [hullHalfWidthAtHeight(d, boxFloor), hullHalfWidthAtHeight(d, boxFloor + height)]),
        ) - depth / 2 - 0.02)),
        size: TAIL_AMMUNITION_BOX, material: materials.aluminium, holedFace: 1,
        throat: { at: new THREE.Vector3(-length / 2 + 0.1, height / 2, 0), facing: new THREE.Vector3(0, 1, 0) },
      },
      // The cone is narrow at the guns, so the belt drops in nearly straight down.
      gun: { origin: gun, direction: AFT, side: feedSide, approach: beltFromAbove(feedSide, 0.15) },
      via: [
        v(boxD + length / 2, trackY - 0.05, side * (hullHalfWidthAtHeight(boxD + length / 2, trackY) - 0.1)),
        v(trackD, trackY, side * (hullHalfWidthAtHeight(trackD, trackY) - 0.1)),
        // Down to the guns' level well inside the narrowing tail cone, then out to the feedway.
        v(TAIL.gripD + 0.3, TAIL.gunY + 0.1, side * 0.2),
      ],
    });
    // The Cheyenne mount chutes its cases and links overboard.
    context.guns.push({ gun: tailGunHandles[side < 0 ? 0 : 1], belt, caseFloorY: null, casesBagged: false, interrupted: null });
  }
  // One regulator on each side wall (Pilot's Manual section XI).
  for (const side of [-1, 1] as const) oxygenStation(parent, materials, { d: TAIL.gunnerD - 0.4, y: tailFloor + 0.45, side });

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

  // Ball turret gunner as figure 39 of AN 11-45G-1 draws him: seat at the bottom of the ball, back against the door,
  // head at the rear with his eye on the sight's line through the window, knees drawn up between the guns, feet high in
  // the heel rests, hands up on the hand control above his face. Ball gunners were picked for short stature.
  const atStature = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).divideScalar(BALL_GUNNER_STATURE);
  const ballFoot = (side: 1 | -1) => ({
    ankle: atStature(BALL_HEEL_REST.x, BALL_HEEL_REST.y, side * BALL_HEEL_REST.z),
    toes: new THREE.Vector3(0.3, -1, 0), sole: new THREE.Vector3(1, 0.2, 0).normalize(), kneePole: new THREE.Vector3(0.3, 1, side * 0.3),
  });
  const ballGunner: CrewMember = {
    role: 'Ball turret gunner',
    pose: pose({
      pelvis: atStature(-0.1, -0.39, 0),
      yaw: FACING.forward,
      pelvisTilt: 1.15,
      spineBend: 0.8,
      headPitch: 1.3,
      hands: {
        left: verticalGrip(ballGrips[0].clone().divideScalar(BALL_GUNNER_STATURE), 'left', FACING.forward, { curl: 0.9, inward: 0.2, elbowOut: 0.1 }),
        right: verticalGrip(ballGrips[1].clone().divideScalar(BALL_GUNNER_STATURE), 'right', FACING.forward, { curl: 0.9, inward: 0.2, elbowOut: 0.1 }),
      },
      feet: { left: ballFoot(-1), right: ballFoot(1) },
    }),
    outfit: { upper: 'heatedSuit', lower: 'heatedSuit', flakVest: false, flakApron: false, flakHelmet: false, lifeVest: false, harness: true, goggles: 'down', oxygenMask: true },
    // The A-12 regulator is on a bracket under the seat.
    regulator: atStature(-0.14, -0.47, 0.08),
    faceSeed: 8,
    stature: BALL_GUNNER_STATURE,
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
