import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { applyStudioShading, emissiveMaterial, matteMaterial, metalMaterial } from '../render/studio';
import {
  COWL_RADIUS, FIN_OUTLINE, FUSELAGE_LENGTH, NACELLES, NOSE_GLAZING_END, PROPELLER_RADIUS, STATIONS,
  TAILPLANE, WING, WING_SEMISPAN, type NacelleSpec,
} from './b17-dimensions';
import { mergeStaticMeshes, part, roundedBox } from './kit';
import { buildInterior, type CrewStation } from './b17-interior';
import { buildRadialEngine } from './engine';
import { HULL_RING_POINTS, hullRing, hullSectionAt, hullSurfaceHeight, toX } from './hull';
import { airfoilSection, ellipseRing, loftGeometry, mirrorAcrossZ, monotoneCubic } from './loft';
import { PALETTE } from './palette';
import {
  codeLettersTexture, hullPaintTexture, insigniaTexture, propellerDiscTexture, surfacePaintTexture, tailMarkingTexture,
} from './textures';

const AIRFOIL_POINTS_PER_SIDE = 28;
const TAN_DIHEDRAL = Math.tan(THREE.MathUtils.degToRad(WING.dihedralDegrees));
const BLADE_COUNT = 3;
const TIP_STRIPE_LENGTH = 0.15;
const GUN_BARREL_RADIUS = 0.022;
const GUN_JACKET_RADIUS = 0.04;

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

function windowPaneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, '#2a3440');
  gradient.addColorStop(0.5, '#0d1218');
  gradient.addColorStop(1, '#1b232c');
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
    neutralGray: paintMaterial(null, PALETTE.neutralGray),
    canopy: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#dfeef5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide,
    })),
    windowPane: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: windowPaneTexture(), roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.7,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
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
    bomb: paintMaterial(null, '#4f4d35'),
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
  return stations;
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

function buildWingGeometry(): THREE.BufferGeometry {
  // The wing stops just inside the fuselage side with a closed root rib, leaving the bomb bay and radio room clear
  // for the bomb racks and crew, and giving the cutaway a clean wing root.
  const spans = [0.95, 1.6, 2.4, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, ...WING.tip.map((row) => row[0])];
  return buildSurfaceGeometry(spans, wingEdges, wingChordHeight, wingThicknessRatio, WING_SEMISPAN, true);
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
  return buildSurfaceGeometry(
    spans,
    tailplaneEdges,
    () => TAILPLANE.chordHeight,
    (span) => THREE.MathUtils.lerp(TAILPLANE.rootThicknessRatio, TAILPLANE.tipThicknessRatio, span / tipSpan),
    tipSpan,
  );
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
  // Below the outline the fin is buried in the fuselage, so extend both edges straight down.
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
  return loftGeometry(rings, heights.map((height) => height / FIN_TOP), true, true);
}

