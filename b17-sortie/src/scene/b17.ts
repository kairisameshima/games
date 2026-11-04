import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { applyStudioShading, emissiveMaterial, matteMaterial, metalMaterial } from '../render/studio';
import {
  COWL_RADIUS, FIN_OUTLINE, FUSELAGE_LENGTH, NACELLES, NOSE_GLAZING_END, PROPELLER_RADIUS, STATIONS,
  TAILPLANE, WING, WING_SEMISPAN, type NacelleSpec,
} from './b17-dimensions';
import { mergeRigidMeshes, mergeStaticMeshes, part, roundedBox } from './kit';
import type { FigureDetail } from './crew/figure';
import { buildInterior, type B17Interior, type CrewStation } from './interior';
import { Assemblies, assignAssembly, engineAssembly, FUSELAGE_JOINTS, fuselageSectionAt } from './assemblies';
import { addBallTurretMount, addBallTurretShell, BALL, ballGunOrigin, ballTurretCentre, ballWindowMaskMaterial } from './ball-turret';
import type { MountedGun } from './gunnery';
import { addM2, type M2Gun } from './m2';
import { WindowCutouts } from './window-cutouts';
import { buildRadialEngine } from './engine';
import { HULL_EXPONENT, HULL_RING_POINTS, hullHalfWidthAtHeight, hullRing, hullSectionAt, hullSurfaceHeight, toX } from './hull';
import { airfoilSection, ellipseRing, loftGeometry, mirrorAcrossZ, monotoneCubic } from './loft';
import { PALETTE } from './palette';
import {
  codeLettersTexture, hullPaintTexture, insigniaTexture, propellerDiscTexture, surfacePaintTexture, tailMarkingTexture,
} from './textures';

const AIRFOIL_POINTS_PER_SIDE = 28;
const TAN_DIHEDRAL = Math.tan(THREE.MathUtils.degToRad(WING.dihedralDegrees));
const BLADE_COUNT = 3;
const TIP_STRIPE_LENGTH = 0.15;

// Wing planform and section.

function wingEdges(span: number): { leading: number; trailing: number } {
  const tipStart = WING.tip[0][0];
  if (span <= tipStart) {
    return {
      leading: WING.leadingEdge.slope * span + WING.leadingEdge.intercept,
      trailing: WING.trailingEdge.slope * span + WING.trailingEdge.intercept,
    };
  }
  const spans = WING.tip.map((row) => row[0]);
  return {
    leading: monotoneCubic(spans, WING.tip.map((row) => row[1]), span),
    trailing: monotoneCubic(spans, WING.tip.map((row) => row[2]), span),
  };
}

function wingChordHeight(span: number): number {
  return WING.rootChordHeight + Math.max(0, span - WING.rootSpan) * TAN_DIHEDRAL;
}

function wingThicknessRatio(span: number): number {
  return THREE.MathUtils.lerp(WING.rootThicknessRatio, WING.tipThicknessRatio, THREE.MathUtils.clamp(span / WING_SEMISPAN, 0, 1));
}

function nacaHalfThickness(thicknessRatio: number, chordFraction: number): number {
  const x = THREE.MathUtils.clamp(chordFraction, 0, 1);
  return 5 * thicknessRatio * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/** Upper and lower wing surface heights at a span station and fuselage station. */
export function wingSurfaceAt(span: number, d: number): { upper: number; lower: number; middle: number } {
  const { leading, trailing } = wingEdges(span);
  const chord = trailing - leading;
  const halfThickness = nacaHalfThickness(wingThicknessRatio(span), (d - leading) / chord) * chord;
  const middle = wingChordHeight(span);
  return { upper: middle + halfThickness, lower: middle - halfThickness, middle };
}

// Materials and textures are shared by every aircraft in the formation.

interface AircraftMaterials {
  hull: THREE.MeshStandardMaterial;
  wing: THREE.MeshStandardMaterial;
  tailplane: THREE.MeshStandardMaterial;
  fin: THREE.MeshStandardMaterial;
  nacelle: THREE.MeshStandardMaterial;
  oliveDrab: THREE.MeshStandardMaterial;
  tailHousing: THREE.MeshStandardMaterial;
  neutralGray: THREE.MeshStandardMaterial;
  canopy: THREE.MeshPhysicalMaterial;
  windowPane: THREE.MeshStandardMaterial;
  insignia: THREE.MeshStandardMaterial;
  codes: THREE.MeshStandardMaterial;
  aircraftLetter: THREE.MeshStandardMaterial;
  tailMarking: THREE.MeshStandardMaterial;
  bayDoor: THREE.MeshStandardMaterial;
  cowlLiner: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  gunBlack: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  propellerDisc: THREE.MeshBasicMaterial;
  turboGlow: THREE.MeshBasicMaterial;
  navRed: THREE.MeshBasicMaterial;
  navGreen: THREE.MeshBasicMaterial;
  navWhite: THREE.MeshBasicMaterial;
  bomb: THREE.MeshStandardMaterial;
  bombBand: THREE.MeshStandardMaterial;
}

let sharedMaterials: AircraftMaterials | null = null;

/** Flat, sun-faded lacquer with a thin clearcoat, so softbox streaks still run along the hull. */
function paintMaterial(map: THREE.Texture | null, color: THREE.ColorRepresentation = '#ffffff'): THREE.MeshStandardMaterial {
  return applyStudioShading(new THREE.MeshPhysicalMaterial({
    color, map, roughness: 0.66, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.72,
  }));
}

function decalMaterial(map: THREE.Texture, roughness = 0.6): THREE.MeshStandardMaterial {
  return applyStudioShading(new THREE.MeshPhysicalMaterial({
    map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    roughness, clearcoat: 0.32, clearcoatRoughness: 0.38, envMapIntensity: 0.9,
  }));
}

/** Glazing: faintly tinted, mostly clear glass in an olive-drab frame strip; the alpha carries the transparency. */
function windowPaneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, 'rgba(170, 196, 214, 0.22)');
  gradient.addColorStop(0.5, 'rgba(120, 146, 166, 0.12)');
  gradient.addColorStop(1, 'rgba(150, 176, 196, 0.2)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#3c3b2a';
  context.lineWidth = 14;
  context.strokeRect(7, 7, 242, 242);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function aircraftMaterials(): AircraftMaterials {
  if (sharedMaterials) return sharedMaterials;
  const hullTexture = hullPaintTexture({
    lengthMetres: FUSELAGE_LENGTH, majorJoints: [0.78, 3.0, 7.5, 10.3, 13.0, 16.0, 19.45], frameSpacing: 0.5,
    oliveDrabHalfBand: 0.3, seed: 11, width: 2048, height: 1024,
  });
  const nacelleTexture = hullPaintTexture({
    lengthMetres: 7.8, majorJoints: [0.2, 1.4, 2.1], frameSpacing: 0.45, oliveDrabHalfBand: 0.31, sootFrom: 0.42, seed: 5, width: 1024, height: 512,
  });
  const wingTexture = surfacePaintTexture({
    spanMetres: WING_SEMISPAN, upperColor: PALETTE.oliveDrab, lowerColor: PALETTE.neutralGray,
    deIcerBoots: [[1.3, 2.25], [3.7, 5.8], [7.4, 15.3]], controlSurfaces: [[1.1, 10.2], [10.3, 15.1]], ribSpacing: 0.6, seed: 3,
  });
  const tailplaneTexture = surfacePaintTexture({
    spanMetres: 6.31, upperColor: PALETTE.oliveDrab, lowerColor: PALETTE.neutralGray,
    deIcerBoots: [[0.95, 5.85]], controlSurfaces: [[0.9, 5.9]], ribSpacing: 0.45, seed: 9,
  });
  const finTexture = surfacePaintTexture({
    spanMetres: 4.65, upperColor: PALETTE.oliveDrab, lowerColor: PALETTE.oliveDrab,
    deIcerBoots: [[1.7, 4.3]], controlSurfaces: [[0.9, 4.45]], ribSpacing: 0.45, seed: 13,
  });
  const propellerDisc = new THREE.MeshBasicMaterial({
    map: propellerDiscTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  sharedMaterials = {
    hull: paintMaterial(hullTexture),
    wing: paintMaterial(wingTexture),
    tailplane: paintMaterial(tailplaneTexture),
    fin: paintMaterial(finTexture),
    nacelle: paintMaterial(nacelleTexture),
    oliveDrab: paintMaterial(null, PALETTE.oliveDrab),
    // Its own material because the tail gunner's window holes are cut in it.
    tailHousing: paintMaterial(null, PALETTE.oliveDrab),
    neutralGray: paintMaterial(null, PALETTE.neutralGray),
    canopy: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#dfeef5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide,
    })),
    windowPane: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: windowPaneTexture(), transparent: true, depthWrite: false, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })),
    insignia: decalMaterial(insigniaTexture()),
    codes: decalMaterial(codeLettersTexture('LG')),
    aircraftLetter: decalMaterial(codeLettersTexture('K')),
    tailMarking: decalMaterial(tailMarkingTexture('238107', 'K')),
    bayDoor: Object.assign(paintMaterial(null, PALETTE.neutralGray), { side: THREE.DoubleSide }),
    cowlLiner: matteMaterial('#1c1e1f', { roughness: 0.8, side: THREE.DoubleSide }),
    gunmetal: metalMaterial(PALETTE.gunmetal, { roughness: 0.36 }),
    gunBlack: metalMaterial(PALETTE.anodised, { roughness: 0.46, metalness: 0.55 }),
    steel: metalMaterial(PALETTE.chrome, { roughness: 0.22, metalness: 1 }),
    rubber: matteMaterial(PALETTE.rubber, { roughness: 0.72, envMapIntensity: 0.35 }),
    blade: applyStudioShading(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.48, metalness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 1.0,
    })),
    propellerDisc,
    turboGlow: emissiveMaterial(PALETTE.turboGlow, 2.6),
    navRed: emissiveMaterial(PALETTE.navRed, 3.2),
    navGreen: emissiveMaterial(PALETTE.navGreen, 3.2),
    navWhite: emissiveMaterial('#fff4e0', 2.4),
    bomb: paintMaterial(null, '#3e3e2e'),
    bombBand: paintMaterial(null, PALETTE.tailYellow),
  };
  return sharedMaterials;
}

