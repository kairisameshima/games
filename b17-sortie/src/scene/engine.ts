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
/** The hold-down flange round each barrel's foot on the crankcase. */
const FLANGE = { radius: 0.105, thickness: 0.014 } as const;
/** Front spark plug: where it leaves the head, its length out along the thrust axis, and the ceramic insulator's share. */
const SPARK_PLUG = { x: 0.085, length: 0.055, radius: 0.012, insulator: 0.45 } as const;
/** Sheet-metal deflectors between neighbouring cylinders, steering the cooling air round the barrels' backs. */
const DEFLECTOR = { inner: 0.3, outer: 0.6, depth: 0.12, x: -0.04, thickness: 0.005 } as const;
/** Oil drain tubes linking each rocker box to its neighbour's, a ring round the engine's face. */
const ROCKER_DRAIN = { x: 0.03, radius: 0.57, side: 0.075, tube: 0.008 } as const;
/** Each head's exhaust port at the back, its stub pipe, and the collector ring behind the cylinders the stubs run into. */
const EXHAUST = { portX: -0.06, portRadius: 0.53, ring: { x: -0.125, radius: 0.5, tube: 0.034 }, stub: 0.026 } as const;
/** Bolts round the nose case's flange on the crankcase front. */
const NOSE_BOLTS = { count: 18, radius: 0.235, x: 0.125, size: 0.013 } as const;

interface EngineMaterials {
  barrel: THREE.Material;
  head: THREE.Material;
  crankcase: THREE.Material;
  harness: THREE.Material;
  baffle: THREE.Material;
  /** Heat-blued, sooted steel of the exhaust stubs and collector ring. */
  exhaust: THREE.Material;
  /** The spark plugs' white ceramic insulators. */
  ceramic: THREE.Material;
}

function engineMaterials(): EngineMaterials {
  return {
    barrel: metalMaterial('#1d1f22', { roughness: 0.5, metalness: 0.6 }),
    head: metalMaterial('#8d939a', { roughness: 0.42, metalness: 0.8 }),
    crankcase: metalMaterial('#5e6468', { roughness: 0.4, metalness: 0.5 }),
    harness: metalMaterial('#b5b8bc', { roughness: 0.3, metalness: 0.9 }),
    baffle: metalMaterial('#15171b', { roughness: 0.6, metalness: 0.4 }),
    exhaust: metalMaterial('#4a3a33', { roughness: 0.7, metalness: 0.5 }),
    ceramic: metalMaterial('#e6e1d6', { roughness: 0.3, metalness: 0 }),
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

/** A point on cylinder `cylinder`'s holder (local +y out along the cylinder, +z toward the next cylinder round). */
function onCylinder(cylinder: number, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(1, 0, 0), (cylinder / CYLINDER_COUNT) * Math.PI * 2);
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
  // The nose case's bolt ring, and the exhaust collector ring behind the cylinders, seen through the gaps between them.
  for (let bolt = 0; bolt < NOSE_BOLTS.count; bolt++) {
    const angle = (bolt / NOSE_BOLTS.count) * Math.PI * 2;
    part(engine, new THREE.CylinderGeometry(NOSE_BOLTS.size, NOSE_BOLTS.size, NOSE_BOLTS.size, 6), materials.harness, NOSE_BOLTS.x, Math.cos(angle) * NOSE_BOLTS.radius, Math.sin(angle) * NOSE_BOLTS.radius, { rotation: [0, 0, Math.PI / 2], castShadow: false });
  }
  part(engine, new THREE.TorusGeometry(EXHAUST.ring.radius, EXHAUST.ring.tube, 8, 54), materials.exhaust, EXHAUST.ring.x, 0, 0, { rotation: [0, Math.PI / 2, 0] });

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
    // Hold-down flange at the barrel's foot.
    part(holder, new THREE.CylinderGeometry(FLANGE.radius, FLANGE.radius, FLANGE.thickness, 16), materials.crankcase, 0, CYLINDER.barrelBase + FLANGE.thickness / 2, 0);
    // Front spark plug, steel body and ceramic insulator, with the ignition lead from the harness ring to its tip.
    const plugY = CYLINDER.headTop - 0.07;
    const bodyLength = SPARK_PLUG.length * (1 - SPARK_PLUG.insulator);
    const insulatorLength = SPARK_PLUG.length * SPARK_PLUG.insulator;
    part(holder, new THREE.CylinderGeometry(SPARK_PLUG.radius, SPARK_PLUG.radius, bodyLength, 6), materials.harness, SPARK_PLUG.x + bodyLength / 2, plugY, 0, { rotation: [0, 0, Math.PI / 2], castShadow: false });
    part(holder, new THREE.CylinderGeometry(SPARK_PLUG.radius * 0.6, SPARK_PLUG.radius * 0.75, insulatorLength, 8), materials.ceramic, SPARK_PLUG.x + bodyLength + insulatorLength / 2, plugY, 0, { rotation: [0, 0, Math.PI / 2], castShadow: false });
    rod(holder, new THREE.Vector3(HARNESS.x, HARNESS.radius, 0), new THREE.Vector3(SPARK_PLUG.x + SPARK_PLUG.length, plugY, 0), 0.007, materials.harness);
    // Exhaust stub from the port at the head's back to the collector ring behind.
    rod(holder, new THREE.Vector3(EXHAUST.portX, EXHAUST.portRadius, 0), new THREE.Vector3(EXHAUST.ring.x, EXHAUST.ring.radius, 0), EXHAUST.stub, materials.exhaust);
  }
  for (let cylinder = 0; cylinder < CYLINDER_COUNT; cylinder++) {
    const next = (cylinder + 1) % CYLINDER_COUNT;
    // Deflector halfway round to the next cylinder: a plate standing radially between the two barrels.
    const deflector = new THREE.Group();
    deflector.rotation.x = ((cylinder + 0.5) / CYLINDER_COUNT) * Math.PI * 2;
    engine.add(deflector);
    part(deflector, new THREE.BoxGeometry(DEFLECTOR.depth, DEFLECTOR.outer - DEFLECTOR.inner, DEFLECTOR.thickness), materials.baffle, DEFLECTOR.x, (DEFLECTOR.inner + DEFLECTOR.outer) / 2, 0, { castShadow: false });
    // Drain tube from this rocker box's near side to the next one's.
    rod(engine, onCylinder(cylinder, ROCKER_DRAIN.x, ROCKER_DRAIN.radius, ROCKER_DRAIN.side), onCylinder(next, ROCKER_DRAIN.x, ROCKER_DRAIN.radius, -ROCKER_DRAIN.side), ROCKER_DRAIN.tube, materials.harness);
  }
  return engine;
}
