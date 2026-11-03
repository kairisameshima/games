import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STATIONS } from './b17-dimensions';
import { hullSectionAt, toX } from './hull';
import { part, roundedBox } from './kit';

/**
 * Sperry A-2 lower ball turret, from AN 11-45G-1 (Handbook of Instructions, Lower Ball Turrets): the installation
 * outline drawing (figure 47), the exploded view (figure 13) and the cutaway (figure 39). Pitch-frame axes: +x along the
 * guns, +y up when the guns are level, +z to starboard; the origin is the ball's centre, on the elevation trunnions.
 *
 * The 44 in ball is built from a front centre section (the round sighting window between the guns, with Plexiglas
 * panes above and below it), the armour plate and seat under the gunner, the entrance door behind him, the rear centre
 * section and the ammunition box cover on top, all between two end bells. Each end bell carries a gun on its inner face
 * and is glazed: wedge panes round the trunnion hub on its flat face, a ring of panes round its shoulder.
 */

const INCH = 0.0254;

export const BALL = {
  radius: 22 * INCH,
  /** Seam between the end bells and the centre sections. */
  endBellZ: 9.9 * INCH,
  /** The end bells' flat faces, where the trunnion ring support brackets carry the ball. */
  faceZ: 18.31 * INCH,
  gunHalfSpacing: 14 * INCH,
  gunAxisY: -2.25 * INCH,
  /** Muzzles 42 11/32 in ahead of the ball's vertical centreline. */
  muzzleX: (42 + 11 / 32) * INCH,
  /** The sighting window's centre sits 3 in below the ball's horizontal centreline. */
  sightWindow: { centreY: -3 * INCH, glassRadius: 7.65 * INCH, frameRadius: 8.7 * INCH },
  /** Circular hole in the fuselage skin; the ball's centre hangs 2 in below the skin line. */
  openingRadius: 23.25 * INCH,
  centreBelowSkin: 2 * INCH,
  /** Azimuth ring gear (fixed in the airplane) and the trunnion ring support that rides inside it. */
  ringGear: { innerRadius: 22.1 * INCH, outerRadius: 23.3 * INCH, bottom: 6.6 * INCH, top: 8.8 * INCH },
  /** Top of the collector ring housing, where the A-2A support column comes down from the fuselage roof. */
  collectorTop: 32 * INCH,
} as const;

/** The ball's centre in model space: on the fuselage centreline, 2 in below the skin at its station. */
export function ballTurretCentre(): THREE.Vector3 {
  const d = STATIONS.ballTurret.d;
  return new THREE.Vector3(toX(d), hullSectionAt(d).bottom - BALL.centreBelowSkin, 0);
}

/** Flat-face radius: where the plane at `faceZ` cuts the sphere. */
const FACE_RADIUS = Math.sqrt(BALL.radius ** 2 - BALL.faceZ ** 2);

/** Gun barrel exit through the shell, in the pitch frame. */
export function ballGunOrigin(side: 1 | -1): THREE.Vector3 {
  // The M2's gun-space origin is its trunnion block; this places the muzzle where figure 47 puts it.
  return new THREE.Vector3(BALL.muzzleX - 0.925, BALL.gunAxisY, side * BALL.gunHalfSpacing);
}

/**
 * Window layout as a fragment mask, in inches. Panes are cut in the shading rather than the mesh so their edges stay
 * crisp at any distance; glass sits just inside the shell. Positions are object space of a mesh centred on the ball.
 */