// Geometry builders.

function hullStations(): number[] {
  const stations: number[] = [];
  for (let d = NOSE_GLAZING_END; d < 2.9; d += 0.12) stations.push(d);
  for (let d = 2.9; d < 3.75; d += 0.03) stations.push(d);
  for (let d = 3.75; d < FUSELAGE_LENGTH; d += 0.15) stations.push(d);
  stations.push(FUSELAGE_LENGTH);
  // A ring on every section joint, so the exploded view parts the skin on a clean line.
  for (const joint of FUSELAGE_JOINTS) if (!stations.some((d) => Math.abs(d - joint) < 0.02)) stations.push(joint);
  return stations.sort((a, b) => a - b);
}

/** Under the Cheyenne tail housing the housing itself is the roof, so the hull top there is open. */
const TAIL_ROOF_OPENING = { start: 19.75, end: 21.6, aboveBottom: 0.5 } as const;

/**
 * Drops hull triangles inside the bomb bay opening and under the tail housing, so open doors show a real hole and
 * the tail gunner's compartment has headroom.
 */
function cutHullOpenings(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const bay = STATIONS.bombBay;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Hull geometry must be indexed');
  const kept: number[] = [];
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    centre.set(0, 0, 0);
    for (let vertex = 0; vertex < 3; vertex++) centre.add(corner.fromBufferAttribute(position, index.getX(triangle + vertex)));
    centre.divideScalar(3);
    const d = toX(centre.x); // toX is its own inverse
    const insideBay = d > bay.start && d < bay.end && Math.abs(centre.z) < bay.halfWidth - 0.03 && centre.y < -0.9;
    const underTailHousing = d > TAIL_ROOF_OPENING.start && d < TAIL_ROOF_OPENING.end
      && centre.y > hullSectionAt(d).bottom + TAIL_ROOF_OPENING.aboveBottom;
    if (!insideBay && !underTailHousing) kept.push(index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2));
  }
  geometry.setIndex(kept);
  return geometry;
}

function buildHullGeometry(): THREE.BufferGeometry {
  const stations = hullStations();
  // The front end stays open so the nose compartment shows through the glazing.
  return cutHullOpenings(loftGeometry(stations.map((d) => hullRing(d)), stations.map((d) => d / FUSELAGE_LENGTH), false, true));
}

/** One bomb bay door as a patch of the hull skin from the keel seam out to its hinge, relative to the hinge line. */
function buildBayDoorGeometry(side: 1 | -1): THREE.BufferGeometry {
  const bay = STATIONS.bombBay;
  const bayMid = (bay.start + bay.end) / 2;
  const hingeY = hullSurfaceHeight(bayMid, bay.halfWidth, false);
  const lengthSteps = 6;
  const acrossSteps = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let along = 0; along <= lengthSteps; along++) {
    const d = THREE.MathUtils.lerp(bay.start + 0.02, bay.end - 0.02, along / lengthSteps);
    for (let across = 0; across <= acrossSteps; across++) {
      const z = side * bay.halfWidth * (across / acrossSteps);
      // A few millimetres proud of the skin so the closed door never fights the hull edge around the opening.
      positions.push(toX(d) - toX(bayMid), hullSurfaceHeight(d, z, false) - 0.006 - hingeY, z - side * bay.halfWidth);
    }
  }
  const stride = acrossSteps + 1;
  for (let along = 0; along < lengthSteps; along++) {
    for (let across = 0; across < acrossSteps; across++) {
      const a = along * stride + across;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildNoseGlazingGeometry(): THREE.BufferGeometry {
  const stations: number[] = [];
  for (let d = 0; d <= NOSE_GLAZING_END + 0.03; d += 0.03) stations.push(d);
  return loftGeometry(stations.map((d) => hullRing(d, 0.004)), stations.map((d) => d), true, false);
}

/** Lifting surface lofted along +z from a list of spanwise sections. */
function buildSurfaceGeometry(
  spans: number[],
  edges: (span: number) => { leading: number; trailing: number },
  chordHeight: (span: number) => number,
  thicknessRatio: (span: number) => number,
  spanLength: number,
  capRoot = false,
): THREE.BufferGeometry {
  const rings = spans.map((span) => {
    const { leading, trailing } = edges(span);
    const chord = trailing - leading;
    return airfoilSection(thicknessRatio(span), 0, 0.4, AIRFOIL_POINTS_PER_SIDE).map((point) =>
      new THREE.Vector3(toX(leading + point.x * chord), chordHeight(span) + point.y * chord, span));
  });
  return loftGeometry(rings, spans.map((span) => span / spanLength), capRoot, true);
}

/** Root vertices land this far outside the skin: hidden by the interior skin from the cabin, and inside the surface's own root from outside. */
const ROOT_SKIN_OFFSET = 0.005;

/**
 * Moves every vertex that lies inside the fuselage out onto its skin, so a flying surface's buried root stops at the
 * hull instead of running through the compartments. `outward` is the direction the surface leaves the hull: sideways
 * for the wing and tailplane, up for the fin. Normals stay as lofted: the moved vertices are hidden in the joint.
 */
function conformRootToHull(geometry: THREE.BufferGeometry, outward: 'side' | 'up'): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const d = toX(position.getX(index));
    if (d <= 0 || d >= FUSELAGE_LENGTH) continue;
    const y = position.getY(index);
    const z = position.getZ(index);
    if (outward === 'up') {
      // Over the tail gunner the Cheyenne housing is the roof, so the fin stands on it rather than on the hull.
      const roof = Math.max(hullSurfaceHeight(d, z, true), tailHousingSurfaceHeight(d, z) ?? -Infinity);
      if (y < roof && insideHull(d, y, z, roof)) position.setY(index, roof + ROOT_SKIN_OFFSET);
    } else if (insideHull(d, y, z, hullSectionAt(d).top)) {
      position.setZ(index, Math.sign(z) * (hullHalfWidthAtHeight(d, y) + ROOT_SKIN_OFFSET));
    }
  }
  return geometry;
}

/** Inside the hull section at `d`, with its top raised to `top` where a fairing roofs it. */
function insideHull(d: number, y: number, z: number, top: number): boolean {
  const section = hullSectionAt(d);
  const middle = (top + section.bottom) / 2;
  const halfHeight = (top - section.bottom) / 2;
  return (Math.abs(z) / section.halfWidth) ** HULL_EXPONENT + (Math.abs(y - middle) / halfHeight) ** HULL_EXPONENT < 1;
}

function buildWingGeometry(): THREE.BufferGeometry {
  // The wing root rib is pressed onto the fuselage side, leaving the bomb bay and radio room clear for the bomb racks
  // and crew, and giving the cutaway a clean wing root.
  const spans = [0.95, 1.6, 2.4, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, ...WING.tip.map((row) => row[0])];
  return conformRootToHull(buildSurfaceGeometry(spans, wingEdges, wingChordHeight, wingThicknessRatio, WING_SEMISPAN, true), 'side');
}