/** Cheyenne tail-gun housing under the rudder: a raised, slab-sided fairing over the tail cone. */
function buildTailHousingGeometry(): THREE.BufferGeometry {
  const { start, end, top } = STATIONS.tailTurretHousing;
  const stations = [start, start + 0.3, start + 0.8, end - 0.6, end - 0.3, end];
  const tops = [hullSectionAt(start).top - 0.02, top - 0.12, top, top, top - 0.14, hullSectionAt(end).top];
  const rings = stations.map((d, index) => {
    const hull = hullSectionAt(d);
    return ellipseRing(new THREE.Vector3(toX(d), 0, 0), tops[index], hull.bottom + 0.3, Math.min(hull.halfWidth + 0.015, 0.4), HULL_RING_POINTS, 3.2);
  });
  return loftGeometry(rings, stations.map((d) => d / FUSELAGE_LENGTH), true, true);
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

function buildChinTurret(materials: AircraftMaterials): THREE.Group {
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
  for (const side of [-1, 1]) {
    part(turret, roundedBox(0.05, CHIN_GUN_SLOT.top - CHIN_GUN_SLOT.bottom, CHIN_GUN_SLOT.width, 0.015), materials.gunBlack, faceX - 0.01, slotMiddle, side * slotZ);
    addGun(turret, materials, new THREE.Vector3(faceX - 0.08, CHIN_GUN_SLOT.top - 0.1, side * slotZ), gunDirection, 1.1);
  }
  return turret;
}

function addGun(parent: THREE.Object3D, materials: AircraftMaterials, origin: THREE.Vector3, direction: THREE.Vector3, length: number): void {
  const gun = new THREE.Group();
  gun.position.copy(origin);
  gun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  const jacketLength = length * 0.55;
  part(gun, new THREE.CylinderGeometry(GUN_JACKET_RADIUS, GUN_JACKET_RADIUS, jacketLength, 10), materials.gunBlack, 0, jacketLength / 2, 0);
  part(gun, new THREE.CylinderGeometry(GUN_BARREL_RADIUS, GUN_BARREL_RADIUS, length, 8), materials.gunBlack, 0, length / 2, 0);
  part(gun, new THREE.CylinderGeometry(0.03, 0.026, 0.09, 8), materials.gunBlack, 0, length, 0);
  parent.add(gun);
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

/** Window panes on both hull sides between two stations and heights. */
function addSideWindows(airframe: THREE.Object3D, hull: THREE.Mesh, material: THREE.Material, start: number, end: number, top: number, bottom: number, sides: (1 | -1)[]): void {
  const d = (start + end) / 2;
  const h = (top + bottom) / 2;
  const halfWidth = hullSectionAt(d).halfWidth;
  for (const side of sides) {
    addDecal(airframe, hull, material, new THREE.Vector3(toX(d), h, side * halfWidth), side > 0 ? STARBOARD : PORT, side > 0 ? FORWARD : FORWARD.clone().negate(), end - start, top - bottom, 0.5);
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
  /** Materials a cutaway clips: the fuselage skin and everything mounted on it. */
  cutawayMaterials: THREE.Material[];
  /** Turbosupercharger exhaust outlets, model space: where contrails form. */
  exhaustPorts: THREE.Vector3[];
  turboGlow: THREE.MeshBasicMaterial;
  navigationLights: THREE.Mesh[];
}

export function buildB17(): B17 {
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
  const starboardWing = part(airframe, wingGeometry, materials.wing, 0, 0, 0);
  const portWing = part(airframe, mirrorAcrossZ(wingGeometry), materials.wing, 0, 0, 0);
  const tailplaneGeometry = buildTailplaneGeometry();
  part(airframe, tailplaneGeometry, materials.tailplane, 0, 0, 0);
  part(airframe, mirrorAcrossZ(tailplaneGeometry), materials.tailplane, 0, 0, 0);
  const fin = part(airframe, buildFinGeometry(), materials.fin, 0, 0, 0);
  const tailHousingGeometry = buildTailHousingGeometry();
  const tailHousing = part(airframe, tailHousingGeometry, materials.oliveDrab, 0, 0, 0);

  // Engines.
  sharedBladeGeometry ??= buildBladeGeometry();
  const propellers: THREE.Object3D[] = [];
  const exhaustPorts: THREE.Vector3[] = [];
  const navigationLights: THREE.Mesh[] = [];
  for (const spec of NACELLES) {
    const nacelleGeometry = buildNacelleGeometry(spec);
    for (const side of [1, -1] as const) {
      const span = side * spec.span;
      part(airframe, side > 0 ? nacelleGeometry : mirrorAcrossZ(nacelleGeometry), materials.nacelle, 0, 0, 0);
      // Cylinder plane sits just behind the cowl lip, so the heads show through the opening as on the real aircraft.
      const cylinderPlaneD = spec.cowlFrontD + 0.26;
      const engine = buildRadialEngine(cylinderPlaneD - (spec.propellerD + PROPELLER_HUB_REAR));
      engine.position.set(toX(cylinderPlaneD), spec.thrustLineH, span);
      airframe.add(engine);
      part(airframe, new THREE.TorusGeometry(COWL_RADIUS * 0.85, 0.028, 8, 48), materials.oliveDrab, toX(spec.cowlFrontD + 0.01), spec.thrustLineH, span, { rotation: [0, Math.PI / 2, 0] });
      part(airframe, cowlLinerGeometry(), materials.cowlLiner, toX(spec.cowlFrontD), spec.thrustLineH, span, { castShadow: false });
      addCowlFlaps(airframe, materials, spec, span);

      // Turbosupercharger under the wing, outboard of the nacelle; its exhaust hood glows at climb power.
      const turboD = wingEdges(spec.span).leading + 1.9;
      const turboY = wingSurfaceAt(spec.span, turboD).lower - 0.1;
      const turboZ = span + side * 0.42;
      addTurbosupercharger(airframe, materials, toX(turboD), turboY, turboZ);
      exhaustPorts.push(new THREE.Vector3(toX(turboD + 0.45), turboY - 0.1, turboZ));

      // Main wheel: the B-17 leaves a third of the tyre exposed below the inboard nacelle when retracted.
      if (spec === NACELLES[0]) {
        part(airframe, new THREE.TorusGeometry(0.52, 0.19, 14, 36), materials.rubber, toX(5.35), spec.thrustLineH - 0.41, span);
        part(airframe, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 24), materials.gunmetal, toX(5.35), spec.thrustLineH - 0.41, span, { rotation: [Math.PI / 2, 0, 0] });
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
      root.add(propeller);
      propellers.push(propeller);
    }
  }
  const intakeMaterial = matteMaterial('#0d0e10', { roughness: 0.9 });
  for (const side of [1, -1] as const) addWingIntakes(airframe, intakeMaterial, side);

  // Windows and canopy panes, projected onto the hull so they follow its curvature.
  const windscreen = STATIONS.windscreen;
  const windscreenMid = (windscreen.start + windscreen.end) / 2;
  const windscreenNormal = new THREE.Vector3(0.62, 0.79, 0);
  for (const side of [1, -1]) {
    addDecal(airframe, hull, materials.windowPane, new THREE.Vector3(toX(windscreenMid), hullSurfaceHeight(windscreenMid, 0.33 * side, true), 0.33 * side), windscreenNormal, STARBOARD, 0.56, 0.62, 0.3);
  }
  const cockpitSide = STATIONS.cockpitSideWindow;
  addSideWindows(airframe, hull, materials.windowPane, cockpitSide.start, (cockpitSide.start + cockpitSide.end) / 2 - 0.03, cockpitSide.top, cockpitSide.bottom, [1, -1]);
  addSideWindows(airframe, hull, materials.windowPane, (cockpitSide.start + cockpitSide.end) / 2 + 0.03, cockpitSide.end, cockpitSide.top, cockpitSide.bottom, [1, -1]);
  const cheek = STATIONS.cheekWindows;
  addSideWindows(airframe, hull, materials.windowPane, cheek.start, cheek.end, cheek.top, cheek.bottom, [1, -1]);
  for (const [start, end] of STATIONS.navigatorWindows) {
    addSideWindows(airframe, hull, materials.windowPane, start, end, STATIONS.navigatorWindowBand.top, STATIONS.navigatorWindowBand.bottom, [1, -1]);
  }
  const waistBand = STATIONS.waistWindowBand;
  addSideWindows(airframe, hull, materials.windowPane, STATIONS.waistWindowStarboard.start, STATIONS.waistWindowStarboard.end, waistBand.top, waistBand.bottom, [1]);
  addSideWindows(airframe, hull, materials.windowPane, STATIONS.waistWindowPort.start, STATIONS.waistWindowPort.end, waistBand.top, waistBand.bottom, [-1]);
  const radioHatch = STATIONS.radioHatch;
  const radioMid = (radioHatch.start + radioHatch.end) / 2;
  addDecal(airframe, hull, materials.windowPane, new THREE.Vector3(toX(radioMid), hullSectionAt(radioMid).top, 0), UP, FORWARD, radioHatch.end - radioHatch.start, 0.62, 0.4);

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
    addDecal(airframe, fin, materials.tailMarking, new THREE.Vector3(toX(19.75), 2.75, side * 0.12), normal, along, 1.3, 1.93, 0.2);
  }
  const wingInsigniaSpan = 11.4;
  const wingInsigniaEdges = wingEdges(wingInsigniaSpan);
  const wingInsigniaD = (wingInsigniaEdges.leading + wingInsigniaEdges.trailing) / 2;
  const wingInsigniaSurface = wingSurfaceAt(wingInsigniaSpan, wingInsigniaD);
  // Upper surface of the port wing and lower surface of the starboard wing, per USAAF practice from 1943.
  addDecal(airframe, portWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.upper, -wingInsigniaSpan), UP, STARBOARD, 2.87, 1.52, 0.28);
  addDecal(airframe, starboardWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.lower, wingInsigniaSpan), UP.clone().negate(), STARBOARD, 2.87, 1.52, 0.28);

  // Bomb bay doors: patches of the skin hinged along the outer edges of the opening.
  const bay = STATIONS.bombBay;
  const bayMid = (bay.start + bay.end) / 2;
  const bombBayDoors: B17['bombBayDoors'] = [];
  for (const side of [1, -1] as const) {
    const hingeZ = side * bay.halfWidth;
    const hinge = new THREE.Group();
    hinge.position.set(toX(bayMid), hullSurfaceHeight(bayMid, hingeZ, false), hingeZ);
    part(hinge, buildBayDoorGeometry(side), materials.bayDoor, 0, 0, 0);
    root.add(hinge);
    bombBayDoors.push({ hinge, side: side > 0 ? -1 : 1 });
  }

  // Top turret: Sperry A-1 behind the cockpit.
  const topTurretSpec = STATIONS.topTurret;
  const topTurretYaw = new THREE.Group();
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
  topTurretPitch.position.set(0.18, 0.24, 0);
  for (const offset of [-0.14, 0.14]) addGun(topTurretPitch, materials, new THREE.Vector3(0, 0, offset), FORWARD, 1.2);
  topTurretYaw.add(topTurretPitch);
  root.add(topTurretYaw);

  // Ball turret hanging from its yoke under the radio room.
  const ballSpec = STATIONS.ballTurret;
  part(airframe, new THREE.CylinderGeometry(0.16, 0.2, 0.5, 16), materials.gunmetal, toX(ballSpec.d), ballSpec.h + ballSpec.radius + 0.1, 0);
  const ballYaw = new THREE.Group();
  ballYaw.position.set(toX(ballSpec.d), ballSpec.h, 0);
  const ballPitch = new THREE.Group();
  part(ballPitch, new THREE.SphereGeometry(ballSpec.radius, 32, 20), materials.neutralGray, 0, 0, 0);
  part(ballPitch, new THREE.SphereGeometry(ballSpec.radius + 0.006, 24, 8, -0.42, 0.84, Math.PI / 2 - 0.42, 0.84), materials.windowPane, 0, 0, 0, { rotation: [0, Math.PI / 2, 0], castShadow: false });
  for (const offset of [-0.2, 0.2]) addGun(ballPitch, materials, new THREE.Vector3(0.2, -0.05, offset), FORWARD, 1.25);
  ballYaw.add(ballPitch);
  root.add(ballYaw);

  // Bendix chin turret on its fixed fairing.
  part(airframe, buildChinFairingGeometry(), materials.oliveDrab, 0, 0, 0);
  const chinTurret = buildChinTurret(materials);
  root.add(chinTurret);

  // Hand-held guns: cheeks, waists and the twin tail guns.
  addGun(airframe, materials, new THREE.Vector3(toX(1.1), 0.05, hullSectionAt(1.1).halfWidth - 0.02), new THREE.Vector3(1, -0.05, 0.32), 1.0);
  addGun(airframe, materials, new THREE.Vector3(toX(1.45), 0.05, -hullSectionAt(1.45).halfWidth + 0.02), new THREE.Vector3(1, -0.05, -0.32), 1.0);
  const starboardWaist = (STATIONS.waistWindowStarboard.start + STATIONS.waistWindowStarboard.end) / 2;
  const portWaist = (STATIONS.waistWindowPort.start + STATIONS.waistWindowPort.end) / 2;
  addGun(airframe, materials, new THREE.Vector3(toX(starboardWaist), 0.12, hullSectionAt(starboardWaist).halfWidth - 0.15), new THREE.Vector3(-0.35, -0.1, 1), 1.1);
  addGun(airframe, materials, new THREE.Vector3(toX(portWaist), 0.12, -hullSectionAt(portWaist).halfWidth + 0.15), new THREE.Vector3(-0.35, -0.1, -1), 1.1);
  for (const offset of [-0.11, 0.11]) {
    addGun(airframe, materials, new THREE.Vector3(toX(FUSELAGE_LENGTH - 0.1), -0.06, offset), FORWARD.clone().negate(), 1.0);
  }
  const tailWindows = STATIONS.tailTurretWindows;
  // The tail gunner's windows sit in the housing, which forms the roof of his compartment.
  addSideWindows(airframe, tailHousing, materials.windowPane, tailWindows.start, tailWindows.end, tailWindows.top, tailWindows.bottom, [1, -1]);

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
    navigationLights.push(part(root, new THREE.SphereGeometry(0.07, 12, 8), material, toX(tipD), wingChordHeight(Math.abs(span)), span, { castShadow: false }));
  }
  navigationLights.push(part(root, new THREE.SphereGeometry(0.05, 12, 8), materials.navWhite, toX(FUSELAGE_LENGTH - 0.05), 0.2, 0, { castShadow: false }));

  const interior = buildInterior({
    airframe,
    root,
    shells: [hullGeometry, tailHousingGeometry],
    topTurretYaw,
    ballTurretPitch: ballPitch,
    createBomb,
  });

  root.add(mergeStaticMeshes(airframe));
  // Glass and propeller blur are see-through, so they must not cast ambient occlusion on what lies behind them.
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && (object.material === materials.canopy || object.material === materials.propellerDisc)) {
      object.userData.skipAmbientOcclusion = true;
    }
  });

  return {
    root,
    propellers,
    topTurret: { yaw: topTurretYaw, pitch: topTurretPitch },
    ballTurret: { yaw: ballYaw, pitch: ballPitch },
    chinTurret,
    bombBayDoors,
    rackedBombs: interior.rackedBombs,
    crewStations: interior.stations,
    cutawayMaterials: [
      materials.hull, materials.oliveDrab, materials.canopy, materials.windowPane, materials.insignia, materials.codes, materials.aircraftLetter,
      materials.neutralGray,
    ],
    exhaustPorts,
    turboGlow: materials.turboGlow,
    navigationLights,
  };
}

