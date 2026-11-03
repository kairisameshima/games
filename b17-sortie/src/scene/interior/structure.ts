import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FUSELAGE_LENGTH, STATIONS } from '../b17-dimensions';
import { HULL_RING_POINTS, hullHalfWidthAtHeight, hullRing, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { BULKHEADS, FLOORS, TAIL_FLOOR_CLEARANCE, WAIST_FLOOR_CLEARANCE } from './layout';
import type { InteriorMaterials } from './materials';

const FRAME_SPACING = 0.5;
const FRAME_DEPTH = 0.065;
const FRAME_FLANGE = 0.016;
const FRAME_INSET = 0.006;
const STRINGER_EVERY = 4;
const STRINGER_DEPTH = 0.024;
const FLOOR_SEGMENT = 0.5;
const FLOOR_THICKNESS = 0.035;
/** The waist floor's well round the ball turret: clear of the trunnion ring support and its brackets. */
const BALL_WELL_RADIUS = 0.62;
const TRUSS_TUBE_RADIUS = 0.032;

/** Inward unit normals of a hull ring, in the section plane. */
function inwardNormals(ring: THREE.Vector3[]): THREE.Vector3[] {
  const centre = ring.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(ring.length);
  return ring.map((point, index) => {
    const before = ring[(index + ring.length - 1) % ring.length];
    const after = ring[(index + 1) % ring.length];
    const tangent = after.clone().sub(before);
    const normal = new THREE.Vector3(0, -tangent.z, tangent.y).normalize();
    if (normal.dot(centre.clone().sub(point)) < 0) normal.negate();
    return normal;
  });
}

function quadStrip(positions: number[], a: THREE.Vector3[], b: THREE.Vector3[], closed: boolean): void {
  const count = closed ? a.length : a.length - 1;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % a.length;
    for (const point of [a[index], b[index], b[next], a[index], b[next], a[next]]) positions.push(point.x, point.y, point.z);
  }
}