function tailplaneEdges(span: number): { leading: number; trailing: number } {
  const tipStart = TAILPLANE.tip[0][0];
  if (span <= tipStart) {
    return {
      leading: TAILPLANE.leadingEdge.atRoot + (span - TAILPLANE.leadingEdge.rootSpan) * TAILPLANE.leadingEdge.slope,
      trailing: TAILPLANE.trailingEdge.atRoot + (span - TAILPLANE.trailingEdge.rootSpan) * TAILPLANE.trailingEdge.slope,
    };
  }
  const spans = TAILPLANE.tip.map((row) => row[0]);
  return {
    leading: monotoneCubic(spans, TAILPLANE.tip.map((row) => row[1]), span),
    trailing: monotoneCubic(spans, TAILPLANE.tip.map((row) => row[2]), span),
  };
}

function buildTailplaneGeometry(): THREE.BufferGeometry {
  const spans = [0.15, 0.844, 1.6, 2.6, 3.6, 4.6, ...TAILPLANE.tip.map((row) => row[0])];
  const tipSpan = TAILPLANE.tip[TAILPLANE.tip.length - 1][0];
  return conformRootToHull(buildSurfaceGeometry(
    spans,
    tailplaneEdges,
    () => TAILPLANE.chordHeight,
    (span) => THREE.MathUtils.lerp(TAILPLANE.rootThicknessRatio, TAILPLANE.tipThicknessRatio, span / tipSpan),
    tipSpan,
  ), 'side');
}

const FIN_TOP_INDEX = FIN_OUTLINE.reduce((best, point, index) => (point[1] > FIN_OUTLINE[best][1] ? index : best), 0);
const FIN_LEADING = FIN_OUTLINE.slice(0, FIN_TOP_INDEX + 1);
const FIN_TRAILING = FIN_OUTLINE.slice(FIN_TOP_INDEX).reverse();
const FIN_TOP = FIN_OUTLINE[FIN_TOP_INDEX][1];
const FIN_DORSAL_THICKNESS = 0.3;
const FIN_TIP_THICKNESS = 0.12;

function finEdges(height: number): { leading: number; trailing: number } {
  const leadingHeights = FIN_LEADING.map((point) => point[1]);
  const trailingHeights = FIN_TRAILING.map((point) => point[1]);
  const [lowLeading, lowLeadingHeight] = FIN_LEADING[0];
  const [lowTrailing, lowTrailingHeight] = FIN_TRAILING[0];
  // Below the outline the fin runs down into the fuselage, so extend both edges; the root is then pressed onto the skin.
  const trailingSlope = (FIN_TRAILING[1][0] - lowTrailing) / (FIN_TRAILING[1][1] - lowTrailingHeight);
  return {
    leading: height < lowLeadingHeight ? lowLeading - 0.3 : monotoneCubic(leadingHeights, FIN_LEADING.map((point) => point[0]), height),
    trailing: height < lowTrailingHeight
      ? lowTrailing + (height - lowTrailingHeight) * trailingSlope
      : monotoneCubic(trailingHeights, FIN_TRAILING.map((point) => point[0]), height),
  };
}

function buildFinGeometry(): THREE.BufferGeometry {
  const heights = [0.25, 0.7, 1.04, 1.2, 1.4, 1.61, 1.8, 2.0, 2.4, 2.9, 3.4, 3.8, 4.1, 4.35, 4.5, 4.58, 4.63, FIN_TOP - 0.005];
  const rings = heights.map((height) => {
    const { leading, trailing } = finEdges(height);
    const chord = Math.max(trailing - leading, 0.05);
    const thickness = THREE.MathUtils.clamp(chord * 0.11, FIN_TIP_THICKNESS * Math.min(1, chord / 1.2), FIN_DORSAL_THICKNESS);
    return airfoilSection(thickness / chord, 0, 0.4, AIRFOIL_POINTS_PER_SIDE).map((point) =>
      new THREE.Vector3(toX(leading + point.x * chord), height, point.y * chord));
  });
  return conformRootToHull(loftGeometry(rings, heights.map((height) => height / FIN_TOP), true, true), 'up');
}

/** Superellipse exponent of the Cheyenne housing's sections: flatter-sided than the hull. */
const TAIL_HOUSING_EXPONENT = 3.2;

/** The housing's lofted sections: top, bottom and half-width at each station. */
function tailHousingSections(): NacelleProfile[] {
  const { start, end, top } = STATIONS.tailTurretHousing;
  const stations = [start, start + 0.3, start + 0.8, end - 0.6, end - 0.3, end];
  const tops = [hullSectionAt(start).top - 0.02, top - 0.12, top, top, top - 0.14, hullSectionAt(end).top];
  return stations.map((d, index) => {
    const hull = hullSectionAt(d);
    return { d, top: tops[index], bottom: hull.bottom + 0.3, halfWidth: Math.min(hull.halfWidth + 0.015, 0.4) };
  });
}

/** Height of the housing's upper surface at a station and lateral offset, or null outside the housing. */
function tailHousingSurfaceHeight(d: number, z: number): number | null {
  const sections = tailHousingSections();
  const after = sections.findIndex((section) => section.d >= d);
  if (after <= 0 || d > sections[sections.length - 1].d) return null;
  const a = sections[after - 1], b = sections[after];
  const t = (d - a.d) / (b.d - a.d);
  const top = THREE.MathUtils.lerp(a.top, b.top, t);
  const bottom = THREE.MathUtils.lerp(a.bottom, b.bottom, t);
  const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t);
  const lateral = Math.min(Math.abs(z) / halfWidth, 0.999);
  return (top + bottom) / 2 + (1 - lateral ** TAIL_HOUSING_EXPONENT) ** (1 / TAIL_HOUSING_EXPONENT) * (top - bottom) / 2;
}

/** Cheyenne tail-gun housing under the rudder: a raised, slab-sided fairing over the tail cone. */
function buildTailHousingGeometry(): THREE.BufferGeometry {
  const sections = tailHousingSections();
  const rings = sections.map((section) =>
    ellipseRing(new THREE.Vector3(toX(section.d), 0, 0), section.top, section.bottom, section.halfWidth, HULL_RING_POINTS, TAIL_HOUSING_EXPONENT));
  return loftGeometry(rings, sections.map((section) => section.d / FUSELAGE_LENGTH), true, true);
}

interface NacelleProfile { d: number; top: number; bottom: number; halfWidth: number }

/** Cowl and nacelle body, relative to the thrust line except where the profile tucks into the wing. */
function nacelleProfile(spec: NacelleSpec): NacelleProfile[] {
  const wingLeading = wingEdges(spec.span).leading;
  const profile: NacelleProfile[] = [];
  const add = (d: number, top: number, bottom: number, halfWidth: number) => profile.push({ d, top, bottom, halfWidth });
  const r = COWL_RADIUS;
  const h = spec.thrustLineH;
  add(spec.cowlFrontD, h + r * 0.83, h - r * 0.83, r * 0.83);
  add(spec.cowlFrontD + 0.05, h + r * 0.96, h - r * 0.96, r * 0.96);
  add(spec.cowlFrontD + 0.18, h + r, h - r, r);
  add(spec.cowlRearD - 0.12, h + r * 1.0, h - r * 1.0, r * 1.0);
  // The skin steps in under the cowl flaps, which are separate panels (see addCowlFlaps) standing proud of it.
  add(spec.cowlRearD - 0.02, h + r * 0.95, h - r * 0.95, r * 0.95);
  add(spec.cowlRearD + 0.06, h + r * 0.94, h - r * 0.94, r * 0.94);
  add(Math.max(spec.cowlRearD + 0.6, wingLeading + 0.2), h + r * 0.9, h - r * 1.05, r * 0.92);
  const fairingSamples = 6;
  for (let sample = 1; sample <= fairingSamples; sample++) {
    const t = sample / fairingSamples;
    const d = THREE.MathUtils.lerp(Math.max(spec.cowlRearD + 0.6, wingLeading + 0.2), spec.upperFairingEndD, t);
    const wing = wingSurfaceAt(spec.span, d);
    const top = THREE.MathUtils.lerp(h + r * 0.9, wing.upper + 0.01, t * t * (3 - 2 * t));
    add(d, top, h - r * 1.05, THREE.MathUtils.lerp(r * 0.92, r * 0.5, t));
  }
  const bodySamples = 6;
  for (let sample = 1; sample <= bodySamples; sample++) {
    const t = sample / bodySamples;
    const d = THREE.MathUtils.lerp(spec.upperFairingEndD, spec.lowerBodyEndD, t);
    const wing = wingSurfaceAt(spec.span, Math.min(d, wingEdges(spec.span).trailing - 0.05));
    const bottom = THREE.MathUtils.lerp(h - r * 1.05, wing.middle - 0.02, t ** 2.2);
    add(d, Math.max(wing.middle, bottom + 0.02), bottom, THREE.MathUtils.lerp(r * 0.5, 0.04, t ** 1.4));
  }
  return profile;
}

