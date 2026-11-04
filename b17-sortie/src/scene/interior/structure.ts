import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FUSELAGE_LENGTH, STATIONS } from '../b17-dimensions';
import { HULL_RING_POINTS, hullHalfWidthAtHeight, hullRing, hullSectionAt, toX } from '../hull';
import { part, roundedBox } from '../kit';
import { BULKHEADS, CRAWLWAY, FLOORS, TAIL_FLOOR_CLEARANCE, WAIST_FLOOR_CLEARANCE } from './layout';
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
/** A hole through a floor: a round well (the ball turret's) or a rectangular hatchway (the crawlway's exit). */
export type FloorOpening = { shape: 'round'; d: number; radius: number } | { shape: 'rectangle'; start: number; end: number; halfWidth: number };

/** Floor strips round a round hole are this long fore and aft, short enough that the hole's edge reads as round. */
const OPENING_STRIP = 0.06;
/** Seam left between neighbouring floor panels. */
const PANEL_SEAM = 0.008;

/** Half-width of the hole across the floor between two stations, or 0 where the strip misses it. */
function openingHalfWidth(opening: FloorOpening | null, from: number, to: number): number {
  if (!opening) return 0;
  if (opening.shape === 'rectangle') return from < opening.end - 1e-3 && to > opening.start + 1e-3 ? opening.halfWidth : 0;
  const nearest = Math.max(0, Math.abs((from + to) / 2 - opening.d) - (to - from) / 2);
  return nearest < opening.radius ? Math.sqrt(opening.radius ** 2 - nearest ** 2) : 0;
}

/** Where the next panel after `d` ends: a whole panel, a short strip by a round hole, or cut at a hatchway's edge. */
function panelEnd(d: number, end: number, opening: FloorOpening | null): number {
  let next = d + FLOOR_SEGMENT;
  if (opening?.shape === 'round') {
    const near = (station: number) => Math.abs(station - opening.d) < opening.radius;
    if (near(d) || near(next)) next = d + OPENING_STRIP;
  } else if (opening?.shape === 'rectangle') {
    for (const edge of [opening.start, opening.end]) if (edge > d + 1e-3 && edge < next) next = edge;
  }
  return Math.min(next, end);
}

/**
 * Plywood floor panels from `start` to `end`, each laid from the floor height at its forward end to that at its aft
 * end, so a floor that climbs with the hull (the waist's, the tail's) is one even slope with seams, not a staircase.
 */
export function addFloor(
  parent: THREE.Object3D, materials: InteriorMaterials, start: number, end: number, heightAt: (d: number) => number,
  maxHalfWidth = 2, opening: FloorOpening | null = null,
): void {
  for (let d = start; d < end - 1e-3;) {
    const next = panelEnd(d, end, opening);
    const length = next - d;
    const middle = d + length / 2;
    const fore = heightAt(d);
    const aft = heightAt(next);
    const y = (fore + aft) / 2;
    // Measured at the panel's underside too: low in the tail the hull narrows fast, and a width taken at the top
    // surface alone would push the panel's lower corners out through the skin.
    const halfWidth = Math.min(
      hullHalfWidthAtHeight(d, fore), hullHalfWidthAtHeight(next, aft),
      hullHalfWidthAtHeight(d, fore - FLOOR_THICKNESS), hullHalfWidthAtHeight(next, aft - FLOOR_THICKNESS), maxHalfWidth,
    ) - 0.03;
    const holeHalfWidth = openingHalfWidth(opening, d, next);
    d = next;
    if (halfWidth < 0.12) continue;
    // Model x runs forward, so a floor rising aft tilts its forward end down: a turn about z by the slope.
    const slope = Math.atan2(fore - aft, length);
    const pieces = holeHalfWidth === 0
      ? [{ z: 0, width: halfWidth * 2 }]
      : [-1, 1].map((side) => ({ z: side * (holeHalfWidth + (halfWidth - holeHalfWidth) / 2), width: halfWidth - holeHalfWidth }));
    for (const piece of pieces) {
      if (piece.width < 0.03) continue;
      const panelLength = Math.hypot(length, fore - aft) - PANEL_SEAM;
      const panel = part(parent, roundedBox(panelLength, FLOOR_THICKNESS, piece.width, 0.006), materials.plywood, toX(middle), y - FLOOR_THICKNESS / 2, piece.z);
      panel.rotation.z = slope;
      panel.castShadow = true;
    }
  }
}