function geometryFrom(positions: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A Z-section former: a web standing in from the skin with an inner flange. */
function frameGeometry(d: number): THREE.BufferGeometry {
  const ring = hullRing(d, -FRAME_INSET);
  const normals = inwardNormals(ring);
  const inner = ring.map((point, index) => point.clone().addScaledVector(normals[index], FRAME_DEPTH));
  const positions: number[] = [];
  quadStrip(positions, ring, inner, true);
  const forward = inner.map((point) => point.clone().add(new THREE.Vector3(FRAME_FLANGE, 0, 0)));
  quadStrip(positions, inner, forward, true);
  return geometryFrom(positions);
}

function stringerGeometry(index: number, from: number, to: number): THREE.BufferGeometry {
  const outer: THREE.Vector3[] = [];
  const inner: THREE.Vector3[] = [];
  for (let d = from; d <= to + 1e-6; d += 0.25) {
    const ring = hullRing(d, -FRAME_INSET);
    const normal = inwardNormals(ring)[index];
    outer.push(ring[index]);
    inner.push(ring[index].clone().addScaledVector(normal, STRINGER_DEPTH));
  }
  const positions: number[] = [];
  quadStrip(positions, outer, inner, false);
  return geometryFrom(positions);
}

export function addSkinAndStructure(parent: THREE.Object3D, materials: InteriorMaterials, shells: THREE.BufferGeometry[]): void {
  for (const shell of shells) part(parent, shell, materials.skin, 0, 0, 0, { castShadow: false });

  const aluminium: THREE.BufferGeometry[] = [];
  const green: THREE.BufferGeometry[] = [];
  for (let d = 1.0; d < FUSELAGE_LENGTH - 0.8; d += FRAME_SPACING) {
    // Bulkheads stand in for the frames at their stations.
    if (Object.values(BULKHEADS).some((station) => Math.abs(station - d) < 0.15)) continue;
    (d > BULKHEADS.noseToCockpit && d < 4.75 ? green : aluminium).push(frameGeometry(d));
  }
  for (let index = 0; index < HULL_RING_POINTS; index += STRINGER_EVERY) {
    aluminium.push(stringerGeometry(index, 0.95, FUSELAGE_LENGTH - 0.9));
  }
  part(parent, mergeGeometries(aluminium), materials.frame, 0, 0, 0);
  part(parent, mergeGeometries(green), materials.frameGreen, 0, 0, 0);
}

/** Plywood floor panels, each as wide as the hull allows at its height. */
/** A round hole in a floor, centred on the fuselage centreline: the ball turret's well. */
export interface FloorOpening { d: number; radius: number }

/** Floor strips round the hole are this long fore and aft, short enough that the hole's edge reads as round. */
const OPENING_STRIP = 0.06;

export function addFloor(
  parent: THREE.Object3D, materials: InteriorMaterials, start: number, end: number, heightAt: (d: number) => number,
  maxHalfWidth = 2, opening: FloorOpening | null = null,
): void {
  const inOpening = (d: number) => opening !== null && Math.abs(d - opening.d) < opening.radius;
  for (let d = start; d < end - 1e-3;) {
    const step = inOpening(d) || inOpening(d + FLOOR_SEGMENT) ? OPENING_STRIP : FLOOR_SEGMENT;
    const length = Math.min(step, end - d);
    const middle = d + length / 2;
    const y = heightAt(middle);
    const halfWidth = Math.min(hullHalfWidthAtHeight(d, y), hullHalfWidthAtHeight(d + length, y), maxHalfWidth) - 0.03;
    d += length;
    if (halfWidth < 0.12) continue;
    // Where the strip crosses the hole, the floor runs only outboard of it.
    const nearest = opening ? Math.max(0, Math.abs(middle - opening.d) - length / 2) : 0;
    const holeHalfWidth = opening && nearest < opening.radius ? Math.sqrt(opening.radius ** 2 - nearest ** 2) : 0;
    if (holeHalfWidth === 0) {
      const panel = part(parent, roundedBox(length - 0.008, FLOOR_THICKNESS, halfWidth * 2, 0.008), materials.plywood, toX(middle), y - FLOOR_THICKNESS / 2, 0);
      panel.castShadow = true;
      continue;
    }
    const width = halfWidth - holeHalfWidth;
    if (width < 0.03) continue;
    for (const side of [-1, 1]) {
      const panel = part(parent, roundedBox(length - 0.004, FLOOR_THICKNESS, width, 0.006), materials.plywood, toX(middle), y - FLOOR_THICKNESS / 2, side * (holeHalfWidth + width / 2));
      panel.castShadow = true;
    }
  }
}

export const waistFloorHeight = (d: number) => hullSectionAt(d).bottom + WAIST_FLOOR_CLEARANCE;
export const tailFloorHeight = (d: number) => hullSectionAt(d).bottom + TAIL_FLOOR_CLEARANCE;

export function addFloors(parent: THREE.Object3D, materials: InteriorMaterials): void {
  addFloor(parent, materials, FLOORS.nose.start, FLOORS.nose.end, () => FLOORS.nose.y);
  addFloor(parent, materials, FLOORS.crawlway.start, FLOORS.crawlway.end, () => FLOORS.crawlway.y, 0.32);
  addFloor(parent, materials, FLOORS.cockpit.start, FLOORS.cockpit.end, () => FLOORS.cockpit.y);
  addFloor(parent, materials, FLOORS.flightDeck.start, FLOORS.flightDeck.end, () => FLOORS.flightDeck.y);
  addFloor(parent, materials, FLOORS.radioRoom.start, FLOORS.radioRoom.end, () => FLOORS.radioRoom.y);
  addFloor(parent, materials, BULKHEADS.radioToWaist, BULKHEADS.waistToTail, waistFloorHeight, 2, { d: STATIONS.ballTurret.d, radius: BALL_WELL_RADIUS });
  addFloor(parent, materials, BULKHEADS.waistToTail, 21.75, tailFloorHeight, 0.32);
  // Cockpit floor bearers either side of the crawlway, closing the space under the floor at its sides.
  for (const side of [-1, 1]) {
    part(parent, roundedBox(FLOORS.cockpit.end - FLOORS.cockpit.start, FLOORS.cockpit.y - FLOORS.crawlway.y, 0.03, 0.008), materials.cockpitGreen,
      toX((FLOORS.cockpit.start + FLOORS.cockpit.end) / 2), (FLOORS.cockpit.y + FLOORS.crawlway.y) / 2, side * 0.34);
  }
}

/** Bulkhead sheet with a round-topped door. */
export function addBulkhead(parent: THREE.Object3D, material: THREE.Material, d: number, door: { bottom: number; top: number; halfWidth: number; z?: number }): void {
  const outline = new THREE.Shape(hullRing(d, -0.012).map((point) => new THREE.Vector2(-point.z, point.y)));
  const hole = new THREE.Path();
  const centre = -(door.z ?? 0);
  hole.moveTo(centre - door.halfWidth, door.bottom);
  hole.lineTo(centre + door.halfWidth, door.bottom);
  hole.lineTo(centre + door.halfWidth, door.top - door.halfWidth);
  hole.absarc(centre, door.top - door.halfWidth, door.halfWidth, 0, Math.PI, false);
  hole.lineTo(centre - door.halfWidth, door.bottom);
  outline.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(outline, 16);
  geometry.rotateY(Math.PI / 2);
  part(parent, geometry, material, toX(d), 0, 0);
}

/** Wing spar carry-through: the spar trusses frame the bomb bay ends. */
export function addSparTruss(parent: THREE.Object3D, material: THREE.Material, d: number, topY: number, bottomY: number): void {
  const x = toX(d);
  const halfWidthTop = hullHalfWidthAtHeight(d, topY) - 0.05;
  const halfWidthBottom = hullHalfWidthAtHeight(d, bottomY) - 0.05;
  const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    const mesh = part(parent, new THREE.CylinderGeometry(TRUSS_TUBE_RADIUS, TRUSS_TUBE_RADIUS, direction.length(), 12), material, 0, 0, 0);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  };
  const chordTop = [new THREE.Vector3(x, topY, -halfWidthTop), new THREE.Vector3(x, topY, halfWidthTop)];
  const chordBottom = [new THREE.Vector3(x, bottomY, -halfWidthBottom), new THREE.Vector3(x, bottomY, halfWidthBottom)];
  tube(chordTop[0], chordTop[1]);
  tube(chordBottom[0], chordBottom[1]);
  // Warren-truss diagonals, leaving the middle open for the catwalk door.
  for (const side of [-1, 1]) {
    tube(new THREE.Vector3(x, topY, side * halfWidthTop), new THREE.Vector3(x, bottomY, side * 0.3));
    tube(new THREE.Vector3(x, bottomY, side * halfWidthBottom), new THREE.Vector3(x, topY, side * 0.32));
    tube(new THREE.Vector3(x, topY, side * 0.3), new THREE.Vector3(x, bottomY, side * 0.3));
  }
}