function buildNacelleGeometry(spec: NacelleSpec): THREE.BufferGeometry {
  const profile = nacelleProfile(spec);
  const length = spec.lowerBodyEndD - spec.cowlFrontD;
  const rings = profile.map((station) =>
    ellipseRing(new THREE.Vector3(toX(station.d), 0, spec.span), station.top, station.bottom, station.halfWidth, 48, 2.05));
  return loftGeometry(rings, profile.map((station) => (station.d - spec.cowlFrontD) / length), false, true);
}

/** Hamilton Standard blade shank: round where it seats in the hub, blending into the airfoil a little further out. */
const BLADE_SHANK = { innerRadius: 0.1, radius: 0.068, blendStart: 0.34, blendEnd: 0.5 } as const;
/** The pitch axis sits at this fraction of the chord, so the blade twists about its thickest part. */
const BLADE_PITCH_AXIS = 0.35;

/**
 * Blade lofted from the hub out: a round shank seated inside the hub barrel, blending into a twisted, tapering
 * airfoil with a rounded tip and the six-inch yellow tip stripe in vertex colours. Radius runs along +y.
 */
function buildBladeGeometry(): THREE.BufferGeometry {
  const pointsPerSide = 12;
  const radii = [BLADE_SHANK.innerRadius, 0.2, 0.28, BLADE_SHANK.blendStart, 0.39, 0.44, BLADE_SHANK.blendEnd];
  for (let step = 1; step <= 26; step++) radii.push(THREE.MathUtils.lerp(BLADE_SHANK.blendEnd, PROPELLER_RADIUS - 0.004, step / 26));
  const rings = radii.map((radius) => {
    const fraction = radius / PROPELLER_RADIUS;
    const tipRounding = fraction > 0.9 ? Math.sqrt(Math.max(0, 1 - ((fraction - 0.9) / 0.1) ** 2)) : 1;
    const chord = (0.17 + 0.13 * Math.sin(Math.PI * Math.min(fraction * 1.15, 1))) * Math.max(tipRounding, 0.2);
    const thicknessRatio = THREE.MathUtils.lerp(0.2, 0.08, THREE.MathUtils.clamp((fraction - 0.25) / 0.75, 0, 1));
    const twist = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(42, 14, fraction));
    const blend = THREE.MathUtils.smoothstep(radius, BLADE_SHANK.blendStart, BLADE_SHANK.blendEnd);
    const section = airfoilSection(thicknessRatio, 0.02, 0.4, pointsPerSide);
    return section.map((point, index) => {
      // Matching point on the shank circle: upper surface over the top, lower surface underneath, trailing edge at 0.
      const angle = index <= pointsPerSide ? Math.PI * (index / pointsPerSide) : Math.PI * (1 + (index - pointsPerSide) / pointsPerSide);
      const across = THREE.MathUtils.lerp(Math.cos(angle) * BLADE_SHANK.radius, (point.x - BLADE_PITCH_AXIS) * chord, blend);
      const through = THREE.MathUtils.lerp(Math.sin(angle) * BLADE_SHANK.radius, point.y * chord, blend);
      return new THREE.Vector3(across * Math.cos(twist) - through * Math.sin(twist), radius, across * Math.sin(twist) + through * Math.cos(twist));
    });
  });
  const geometry = loftGeometry(rings, radii.map((radius) => radius / PROPELLER_RADIUS), true, true);
  const position = geometry.getAttribute('position');
  const black = new THREE.Color('#151515');
  const yellow = new THREE.Color(PALETTE.propTipYellow);
  const colors: number[] = [];
  for (let index = 0; index < position.count; index++) {
    const color = position.getY(index) > PROPELLER_RADIUS - TIP_STRIPE_LENGTH ? yellow : black;
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

let sharedBladeGeometry: THREE.BufferGeometry | null = null;

/** Distance aft of the propeller plane to the back of the hub barrel, where the engine's nose case meets it. */
const PROPELLER_HUB_REAR = 0.18;
const COWL_FLAP_COUNT = 14;
const COWL_FLAP = { length: 0.26, thickness: 0.012, openDegrees: 9, hingeAheadOfRear: 0.2 } as const;
/** Below this cosine of the angle from the top, a cowl flap sits in the Neutral Gray underside. */
const COWL_FLAP_GRAY_BELOW = -0.37;
/** Oil-cooler and intercooler intakes in the wing leading edge, as spanwise ranges read off the 3-view's front view. */
const WING_INTAKE_SPANS: readonly (readonly [number, number])[] = [[1.45, 2.15], [4.2, 5.3]];
const WING_INTAKE = { height: 0.2, depth: 0.16 } as const;
const TURBINE_VANE_COUNT = 36;

/** Cowl inner wall, matching the cowl profile just inside the skin, from the lip back past the engine baffle. */
const COWL_LINER_PROFILE: readonly (readonly [number, number])[] = [[0, 0.83], [0.05, 0.96], [0.18, 1.0], [0.45, 1.0]];
const COWL_LINER_INSET = 0.012;
let sharedCowlLinerGeometry: THREE.BufferGeometry | null = null;

/**
 * The nacelle skin is single-sided, so without a liner the inside of the cowl is see-through from any oblique angle.
 * Built along +x from the lip, so place it at the cowl front.
 */
function cowlLinerGeometry(): THREE.BufferGeometry {
  if (sharedCowlLinerGeometry) return sharedCowlLinerGeometry;
  const profile = COWL_LINER_PROFILE.map(([aft, radius]) => new THREE.Vector2(radius * COWL_RADIUS - COWL_LINER_INSET, -aft));
  // Lathe revolves about y; turning it about z by −90° puts that axis along +x, with the profile running aft.
  sharedCowlLinerGeometry = new THREE.LatheGeometry(profile, 48).rotateZ(-Math.PI / 2);
  return sharedCowlLinerGeometry;
}

/** Cowl flaps hinged around the rear of the cowl, trailing a few degrees open for climb cooling. */
function addCowlFlaps(parent: THREE.Object3D, materials: AircraftMaterials, spec: NacelleSpec, span: number): void {
  const geometry = roundedBox(COWL_FLAP.length, COWL_FLAP.thickness, ((2 * Math.PI * COWL_RADIUS) / COWL_FLAP_COUNT) * 0.93, 0.005);
  for (let flap = 0; flap < COWL_FLAP_COUNT; flap++) {
    const angle = ((flap + 0.5) / COWL_FLAP_COUNT) * Math.PI * 2;
    const ring = new THREE.Group();
    ring.position.set(toX(spec.cowlRearD - COWL_FLAP.hingeAheadOfRear), spec.thrustLineH, span);
    ring.rotation.x = angle;
    const hinge = new THREE.Group();
    hinge.position.y = COWL_RADIUS;
    hinge.rotation.z = -THREE.MathUtils.degToRad(COWL_FLAP.openDegrees);
    ring.add(hinge);
    parent.add(ring);
    const material = Math.cos(angle) < COWL_FLAP_GRAY_BELOW ? materials.neutralGray : materials.oliveDrab;
    part(hinge, geometry, material, -COWL_FLAP.length / 2, COWL_FLAP.thickness / 2, 0);
  }
}

/** Dark intake slots let into the leading edge, turned to follow its sweep. */
function addWingIntakes(parent: THREE.Object3D, material: THREE.Material, side: 1 | -1): void {
  const sweep = Math.atan(WING.leadingEdge.slope);
  for (const [inner, outer] of WING_INTAKE_SPANS) {
    const span = (inner + outer) / 2;
    const leading = wingEdges(span).leading;
    part(parent, new THREE.BoxGeometry(WING_INTAKE.depth, WING_INTAKE.height, (outer - inner) / Math.cos(sweep)), material,
      toX(leading + WING_INTAKE.depth / 2 - 0.01), wingChordHeight(span), side * span, { rotation: [0, -side * sweep, 0], castShadow: false });
  }
}

/**
 * GE B-22 turbosupercharger under the wing: the turbine wheel is exposed to the airstream with its nozzle-box ring and
 * vanes, the exhaust hood trails aft, and the waste-gate stack stands beside it.
 */
function addTurbosupercharger(parent: THREE.Object3D, materials: AircraftMaterials, x: number, y: number, z: number): void {
  part(parent, new THREE.CylinderGeometry(0.3, 0.3, 0.12, 36), materials.steel, x, y, z);
  part(parent, new THREE.TorusGeometry(0.29, 0.035, 8, 40), materials.steel, x, y - 0.06, z, { rotation: [Math.PI / 2, 0, 0] });
  const vane = new THREE.BoxGeometry(0.05, 0.028, 0.008);
  for (let index = 0; index < TURBINE_VANE_COUNT; index++) {
    const angle = (index / TURBINE_VANE_COUNT) * Math.PI * 2;
    part(parent, vane, materials.gunmetal, x + Math.cos(angle) * 0.25, y - 0.075, z + Math.sin(angle) * 0.25, { rotation: [0.5, -angle, 0], castShadow: false });
  }
  part(parent, new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), materials.gunmetal, x, y - 0.06, z);
  part(parent, new THREE.CylinderGeometry(0.11, 0.13, 0.2, 16), materials.steel, x - 0.32, y - 0.05, z, { rotation: [0, 0, Math.PI / 2.4] });
  part(parent, new THREE.CircleGeometry(0.1, 16), materials.turboGlow, x - 0.43, y - 0.1, z, { rotation: [0, -Math.PI / 2, 0] });
  part(parent, new THREE.CylinderGeometry(0.05, 0.055, 0.16, 12), materials.steel, x + 0.24, y - 0.1, z);
}