const WINDOW_MASK_GLSL = /* glsl */ `
bool ballSpokeGap(float rho, float angle, float count, float offset, float halfBar) {
  float sector = 6.2831853 / count;
  float local = mod(angle - offset, sector);
  float distanceToBar = min(local, sector - local) * rho;
  return distanceToBar > halfBar;
}

bool ballWindow(vec3 p) {
  vec3 q = p / ${INCH};
  float side = abs(q.z);
  float rho = length(q.xy);
  float angle = atan(q.y, q.x);
  if (side > ${(BALL.endBellZ / INCH).toFixed(3)}) {
    if (side > ${(BALL.faceZ / INCH - 0.7).toFixed(3)}) {
      // Flat face: eight wedge panes round the trunnion hub.
      return rho > 3.6 && rho < ${(FACE_RADIUS / INCH - 1.4).toFixed(3)} && ballSpokeGap(rho, angle, 8.0, 0.3927, 1.0);
    }
    // Shoulder: a ring of panes, solid where the gun's front mounting support passes through.
    float degreesFromFront = degrees(angle);
    if (degreesFromFront > -34.0 && degreesFromFront < 22.0) return false;
    return rho > 13.8 && rho < 17.4 && ballSpokeGap(rho, angle, 12.0, 0.0, 1.5);
  }
  if (q.x > 0.0) {
    vec2 window = vec2(q.z, q.y - ${(BALL.sightWindow.centreY / INCH).toFixed(3)});
    float fromWindow = length(window);
    if (fromWindow < ${(BALL.sightWindow.glassRadius / INCH).toFixed(3)}) return true;
    if (fromWindow < ${(BALL.sightWindow.frameRadius / INCH + 0.6).toFixed(3)}) return false;
    if (side > 9.2) return false;
    // Upper panes beside the top of the sighting window, lower panes below it split by a mullion.
    if (side > 4.0 && q.y > -0.5 && q.y < 5.8) return true;
    if (side > 0.6 && q.y < -6.0 && q.y > -19.0 && abs(side - 7.6) > 0.35) return true;
    return false;
  }
  // Rear centre section: the Plexiglas inspection window above the door.
  return q.x < -12.0 && q.y > 3.0 && q.y < 9.0 && side < 4.0;
}`;

const maskedMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();

/** A copy of `base` that leaves the window panes open; shared per base material. */
export function ballWindowMaskMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const cached = maskedMaterials.get(base);
  if (cached) return cached;
  const material = base.clone();
  const basePatch = base.onBeforeCompile;
  const baseKey = base.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    basePatch.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBallPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBallPosition;\n${WINDOW_MASK_GLSL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (ballWindow(vBallPosition)) discard;');
  };
  material.customProgramCacheKey = () => `${baseKey}|ball-windows`;
  maskedMaterials.set(base, material);
  return material;
}

/** The ball's surface at `radius`: the sphere between the end bells' flat faces, and the two faces. */
export function ballShellGeometry(radius: number): THREE.BufferGeometry {
  const faceZ = BALL.faceZ * (radius / BALL.radius);
  const faceAngle = Math.acos(faceZ / radius);
  // SphereGeometry's poles are on y; rotated so they sit on ±z, its polar range spans the band between the faces.
  const band = new THREE.SphereGeometry(radius, 96, 64, 0, Math.PI * 2, faceAngle, Math.PI - 2 * faceAngle).rotateX(Math.PI / 2);
  const faceRadius = Math.sqrt(radius ** 2 - faceZ ** 2);
  const starboard = new THREE.CircleGeometry(faceRadius, 64).translate(0, 0, faceZ);
  const port = new THREE.CircleGeometry(faceRadius, 64).rotateY(Math.PI).translate(0, 0, -faceZ);
  const geometry = mergeGeometries([band.toNonIndexed(), starboard.toNonIndexed(), port.toNonIndexed()]);
  if (!geometry) throw new Error('Ball shell pieces have mismatched attributes');
  return geometry;
}

/** Point on the ball at side-view angle `angle` (from +x toward +y) and lateral offset `z`. */
function ballSurfacePoint(angle: number, z: number, radius = BALL.radius): THREE.Vector3 {
  const rho = Math.sqrt(radius ** 2 - z ** 2);
  return new THREE.Vector3(rho * Math.cos(angle), rho * Math.sin(angle), z);
}

