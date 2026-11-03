import * as THREE from 'three';
import { STATIONS } from './b17-dimensions';
import { part, roundedBox } from './kit';

/**
 * Sperry ball turret shell, in the turret's pitch frame (+x along the guns, +z to starboard). Wartime photographs and
 * the Sperry cutaway show a sphere cut flat on both sides: each side is a glazed wheel round the elevation trunnion hub,
 * held by the yoke, and the front carries one round armoured sighting window. The guns run just inboard of the sides.
 */

const { radius: BALL_RADIUS, sidePlateZ: SIDE_PLATE_Z, windowHalfAngle: WINDOW_HALF_ANGLE } = STATIONS.ballTurret;
/** Radius of each flat side, where the plane cuts the sphere. */
const SIDE_RADIUS = Math.sqrt(BALL_RADIUS ** 2 - SIDE_PLATE_Z ** 2);
const HUB_RADIUS = 0.11;
/** The side wheel's glazing is split into two rows of panes by a middle ring and eight spokes. */
const SIDE_MIDDLE_RING = 0.26;
const SIDE_SPOKES = 8;
const FRAME = { rim: 0.018, ring: 0.01, spokeWidth: 0.026, spokeDepth: 0.02 } as const;
const WINDOW_RIM = 0.02;

/**
 * Sphere band between the two side planes, with the front window cut out. Triangles are dropped whole, so the window
 * edge is ragged at the tessellation scale; the window rim covers it.
 */
export function ballShellGeometry(radius: number): THREE.BufferGeometry {
  const sideAngle = Math.acos(Math.min(SIDE_PLATE_Z / radius, 1));
  // SphereGeometry's poles are on y; rotated so they sit on ±z, the polar range spans the band between the side planes.
  const geometry = new THREE.SphereGeometry(radius, 96, 48, 0, Math.PI * 2, sideAngle, Math.PI - 2 * sideAngle).rotateX(Math.PI / 2);
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Sphere geometry must be indexed');
  const cosWindow = Math.cos(WINDOW_HALF_ANGLE);
  const kept: number[] = [];
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    centre.set(0, 0, 0);
    for (let vertex = 0; vertex < 3; vertex++) centre.add(corner.fromBufferAttribute(position, index.getX(triangle + vertex)));
    if (centre.normalize().x > cosWindow) continue;
    kept.push(index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2));
  }
  geometry.setIndex(kept);
  return geometry;
}

interface BallTurretMaterials { shell: THREE.Material; frame: THREE.Material; glass: THREE.Material; trunnion: THREE.Material }

/** One glazed side wheel at z = `side · SIDE_PLATE_Z`: glass annulus, hub, rim, middle ring and spokes. */
function addSideWheel(pitch: THREE.Object3D, materials: BallTurretMaterials, side: 1 | -1): void {
  const z = side * SIDE_PLATE_Z;
  part(pitch, new THREE.RingGeometry(HUB_RADIUS, SIDE_RADIUS, 64, 1), materials.glass, 0, 0, z, { castShadow: false });
  part(pitch, new THREE.TorusGeometry(SIDE_RADIUS - FRAME.rim * 0.5, FRAME.rim, 8, 64), materials.frame, 0, 0, z);
  part(pitch, new THREE.TorusGeometry(SIDE_MIDDLE_RING, FRAME.ring, 6, 48), materials.frame, 0, 0, z);
  part(pitch, new THREE.CylinderGeometry(HUB_RADIUS, HUB_RADIUS, 0.05, 32), materials.frame, 0, 0, z, { rotation: [Math.PI / 2, 0, 0] });
  // Trunnion boss on the hub, where the yoke arm takes hold.
  part(pitch, new THREE.CylinderGeometry(0.055, 0.065, 0.08, 24), materials.trunnion, 0, 0, z + side * 0.06, { rotation: [Math.PI / 2, 0, 0] });
  const spokeLength = SIDE_RADIUS - HUB_RADIUS;
  for (let spoke = 0; spoke < SIDE_SPOKES; spoke++) {
    const angle = ((spoke + 0.5) / SIDE_SPOKES) * Math.PI * 2;
    const middle = HUB_RADIUS + spokeLength / 2;
    const mesh = part(pitch, roundedBox(spokeLength, FRAME.spokeWidth, FRAME.spokeDepth, 0.006), materials.frame, Math.cos(angle) * middle, Math.sin(angle) * middle, z);
    mesh.rotation.z = angle;
  }
}

/** Shell, front window and glazed sides, all in the pitch group so they elevate with the guns. */
export function addBallTurretShell(pitch: THREE.Object3D, materials: BallTurretMaterials): void {
  part(pitch, ballShellGeometry(BALL_RADIUS), materials.shell, 0, 0, 0);
  const windowGlass = new THREE.SphereGeometry(BALL_RADIUS - 0.004, 48, 8, 0, Math.PI * 2, 0, WINDOW_HALF_ANGLE).rotateZ(-Math.PI / 2);
  part(pitch, windowGlass, materials.glass, 0, 0, 0, { castShadow: false });
  part(pitch, new THREE.TorusGeometry(BALL_RADIUS * Math.sin(WINDOW_HALF_ANGLE), WINDOW_RIM, 10, 64), materials.frame, BALL_RADIUS * Math.cos(WINDOW_HALF_ANGLE), 0, 0, { rotation: [0, Math.PI / 2, 0] });
  for (const side of [-1, 1] as const) addSideWheel(pitch, materials, side);
}

/** The yoke: a crossbar under the azimuth ring and an arm down each side to the trunnion hubs. Turns with azimuth only. */
export function addBallTurretYoke(yaw: THREE.Object3D, material: THREE.Material): void {
  const armZ = SIDE_PLATE_Z + 0.1;
  const top = BALL_RADIUS + 0.06;
  part(yaw, roundedBox(0.16, 0.05, armZ * 2 + 0.06, 0.012), material, 0, top, 0);
  for (const side of [-1, 1]) part(yaw, roundedBox(0.12, top, 0.04, 0.012), material, 0, top / 2, side * armZ);
}