const CHIN_TURRET_RING_POINTS = 48;
/** Plan-view squareness of the turret drum: 2 would be an ellipse, higher is boxier with rounded corners. */
const CHIN_TURRET_PLAN_EXPONENT = 3;
const CHIN_GUN_SLOT = { top: -0.78, bottom: -1.18, width: 0.07 } as const;
const CHIN_GUN_REST_DEPRESSION_DEGREES = 12;

/**
 * Turret drum in turret space (rotation axis at x = z = 0, heights absolute): rounded-square in plan, straight sides,
 * and a rounded bottom edge onto a flat floor.
 */
function buildChinTurretGeometry(): THREE.BufferGeometry {
  const spec = STATIONS.chinTurret;
  const cornerTop = spec.bottom + spec.bottomCornerRadius;
  const heights = [spec.top, (spec.top + cornerTop) / 2, cornerTop];
  const cornerSteps = 6;
  for (let step = 1; step <= cornerSteps; step++) heights.push(cornerTop - spec.bottomCornerRadius * Math.sin((step / cornerSteps) * (Math.PI / 2)));
  const power = 2 / CHIN_TURRET_PLAN_EXPONENT;
  const rings = heights.map((y) => {
    const below = Math.max(cornerTop - y, 0);
    const inset = spec.bottomCornerRadius - Math.sqrt(Math.max(spec.bottomCornerRadius ** 2 - below ** 2, 0));
    const ring: THREE.Vector3[] = [];
    for (let index = 0; index < CHIN_TURRET_RING_POINTS; index++) {
      const theta = (index / CHIN_TURRET_RING_POINTS) * Math.PI * 2;
      const cosine = Math.cos(theta);
      const sine = Math.sin(theta);
      ring.push(new THREE.Vector3(
        (spec.halfLength - inset) * Math.sign(cosine) * Math.abs(cosine) ** power,
        y,
        (spec.halfWidth - inset) * Math.sign(sine) * Math.abs(sine) ** power,
      ));
    }
    return ring;
  });
  return loftGeometry(rings, heights.map((y) => (spec.top - y) / (spec.top - spec.bottom)), true, true);
}

/** Fixed fairing behind the turret, tapering from its full width into the belly. */
function buildChinFairingGeometry(): THREE.BufferGeometry {
  const fairing = STATIONS.chinTurret.fairing;
  const steps = 10;
  const stations: number[] = [];
  for (let step = 0; step <= steps; step++) stations.push(THREE.MathUtils.lerp(fairing.start, fairing.end, step / steps));
  const rings = stations.map((d, index) => {
    const t = index / steps;
    const top = hullSectionAt(d).bottom + 0.12;
    const bottom = Math.min(THREE.MathUtils.lerp(fairing.bottomStart, fairing.bottomEnd, t), top - 0.06);
    const halfWidth = THREE.MathUtils.lerp(fairing.halfWidthStart, fairing.halfWidthEnd, t ** 0.8);
    return ellipseRing(new THREE.Vector3(toX(d), 0, 0), top, bottom, halfWidth, CHIN_TURRET_RING_POINTS, 2.6);
  });
  return loftGeometry(rings, stations.map((d) => d / FUSELAGE_LENGTH), true, true);
}

function buildChinTurret(materials: AircraftMaterials): { turret: THREE.Group; guns: M2Gun[] } {
  const spec = STATIONS.chinTurret;
  const turret = new THREE.Group();
  turret.position.set(toX(spec.d), 0, 0);
  part(turret, buildChinTurretGeometry(), materials.oliveDrab, 0, 0, 0);
  // Gun slots in the front face, where the face sits a little behind the drum's nose because of the plan rounding.
  const slotZ = spec.gunSpacing;
  const faceX = spec.halfLength * (1 - (slotZ / spec.halfWidth) ** CHIN_TURRET_PLAN_EXPONENT) ** (1 / CHIN_TURRET_PLAN_EXPONENT);
  const slotMiddle = (CHIN_GUN_SLOT.top + CHIN_GUN_SLOT.bottom) / 2;
  // Photographs show the guns resting a little below level, emerging from the upper part of the slots.
  const gunDirection = new THREE.Vector3(1, -Math.tan(THREE.MathUtils.degToRad(CHIN_GUN_REST_DEPRESSION_DEGREES)), 0);
  const guns = [-1, 1].map((side) => {
    part(turret, roundedBox(0.05, CHIN_GUN_SLOT.top - CHIN_GUN_SLOT.bottom, CHIN_GUN_SLOT.width, 0.015), materials.gunBlack, faceX - 0.01, slotMiddle, side * slotZ);
    return addM2(turret, new THREE.Vector3(faceX - 0.08, CHIN_GUN_SLOT.top - 0.1, side * slotZ), gunDirection, 'turret');
  });
  return { turret, guns };
}