/** A closed seam line along the ball between two side-view angles and two lateral offsets. */
function panelSeam(fromAngle: number, toAngle: number, halfWidth: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const steps = 16;
  for (let step = 0; step <= steps; step++) points.push(ballSurfacePoint(THREE.MathUtils.lerp(fromAngle, toAngle, step / steps), -halfWidth, BALL.radius + 0.002));
  for (let step = 0; step <= steps; step++) points.push(ballSurfacePoint(THREE.MathUtils.lerp(toAngle, fromAngle, step / steps), halfWidth, BALL.radius + 0.002));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'centripetal'), 80, 0.0045, 5, true);
}

export interface BallTurretMaterials {
  shell: THREE.MeshStandardMaterial;
  glass: THREE.Material;
  seam: THREE.Material;
  steel: THREE.Material;
}

/** Ring round the axis `axis`, centred `along` from the ball's centre on it. */
function ringOnAxis(parent: THREE.Object3D, material: THREE.Material, axis: THREE.Vector3, along: number, ringRadius: number, tube: number): void {
  const mesh = part(parent, new THREE.TorusGeometry(ringRadius, tube, 8, 72), material, 0, 0, 0);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  mesh.position.copy(axis).multiplyScalar(along);
}

/** Shell, glazing and the raised frames on it; all of it elevates with the guns. */
export function addBallTurretShell(pitch: THREE.Object3D, materials: BallTurretMaterials): void {
  part(pitch, ballShellGeometry(BALL.radius), ballWindowMaskMaterial(materials.shell), 0, 0, 0);
  part(pitch, ballShellGeometry(BALL.radius - 0.004), materials.glass, 0, 0, 0, { castShadow: false });

  // Armoured frame round the laminated-glass sighting window.
  const windowAxis = new THREE.Vector3(Math.sqrt(BALL.radius ** 2 - BALL.sightWindow.centreY ** 2), BALL.sightWindow.centreY, 0).normalize();
  const frameRing = (BALL.sightWindow.glassRadius + BALL.sightWindow.frameRadius) / 2;
  ringOnAxis(pitch, materials.shell, windowAxis, Math.sqrt(BALL.radius ** 2 - frameRing ** 2), frameRing, 0.55 * INCH);
  for (const side of [-1, 1] as const) {
    const axis = new THREE.Vector3(0, 0, side);
    // Rim of the flat face, the end-bell seam, and the trunnion hub with its boss.
    ringOnAxis(pitch, materials.shell, axis, BALL.faceZ, FACE_RADIUS - 0.4 * INCH, 0.45 * INCH);
    ringOnAxis(pitch, materials.seam, axis, BALL.endBellZ, Math.sqrt(BALL.radius ** 2 - BALL.endBellZ ** 2) + 0.001, 0.12 * INCH);
    part(pitch, new THREE.CylinderGeometry(2.6 * INCH, 2.8 * INCH, 0.9 * INCH, 32), materials.shell, 0, 0, side * (BALL.faceZ + 0.45 * INCH), { rotation: [Math.PI / 2, 0, 0] });
    part(pitch, new THREE.CylinderGeometry(1.3 * INCH, 1.3 * INCH, 1.4 * INCH, 20), materials.steel, 0, 0, side * (BALL.faceZ + 1.4 * INCH), { rotation: [Math.PI / 2, 0, 0] });
    // Front gun mounting support: the boss the barrel passes through, and the link and case chute outlet under the gun.
    const origin = ballGunOrigin(side);
    const exitX = Math.sqrt(BALL.radius ** 2 - origin.y ** 2 - origin.z ** 2);
    part(pitch, new THREE.CylinderGeometry(1.5 * INCH, 1.9 * INCH, 3 * INCH, 20), materials.shell, exitX, origin.y, origin.z, { rotation: [0, 0, -Math.PI / 2] });
    const chute = ballSurfacePoint(THREE.MathUtils.degToRad(-58), side * 13 * INCH);
    const outlet = part(pitch, roundedBox(3.2 * INCH, 1.2 * INCH, 2.4 * INCH, 0.004), materials.seam, chute.x, chute.y, chute.z);
    outlet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), chute.clone().normalize().negate());
  }
  // Entrance door behind the gunner, with its latch handle, and the ammunition box cover on top with four Dzus fasteners.
  part(pitch, panelSeam(THREE.MathUtils.degToRad(148), THREE.MathUtils.degToRad(218), 8.8 * INCH), materials.seam, 0, 0, 0);
  const latch = ballSurfacePoint(Math.PI, 0, BALL.radius + 0.01);
  part(pitch, roundedBox(0.6 * INCH, 3 * INCH, 1 * INCH, 0.003), materials.steel, latch.x, latch.y, latch.z);
  part(pitch, panelSeam(THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(118), 8.6 * INCH), materials.seam, 0, 0, 0);
  for (const angle of [58, 112]) {
    for (const z of [-7.6, 7.6]) {
      const fastener = ballSurfacePoint(THREE.MathUtils.degToRad(angle), z * INCH, BALL.radius + 0.002);
      part(pitch, new THREE.SphereGeometry(0.45 * INCH, 10, 6), materials.steel, fastener.x, fastener.y, fastener.z);
    }
  }
}