let bombTemplate: THREE.Group | null = null;

/**
 * AN-M64 500 lb general-purpose bomb: olive drab body, yellow nose band, box fins. Model space metres, nose toward +x.
 * Returns a clone of one merged template, so racks and falling bombs share geometry.
 */
export function createBomb(): THREE.Group {
  bombTemplate ??= mergeStaticMeshes(buildBombParts());
  return bombTemplate.clone();
}

function buildBombParts(): THREE.Group {
  const materials = aircraftMaterials();
  const bomb = new THREE.Group();
  const profile = [
    new THREE.Vector2(0, 0.62), new THREE.Vector2(0.09, 0.58), new THREE.Vector2(0.16, 0.45), new THREE.Vector2(0.18, 0.25),
    new THREE.Vector2(0.18, -0.2), new THREE.Vector2(0.15, -0.42), new THREE.Vector2(0.07, -0.6), new THREE.Vector2(0, -0.62),
  ];
  part(bomb, new THREE.LatheGeometry(profile, 24), materials.bomb, 0, 0, 0, { rotation: [0, 0, -Math.PI / 2] });
  part(bomb, new THREE.CylinderGeometry(0.182, 0.182, 0.06, 24), materials.bombBand, 0.35, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  for (let fin = 0; fin < 4; fin++) {
    part(bomb, roundedBox(0.36, 0.3, 0.015, 0.005), materials.bomb, -0.62, 0, 0, { rotation: [(fin * Math.PI) / 2, 0, 0] });
  }
  part(bomb, new THREE.CylinderGeometry(0.17, 0.17, 0.3, 4, 1, true), materials.bomb, -0.62, 0, 0, { rotation: [0, 0, Math.PI / 2] });
  return bomb;
}