/** Basis whose z axis is the surface normal and whose x axis runs along `along`, for decal projectors. */
function decalOrientation(normal: THREE.Vector3, along: THREE.Vector3): THREE.Euler {
  const zAxis = normal.clone().normalize();
  const xAxis = along.clone().sub(zAxis.clone().multiplyScalar(along.dot(zAxis))).normalize();
  const yAxis = zAxis.clone().cross(xAxis);
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

function addDecal(
  parent: THREE.Object3D,
  target: THREE.Mesh,
  material: THREE.Material,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  along: THREE.Vector3,
  width: number,
  height: number,
  depth: number,
): THREE.Mesh {
  const geometry = new DecalGeometry(target, position, decalOrientation(normal, along), new THREE.Vector3(width, height, depth));
  if (geometry.getAttribute('position').count === 0) throw new Error(`Decal at ${position.toArray().map((value) => value.toFixed(2)).join(', ')} missed its target surface`);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const FORWARD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STARBOARD = new THREE.Vector3(0, 0, 1);
const PORT = new THREE.Vector3(0, 0, -1);

/** A glazed pane: the glass decal, plus the matching hole in the skin so the compartment shows through it. */
function addWindow(
  airframe: THREE.Object3D, target: THREE.Mesh, material: THREE.Material, cutouts: WindowCutouts,
  position: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3, width: number, height: number, depth: number,
): void {
  addDecal(airframe, target, material, position, normal, along, width, height, depth);
  cutouts.add(position, decalOrientation(normal, along), new THREE.Vector3(width, height, depth));
}

/** Window panes on both hull sides between two stations and heights. */
function addSideWindows(airframe: THREE.Object3D, hull: THREE.Mesh, material: THREE.Material, cutouts: WindowCutouts, start: number, end: number, top: number, bottom: number, sides: (1 | -1)[]): void {
  const d = (start + end) / 2;
  const h = (top + bottom) / 2;
  const halfWidth = hullSectionAt(d).halfWidth;
  for (const side of sides) {
    addWindow(airframe, hull, material, cutouts, new THREE.Vector3(toX(d), h, side * halfWidth), side > 0 ? STARBOARD : PORT, side > 0 ? FORWARD : FORWARD.clone().negate(), end - start, top - bottom, 0.5);
  }
}

export interface B17 {
  /** Model space is metres, nose toward +x, starboard toward +z. Scale and pose it from outside. */
  root: THREE.Group;
  propellers: THREE.Object3D[];
  topTurret: { yaw: THREE.Object3D; pitch: THREE.Object3D };
  ballTurret: { yaw: THREE.Object3D; pitch: THREE.Object3D };
  chinTurret: THREE.Object3D;
  /** Hinge groups; rotate about x by `side * angle` to open. */
  bombBayDoors: { hinge: THREE.Object3D; side: 1 | -1 }[];
  /** Racked bombs in release order; hide each as it drops. */
  rackedBombs: THREE.Object3D[];
  crewStations: CrewStation[];
  crew: B17Interior['crew'];
  /** All thirteen guns, for the gunnery. */
  guns: MountedGun[];
  /** Materials a cutaway clips: the fuselage skin and everything mounted on it. */
  cutawayMaterials: THREE.Material[];
  /** Hidden once the cut opens; they hang on the starboard skin the cut removes. */
  cutawayHidden: THREE.Object3D[];
  /** Turbosupercharger exhaust outlets, markers carried with their nacelles: where contrails form. */
  exhaustPorts: THREE.Object3D[];
  /** The assemblies the exploded view moves apart. */
  assemblies: Assemblies;
  turboGlow: THREE.MeshBasicMaterial;
  navigationLights: THREE.Mesh[];
}

/** `crewDetail`: the lead ship's crew is meshed finely for close-ups; wingmen only show through their glazing. */
export function buildB17(crewDetail: FigureDetail = 'high'): B17 {
  const materials = aircraftMaterials();
  const root = new THREE.Group();
  root.name = 'B-17G';
  const airframe = new THREE.Group();

  // Hull and nose glazing; the crew and fittings inside come from the interior builder below.
  const hullGeometry = buildHullGeometry();
  const hull = part(airframe, hullGeometry, materials.hull, 0, 0, 0);
  part(root, buildNoseGlazingGeometry(), materials.canopy, 0, 0, 0, { castShadow: false });
  const glazingFrame = new THREE.TorusGeometry(1, 0.018, 6, 48);
  const frameSection = hullSectionAt(NOSE_GLAZING_END);
  const frame = part(airframe, glazingFrame, materials.oliveDrab, toX(NOSE_GLAZING_END), (frameSection.top + frameSection.bottom) / 2, 0, { rotation: [0, Math.PI / 2, 0] });
  frame.scale.set(frameSection.halfWidth + 0.01, (frameSection.top - frameSection.bottom) / 2 + 0.01, 1);
  part(airframe, roundedBox(0.34, 0.3, 0.26, 0.04), materials.gunmetal, toX(0.5), -0.3, 0);
  part(airframe, new THREE.CylinderGeometry(0.06, 0.08, 0.24, 12), materials.gunBlack, toX(0.4), -0.05, 0);

  // Flying surfaces.
  const wingGeometry = buildWingGeometry();
  const starboardWing = assignAssembly(part(airframe, wingGeometry, materials.wing, 0, 0, 0), 'wing-starboard');
  const portWing = assignAssembly(part(airframe, mirrorAcrossZ(wingGeometry), materials.wing, 0, 0, 0), 'wing-port');
  const tailplaneGeometry = buildTailplaneGeometry();
  assignAssembly(part(airframe, tailplaneGeometry, materials.tailplane, 0, 0, 0), 'stabilizer-starboard');
  assignAssembly(part(airframe, mirrorAcrossZ(tailplaneGeometry), materials.tailplane, 0, 0, 0), 'stabilizer-port');
  const fin = assignAssembly(part(airframe, buildFinGeometry(), materials.fin, 0, 0, 0), 'fin');
  const tailHousingGeometry = buildTailHousingGeometry();
  const tailHousing = part(airframe, tailHousingGeometry, materials.tailHousing, 0, 0, 0);

  // Engines.
  sharedBladeGeometry ??= buildBladeGeometry();
  const propellers: THREE.Object3D[] = [];
  const exhaustPorts: THREE.Object3D[] = [];
  const navigationLights: THREE.Mesh[] = [];
  for (const spec of NACELLES) {
    const nacelleGeometry = buildNacelleGeometry(spec);
    for (const side of [1, -1] as const) {
      const span = side * spec.span;
      // Each nacelle, its engine, cowl, turbosupercharger and propeller is one assembly.
      const nacelleId = engineAssembly(side, spec === NACELLES[0]);
      const nacelle = assignAssembly(new THREE.Group(), nacelleId);
      airframe.add(nacelle);
      part(nacelle, side > 0 ? nacelleGeometry : mirrorAcrossZ(nacelleGeometry), materials.nacelle, 0, 0, 0);
      // Cylinder plane sits just behind the cowl lip, so the heads show through the opening as on the real aircraft.
      const cylinderPlaneD = spec.cowlFrontD + 0.26;
      const engine = buildRadialEngine(cylinderPlaneD - (spec.propellerD + PROPELLER_HUB_REAR));
      engine.position.set(toX(cylinderPlaneD), spec.thrustLineH, span);
      nacelle.add(engine);
      part(nacelle, new THREE.TorusGeometry(COWL_RADIUS * 0.85, 0.028, 8, 48), materials.oliveDrab, toX(spec.cowlFrontD + 0.01), spec.thrustLineH, span, { rotation: [0, Math.PI / 2, 0] });
      part(nacelle, cowlLinerGeometry(), materials.cowlLiner, toX(spec.cowlFrontD), spec.thrustLineH, span, { castShadow: false });
      addCowlFlaps(nacelle, materials, spec, span);

      // Turbosupercharger under the wing, outboard of the nacelle; its exhaust hood glows at climb power.
      const turboD = wingEdges(spec.span).leading + 1.9;
      const turboY = wingSurfaceAt(spec.span, turboD).lower - 0.1;
      const turboZ = span + side * 0.42;
      addTurbosupercharger(nacelle, materials, toX(turboD), turboY, turboZ);
      const exhaust = new THREE.Object3D();
      exhaust.position.set(toX(turboD + 0.45), turboY - 0.1, turboZ);
      exhaust.userData.unmerged = true;
      nacelle.add(exhaust);
      exhaustPorts.push(exhaust);

      // Main wheel: the B-17 leaves a third of the tyre exposed below the inboard nacelle when retracted.
      if (spec === NACELLES[0]) {
        part(nacelle, new THREE.TorusGeometry(0.52, 0.19, 14, 36), materials.rubber, toX(5.35), spec.thrustLineH - 0.41, span);
        part(nacelle, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 24), materials.gunmetal, toX(5.35), spec.thrustLineH - 0.41, span, { rotation: [Math.PI / 2, 0, 0] });
      }

      const propeller = new THREE.Group();
      propeller.position.set(toX(spec.propellerD), spec.thrustLineH, span);
      part(propeller, new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.gunmetal, 0.12, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
      part(propeller, new THREE.CylinderGeometry(0.2, 0.22, 0.3, 20), materials.gunmetal, -0.03, 0, 0, { rotation: [0, 0, Math.PI / 2] });
      for (let blade = 0; blade < BLADE_COUNT; blade++) {
        const bladeMesh = part(propeller, sharedBladeGeometry, materials.blade, 0, 0, 0);
        bladeMesh.rotation.x = (blade / BLADE_COUNT) * Math.PI * 2;
        // Clamp ring where the shank leaves the hub barrel.
        part(bladeMesh, new THREE.CylinderGeometry(0.085, 0.09, 0.07, 18), materials.gunmetal, 0, 0.235, 0);
      }
      const disc = part(propeller, new THREE.CircleGeometry(PROPELLER_RADIUS, 64), materials.propellerDisc, 0, 0, 0, { rotation: [0, Math.PI / 2, 0], castShadow: false });
      disc.receiveShadow = false;
      disc.renderOrder = 2;
      assignAssembly(propeller, nacelleId);
      root.add(propeller);
      propellers.push(propeller);
    }
  }
  const intakeMaterial = matteMaterial('#0d0e10', { roughness: 0.9 });
  for (const side of [1, -1] as const) {
    const intakes = assignAssembly(new THREE.Group(), side > 0 ? 'wing-starboard' : 'wing-port');
    airframe.add(intakes);
    addWingIntakes(intakes, intakeMaterial, side);
  }

  // Windows and canopy panes, projected onto the hull so they follow its curvature.
  const cutouts = new WindowCutouts();
  const windscreen = STATIONS.windscreen;
  const windscreenMid = (windscreen.start + windscreen.end) / 2;
  const windscreenNormal = new THREE.Vector3(0.62, 0.79, 0);
  for (const side of [1, -1]) {
    addWindow(airframe, hull, materials.windowPane, cutouts, new THREE.Vector3(toX(windscreenMid), hullSurfaceHeight(windscreenMid, 0.33 * side, true), 0.33 * side), windscreenNormal, STARBOARD, 0.56, 0.62, 0.3);
  }
  const cockpitSide = STATIONS.cockpitSideWindow;
  addSideWindows(airframe, hull, materials.windowPane, cutouts, cockpitSide.start, (cockpitSide.start + cockpitSide.end) / 2 - 0.03, cockpitSide.top, cockpitSide.bottom, [1, -1]);
  addSideWindows(airframe, hull, materials.windowPane, cutouts, (cockpitSide.start + cockpitSide.end) / 2 + 0.03, cockpitSide.end, cockpitSide.top, cockpitSide.bottom, [1, -1]);
  const cheek = STATIONS.cheekWindows;
  addSideWindows(airframe, hull, materials.windowPane, cutouts, cheek.start, cheek.end, cheek.top, cheek.bottom, [1, -1]);
  for (const [start, end] of STATIONS.navigatorWindows) {
    addSideWindows(airframe, hull, materials.windowPane, cutouts, start, end, STATIONS.navigatorWindowBand.top, STATIONS.navigatorWindowBand.bottom, [1, -1]);
  }
  const waistBand = STATIONS.waistWindowBand;
  addSideWindows(airframe, hull, materials.windowPane, cutouts, STATIONS.waistWindowStarboard.start, STATIONS.waistWindowStarboard.end, waistBand.top, waistBand.bottom, [1]);
  addSideWindows(airframe, hull, materials.windowPane, cutouts, STATIONS.waistWindowPort.start, STATIONS.waistWindowPort.end, waistBand.top, waistBand.bottom, [-1]);
  const radioHatch = STATIONS.radioHatch;
  const radioMid = (radioHatch.start + radioHatch.end) / 2;
  addWindow(airframe, hull, materials.windowPane, cutouts, new THREE.Vector3(toX(radioMid), hullSectionAt(radioMid).top, 0), UP, FORWARD, radioHatch.end - radioHatch.start, radioHatch.width, 0.4);

  // The ball turret's 46 1/2 in hole in the belly.
  const ballCentre = ballTurretCentre();
  const ballOpening = new THREE.Vector3(ballCentre.x, ballCentre.y + BALL.centreBelowSkin, 0);
  cutouts.add(ballOpening, decalOrientation(UP.clone().negate(), FORWARD), new THREE.Vector3(BALL.openingRadius * 2, BALL.openingRadius * 2, 0.3), 'round');

  // National insignia, codes and the 91st BG tail marking.
  const insignia = STATIONS.fuselageInsignia;
  for (const side of [1, -1] as const) {
    const normal = side > 0 ? STARBOARD : PORT;
    const along = side > 0 ? FORWARD : FORWARD.clone().negate();
    const insigniaHalfWidth = hullSectionAt(insignia.d).halfWidth;
    addDecal(airframe, hull, materials.insignia, new THREE.Vector3(toX(insignia.d), insignia.h, side * insigniaHalfWidth), normal, along, 2.55, 1.35, 0.9);
    addDecal(airframe, hull, materials.codes, new THREE.Vector3(toX(12.05), 0.05, side * hullSectionAt(12.05).halfWidth), normal, along, 1.2, 0.75, 0.6);
    addDecal(airframe, hull, materials.aircraftLetter, new THREE.Vector3(toX(17.55), -0.08, side * hullSectionAt(17.55).halfWidth), normal, along, 0.55, 0.68, 0.6);
    // Shallow projector so the marking lands on one face of the thin fin only, not mirrored through to the other.
    assignAssembly(addDecal(airframe, fin, materials.tailMarking, new THREE.Vector3(toX(19.75), 2.75, side * 0.12), normal, along, 1.3, 1.93, 0.2), 'fin');
  }
  const wingInsigniaSpan = 11.4;
  const wingInsigniaEdges = wingEdges(wingInsigniaSpan);
  const wingInsigniaD = (wingInsigniaEdges.leading + wingInsigniaEdges.trailing) / 2;
  const wingInsigniaSurface = wingSurfaceAt(wingInsigniaSpan, wingInsigniaD);
  // Upper surface of the port wing and lower surface of the starboard wing, per USAAF practice from 1943.
  assignAssembly(addDecal(airframe, portWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.upper, -wingInsigniaSpan), UP, STARBOARD, 2.87, 1.52, 0.28), 'wing-port');
  assignAssembly(addDecal(airframe, starboardWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.lower, wingInsigniaSpan), UP.clone().negate(), STARBOARD, 2.87, 1.52, 0.28), 'wing-starboard');

  // Bomb bay doors: patches of the skin hinged along the outer edges of the opening.
  const bay = STATIONS.bombBay;
  const bayMid = (bay.start + bay.end) / 2;
  const bombBayDoors: B17['bombBayDoors'] = [];
  for (const side of [1, -1] as const) {
    const hingeZ = side * bay.halfWidth;
    const hinge = assignAssembly(new THREE.Group(), 'bomb-doors');
    hinge.position.set(toX(bayMid), hullSurfaceHeight(bayMid, hingeZ, false), hingeZ);
    part(hinge, buildBayDoorGeometry(side), materials.bayDoor, 0, 0, 0);
    root.add(hinge);
    bombBayDoors.push({ hinge, side: side > 0 ? -1 : 1 });
  }

  // Top turret: Sperry A-1 behind the cockpit.
  const topTurretSpec = STATIONS.topTurret;
  const topTurretYaw = assignAssembly(new THREE.Group(), 'top-turret');
  topTurretYaw.position.set(toX(topTurretSpec.d), hullSectionAt(topTurretSpec.d).top - 0.03, 0);
  part(topTurretYaw, new THREE.CylinderGeometry(topTurretSpec.radius + 0.04, topTurretSpec.radius + 0.06, 0.12, 32, 1, true), materials.gunmetal, 0, 0.04, 0);
  const dome = part(topTurretYaw, new THREE.SphereGeometry(topTurretSpec.radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), materials.canopy, 0, 0.08, 0, { castShadow: false });
  dome.scale.y = topTurretSpec.domeHeight / topTurretSpec.radius;
  for (let rib = 0; rib < 4; rib++) {
    const ribMesh = part(topTurretYaw, new THREE.TorusGeometry(topTurretSpec.radius, 0.014, 6, 32, Math.PI), materials.oliveDrab, 0, 0.08, 0, { rotation: [0, (rib * Math.PI) / 4, 0] });
    ribMesh.scale.y = topTurretSpec.domeHeight / topTurretSpec.radius;
  }
  part(topTurretYaw, roundedBox(0.5, 0.2, 0.7, 0.06), materials.oliveDrab, -0.4, 0.1, 0);
  const topTurretPitch = new THREE.Group();
  topTurretPitch.userData.unmerged = true;
  topTurretPitch.position.set(0.18, 0.24, 0);
  const topTurretGuns = [-1, 1].map((side) => addM2(topTurretPitch, new THREE.Vector3(0, 0, (side * topTurretSpec.gunSpacing) / 2), FORWARD, 'turret'));
  topTurretYaw.add(topTurretPitch);
  root.add(topTurretYaw);

  // Sperry ball turret, hanging from its trunnion ring support in the hole in the belly behind the radio room.
  const ballYaw = assignAssembly(new THREE.Group(), 'ball-turret');
  ballYaw.position.copy(ballTurretCentre());
  addBallTurretMount(ballYaw, { structure: materials.neutralGray, steel: materials.gunmetal });
  const ballPitch = new THREE.Group();
  ballPitch.userData.unmerged = true;
  addBallTurretShell(ballPitch, { shell: materials.neutralGray, glass: materials.canopy, seam: materials.rubber, steel: materials.steel });
  const ballTurretGuns = ([-1, 1] as const).map((side) => addM2(ballPitch, ballGunOrigin(side), FORWARD, 'turret'));
  ballYaw.add(ballPitch);
  root.add(ballYaw);

  // Bendix chin turret on its fixed fairing.
  part(airframe, buildChinFairingGeometry(), materials.oliveDrab, 0, 0, 0);
  const { turret: chinTurret, guns: chinGuns } = buildChinTurret(materials);
  root.add(assignAssembly(chinTurret, 'chin-turret'));

  const tailWindows = STATIONS.tailTurretWindows;
  // The tail gunner's windows sit in the housing, which forms the roof of his compartment.
  addSideWindows(airframe, tailHousing, materials.windowPane, cutouts, tailWindows.start, tailWindows.end, tailWindows.top, tailWindows.bottom, [1, -1]);

  // Astrodome, radio antennas, and the long aerial from the radio-room mast to the fin.
  const astrodome = STATIONS.astrodome;
  part(root, new THREE.SphereGeometry(astrodome.radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.canopy, toX(astrodome.d), hullSectionAt(astrodome.d).top - 0.02, 0, { castShadow: false });
  part(airframe, new THREE.CylinderGeometry(0.02, 0.03, 0.45, 8), materials.gunBlack, toX(1.4), hullSectionAt(1.4).top + 0.2, 0);
  part(airframe, new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), materials.gunBlack, toX(1.4), hullSectionAt(1.4).top + 0.42, 0, { rotation: [Math.PI / 2, 0, 0] });
  for (const [d, lean] of [[9.05, 0.35], [10.2, 0.5]] as const) {
    part(airframe, new THREE.CylinderGeometry(0.015, 0.025, 0.65, 8), materials.gunBlack, toX(d) - 0.12, hullSectionAt(d).top + 0.28, 0, { rotation: [0, 0, lean] });
  }
  const mastD = 12.2;
  const mastBase = hullSectionAt(mastD).top;
  part(airframe, new THREE.CylinderGeometry(0.025, 0.04, 0.82, 8), materials.gunBlack, toX(mastD), mastBase + 0.41, 0);
  const aerial = new THREE.CatmullRomCurve3([new THREE.Vector3(toX(mastD), mastBase + 0.8, 0), new THREE.Vector3(toX(18.1), 3.94, 0)]);
  part(airframe, new THREE.TubeGeometry(aerial, 8, 0.012, 5, false), materials.gunBlack, 0, 0, 0, { castShadow: false });
  part(airframe, new THREE.SphereGeometry(0.16, 16, 10), materials.oliveDrab, toX(4.55), hullSectionAt(4.55).bottom - 0.08, 0).scale.set(2.2, 0.7, 0.9);

  // Navigation lights: red port wingtip, green starboard, white on the tail.
  const tipEdges = wingEdges(WING_SEMISPAN - 0.08);
  const tipD = (tipEdges.leading + tipEdges.trailing) / 2;
  for (const [span, material] of [[WING_SEMISPAN - 0.06, materials.navGreen], [-(WING_SEMISPAN - 0.06), materials.navRed]] as const) {
    navigationLights.push(assignAssembly(part(root, new THREE.SphereGeometry(0.07, 12, 8), material, toX(tipD), wingChordHeight(Math.abs(span)), span, { castShadow: false }), span > 0 ? 'wing-starboard' : 'wing-port'));
  }
  navigationLights.push(part(root, new THREE.SphereGeometry(0.05, 12, 8), materials.navWhite, toX(FUSELAGE_LENGTH - 0.05), 0.2, 0, { castShadow: false }));

  const interior = buildInterior({
    airframe,
    root,
    shells: [hullGeometry, tailHousingGeometry],
    topTurretYaw,
    topTurretPitch,
    topTurretGuns,
    ballTurretGuns,
    ballTurretPitch: ballPitch,
    createBomb,
    windowCutouts: cutouts,
  }, crewDetail);
  cutouts.apply(materials.hull);
  cutouts.apply(materials.tailHousing);

  // Into the assemblies the exploded view pulls apart. The starboard-wall equipment goes piece by piece, to the
  // compartment each piece hangs in.
  const assemblies = new Assemblies(root);
  assemblies.bake(airframe);
  for (const item of [...interior.starboardWall.children]) {
    item.userData.hiddenInCutaway = true;
    root.add(item);
  }
  interior.starboardWall.removeFromParent();
  assemblies.adoptRootChildren();
  // The turrets and every other moving part were left whole by the bake; merge each one's fixed pieces in its own space.
  const movingParts: THREE.Object3D[] = [topTurretYaw, ballYaw, chinTurret];
  root.traverse((object) => { if (object.userData.unmerged) movingParts.push(object); });
  for (const moving of movingParts) mergeRigidMeshes(moving);
  const starboardWall: THREE.Object3D[] = [];
  root.traverse((object) => { if (object.userData.hiddenInCutaway) starboardWall.push(object); });
  // Callouts ride with the assembly their man is in: the engineer with the top turret, the gunners with their sections.
  const crewStations = interior.stations.map((station) => {
    const man = interior.crew.find((entry) => entry.station.label === station.role);
    return { ...station, space: man ? assemblies.of(man.mesh) : assemblies.get(fuselageSectionAt(toX(station.anchor.x))) };
  });

  return {
    root,
    propellers,
    topTurret: { yaw: topTurretYaw, pitch: topTurretPitch },
    ballTurret: { yaw: ballYaw, pitch: ballPitch },
    chinTurret,
    bombBayDoors,
    rackedBombs: interior.rackedBombs,
    crewStations,
    assemblies,
    crew: interior.crew,
    // The chin turret's belts run up from the nose boxes out of sight, and its cases chute overboard.
    guns: [...interior.guns, ...chinGuns.map((gun) => ({ gun, belt: null, caseFloorY: null }))],
    cutawayMaterials: [
      materials.hull, materials.oliveDrab, materials.canopy, materials.windowPane, materials.insignia, materials.codes, materials.aircraftLetter,
      materials.neutralGray, ballWindowMaskMaterial(materials.neutralGray), materials.tailHousing, ...interior.clipMaterials,
    ],
    cutawayHidden: starboardWall,
    exhaustPorts,
    turboGlow: materials.turboGlow,
    navigationLights,
  };
}