export const waistFloorHeight = (d: number) => hullSectionAt(d).bottom + WAIST_FLOOR_CLEARANCE;
export const tailFloorHeight = (d: number) => hullSectionAt(d).bottom + TAIL_FLOOR_CLEARANCE;

export function addFloors(parent: THREE.Object3D, materials: InteriorMaterials): void {
  addFloor(parent, materials, FLOORS.nose.start, FLOORS.nose.end, () => FLOORS.nose.y);
  addCrawlway(parent, materials);
  addFloor(parent, materials, FLOORS.cockpit.start, FLOORS.cockpit.end, () => FLOORS.cockpit.y, 2, { shape: 'rectangle', ...CRAWLWAY.exit });
  addHatchwayTrim(parent, materials.aluminium, CRAWLWAY.exit, FLOORS.cockpit.y);
  addFloor(parent, materials, FLOORS.flightDeck.start, FLOORS.flightDeck.end, () => FLOORS.flightDeck.y);
  addFloor(parent, materials, FLOORS.radioRoom.start, FLOORS.radioRoom.end, () => FLOORS.radioRoom.y);
  addFloor(parent, materials, BULKHEADS.radioToWaist, BULKHEADS.waistToTail, waistFloorHeight, 2, { shape: 'round', d: STATIONS.ballTurret.d, radius: BALL_WELL_RADIUS });
  addFloor(parent, materials, BULKHEADS.waistToTail, 21.75, tailFloorHeight, 0.32);
}

/**
 * Aluminium angle round a hatchway in a floor: a lip on each side and across its forward end, standing just proud of
 * the plywood, so the cut edges are capped as a real floor's are. The aft side is the next floor's edge.
 */
function addHatchwayTrim(parent: THREE.Object3D, material: THREE.Material, hatch: { start: number; end: number; halfWidth: number }, floorY: number): void {
  const length = hatch.end - hatch.start;
  for (const side of [-1, 1]) {
    part(parent, new THREE.BoxGeometry(length, HATCH_TRIM.height, HATCH_TRIM.width), material, toX((hatch.start + hatch.end) / 2), floorY - FLOOR_THICKNESS / 2 + HATCH_TRIM.proud, side * (hatch.halfWidth + HATCH_TRIM.width / 2));
  }
  part(parent, new THREE.BoxGeometry(HATCH_TRIM.width, HATCH_TRIM.height, hatch.halfWidth * 2 + HATCH_TRIM.width * 2), material, toX(hatch.start) + HATCH_TRIM.width / 2, floorY - FLOOR_THICKNESS / 2 + HATCH_TRIM.proud, 0);
}

/** The hatchway trim's angle: face width on the floor, its depth, and how far it stands above the floor's middle. */
const HATCH_TRIM = { width: 0.025, height: FLOOR_THICKNESS + 0.01, proud: 0.005 } as const;

/** Half-width of the crawlway's floor, and where its side bearers stand. */
const CRAWLWAY_HALF_WIDTH = 0.32;
const CRAWLWAY_BEARER_Z = 0.34;

/**
 * The crawlway from bulkhead 4 to the opening behind the pilots' seats: its floor, which over the forward entrance
 * hatch is the hatch's hinged metal guard on the port half; the bearers either side under the pilots' floor; the step
 * up into the opening; and the panel that closes the crawlway's aft end, so it stops at the opening and does not run
 * on into the space under the flight deck.
 */
