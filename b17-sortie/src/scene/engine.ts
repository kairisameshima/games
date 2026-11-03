import * as THREE from 'three';
import { metalMaterial } from '../render/studio';
import { part, roundedBox } from './kit';

/**
 * Wright R-1820-97 Cyclone: nine-cylinder single-row radial, 1.38 m across, 6.125 in bore. Built in engine space with the
 * thrust axis along +x (forward) and the cylinder centrelines in the plane x = 0.
 */

const CYLINDER_COUNT = 9;
/** Radii along the cylinder axis, from the crankshaft centreline outward. */
const CYLINDER = { barrelBase: 0.27, barrelTop: 0.47, headTop: 0.64, domeTop: 0.67 } as const;
const BARREL_FIN = { outer: 0.088, root: 0.07, pitch: 0.018 } as const;
const HEAD_FIN = { outer: 0.104, root: 0.072, pitch: 0.016 } as const;
const CRANKCASE_RADIUS = 0.28;
const ROCKER_RADIUS = 0.6;
const HARNESS = { radius: 0.31, x: 0.17, tube: 0.016 } as const;
/** Reaches the cowl liner, so nothing shows between the baffle edge and the cowl wall. */
const BAFFLE = { radius: 0.712, x: -0.15 } as const;

interface EngineMaterials {
  barrel: THREE.Material;
  head: THREE.Material;
  crankcase: THREE.Material;
  harness: THREE.Material;
  baffle: THREE.Material;
}

function engineMaterials(): EngineMaterials {
  return {
    barrel: metalMaterial('#1d1f22', { roughness: 0.5, metalness: 0.6 }),
    head: metalMaterial('#8d939a', { roughness: 0.42, metalness: 0.8 }),
    crankcase: metalMaterial('#5e6468', { roughness: 0.4, metalness: 0.5 }),
    harness: metalMaterial('#b5b8bc', { roughness: 0.3, metalness: 0.9 }),
    baffle: metalMaterial('#15171b', { roughness: 0.6, metalness: 0.4 }),
  };
}

/** Cooling fins as a lathe profile: alternating fin tips and roots stepping out along the cylinder axis (+y). */
function finnedLathe(from: number, to: number, fin: { outer: number; root: number; pitch: number }, closeTop: boolean): THREE.LatheGeometry {
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, from), new THREE.Vector2(fin.root, from)];
  for (let y = from + fin.pitch / 2; y < to - fin.pitch / 2; y += fin.pitch) {
    profile.push(new THREE.Vector2(fin.outer, y - fin.pitch * 0.15), new THREE.Vector2(fin.outer, y + fin.pitch * 0.15));
    profile.push(new THREE.Vector2(fin.root, y + fin.pitch * 0.35), new THREE.Vector2(fin.root, y + fin.pitch * 0.65));
  }
  profile.push(new THREE.Vector2(fin.root, to));
  if (closeTop) profile.push(new THREE.Vector2(0, to));
  return new THREE.LatheGeometry(profile, 16);
}

let sharedGeometries: { barrel: THREE.BufferGeometry; head: THREE.BufferGeometry; dome: THREE.BufferGeometry } | null = null;

function cylinderGeometries(): NonNullable<typeof sharedGeometries> {
  sharedGeometries ??= {
    barrel: finnedLathe(CYLINDER.barrelBase, CYLINDER.barrelTop, BARREL_FIN, false),
    head: finnedLathe(CYLINDER.barrelTop, CYLINDER.headTop, HEAD_FIN, false),
    dome: new THREE.SphereGeometry(HEAD_FIN.root, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, CYLINDER.headTop, 0),
  };
  return sharedGeometries;
}

/** Thin rod between two engine-space points. */
function rod(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): void {
  const direction = to.clone().sub(from);
  const mesh = part(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material, 0, 0, 0, { castShadow: false });
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

/**
 * `noseReach` is how far forward of the cylinder plane the reduction-gear case runs before it meets the propeller hub.
 */
export function buildRadialEngine(noseReach: number): THREE.Group {
  const materials = engineMaterials();
  const geometries = cylinderGeometries();
  const engine = new THREE.Group();

  // Baffle plate behind the cylinders: what shows through the gaps between them.
  part(engine, new THREE.CircleGeometry(BAFFLE.radius, 40), materials.baffle, BAFFLE.x, 0, 0, { rotation: [0, Math.PI / 2, 0] });

  // Crankcase, the tapering reduction-gear nose case, and the propeller governor on top of it.
  part(engine, new THREE.CylinderGeometry(CRANKCASE_RADIUS, CRANKCASE_RADIUS, 0.24, 27), materials.crankcase, 0, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  const noseLength = noseReach - 0.12;
  part(engine, new THREE.CylinderGeometry(0.17, 0.25, noseLength, 27), materials.crankcase, 0.12 + noseLength / 2, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
  part(engine, roundedBox(0.12, 0.09, 0.1, 0.02), materials.crankcase, 0.12 + noseLength * 0.45, 0.23, 0);
  part(engine, new THREE.TorusGeometry(HARNESS.radius, HARNESS.tube, 6, 54), materials.harness, HARNESS.x, 0, 0, { rotation: [0, Math.PI / 2, 0] });

  for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
    const angle = (cylinder / CYLINDER_COUNT) * Math.PI * 2;
    // Each cylinder hangs off a holder rotated about the thrust axis, so its local +y points out along the cylinder.
    const holder = new THREE.Group();
    holder.rotation.x = angle;
    engine.add(holder);
    part(holder, geometries.barrel, materials.barrel, 0, 0, 0);
    part(holder, geometries.head, materials.head, 0, 0, 0);
    part(holder, geometries.dome, materials.head, 0, 0, 0);
    // Intake and exhaust rocker boxes on the head, with their pushrods running back to the crankcase front.
    for (const side of [-1, 1]) {
      const rocker = new THREE.Vector3(0.055, ROCKER_RADIUS, side * 0.06);
      part(holder, roundedBox(0.07, 0.07, 0.09, 0.02), materials.head, rocker.x, rocker.y, rocker.z);
      rod(holder, new THREE.Vector3(0.1, CRANKCASE_RADIUS - 0.02, side * 0.035), new THREE.Vector3(0.07, ROCKER_RADIUS - 0.04, side * 0.06), 0.011, materials.barrel);
    }
    // Ignition lead from the harness ring to the front spark plug.
    rod(holder, new THREE.Vector3(HARNESS.x, HARNESS.radius, 0), new THREE.Vector3(0.1, CYLINDER.headTop - 0.07, 0), 0.007, materials.harness);
  }
  return engine;
}