let bombTemplate: THREE.Group | null = null;

/**
 * AN-M64 500 lb general-purpose bomb (TM 9-1980): 59.2 in long, 14.18 in body, olive drab with a yellow band at nose and
 * tail for a high-explosive filling, two suspension lugs 14 in apart, an AN-M103 nose fuze with its arming vane, and a
 * box tail fin. Model space metres, nose toward +x. Returns a clone of one merged template, so racks and falling bombs
 * share geometry.
 */
export function createBomb(): THREE.Group {
  bombTemplate ??= mergeStaticMeshes(buildBombParts());
  return bombTemplate.clone();
}

const BOMB = {
  radius: 0.18,
  /** Tail end of the fin box to the nose fuze's tip. */
  tail: -0.752,
  nose: 0.752,
  lugSpacing: 0.356,
  band: 0.025,
  /** Box fin: a square tube about the body's width across, its corners on the four fins' tips. */
  finBox: { front: -0.49, back: -0.752, half: 0.165 },
  finRoot: -0.39,
} as const;

/** Body of revolution, (radius, distance along the axis) from the tail plug to the fuze tip. */
const BOMB_PROFILE: [number, number][] = [
  [0, -0.6], [0.05, -0.6], [0.075, -0.56], [0.12, -0.4], [0.165, -0.22], [0.18, -0.12],
  [0.18, 0.36], [0.172, 0.44], [0.15, 0.53], [0.11, 0.61], [0.062, 0.67],
  // AN-M103 nose fuze: body, then the arming-vane hub.
  [0.045, 0.68], [0.04, 0.72], [0.022, 0.73], [0.02, 0.75], [0, 0.752],
];