/**
 * What turns with the turret in azimuth: the trunnion ring support riding inside the fixed ring gear, its two brackets
 * down to the trunnions, and the hanger tubing up to the collector ring housing under the support column.
 */
export function addBallTurretMount(yaw: THREE.Object3D, materials: { structure: THREE.Material; steel: THREE.Material }): void {
  const ringY = 6.2 * INCH;
  const ringProfile = [
    new THREE.Vector2(21.2 * INCH, ringY - 0.8 * INCH), new THREE.Vector2(22.0 * INCH, ringY - 0.8 * INCH),
    new THREE.Vector2(22.0 * INCH, ringY + 0.8 * INCH), new THREE.Vector2(21.2 * INCH, ringY + 0.8 * INCH),
  ];
  part(yaw, new THREE.LatheGeometry([...ringProfile, ringProfile[0]], 96), materials.structure, 0, 0, 0);
  for (const side of [-1, 1]) {
    const z = side * (BALL.faceZ + 2.4 * INCH);
    const top = ringY + 0.4 * INCH;
    const bottom = -3.2 * INCH;
    part(yaw, roundedBox(4.6 * INCH, top - bottom, 1.0 * INCH, 0.008), materials.structure, 0, (top + bottom) / 2, z);
    // Elevation trunnion bearing housing on the bracket.
    part(yaw, new THREE.CylinderGeometry(2.4 * INCH, 2.4 * INCH, 1.6 * INCH, 24), materials.structure, 0, 0, z + side * 0.3 * INCH, { rotation: [Math.PI / 2, 0, 0] });
  }
  // Hanger tubing: four legs from the ring support up to the collector ring housing.
  const housingBottom = 26 * INCH;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const foot = new THREE.Vector3(x * 11 * INCH, ringY + 0.8 * INCH, z * 14.9 * INCH);
      const head = new THREE.Vector3(x * 2.6 * INCH, housingBottom, z * 3 * INCH);
      const leg = part(yaw, new THREE.CylinderGeometry(0.75 * INCH, 0.75 * INCH, foot.distanceTo(head), 10), materials.steel, 0, 0, 0);
      leg.position.copy(foot).add(head).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), head.clone().sub(foot).normalize());
    }
  }
  part(yaw, new THREE.CylinderGeometry(4.2 * INCH, 4.2 * INCH, BALL.collectorTop - housingBottom, 24), materials.structure, 0, (housingBottom + BALL.collectorTop) / 2, 0);
  // Elevation hand crank and brake on the right of the hanger.
  part(yaw, new THREE.CylinderGeometry(0.4 * INCH, 0.4 * INCH, 6 * INCH, 8), materials.steel, 3 * INCH, 21 * INCH, 12 * INCH, { rotation: [Math.PI / 2, 0, 0] });
  part(yaw, roundedBox(1 * INCH, 3 * INCH, 1 * INCH, 0.004), materials.structure, 3 * INCH, 22 * INCH, 15 * INCH);
}