function addCrawlway(parent: THREE.Object3D, materials: InteriorMaterials): void {
  const y = FLOORS.crawlway.y;
  const hatch = CRAWLWAY.forwardHatch;
  addFloor(parent, materials, FLOORS.crawlway.start, hatch.start, () => y, CRAWLWAY_HALF_WIDTH);
  addFloor(parent, materials, hatch.end, FLOORS.crawlway.end, () => y, CRAWLWAY_HALF_WIDTH);
  const hatchLength = hatch.end - hatch.start;
  const hatchMiddle = toX((hatch.start + hatch.end) / 2);
  // Starboard half over the hatch is plain floor; the port half is the guard, ribbed aluminium on its hinge.
  part(parent, roundedBox(hatchLength - 0.008, FLOOR_THICKNESS, CRAWLWAY_HALF_WIDTH, 0.008), materials.plywood, hatchMiddle, y - FLOOR_THICKNESS / 2, CRAWLWAY_HALF_WIDTH / 2);
  part(parent, roundedBox(hatchLength - 0.01, 0.012, CRAWLWAY_HALF_WIDTH - 0.01, 0.004), materials.aluminium, hatchMiddle, y - 0.006, -CRAWLWAY_HALF_WIDTH / 2);
  for (let rib = 1; rib < 6; rib++) {
    part(parent, new THREE.BoxGeometry(hatchLength - 0.06, 0.008, 0.012), materials.aluminium, hatchMiddle, y + 0.004, -rib * (CRAWLWAY_HALF_WIDTH / 6));
  }
  part(parent, new THREE.CylinderGeometry(0.012, 0.012, CRAWLWAY_HALF_WIDTH - 0.04, 10), materials.frame, toX(hatch.start) + 0.01, y + 0.01, -CRAWLWAY_HALF_WIDTH / 2, { rotation: [Math.PI / 2, 0, 0] });
  // The red emergency release handle that withdraws the hinge pins, at the hatch's aft port corner.
  part(parent, roundedBox(0.03, 0.03, 0.12, 0.008), materials.extinguisher, toX(hatch.end) - 0.04, y + 0.03, -CRAWLWAY_HALF_WIDTH + 0.08);
  part(parent, new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), materials.extinguisher, toX(hatch.end) - 0.04, y + 0.01, -CRAWLWAY_HALF_WIDTH + 0.03);

  // Bearers under the pilots' floor either side of the crawlway, closing the space under it at its sides.
  for (const side of [-1, 1]) {
    part(parent, roundedBox(FLOORS.cockpit.end - FLOORS.cockpit.start, FLOORS.cockpit.y - y, 0.03, 0.008), materials.cockpitGreen,
      toX((FLOORS.cockpit.start + FLOORS.cockpit.end) / 2), (FLOORS.cockpit.y + y) / 2, side * CRAWLWAY_BEARER_Z);
  }
  // The step: a plank across between the bearers on two angle brackets.
  const step = CRAWLWAY.step;
  part(parent, roundedBox(0.2, 0.03, step.width, 0.008), materials.plywood, toX(step.d), step.topY - 0.015, 0);
  for (const side of [-1, 1]) {
    part(parent, new THREE.BoxGeometry(0.03, step.topY - y, 0.03), materials.aluminium, toX(step.d), (step.topY + y) / 2, side * (step.width / 2 - 0.03));
  }
  addCrawlwayEndPanel(parent, materials.frameGreen, FLOORS.crawlway.end);
}

/** A panel across the hull at `d` from the keel up to the flight deck floor, closing the crawlway's aft end (`material` two-sided). */
function addCrawlwayEndPanel(parent: THREE.Object3D, material: THREE.Material, d: number): void {
  const top = FLOORS.flightDeck.y - 0.01;
  const below = hullRing(d, -0.012).filter((point) => point.y < top).map((point) => new THREE.Vector2(-point.z, point.y)).sort((a, b) => a.x - b.x);
  const outline = new THREE.Shape();
  const halfWidth = hullHalfWidthAtHeight(d, top) - 0.012;
  outline.moveTo(-halfWidth, top);
  for (const point of below) outline.lineTo(point.x, point.y);
  outline.lineTo(halfWidth, top);
  outline.closePath();
  const geometry = new THREE.ShapeGeometry(outline, 8);
  geometry.rotateY(Math.PI / 2);
  part(parent, geometry, material, toX(d) - 0.01, 0, 0);
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