function buildBombParts(): THREE.Group {
  const materials = aircraftMaterials();
  const bomb = new THREE.Group();
  const alongX = (geometry: THREE.BufferGeometry) => geometry.rotateZ(-Math.PI / 2);
  part(bomb, alongX(new THREE.LatheGeometry(BOMB_PROFILE.map(([radius, along]) => new THREE.Vector2(radius, along)), 32)), materials.bomb, 0, 0, 0);
  // Yellow identification bands where the nose ogive meets the body, and at the start of the tail cone.
  for (const x of [0.33, -0.1]) {
    part(bomb, alongX(new THREE.CylinderGeometry(BOMB.radius + 0.0015, BOMB.radius + 0.0015, BOMB.band, 32, 1, true)), materials.bombBand, x, 0, 0);
  }
  // Fuze arming vane: two small blades across the nose.
  for (const angle of [0, Math.PI / 2]) {
    part(bomb, roundedBox(0.006, 0.1, 0.022, 0.002), materials.gunmetal, 0.725, 0, 0, { rotation: [angle + 0.4, 0, 0] });
  }
  // Suspension lugs on top, 14 in apart, for the rack's shackle hooks.
  for (const x of [-BOMB.lugSpacing / 2, BOMB.lugSpacing / 2]) {
    part(bomb, new THREE.TorusGeometry(0.018, 0.005, 6, 14, Math.PI), materials.gunmetal, x, BOMB.radius - 0.004, 0);
  }
  // Box fin: four fins in an X from the tail cone out to the corners of a square box.
  const half = BOMB.finBox.half;
  const tipRadius = half * Math.SQRT2;
  const finLength = BOMB.finBox.front - BOMB.tail + (BOMB.finRoot - BOMB.finBox.front);
  for (let fin = 0; fin < 4; fin++) {
    const angle = Math.PI / 4 + (fin * Math.PI) / 2;
    const span = tipRadius - 0.06;
    const mesh = part(bomb, roundedBox(finLength, span, 0.004, 0.0015), materials.bomb, (BOMB.finRoot + BOMB.tail) / 2, 0, 0);
    mesh.rotation.x = angle;
    mesh.translateY(0.06 + span / 2);
  }
  const boxLength = BOMB.finBox.front - BOMB.finBox.back;
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2;
    const mesh = part(bomb, roundedBox(boxLength, half * 2, 0.004, 0.0015), materials.bomb, (BOMB.finBox.front + BOMB.finBox.back) / 2, 0, 0);
    mesh.rotation.x = angle;
    mesh.translateZ(half);
  }
  return bomb;
}
