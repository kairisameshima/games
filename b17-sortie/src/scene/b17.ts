import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyBrushwork } from '../render/miniature';
import { applyStudioShading, emissiveMaterial, matteMaterial, metalMaterial } from '../render/studio';
import {
  COWL_RADIUS, FIN_OUTLINE, FUSELAGE_LENGTH, NACELLES, NOSE_GLAZING_END, PROPELLER_RADIUS, STATIONS,
  TAILPLANE, WING, WING_SEMISPAN, type NacelleSpec,
} from './b17-dimensions';
import { mergeRigidMeshes, mergeStaticMeshes, part, roundedBox } from './kit';
import type { FigureDetail } from './crew/figure';
import { buildInterior, type B17Interior, type CrewStation } from './interior';
import { CRAWLWAY, TAIL, WAIST } from './interior/layout';
import { rod } from './interior/parts';
import { waistFloorHeight } from './interior/structure';
import { interiorMaterials } from './interior/materials';
import { Assemblies, assignAssembly, engineAssembly, FUSELAGE_JOINTS, fuselageSectionAt } from './assemblies';
import { addBallTurretMount, addBallTurretShell, BALL, ballGunOrigin, ballTurretCentre, ballWindowMaskMaterial } from './ball-turret';
import type { MountedGun } from './gunnery';
import { addM2, type M2Gun } from './m2';
import { WindowCutouts } from './window-cutouts';
import { LEAD_LIVERY, type Finish, type Livery, type TailGunPosition } from './livery';
import { buildRadialEngine } from './engine';
import { HULL_EXPONENT, HULL_RING_POINTS, hullHalfWidthAtHeight, hullRing, hullSectionAt, hullSurfaceHeight, toX } from './hull';
import { airfoilSection, ellipseRing, loftGeometry, mirrorAcrossZ, monotoneCubic } from './loft';
import { PALETTE } from './palette';
import {
  codeLettersDecal, fingerprintTexture, flakDamageTexture, hatchOutlineTexture, oilStreakTexture, MISSION_TALLY_ART, missionTallyDecal, MISSIONS_FLOWN, noseArtDecal, type NoseArtChoice, glueFogTexture, hullPaintTexture, insigniaDecal, surfacePaintTexture, tailMarkingDecal,
  type DecalArt,
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

// Materials and textures are shared by every aircraft in the same livery.

interface AircraftMaterials {
  hull: THREE.MeshStandardMaterial;
  wing: THREE.MeshStandardMaterial;
  tailplane: THREE.MeshStandardMaterial;
  fin: THREE.MeshStandardMaterial;
  nacelle: THREE.MeshStandardMaterial;
  /** Plain paint of the upper and lower surfaces: Olive Drab over Neutral Gray, or bare metal both. */
  upperPaint: THREE.MeshStandardMaterial;
  tailHousing: THREE.MeshStandardMaterial;
  lowerPaint: THREE.MeshStandardMaterial;
  canopy: THREE.MeshPhysicalMaterial;
  /** The top turret's dome: Plexiglas yellowed by sun and cleaning, a warmer tint than the rest of the glazing. */
  turretDome: THREE.MeshPhysicalMaterial;
  /** The top turret's flat windscreen: thick laminated glass, green at its edges. */
  armourGlass: THREE.MeshPhysicalMaterial;
  /** Bare metal where the paint has worn off the top turret's frames. */
  paintChip: THREE.MeshStandardMaterial;
  /** Kit flaws on the glazing: cement fog where glue touched it, and a thumbprint. */
  glueFog: THREE.MeshStandardMaterial;
  fingerprint: THREE.MeshStandardMaterial;
  windowPane: THREE.MeshStandardMaterial;
  insignia: THREE.MeshStandardMaterial;
  codes: THREE.MeshStandardMaterial;
  aircraftLetter: THREE.MeshStandardMaterial;
  tailMarking: THREE.MeshStandardMaterial;
  noseArt: Record<NoseArtChoice, THREE.MeshStandardMaterial>;
  missionTally: THREE.MeshStandardMaterial;
  /** The bomb added for the mission just flown, on its own scrap of decal sheet. */
  nextMission: THREE.MeshStandardMaterial;
  /** Outline of the forward entrance hatch in the belly. */
  hatchOutline: THREE.MeshStandardMaterial;
  bayDoor: THREE.MeshStandardMaterial;
  cowlLiner: THREE.MeshStandardMaterial;
  /** Scorched flak holes, painted on with the soot round them. */
  flakDamage: THREE.MeshStandardMaterial;
  /** Oil and soot streaked back from a hit engine; its opacity rises as the streaks build. */
  oilStreak: THREE.MeshStandardMaterial;
  /** Doped canvas of the stinger guns' boots. */
  canvas: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  gunBlack: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  turboGlow: THREE.MeshBasicMaterial;
  navRed: THREE.MeshBasicMaterial;
  navGreen: THREE.MeshBasicMaterial;
  navWhite: THREE.MeshBasicMaterial;
  bomb: THREE.MeshStandardMaterial;
  bombBand: THREE.MeshStandardMaterial;
}

/** Each livery's materials; ships with the same livery share them. */
const materialsByLivery = new Map<Livery, AircraftMaterials>();

/** Flat, sun-faded lacquer with a thin clearcoat, so softbox streaks still run along the hull. */
/** Brush-painted enamel, the way a kit is finished by hand. */
function paintMaterial(map: THREE.Texture | null, color: THREE.ColorRepresentation = '#ffffff', finish: Finish = 'oliveDrab'): THREE.MeshStandardMaterial {
  const sheen = finish === 'naturalMetal' ? SILVER_PAINT : FLAT_PAINT;
  return applyBrushwork(applyStudioShading(new THREE.MeshPhysicalMaterial({ color, map, ...sheen })));
}

/** Flat enamel for the camouflage; the bare-metal ships are brushed in silver paint, which reflects the softboxes. */
const FLAT_PAINT = { roughness: 0.66, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, envMapIntensity: 0.72 } as const;
const SILVER_PAINT = { roughness: 0.38, metalness: 0.72, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 1.0 } as const;

/** Bump of a decal's film and ink over the paint, in the bump map's 0–1 height. */
const DECAL_RELIEF = 6;

/** A water-slide decal: glossier than the paint, standing off it by its film. `addDecal` widens it to take the film in. */
function decalMaterial(art: DecalArt): THREE.MeshStandardMaterial {
  const material = applyStudioShading(new THREE.MeshPhysicalMaterial({
    map: art.map, bumpMap: art.bumpMap, bumpScale: DECAL_RELIEF, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    roughness: 0.5, clearcoat: 0.75, clearcoatRoughness: 0.18, envMapIntensity: 0.9,
  }));
  material.userData.decalGrowth = art.growth;
  return material;
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

interface PaintTextures { hull: THREE.Texture; nacelle: THREE.Texture; wing: THREE.Texture; tailplane: THREE.Texture; fin: THREE.Texture }

const paintTexturesByFinish = new Map<Finish, PaintTextures>();

/** The painted skins for a finish, drawn once and shared by every ship in it. */
function paintTextures(finish: Finish): PaintTextures {
  const cached = paintTexturesByFinish.get(finish);
  if (cached) return cached;
  const { upper, lower } = FINISH_COLOURS[finish];
  const textures: PaintTextures = {
    hull: hullPaintTexture({
      lengthMetres: FUSELAGE_LENGTH, majorJoints: HULL_SKIN_JOINTS, frameSpacing: 0.5, finish,
      oliveDrabHalfBand: 0.3, antiGlare: [NOSE_GLAZING_END, COCKPIT_WINDSCREEN_D], seed: 11, width: 2048, height: 1024,
    }),
    nacelle: hullPaintTexture({
      lengthMetres: 7.8, majorJoints: [0.2, 1.4, 2.1], frameSpacing: 0.45, finish, oliveDrabHalfBand: 0.31, sootFrom: 0.42, seed: 5, width: 1024, height: 512,
    }),
    wing: surfacePaintTexture({
      spanMetres: WING_SEMISPAN, upperColor: upper, lowerColor: lower,
      deIcerBoots: [[1.3, 2.25], [3.7, 5.8], [7.4, 15.3]], controlSurfaces: [[1.1, 10.2], [10.3, 15.1]], ribSpacing: 0.6, seed: 3,
    }),
    tailplane: surfacePaintTexture({
      spanMetres: 6.31, upperColor: upper, lowerColor: lower,
      deIcerBoots: [[0.95, 5.85]], controlSurfaces: [[0.9, 5.9]], ribSpacing: 0.45, seed: 9,
    }),
    fin: surfacePaintTexture({
      spanMetres: 4.65, upperColor: upper, lowerColor: upper,
      deIcerBoots: [[1.7, 4.3]], controlSurfaces: [[0.9, 4.45]], ribSpacing: 0.45, seed: 13,
    }),
  };
  paintTexturesByFinish.set(finish, textures);
  return textures;
}

const FINISH_COLOURS: Record<Finish, { upper: string; lower: string }> = {
  oliveDrab: { upper: PALETTE.oliveDrab, lower: PALETTE.neutralGray },
  naturalMetal: { upper: PALETTE.aluminium, lower: PALETTE.aluminium },
};

/**
 * The skin's circumferential joints, in metres aft of the nose glazing tip, traced from the vertical panel lines of the
 * Emoscopes side view (reference/b17g-profile-emoscopes.png, 31.7 px to the metre on its scale bar): behind the
 * glazing, bulkhead 4, the front spar, either side of the radio room, the waist, the tail wheel and the tail section.
 */
const HULL_SKIN_JOINTS = [0.74, 2.82, 5.61, 7.66, 10.38, 12.51, 14.49, 16.11, 19.33, 20.94];

/** Where the windscreen's base meets the nose top: the anti-glare panel of a bare-metal ship ends here. */
const COCKPIT_WINDSCREEN_D = 3.2;

function aircraftMaterials(livery: Livery): AircraftMaterials {
  const cached = materialsByLivery.get(livery);
  if (cached) return cached;
  const { finish } = livery;
  const textures = paintTextures(finish);
  const { upper, lower } = FINISH_COLOURS[finish];
  const materials: AircraftMaterials = {
    hull: paintMaterial(textures.hull, undefined, finish),
    wing: paintMaterial(textures.wing, undefined, finish),
    tailplane: paintMaterial(textures.tailplane, undefined, finish),
    fin: paintMaterial(textures.fin, undefined, finish),
    nacelle: paintMaterial(textures.nacelle, undefined, finish),
    upperPaint: paintMaterial(null, upper, finish),
    // Its own material because the tail gunner's window holes are cut in it.
    tailHousing: paintMaterial(null, upper, finish),
    lowerPaint: paintMaterial(null, lower, finish),
    canopy: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#dfeef5', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide,
    })),
    turretDome: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#f2eedc', roughness: 0.07, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.5, side: THREE.DoubleSide,
    })),
    armourGlass: applyStudioShading(new THREE.MeshPhysicalMaterial({
      color: '#cfe7dc', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7, side: THREE.DoubleSide,
    })),
    paintChip: metalMaterial('#8e9295', { roughness: 0.5, metalness: 0.7 }),
    windowPane: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: windowPaneTexture(), transparent: true, depthWrite: false, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })),
    glueFog: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: glueFogTexture(), transparent: true, depthWrite: false, roughness: 0.9, envMapIntensity: 0.4,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    })),
    fingerprint: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: fingerprintTexture(), transparent: true, depthWrite: false, roughness: 0.45, envMapIntensity: 1.2,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    })),
    insignia: decalMaterial(insigniaDecal()),
    codes: decalMaterial(codeLettersDecal(livery.codes, finish)),
    aircraftLetter: decalMaterial(codeLettersDecal(livery.letter, finish)),
    tailMarking: decalMaterial(tailMarkingDecal(livery.tailSerial, livery.letter, finish)),
    noseArt: { pinup: decalMaterial(noseArtDecal('pinup')), card: decalMaterial(noseArtDecal('card')) },
    missionTally: decalMaterial(missionTallyDecal(MISSIONS_FLOWN)),
    nextMission: decalMaterial(missionTallyDecal(1, 1)),
    hatchOutline: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: hatchOutlineTexture(), transparent: true, depthWrite: false, roughness: 0.7,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })),
    bayDoor: Object.assign(paintMaterial(null, lower, finish), { side: THREE.DoubleSide }),
    cowlLiner: matteMaterial('#1c1e1f', { roughness: 0.8, side: THREE.DoubleSide }),
    canvas: matteMaterial('#7d7255', { roughness: 0.9 }),
    oilStreak: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: oilStreakTexture(19), transparent: true, depthWrite: false, roughness: 0.55, envMapIntensity: 0.5, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    })),
    flakDamage: applyStudioShading(new THREE.MeshPhysicalMaterial({
      map: flakDamageTexture(7), transparent: true, depthWrite: false, roughness: 0.85,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    })),
    gunmetal: metalMaterial(PALETTE.gunmetal, { roughness: 0.36 }),
    gunBlack: metalMaterial(PALETTE.anodised, { roughness: 0.46, metalness: 0.55 }),
    steel: metalMaterial(PALETTE.chrome, { roughness: 0.22, metalness: 1 }),
    rubber: matteMaterial(PALETTE.rubber, { roughness: 0.72, envMapIntensity: 0.35 }),
    blade: applyStudioShading(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.48, metalness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 1.0,
    })),
    turboGlow: emissiveMaterial(PALETTE.turboGlow, 2.6),
    navRed: emissiveMaterial(PALETTE.navRed, 3.2),
    navGreen: emissiveMaterial(PALETTE.navGreen, 3.2),
    navWhite: emissiveMaterial('#fff4e0', 2.4),
    bomb: paintMaterial(null, '#3e3e2e'),
    bombBand: paintMaterial(null, PALETTE.tailYellow),
  };
  materialsByLivery.set(livery, materials);
  return materials;
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

/**
 * The hull, open at the nose so the compartment shows through the glazing. With the Cheyenne tail it runs to the gun
 * mount's opening, where the skin curls in round the mount: rings of the last section, each a little further aft and
 * drawn in towards its centre, the mount closing it. With the stinger the cone runs to the end and is closed there; the
 * guns leave it through their boots.
 */
function buildHullGeometry(tailGunPosition: TailGunPosition): THREE.BufferGeometry {
  if (tailGunPosition === 'stinger') {
    const cone = STATIONS.stingerCone;
    const stations = hullStations().filter((d) => d <= cone.from);
    const rings = stations.map((d) => hullRing(d));
    const params = stations.map((d) => d / FUSELAGE_LENGTH);
    for (const [d, scale] of cone.taper) {
      rings.push(scaledRing(hullRing(cone.from), scale, toX(d)));
      params.push(Math.min(d / FUSELAGE_LENGTH, 1));
    }
    return cutHullOpenings(loftGeometry(rings, params, false, true));
  }
  const mount = STATIONS.tailGunMount;
  const stations = hullStations().filter((d) => d < mount.opening - 0.02);
  stations.push(mount.opening);
  const rings = stations.map((d) => hullRing(d));
  const params = stations.map((d) => d / FUSELAGE_LENGTH);
  for (const [fraction, scale] of TAIL_LIP_CURL) {
    rings.push(scaledRing(hullRing(mount.opening), THREE.MathUtils.lerp(1, mount.rimScale, scale), toX(THREE.MathUtils.lerp(mount.opening, mount.rim, fraction))));
    params.push(mount.opening / FUSELAGE_LENGTH);
  }
  return cutHullOpenings(loftGeometry(rings, params, false, false));
}

/** The lip's profile from the opening to the rim: (fraction of the way aft, fraction of the way in), a quarter round. */
const TAIL_LIP_CURL: [number, number][] = [[0.45, 0.12], [0.8, 0.45], [1, 1]];

/** `ring` drawn in by `scale` towards its own centre and moved to model x `x`. */
function scaledRing(ring: THREE.Vector3[], scale: number, x: number): THREE.Vector3[] {
  const centre = ring.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(ring.length);
  return ring.map((point) => point.clone().sub(centre).multiplyScalar(scale).add(centre).setX(x));
}

/**
 * The Cheyenne mount's armoured dome, set in the curled-in rim of the tail cone and bulging aft to the tail's end: an
 * ellipsoidal cap on the rim's outline, with a vertical slot for each gun, edged with a lip. Behind the slots, a dark
 * plate closes the mount so the cone's inside never shows through them.
 */
function buildTailGunMountGeometry(): { dome: THREE.BufferGeometry; slotLips: THREE.BufferGeometry; backing: THREE.BufferGeometry } {
  const mount = STATIONS.tailGunMount;
  const section = hullSectionAt(mount.opening);
  const rimX = toX(mount.rim) + 0.004;
  // The rim, finer than the hull's rings so the slots' edges come out clean.
  const rim = scaledRing(ellipseRing(new THREE.Vector3(rimX, 0, 0), section.top, section.bottom, section.halfWidth, TAIL_DOME.points, HULL_EXPONENT), mount.rimScale, rimX);
  const centre = rim.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(rim.length);
  const radii = { y: ((section.top - section.bottom) / 2) * mount.rimScale, z: section.halfWidth * mount.rimScale };
  // Model x runs nose-ward, so aft of the rim is lower x.
  const aftReach = FUSELAGE_LENGTH - mount.rim;
  const domeX = (y: number, z: number) => {
    const reach = Math.min(((Math.abs(y - centre.y) / radii.y) ** HULL_EXPONENT + (Math.abs(z) / radii.z) ** HULL_EXPONENT) ** (1 / HULL_EXPONENT), 1);
    return centre.x - aftReach * Math.sqrt(1 - reach * reach);
  };
  const positions: number[] = [];
  for (let row = 0; row <= TAIL_DOME.rows; row++) {
    const s = row / TAIL_DOME.rows;
    const reach = Math.sin((s * Math.PI) / 2);
    const x = centre.x - aftReach * Math.cos((s * Math.PI) / 2);
    for (const point of rim) {
      positions.push(x, centre.y + (point.y - centre.y) * reach, centre.z + (point.z - centre.z) * reach);
    }
  }
  const count = rim.length;
  const indices: number[] = [];
  const slot = { bottom: TAIL.gunY - mount.slotBelow, top: TAIL.gunY + mount.slotAbove };
  const inSlot = (y: number, z: number) => TAIL.gunSpacing.some((gunZ) => Math.abs(z - gunZ) < mount.slotHalfWidth && y > slot.bottom && y < slot.top);
  for (let row = 0; row < TAIL_DOME.rows; row++) {
    for (let point = 0; point < count; point++) {
      const a = row * count + point;
      const b = row * count + ((point + 1) % count);
      const c = a + count;
      const d = b + count;
      if (inSlot((positions[a * 3 + 1] + positions[d * 3 + 1]) / 2, (positions[a * 3 + 2] + positions[d * 3 + 2]) / 2)) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  const dome = new THREE.BufferGeometry();
  dome.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  dome.setIndex(indices);
  dome.computeVertexNormals();

  // Each slot's lip: a round-ended loop on the dome's surface round the opening.
  const lips = TAIL.gunSpacing.map((gunZ) => {
    const half = mount.slotHalfWidth;
    const outline: THREE.Vector3[] = [];
    const onDome = (y: number, z: number) => new THREE.Vector3(domeX(y, z) - TAIL_DOME.lipStandOff, y, z);
    for (let step = 0; step <= 8; step++) {
      const angle = Math.PI + (step / 8) * Math.PI;
      outline.push(onDome(slot.bottom + half + Math.sin(angle) * half, gunZ + Math.cos(angle) * half));
    }
    for (let step = 0; step <= 8; step++) {
      const angle = (step / 8) * Math.PI;
      outline.push(onDome(slot.top - half + Math.sin(angle) * half, gunZ + Math.cos(angle) * half));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 48, TAIL_DOME.lipRadius, 6, true);
  });
  const slotLips = mergeGeometries(lips);
  if (!slotLips) throw new Error('Cannot merge the gun slots\' lips');

  const backing = new THREE.BufferGeometry().setFromPoints([centre, ...rim]);
  const fan: number[] = [];
  for (let point = 0; point < count; point++) fan.push(0, 1 + ((point + 1) % count), 1 + point);
  backing.setIndex(fan);
  backing.translate(0.03, 0, 0);
  backing.computeVertexNormals();
  return { dome, slotLips, backing };
}

/** Each stinger gun's canvas boot: where it starts inside the tail end, its length aft, and its radius each end. */
const STINGER_BOOT = { insideEnd: 0.06, length: 0.3, rootRadius: 0.085, tipRadius: 0.03 } as const;

/** The stinger guns leave the tail end through slots each closed round its barrel by a tapered canvas boot. */
function addStingerGunBoots(airframe: THREE.Object3D, materials: AircraftMaterials): void {
  const taper = STATIONS.stingerCone.taper;
  const rootD = taper[taper.length - 1][0] - STINGER_BOOT.insideEnd;
  for (const z of TAIL.gunSpacing) {
    const boot = new THREE.CylinderGeometry(STINGER_BOOT.tipRadius, STINGER_BOOT.rootRadius, STINGER_BOOT.length, 14, 3);
    // Aft is model -x: the cylinder's +y (its tip) turned to point aft.
    boot.rotateZ(Math.PI / 2);
    part(airframe, boot, materials.canvas, toX(rootD + STINGER_BOOT.length / 2), TAIL.gunY, z);
  }
}

/** The dome's mesh (points round the rim, rows from its crown to the rim) and its slot lips (tube radius, stand-off). */
const TAIL_DOME = { points: 192, rows: 32, lipRadius: 0.009, lipStandOff: 0.003 } as const;

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
function conformRootToHull(geometry: THREE.BufferGeometry, outward: 'side' | RoofHeight): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const d = toX(position.getX(index));
    if (d <= 0 || d >= FUSELAGE_LENGTH) continue;
    const y = position.getY(index);
    const z = position.getZ(index);
    if (outward !== 'side') {
      const roof = outward(d, z);
      if (y < roof && insideHull(d, y, z, roof)) position.setY(index, roof + ROOT_SKIN_OFFSET);
    } else if (insideHull(d, y, z, hullSectionAt(d).top)) {
      position.setZ(index, Math.sign(z) * (hullHalfWidthAtHeight(d, y) + ROOT_SKIN_OFFSET));
    }
  }
  return geometry;
}

/** Height of whatever roofs the hull at a station and lateral offset, for a surface standing up out of it. */
type RoofHeight = (d: number, z: number) => number;

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

function buildFinGeometry(tailGunPosition: TailGunPosition): THREE.BufferGeometry {
  const heights = [0.25, 0.7, 1.04, 1.2, 1.4, 1.61, 1.8, 2.0, 2.4, 2.9, 3.4, 3.8, 4.1, 4.35, 4.5, 4.58, 4.63, FIN_TOP - 0.005];
  const rings = heights.map((height) => {
    const { leading, trailing } = finEdges(height);
    const chord = Math.max(trailing - leading, 0.05);
    const thickness = THREE.MathUtils.clamp(chord * 0.11, FIN_TIP_THICKNESS * Math.min(1, chord / 1.2), FIN_DORSAL_THICKNESS);
    return airfoilSection(thickness / chord, 0, 0.4, AIRFOIL_POINTS_PER_SIDE).map((point) =>
      new THREE.Vector3(toX(leading + point.x * chord), height, point.y * chord));
  });
  // Over the tail gunner his cab is the roof, so the fin stands on it rather than on the hull.
  const roof: RoofHeight = (d, z) => Math.max(hullSurfaceHeight(d, z, true), tailHousingSurfaceHeight(d, z, tailGunPosition) ?? -Infinity);
  return conformRootToHull(loftGeometry(rings, heights.map((height) => height / FIN_TOP), true, true), roof);
}

/** How far the gunner's cab stands proud of the fuselage's sides. */
const TAIL_HOUSING_PROUD = 0.015;

/**
 * Superellipse exponent of the gunner's cab sections. The Cheyenne cab is flat-sided and flat-roofed with tight corners,
 * as its sheet metal and glazing frames make; the stinger's is rounder, nearer the hull's own sections.
 */
const TAIL_HOUSING_EXPONENT: Record<TailGunPosition, number> = { cheyenne: 4.5, stinger: 3.2 };

/**
 * The gunner's cab's lofted sections: top, bottom and half-width at each station. The Cheyenne cab rises out of the
 * cone under the fin, runs flat-roofed to the rear window and stops there square: its end is the window. The stinger's
 * roof runs level over the gunner and then slopes down to meet the cone's top at the tail end.
 */
function tailHousingSections(tailGunPosition: TailGunPosition): NacelleProfile[] {
  let stations: number[];
  let tops: number[];
  if (tailGunPosition === 'stinger') {
    const { start, slopeFrom, end, top } = STATIONS.stingerHousing;
    const endTop = hullSectionAt(end).top;
    stations = [start, start + 0.3, start + 0.8, slopeFrom, (slopeFrom + end) / 2, end];
    tops = [hullSectionAt(start).top - 0.02, top - 0.08, top, top, (top + endTop) / 2 + 0.03, endTop];
  } else {
    const { start, end, top } = STATIONS.tailTurretHousing;
    stations = [start, start + 0.3, start + 0.7, end - 0.12, end];
    tops = [hullSectionAt(start).top - 0.02, top - 0.1, top, top, top - 0.025];
  }
  return stations.map((d, index) => {
    const hull = hullSectionAt(d);
    // Flush with the fuselage's sides, just proud of them: where the hull's top is cut away under the cab, the cab is
    // the wall, and anything built against the hull's wall must stay inside it.
    return { d, top: tops[index], bottom: hull.bottom + 0.3, halfWidth: hull.halfWidth + TAIL_HOUSING_PROUD };
  });
}

/** Height of the housing's upper surface at a station and lateral offset, or null outside the housing. */
function tailHousingSurfaceHeight(d: number, z: number, tailGunPosition: TailGunPosition): number | null {
  const sections = tailHousingSections(tailGunPosition);
  const exponent = TAIL_HOUSING_EXPONENT[tailGunPosition];
  const after = sections.findIndex((section) => section.d >= d);
  if (after <= 0 || d > sections[sections.length - 1].d) return null;
  const a = sections[after - 1], b = sections[after];
  const t = (d - a.d) / (b.d - a.d);
  const top = THREE.MathUtils.lerp(a.top, b.top, t);
  const bottom = THREE.MathUtils.lerp(a.bottom, b.bottom, t);
  const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t);
  const lateral = Math.min(Math.abs(z) / halfWidth, 0.999);
  return (top + bottom) / 2 + (1 - lateral ** exponent) ** (1 / exponent) * (top - bottom) / 2;
}

/** The tail gunner's cab under the rudder: a raised fairing over the tail cone. */
function buildTailHousingGeometry(tailGunPosition: TailGunPosition): THREE.BufferGeometry {
  const sections = tailHousingSections(tailGunPosition);
  const rings = sections.map((section) =>
    ellipseRing(new THREE.Vector3(toX(section.d), 0, 0), section.top, section.bottom, section.halfWidth, HULL_RING_POINTS, TAIL_HOUSING_EXPONENT[tailGunPosition]));
  // Open forward, where the gunner crawls in from the fuselage; closed aft.
  return loftGeometry(rings, sections.map((section) => section.d / FUSELAGE_LENGTH), false, true);
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
    const material = Math.cos(angle) < COWL_FLAP_GRAY_BELOW ? materials.lowerPaint : materials.upperPaint;
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
  part(turret, buildChinTurretGeometry(), materials.upperPaint, 0, 0, 0);
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

/**
 * Main gear: the oleo leg from its pivot in the inboard nacelle down to the axle, and the 56 in wheel (the retracted
 * wheel's size). Tail wheel: its fork under the tail wheel well, a 26 in wheel. Extended, the main wheels stand well
 * below the props and the ship sits nose-up on all three, as the B-17's three-point stance.
 */
const MAIN_GEAR = { pivotD: 5.2, pivotDrop: 0.5, axleD: 5.55, axleY: -2.3, wheelRadius: 0.71, tyre: 0.19, retractTurn: 1.45 } as const;
const TAIL_GEAR = { forkTopAbove: 0.05, axleBelow: 0.36, axleAft: 0.12, wheelRadius: 0.33, tyre: 0.09, retractTurn: 1.2 } as const;

/**
 * The Sperry A-1A upper turret (AN 11-45C-1; the dome types drawn in Hangar Thirteen's "Turrets In Detail", and
 * photographs of a restored A-1A), in its own space: y up from the fixed ring's top, +x forward. A sheet-metal band, the
 * tub's top ring, carries the Type 6 "Ainsworth" dome: a low oval of Plexiglas on a metal lower edge, two heavy
 * longitudinal frames arching from the front over the top to the back with the windscreen and the top panel between
 * them, a lighter frame arching over each side, and the guns out through framed slots just outside the windscreen's
 * frames, each closed by an all-metal shutter that rides with its gun (the A-1A's shutter from SP-1641 and E-2700 on).
 */
const TOP_TURRET = {
  ring: { width: 0.07, top: 0.03 },
  band: { radius: 0.5, height: 0.12 },
  /** The dome on the band: its vertical lower edge, its height, and its metal lower edge's depth. */
  dome: { radius: 0.5, wall: 0.1, height: 0.5, metalEdge: 0.06 },
  /** Frame straps: the heavy ones' and the light ones' width on the glass, and how far they stand off it. */
  frame: { heavy: 0.05, light: 0.028, thickness: 0.012, archZ: 0.16, sideZ: 0.37, sill: 0.09, header: 0.36 },
  /** The slot each gun elevates in: half its width either side of the gun, and its top above the dome's foot. */
  slot: { halfWidth: 0.05, top: 0.34 },
  /**
   * Each gun's shutter: a curved plate round the trunnions' axis, so it slides along the slot as the gun elevates, its
   * radius just outside the dome where the barrel crosses it, its width across the slot, and how far it reaches below and
   * above the barrel (radians about the trunnions), covering the slot over the guns' working elevations.
   */
  shutter: { radius: 0.3, width: 0.11, below: 0.62, above: 0.75 },
  /** The guns' trunnions, forward of the turret's axis, at the slots' height above the band. */
  gunPivot: { x: 0.18, y: 0.24 },
  /** The collar round each barrel where it passes through its shutter, along the gun from the trunnions. */
  collar: { along: 0.3, radius: 0.04, length: 0.05 },
  /** Round-head rivets along the frames' edges and round the band's lip. */
  rivet: { radius: 0.0055, spacing: 0.035, edgeInset: 0.009, lipDrop: 0.025 },
  /** Paint worn through to the metal on the frames' edges, where hands and maintenance touch them. */
  chips: { perMetre: 8, size: [0.003, 0.01], seed: 917 },
} as const;

/** Azimuth steps round the top turret's profile cam. */
const PROFILE_CAM_STEPS = 360;
/**
 * How near the line of fire nothing of the aircraft may come, metres: the guns' half-spread and a margin for the
 * barrels and the tracer's dispersion.
 */
const LINE_OF_FIRE_CLEARANCE = 0.3;
/** Parts this near the turret's axis in plan are its own ring and the roof round it, all below the guns. */
const PROFILE_CAM_NEAREST = 0.6;
const PROPELLER_DISC_SAMPLES = 48;

/**
 * The A-1A's profile cam, cut from the model: for each azimuth round the turret, the least elevation at which the line
 * of fire clears the aircraft (the fin and tailplane aft, the propeller discs out on the wings, the cockpit roof ahead).
 * Every part above the guns is taken into account, the propellers as the whole discs their blades sweep.
 */
function topTurretProfileCam(root: THREE.Object3D, turretYaw: THREE.Object3D, propellers: THREE.Object3D[]): Float32Array {
  const cam = new Float32Array(PROFILE_CAM_STEPS);
  root.updateMatrixWorld(true);
  const toModel = root.matrixWorld.clone().invert();
  const guns = turretYaw.position.clone().add(new THREE.Vector3(0, TOP_TURRET.gunPivot.y, 0));
  const offset = new THREE.Vector3();
  const mark = (point: THREE.Vector3) => {
    offset.subVectors(point, guns);
    const plan = Math.hypot(offset.x, offset.z);
    if (offset.y <= 0 || plan < PROFILE_CAM_NEAREST) return;
    const reach = Math.hypot(plan, offset.y);
    const elevation = Math.atan2(offset.y, plan) + Math.atan2(LINE_OF_FIRE_CLEARANCE, reach);
    const azimuth = Math.atan2(-offset.z, offset.x);
    const spread = Math.atan2(LINE_OF_FIRE_CLEARANCE, plan);
    const from = Math.floor(((azimuth - spread) / (Math.PI * 2)) * PROFILE_CAM_STEPS);
    const to = Math.ceil(((azimuth + spread) / (Math.PI * 2)) * PROFILE_CAM_STEPS);
    for (let step = from; step <= to; step++) {
      const index = THREE.MathUtils.euclideanModulo(step, PROFILE_CAM_STEPS);
      cam[index] = Math.max(cam[index], elevation);
    }
  };
  const isUnder = (object: THREE.Object3D, ancestors: THREE.Object3D[]) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (ancestors.includes(node)) return true;
    return false;
  };
  const vertex = new THREE.Vector3();
  const toPart = new THREE.Matrix4();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || isUnder(object, [turretYaw, ...propellers])) return;
    // The men are meshed later in workers and stand inside, below the guns: their empty geometry is passed over.
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    toPart.multiplyMatrices(toModel, object.matrixWorld);
    for (let index = 0; index < positions.count; index++) mark(vertex.fromBufferAttribute(positions, index).applyMatrix4(toPart));
  });
  // A spinning propeller is a disc as wide as its blades reach.
  for (const propeller of propellers) {
    const hub = propeller.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(propeller.matrixWorld).transformDirection(toModel);
    let radius = 0;
    propeller.traverse((object) => {
      const positions = object instanceof THREE.Mesh ? object.geometry.getAttribute('position') : undefined;
      if (!positions) return;
      toPart.multiplyMatrices(toModel, object.matrixWorld);
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(toPart).sub(hub);
        radius = Math.max(radius, vertex.addScaledVector(axis, -vertex.dot(axis)).length());
      }
    });
    const across = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(across, axis).normalize();
    for (let sample = 0; sample < PROPELLER_DISC_SAMPLES; sample++) {
      const angle = (sample / PROPELLER_DISC_SAMPLES) * Math.PI * 2;
      mark(hub.clone().addScaledVector(across, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius));
    }
  }
  return cam;
}

/** The dome's radius at height `y` above its foot: a vertical wall, then a quarter-ellipse up to the crown. */
function topTurretDomeRadius(y: number): number {
  const { radius, wall, height } = TOP_TURRET.dome;
  if (y <= wall) return radius;
  const t = Math.min((y - wall) / (height - wall), 1);
  return radius * Math.sqrt(Math.max(1 - t * t, 0));
}

/** The dome's height at a point (x, z) in plan, or null outside it. */
function topTurretDomeHeight(x: number, z: number): number | null {
  const { radius, wall, height } = TOP_TURRET.dome;
  const r = Math.hypot(x, z);
  if (r > radius) return null;
  return wall + (height - wall) * Math.sqrt(1 - (r / radius) ** 2);
}

/**
 * A frame running over the dome in the plane z = `z`, from the front foot over the crown to the back foot, as points
 * standing `proud` off the glass. With `toY`, only the front part up to that height.
 */
function topTurretFramePath(z: number, proud: number, base: number, toY?: number): THREE.Vector3[] {
  const { radius, wall, metalEdge } = TOP_TURRET.dome;
  const points: THREE.Vector3[] = [];
  const reach = Math.sqrt(radius ** 2 - z ** 2);
  const steps = 32;
  for (let step = 0; step <= steps; step++) {
    const x = reach * Math.cos((step / steps) * Math.PI);
    const y = topTurretDomeHeight(x, z) ?? wall;
    if (toY !== undefined && (x < 0 || y > toY)) continue;
    const surface = new THREE.Vector3(x, y, z);
    const normal = new THREE.Vector3(x, (y - wall) * 0.6, z).normalize();
    points.push(surface.addScaledVector(normal, proud).setY(base + Math.max(surface.y, metalEdge)));
  }
  return points;
}

/** A horizontal frame round the dome at height `y`, between two azimuths (radians from ahead toward starboard). */
function topTurretRingPath(y: number, from: number, to: number, proud: number, base: number): THREE.Vector3[] {
  const r = topTurretDomeRadius(y) + proud;
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) * 12));
  return Array.from({ length: steps + 1 }, (_, step) => {
    const azimuth = THREE.MathUtils.lerp(from, to, step / steps);
    return new THREE.Vector3(Math.cos(azimuth) * r, base + y, Math.sin(azimuth) * r);
  });
}

/**
 * The fixed ring the turret turns in: a flat lip round the opening, and a skirt from it down to the fuselage's curved
 * roof, so no gap shows under it at the sides where the roof falls away.
 */
function buildTurretRingGeometry(d: number, base: number): THREE.BufferGeometry {
  const { width, top } = TOP_TURRET.ring;
  const inner = TOP_TURRET.band.radius + 0.015;
  const outer = inner + width;
  const segments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const centreX = toX(d);
  for (let step = 0; step <= segments; step++) {
    const angle = (step / segments) * Math.PI * 2;
    const x = centreX + Math.cos(angle) * outer;
    const z = Math.sin(angle) * outer;
    const roof = hullSurfaceHeight(toX(x), z, true) - 0.01;
    positions.push(centreX + Math.cos(angle) * inner, base + top, Math.sin(angle) * inner, x, base + top, z, x, roof, z);
  }
  for (let step = 0; step < segments; step++) {
    const a = step * 3;
    const b = a + 3;
    // Lip: inner to outer edge; skirt: outer edge down to the roof.
    indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rows and columns of the dome's band round the windscreen. */
const DOME_BAND = { rows: 10, columns: 48 } as const;
/** The armoured windscreen's thickness, metres. */
const WINDSCREEN_THICKNESS = 0.02;

/**
 * The dome's Plexiglas between heights `from` and `to`, all the way round but for the opening `gapHalfWidth` either
 * side of the centreline ahead, its edges following the planes of the frames that border it.
 */
function domeBandGeometry(from: number, to: number, gapHalfWidth: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const { rows, columns } = DOME_BAND;
  for (let row = 0; row <= rows; row++) {
    const y = THREE.MathUtils.lerp(from, to, row / rows);
    const radius = topTurretDomeRadius(y);
    const edge = Math.asin(Math.min(gapHalfWidth / radius, 1));
    for (let column = 0; column <= columns; column++) {
      const azimuth = THREE.MathUtils.lerp(edge, Math.PI * 2 - edge, column / columns);
      positions.push(Math.cos(azimuth) * radius, y, Math.sin(azimuth) * radius);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The flat armoured windscreen, a slab of laminated glass across the opening between the heavy arches, its corners where
 * the arches meet the sill and the header, its outer face in their plane.
 */
function windscreenGeometry(): THREE.BufferGeometry {
  const { sill, header, archZ } = TOP_TURRET.frame;
  const corner = (y: number, z: number) => new THREE.Vector3(Math.sqrt(topTurretDomeRadius(y) ** 2 - archZ ** 2), y, z);
  const outer = [corner(sill, -archZ), corner(sill, archZ), corner(header, archZ), corner(header, -archZ)];
  const inward = new THREE.Vector3().crossVectors(outer[3].clone().sub(outer[0]), outer[1].clone().sub(outer[0])).normalize();
  if (inward.x > 0) inward.negate();
  const inner = outer.map((point) => point.clone().addScaledVector(inward, WINDSCREEN_THICKNESS));
  const points = [...outer, ...inner];
  // Outer and inner faces, then the four edges.
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const positions: number[] = [];
  for (const [a, b, c, d] of faces) {
    for (const index of [a, b, c, a, c, d]) positions.push(points[index].x, points[index].y, points[index].z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Outward normal of the dome's surface at a point on it (turret space, `base` the dome's foot). */
function topTurretDomeNormal(point: THREE.Vector3, base: number): THREE.Vector3 {
  const { radius, wall, height } = TOP_TURRET.dome;
  const y = point.y - base;
  if (y <= wall) return new THREE.Vector3(point.x, 0, point.z).normalize();
  // The ellipsoid's gradient: horizontal over the radius squared, vertical over the cap's height squared.
  return new THREE.Vector3(point.x / radius ** 2, (y - wall) / (height - wall) ** 2, point.z / radius ** 2).normalize();
}

/** The gap left between a frame strap and the glass under it, so the two never fight for depth. */
const STRAP_STANDOFF = 0.002;

interface StrapFrame {
  point: THREE.Vector3;
  /** Out of the dome's surface. */
  normal: THREE.Vector3;
  /** Unit vector across the strap, in the surface. */
  across: THREE.Vector3;
}

/** The local frame of a strap at each point of its path on the dome. */
function strapFrames(path: THREE.Vector3[], base: number): StrapFrame[] {
  return path.map((point, index) => {
    const tangent = new THREE.Vector3().subVectors(path[Math.min(index + 1, path.length - 1)], path[Math.max(index - 1, 0)]).normalize();
    const normal = topTurretDomeNormal(point, base);
    return { point, normal, across: new THREE.Vector3().crossVectors(tangent, normal).normalize() };
  });
}

/** A strap's path resampled at an even `spacing`, for fittings set along it at a pitch. */
function evenlySpaced(path: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(path);
  return curve.getSpacedPoints(Math.max(1, Math.round(curve.getLength() / spacing)));
}

/** A low round rivet head standing on a surface at `point`, facing along `normal`. */
function rivetHead(point: THREE.Vector3, normal: THREE.Vector3): THREE.BufferGeometry {
  const { radius } = TOP_TURRET.rivet;
  const head = new THREE.SphereGeometry(radius, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  head.scale(1, 0.55, 1);
  head.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
  return head.translate(point.x, point.y, point.z);
}

/**
 * Rivets along a strap: a row inside each edge of a heavy strap, one down the middle of a light one, which has room for
 * no more.
 */
function strapRivets(path: THREE.Vector3[], base: number, width: number, thickness: number): THREE.BufferGeometry[] {
  const { spacing, edgeInset } = TOP_TURRET.rivet;
  const rows = width > TOP_TURRET.frame.light ? [-(width / 2 - edgeInset), width / 2 - edgeInset] : [0];
  const heads: THREE.BufferGeometry[] = [];
  for (const { point, normal, across } of strapFrames(evenlySpaced(path, spacing), base)) {
    for (const row of rows) heads.push(rivetHead(point.clone().addScaledVector(across, row).addScaledVector(normal, thickness + STRAP_STANDOFF), normal));
  }
  return heads;
}

/**
 * Chips worn through the paint along a strap's edges: small ragged flakes lying on its top face, placed by `random` so
 * every turret is worn the same way.
 */
function strapChips(path: THREE.Vector3[], base: number, width: number, thickness: number, random: () => number): THREE.BufferGeometry[] {
  const { perMetre, size } = TOP_TURRET.chips;
  const chips: THREE.BufferGeometry[] = [];
  const frames = strapFrames(evenlySpaced(path, 1 / perMetre), base);
  for (const { point, normal, across } of frames) {
    if (random() < 0.35) continue;
    const edge = (random() < 0.5 ? -1 : 1) * (width / 2 - random() * width * 0.2);
    const flake = new THREE.CircleGeometry(1, 5);
    flake.scale(THREE.MathUtils.lerp(size[0], size[1], random()), THREE.MathUtils.lerp(size[0], size[1], random()) * 0.6, 1);
    flake.rotateZ(random() * Math.PI);
    flake.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    const at = point.clone().addScaledVector(across, edge).addScaledVector(normal, thickness + STRAP_STANDOFF + 0.0006);
    chips.push(flake.translate(at.x, at.y, at.z));
  }
  return chips;
}

/** A Park–Miller generator: the same sequence from the same seed, so the wear is part of the model. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/**
 * A flat frame strap laid along a path on the dome: `width` across the glass, standing `thickness` off it, with its
 * edges closed, so it reads as the riveted sheet-metal frame it is rather than a tube.
 */
function strapGeometry(path: THREE.Vector3[], base: number, width: number, thickness: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const { point, normal, across } of strapFrames(path, base)) {
    for (const [side, lift] of [[-1, 0], [1, 0], [1, thickness], [-1, thickness]] as const) {
      const corner = point.clone().addScaledVector(across, (side * width) / 2).addScaledVector(normal, lift + STRAP_STANDOFF);
      positions.push(corner.x, corner.y, corner.z);
    }
  }
  for (let index = 0; index < path.length - 1; index++) {
    const a = index * 4;
    const b = a + 4;
    // Four faces round the section: under, outer edge, top, inner edge.
    for (let face = 0; face < 4; face++) {
      const p = a + face;
      const q = a + ((face + 1) % 4);
      indices.push(p, b + face, q, q, b + face, b + ((face + 1) % 4));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The turning part of the top turret, added to its yaw group: the band, the framed dome with its rivets and worn paint,
 * and the gun slots. Each gun's shutter and collar go on `gunPitch`, so they elevate with it.
 */
function addTopTurretBody(turret: THREE.Object3D, materials: AircraftMaterials, gunPitch: THREE.Object3D): void {
  const { band, dome, frame, slot, shutter, collar, rivet, chips } = TOP_TURRET;
  const base = band.height;
  // The tub's top ring, standing above the fixed ring, a riveted lip where the dome is bolted on.
  part(turret, new THREE.CylinderGeometry(band.radius, band.radius + 0.01, band.height, 48, 1, true), materials.upperPaint, 0, band.height / 2, 0);
  part(turret, new THREE.TorusGeometry(band.radius + 0.004, 0.012, 6, 48), materials.upperPaint, 0, base, 0, { rotation: [Math.PI / 2, 0, 0], castShadow: false });

  // The dome: metal lower edge, Plexiglas above it. Lathe angle φ puts a point at (sin φ, ·, cos φ).
  const profile = (from: number, to: number) => Array.from({ length: 21 }, (_, step) => {
    const y = THREE.MathUtils.lerp(from, to, step / 20);
    return new THREE.Vector2(Math.max(topTurretDomeRadius(y), 0.001), y);
  });
  part(turret, new THREE.LatheGeometry(profile(0, dome.metalEdge), 48), materials.upperPaint, 0, base, 0, { castShadow: false });
  // The Plexiglas, open between the heavy arches from the sill to the header, where the flat armoured windscreen sits.
  part(turret, new THREE.LatheGeometry(profile(dome.metalEdge, frame.sill), 48), materials.turretDome, 0, base, 0, { castShadow: false });
  part(turret, domeBandGeometry(frame.sill, frame.header, frame.archZ), materials.turretDome, 0, base, 0, { castShadow: false });
  part(turret, new THREE.LatheGeometry(profile(frame.header, dome.height), 48), materials.turretDome, 0, base, 0, { castShadow: false });
  part(turret, windscreenGeometry(), materials.armourGlass, 0, base, 0, { castShadow: false });

  const straps: { path: THREE.Vector3[]; width: number }[] = [];
  const strap = (path: THREE.Vector3[], width: number) => {
    if (path.length >= 2) straps.push({ path, width });
  };
  // The two heavy arches over the crown, a lighter one over each side, and the windscreen's sill and header.
  for (const side of [-1, 1]) {
    strap(topTurretFramePath(side * frame.archZ, 0, base), frame.heavy);
    strap(topTurretFramePath(side * frame.sideZ, 0, base), frame.light);
  }
  const archAzimuth = Math.asin(frame.archZ / dome.radius);
  const headerAzimuth = Math.asin(frame.archZ / topTurretDomeRadius(frame.header));
  strap(topTurretRingPath(frame.sill, -archAzimuth, archAzimuth, 0, base), frame.heavy);
  strap(topTurretRingPath(frame.header, -headerAzimuth, headerAzimuth, 0, base), frame.heavy);
  // Round the dome's foot, where the glass meets its metal edge.
  strap(topTurretRingPath(dome.metalEdge, -Math.PI, Math.PI, 0, base), frame.light);
  // Each gun's slot: framed down both sides from the metal edge and across its top.
  const gunZ = STATIONS.topTurret.gunSpacing / 2;
  for (const side of [-1, 1]) {
    const edges = [gunZ - slot.halfWidth, gunZ + slot.halfWidth].map((z) => side * z);
    for (const z of edges) strap(topTurretFramePath(z, 0, base, slot.top), frame.light);
    const topRadius = topTurretDomeRadius(slot.top);
    const [from, to] = edges.map((z) => Math.asin(z / topRadius)).sort((a, b) => a - b);
    strap(topTurretRingPath(slot.top, from, to, 0, base), frame.light);
  }

  const random = seededRandom(chips.seed);
  const rivets: THREE.BufferGeometry[] = [];
  const flakes: THREE.BufferGeometry[] = [];
  for (const { path, width } of straps) {
    part(turret, strapGeometry(path, base, width, frame.thickness), materials.upperPaint, 0, 0, 0, { castShadow: false });
    rivets.push(...strapRivets(path, base, width, frame.thickness));
    flakes.push(...strapChips(path, base, width, frame.thickness, random));
  }
  // The band's lip is riveted all round, just under where the dome sits on it.
  const lipY = band.height - rivet.lipDrop;
  const lipCount = Math.round((Math.PI * 2 * band.radius) / rivet.spacing);
  for (let index = 0; index < lipCount; index++) {
    const azimuth = (index / lipCount) * Math.PI * 2;
    const outward = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    rivets.push(rivetHead(outward.clone().multiplyScalar(band.radius + 0.002).setY(lipY), outward));
  }
  part(turret, mergeGeometries(rivets), materials.upperPaint, 0, 0, 0, { castShadow: false });
  part(turret, mergeGeometries(flakes), materials.paintChip, 0, 0, 0, { castShadow: false });

  for (const side of [-1, 1]) {
    // The shutter, round the trunnions' axis: cylinder angle θ lies at (sin θ, −cos θ) in the gun's x–y plane once
    // the axis is turned onto z, so the barrel is at θ = π/2.
    const plate = new THREE.CylinderGeometry(shutter.radius, shutter.radius, shutter.width, 16, 1, true, Math.PI / 2 - shutter.below, shutter.below + shutter.above);
    part(gunPitch, plate, materials.upperPaint, 0, 0, side * gunZ, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
    // A collar round the barrel where it passes through the shutter.
    part(gunPitch, new THREE.CylinderGeometry(collar.radius, collar.radius, collar.length, 16), materials.gunmetal, collar.along, 0, side * gunZ, { rotation: [0, 0, Math.PI / 2], castShadow: false });
  }
}

function buildLandingGear(root: THREE.Object3D, materials: AircraftMaterials): LandingGear {
  const legs: { group: THREE.Group; turn: number }[] = [];
  const thrustLine = NACELLES[0].thrustLineH;
  const pivotY = thrustLine - MAIN_GEAR.pivotDrop;
  for (const side of [1, -1] as const) {
    const leg = new THREE.Group();
    leg.position.set(toX(MAIN_GEAR.pivotD), pivotY, side * NACELLES[0].span);
    assignAssembly(leg, engineAssembly(side, true));
    const axle = new THREE.Vector3(toX(MAIN_GEAR.axleD) - toX(MAIN_GEAR.pivotD), MAIN_GEAR.axleY - pivotY, 0);
    for (const offset of [-0.2, 0.2]) {
      const strut = part(leg, new THREE.CylinderGeometry(0.07, 0.08, axle.length(), 12), materials.steel, 0, 0, offset);
      strut.position.copy(axle).multiplyScalar(0.5).setZ(offset);
      strut.quaternion.setFromUnitVectors(UP, axle.clone().normalize());
    }
    part(leg, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), materials.steel, axle.x, axle.y, 0, { rotation: [Math.PI / 2, 0, 0] });
    part(leg, new THREE.TorusGeometry(MAIN_GEAR.wheelRadius - MAIN_GEAR.tyre, MAIN_GEAR.tyre, 14, 36), materials.rubber, axle.x, axle.y, 0);
    part(leg, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 24), materials.gunmetal, axle.x, axle.y, 0, { rotation: [Math.PI / 2, 0, 0] });
    leg.userData.unmerged = true;
    root.add(leg);
    legs.push({ group: leg, turn: MAIN_GEAR.retractTurn });
  }
  const tailD = WAIST.tailwheelD;
  const tailBottom = hullSectionAt(tailD).bottom;
  const tail = new THREE.Group();
  tail.position.set(toX(tailD), tailBottom + TAIL_GEAR.forkTopAbove, 0);
  assignAssembly(tail, fuselageSectionAt(tailD));
  const tailAxle = new THREE.Vector3(-TAIL_GEAR.axleAft, -TAIL_GEAR.axleBelow - TAIL_GEAR.forkTopAbove, 0);
  for (const z of [-0.1, 0.1]) rod(tail, new THREE.Vector3(0, 0, z), tailAxle.clone().setZ(z), 0.035, materials.steel);
  part(tail, new THREE.TorusGeometry(TAIL_GEAR.wheelRadius - TAIL_GEAR.tyre, TAIL_GEAR.tyre, 10, 28), materials.rubber, tailAxle.x, tailAxle.y, 0);
  part(tail, new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), materials.gunmetal, tailAxle.x, tailAxle.y, 0, { rotation: [Math.PI / 2, 0, 0] });
  tail.userData.unmerged = true;
  root.add(tail);
  legs.push({ group: tail, turn: TAIL_GEAR.retractTurn });

  // Three-point stance: pitch the ship until both main tyres and the tail tyre touch the same ground line.
  const mainContact = new THREE.Vector2(toX(MAIN_GEAR.axleD), MAIN_GEAR.axleY - MAIN_GEAR.wheelRadius);
  const tailContact = new THREE.Vector2(toX(tailD) + tailAxle.x, tail.position.y + tailAxle.y - TAIL_GEAR.wheelRadius);
  const pitch = Math.atan2(tailContact.y - mainContact.y, mainContact.x - tailContact.x);
  const height = -(mainContact.x * Math.sin(pitch) + mainContact.y * Math.cos(pitch));

  const hatch = CRAWLWAY.forwardHatch;
  const hatchD = (hatch.start + hatch.end) / 2;
  const hatchZ = (hatch.inner + hatch.outer) / 2;
  const doorD = (WAIST.door.start + WAIST.door.end) / 2;
  // The door's sill stands a little above the waist floor, as the interior builds it.
  const doorSill = waistFloorHeight(doorD) + 0.05;
  const setExtension = (amount: number) => {
    for (const { group, turn } of legs) {
      group.visible = amount > 0.01;
      // Model x is forward: a positive turn about z swings the leg's foot forward and up.
      group.rotation.z = (1 - amount) * turn;
    }
  };
  setExtension(0);
  return {
    setExtension,
    ground: { pitch, height },
    entries: {
      forwardHatch: new THREE.Vector3(toX(hatchD), hullSurfaceHeight(hatchD, hatchZ, false), hatchZ),
      mainDoor: new THREE.Vector3(toX(doorD), doorSill, hullHalfWidthAtHeight(doorD, doorSill)),
    },
  };
}

/** The burst that hits the lead goes off under the starboard wing, outboard of No. 3. */
const BURST = { d: 7.2, span: 5.0, below: 1.4 } as const;
/** The oil streaks: aft of the cowl over the nacelle, and on the wing just outboard of it to the trailing edge. */
const OIL_STREAKS = { nacelle: { aftOfCowl: 1.2, length: 2.4, width: 0.9 }, wing: { d: 8.3, outboard: 0.35, length: 2.8, width: 1.0 } } as const;

/** Depth of the nose art's projector box, deep enough to reach the skin where the nose curves in under it. */
const NOSE_ART_PROJECTOR_DEPTH = 1.4;

/** How far a decal stands off the skin it was projected onto, in model metres. */
const DECAL_STANDOFF = 0.004;

/**
 * The next mission's bomb, on a scrap of decal sheet laid where it falls in the tally: the first place of the row after
 * the last, at the tally's own scale.
 */
function addNextMissionBomb(airframe: THREE.Object3D, hull: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  const tally = STATIONS.missionTally;
  const { perRow, column, row, margin } = MISSION_TALLY_ART;
  const tallyWidth = perRow * column + margin * 2;
  const tallyHeight = Math.ceil(MISSIONS_FLOWN / perRow) * row + margin * 2;
  const metresAcross = tally.width / tallyWidth;
  const metresUp = tally.height / tallyHeight;
  const index = MISSIONS_FLOWN;
  // Offsets of the scrap's centre from the tally's in art pixels: across toward the tail, and down.
  const across = (index % perRow) * column - tallyWidth / 2 + (column + margin * 2) / 2;
  const down = Math.floor(index / perRow) * row - tallyHeight / 2 + (row + margin * 2) / 2;
  const d = tally.d + across * metresAcross;
  const h = tally.h - down * metresUp;
  const decal = addDecal(airframe, hull, material, new THREE.Vector3(toX(d), h, -hullHalfWidthAtHeight(d, h)), PORT, FORWARD.clone().negate(), column * metresAcross + margin * 2 * metresAcross, (row + margin * 2) * metresUp, 0.4);
  // Shown and hidden on its own, so it is kept out of the bake.
  decal.userData.unmerged = true;
  assignAssembly(decal, fuselageSectionAt(d));
  decal.visible = false;
  return decal;
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
  // A water-slide decal is printed with film round its art; `width` and `height` are the art's.
  const growth = material.userData.decalGrowth instanceof THREE.Vector2 ? material.userData.decalGrowth : new THREE.Vector2(1, 1);
  const geometry = new DecalGeometry(target, position, decalOrientation(normal, along), new THREE.Vector3(width * growth.x, height * growth.y, depth));
  if (geometry.getAttribute('position').count === 0) throw new Error(`Decal at ${position.toArray().map((value) => value.toFixed(2)).join(', ')} missed its target surface`);
  // Lifted off the skin along its normals: at a grazing view the depth offset alone loses to the skin in patches.
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  for (let index = 0; index < positions.count; index++) {
    positions.setXYZ(
      index,
      positions.getX(index) + normals.getX(index) * DECAL_STANDOFF,
      positions.getY(index) + normals.getY(index) * DECAL_STANDOFF,
      positions.getZ(index) + normals.getZ(index) * DECAL_STANDOFF,
    );
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const FORWARD = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STARBOARD = new THREE.Vector3(0, 0, 1);
const AFT = new THREE.Vector3(-1, 0, 0);
const PORT = new THREE.Vector3(0, 0, -1);

/** Where a builder's kit shows: the mould's parting line, sprue gates, cement fog and a thumbprint. */
const KIT_FLAWS = {
  /** Radius of the ridge the mould's two halves leave along the fuselage's top and bottom centrelines. */
  seamRadius: 0.006,
  /** Stretches of centreline with no seam: openings, turrets and glazing (start, end in metres from the nose). */
  seamGapsTop: [[1.6, 2.35], [4.5, 5.8], [8.9, 10.1], [19.4, FUSELAGE_LENGTH]] as [number, number][],
  seamGapsBottom: [[0, 2.8], [5.8, 8.45], [10.35, 11.9]] as [number, number][],
  /** Sprue gates trimmed flush-ish on the fuselage sides: station, side, height up from the bottom (fraction). */
  sprueGates: [[3.3, 1, 0.3], [11.6, -1, 0.28], [17.9, 1, 0.33], [7.2, -1, 0.35]] as [number, 1 | -1, number][],
} as const;

function addKitFlaws(airframe: THREE.Object3D, root: THREE.Object3D, noseGlazing: THREE.Mesh, materials: AircraftMaterials): void {
  for (const [upper, gaps, material] of [[true, KIT_FLAWS.seamGapsTop, materials.upperPaint], [false, KIT_FLAWS.seamGapsBottom, materials.lowerPaint]] as const) {
    for (const [start, end] of seamRuns(NOSE_GLAZING_END + 0.05, STATIONS.tailGunMount.opening - 0.05, gaps)) {
      const points: THREE.Vector3[] = [];
      for (let d = start; d <= end + 1e-6; d += Math.min(0.15, end - start)) {
        const section = hullSectionAt(d);
        points.push(new THREE.Vector3(toX(d), upper ? section.top : section.bottom, 0));
      }
      if (points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(points);
      part(airframe, new THREE.TubeGeometry(curve, points.length * 3, KIT_FLAWS.seamRadius, 5, false), material, 0, 0, 0, { castShadow: false });
    }
  }
  for (const [d, side, fraction] of KIT_FLAWS.sprueGates) {
    const section = hullSectionAt(d);
    const y = section.bottom + (section.top - section.bottom) * fraction;
    const z = side * hullHalfWidthAtHeight(d, y);
    part(airframe, new THREE.CylinderGeometry(0.018, 0.022, 0.016, 10), materials.lowerPaint, toX(d), y, z, { rotation: [Math.PI / 2, 0, 0] });
  }
  // Cement that fogged the glazing where it meets the frame, and a thumbprint from setting it in place.
  noseGlazing.updateMatrixWorld(true);
  const glueAt = glazingPoint(noseGlazing, NOSE_GLAZING_END - 0.12, 0.35, 0.6);
  addDecal(root, noseGlazing, materials.glueFog, glueAt.point, glueAt.normal, FORWARD, 0.34, 0.24, 0.2);
  const printAt = glazingPoint(noseGlazing, 0.45, 0.4, -0.75);
  addDecal(root, noseGlazing, materials.fingerprint, printAt.point, printAt.normal, UP, 0.2, 0.24, 0.2);
}

/** The stretches of [start, end] left once the gaps are taken out. */
function seamRuns(start: number, end: number, gaps: readonly (readonly [number, number])[]): [number, number][] {
  const runs: [number, number][] = [];
  let from = start;
  for (const [gapStart, gapEnd] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (gapStart > from) runs.push([from, Math.min(gapStart, end)]);
    from = Math.max(from, gapEnd);
  }
  if (from < end) runs.push([from, end]);
  return runs.filter(([a, b]) => b - a > 0.2);
}

/** A point on the nose glazing and its outward normal, found by aiming in from outside at station `d`. */
function glazingPoint(glazing: THREE.Mesh, d: number, up: number, across: number): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const origin = new THREE.Vector3(toX(d), up * 3, across * 3);
  const aim = new THREE.Vector3(toX(d), 0, 0).sub(origin).normalize();
  const hit = new THREE.Raycaster(origin, aim).intersectObject(glazing, false)[0];
  if (!hit?.face) throw new Error(`No nose glazing at station ${d}`);
  return { point: hit.point, normal: hit.face.normal.clone().transformDirection(glazing.matrixWorld) };
}

/** A glazed pane: the glass decal, plus the matching hole in the skin so the compartment shows through it. */
function addWindow(
  airframe: THREE.Object3D, target: THREE.Mesh, material: THREE.Material, cutouts: WindowCutouts,
  position: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3, width: number, height: number, depth: number,
): void {
  addDecal(airframe, target, material, position, normal, along, width, height, depth);
  cutouts.add(position, decalOrientation(normal, along), new THREE.Vector3(width, height, depth));
}

/**
 * The gunner's cab's glazing, each pane in a raised frame with the hole cut in the housing behind it so the gunner
 * shows through: the Cheyenne cab has two panes in each flat side and the rear window in its square end; the stinger
 * two small panes a side and the sighting window on its sloping roof.
 */
function addTailGunnerGlazing(airframe: THREE.Object3D, housing: THREE.Mesh, materials: AircraftMaterials, cutouts: WindowCutouts, tailGunPosition: TailGunPosition): void {
  const windows = tailGunPosition === 'stinger' ? STATIONS.stingerWindows : STATIONS.tailTurretWindows;
  const sill = windows.bottom;
  const head = windows.top;
  const middleY = (sill + head) / 2;
  for (const [start, end] of windows.panes) {
    for (const side of [1, -1] as const) {
      const at = (d: number, y: number) => new THREE.Vector3(toX(d), y, side * tailHousingHalfWidthAt(d, y, tailGunPosition));
      const middle = (start + end) / 2;
      const outward = side > 0 ? STARBOARD : PORT;
      addWindow(airframe, housing, materials.windowPane, cutouts, at(middle, middleY), outward, side > 0 ? FORWARD : FORWARD.clone().negate(), end - start, head - sill, 0.3);
      const corners = [at(start, sill), at(end, sill), at(end, head), at(start, head)];
      corners.forEach((corner, index) => frameStrip(airframe, materials.upperPaint, corner, corners[(index + 1) % 4], outward));
    }
  }
  if (tailGunPosition === 'stinger') {
    addStingerSightingWindow(airframe, housing, materials, cutouts);
    return;
  }
  const { end } = STATIONS.tailTurretHousing;
  const rear = STATIONS.tailTurretWindows.rear;
  const aftFace = toX(end);
  const centre = new THREE.Vector3(aftFace, (rear.top + rear.bottom) / 2, 0);
  addWindow(airframe, housing, materials.windowPane, cutouts, centre, AFT, STARBOARD, rear.width, rear.top - rear.bottom, 0.16);
  const halfWidth = rear.width / 2;
  const corners = [
    new THREE.Vector3(aftFace, rear.bottom, -halfWidth), new THREE.Vector3(aftFace, rear.bottom, halfWidth),
    new THREE.Vector3(aftFace, rear.top, halfWidth), new THREE.Vector3(aftFace, rear.top, -halfWidth),
  ];
  corners.forEach((corner, index) => frameStrip(airframe, materials.upperPaint, corner, corners[(index + 1) % 4], AFT));
}

/** The stinger's sighting window, lying on the sloping roof ahead of the tail end. */
function addStingerSightingWindow(airframe: THREE.Object3D, housing: THREE.Mesh, materials: AircraftMaterials, cutouts: WindowCutouts): void {
  const sight = STATIONS.stingerWindows.sight;
  const half = sight.length / 2;
  const surface = (d: number) => tailHousingSurfaceHeight(d, 0, 'stinger') ?? hullSectionAt(d).top;
  const fore = new THREE.Vector3(toX(sight.d - half), surface(sight.d - half), 0);
  const aft = new THREE.Vector3(toX(sight.d + half), surface(sight.d + half), 0);
  const downSlope = aft.clone().sub(fore).normalize();
  const outward = new THREE.Vector3().crossVectors(downSlope, STARBOARD).negate().normalize();
  const centre = fore.clone().add(aft).multiplyScalar(0.5);
  addWindow(airframe, housing, materials.windowPane, cutouts, centre, outward, STARBOARD, sight.width, fore.distanceTo(aft), 0.2);
  const across = STARBOARD.clone().multiplyScalar(sight.width / 2);
  const corners = [fore.clone().sub(across), fore.clone().add(across), aft.clone().add(across), aft.clone().sub(across)];
  corners.forEach((corner, index) => frameStrip(airframe, materials.upperPaint, corner, corners[(index + 1) % 4], outward));
}

/** Half-width of the housing's wall at a station and height, on the same superellipse its loft uses. */
function tailHousingHalfWidthAt(d: number, y: number, tailGunPosition: TailGunPosition): number {
  const sections = tailHousingSections(tailGunPosition);
  const exponent = TAIL_HOUSING_EXPONENT[tailGunPosition];
  const after = Math.max(1, sections.findIndex((section) => section.d >= d));
  const a = sections[after - 1], b = sections[after];
  const t = THREE.MathUtils.clamp((d - a.d) / (b.d - a.d), 0, 1);
  const top = THREE.MathUtils.lerp(a.top, b.top, t);
  const bottom = THREE.MathUtils.lerp(a.bottom, b.bottom, t);
  const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t);
  const vertical = Math.min(Math.abs(y - (top + bottom) / 2) / ((top - bottom) / 2), 0.999);
  return halfWidth * (1 - vertical ** exponent) ** (1 / exponent);
}

/** Window frame section: width on the skin, and how far it stands proud. */
const WINDOW_FRAME = { width: 0.03, proud: 0.012 } as const;

/** One straight frame member from `a` to `b` on a wall facing `outward`, standing proud of it. */
function frameStrip(parent: THREE.Object3D, material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, outward: THREE.Vector3): void {
  const along = b.clone().sub(a);
  const length = along.length() + WINDOW_FRAME.width;
  along.normalize();
  const normal = outward.clone().addScaledVector(along, -outward.dot(along)).normalize();
  const across = new THREE.Vector3().crossVectors(normal, along);
  const strip = part(parent, new THREE.BoxGeometry(length, WINDOW_FRAME.width, WINDOW_FRAME.proud * 2), material, 0, 0, 0);
  strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, across, normal));
  strip.position.copy(a).add(b).multiplyScalar(0.5);
}

function addSideWindows(airframe: THREE.Object3D, hull: THREE.Mesh, material: THREE.Material, cutouts: WindowCutouts, start: number, end: number, top: number, bottom: number, sides: (1 | -1)[]): void {
  const d = (start + end) / 2;
  const h = (top + bottom) / 2;
  const halfWidth = hullSectionAt(d).halfWidth;
  for (const side of sides) {
    addWindow(airframe, hull, material, cutouts, new THREE.Vector3(toX(d), h, side * halfWidth), side > 0 ? STARBOARD : PORT, side > 0 ? FORWARD : FORWARD.clone().negate(), end - start, top - bottom, 0.5);
  }
}

/**
 * The flak hit the lead takes on the bomb run, built hidden on every ship: holes in the skin, No. 3 engine's smoke port
 * and propeller, and where the burst goes off under the starboard wing.
 */
export interface BattleDamage {
  holes: THREE.Mesh[];
  /** Oil and soot streaked back over No. 3's nacelle and the wing behind it; their material's opacity builds them up. */
  streaks: { meshes: THREE.Mesh[]; material: THREE.MeshStandardMaterial };
  /** No. 3 engine's propeller: the one feathered. */
  propeller: THREE.Object3D;
  /** Where its fire and smoke break out, through the cowl flaps on the nacelle's upper outboard quarter. */
  smokePort: THREE.Object3D;
  burstPoint: THREE.Object3D;
}

/** The undercarriage let down for the ground: hidden until extended, swung forward up into the nacelles to retract. */
export interface LandingGear {
  /** 0 retracted (only the exposed wheels show), 1 down and locked. */
  setExtension(amount: number): void;
  /** On its wheels: the nose-up pitch about model z, and the model origin's height over the ground, in model metres. */
  ground: { pitch: number; height: number };
  /** Model-space positions of the forward entrance hatch and the main door's sill, where the crew climb in. */
  entries: { forwardHatch: THREE.Vector3; mainDoor: THREE.Vector3 };
}

export interface B17 {
  /** Model space is metres, nose toward +x, starboard toward +z. Scale and pose it from outside. */
  root: THREE.Group;
  landingGear: LandingGear;
  propellers: THREE.Object3D[];
  battleDamage: BattleDamage;
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
  /**
   * Fittings and crew, seen only through the glazing until the ship is opened up: while it is closed they need not
   * cast shadows or show in the floor's reflection, which saves most of each ship's triangles in those passes.
   */
  interiorMeshes: THREE.Mesh[];
  /** The nose art the ship carries, each artwork its own decal, so show one; null if its livery has none. */
  noseArt: Record<NoseArtChoice, THREE.Mesh> | null;
  /** The bomb put on the tally after the mission, hidden until the debrief; null on ships without a tally. */
  nextMissionBomb: THREE.Mesh | null;
  /**
   * The part of `interiorMeshes` a distant viewer cannot make out through the glazing: everything but the crew and the
   * insulated skin, which closes the hull from inside (the outer skin is single-sided).
   */
  cabinFittings: THREE.Mesh[];
}

export interface B17Options {
  /** The lead ship's crew is meshed finely for close-ups; wingmen only show through their glazing. */
  crewDetail: FigureDetail;
  /**
   * Whether the cutaway and the exploded view open this ship up. Only then do its assemblies and its starboard wall stay
   * apart; a ship that never opens merges its fixed parts across them, a fraction of the draw calls.
   */
  opensUp: boolean;
  livery: Livery;
}

export function buildB17({ crewDetail, opensUp, livery }: B17Options): B17 {
  const materials = aircraftMaterials(livery);
  const stinger = livery.tailGunPosition === 'stinger';
  const root = new THREE.Group();
  root.name = 'B-17G';
  const airframe = new THREE.Group();

  // Hull and nose glazing; the crew and fittings inside come from the interior builder below.
  const hullGeometry = buildHullGeometry(livery.tailGunPosition);
  const hull = part(airframe, hullGeometry, materials.hull, 0, 0, 0);
  const noseGlazing = part(root, buildNoseGlazingGeometry(), materials.canopy, 0, 0, 0, { castShadow: false });
  addKitFlaws(airframe, root, noseGlazing, materials);
  const glazingFrame = new THREE.TorusGeometry(1, 0.018, 6, 48);
  const frameSection = hullSectionAt(NOSE_GLAZING_END);
  const frame = part(airframe, glazingFrame, materials.upperPaint, toX(NOSE_GLAZING_END), (frameSection.top + frameSection.bottom) / 2, 0, { rotation: [0, Math.PI / 2, 0] });
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
  const fin = assignAssembly(part(airframe, buildFinGeometry(livery.tailGunPosition), materials.fin, 0, 0, 0), 'fin');
  const tailHousingGeometry = buildTailHousingGeometry(livery.tailGunPosition);
  const tailHousing = part(airframe, tailHousingGeometry, materials.tailHousing, 0, 0, 0);

  // Engines.
  sharedBladeGeometry ??= buildBladeGeometry();
  const propellers: THREE.Object3D[] = [];
  const exhaustPorts: THREE.Object3D[] = [];
  let damagedEngine: { nacelle: THREE.Object3D; nacelleBody: THREE.Mesh; spec: NacelleSpec; smokePort: THREE.Object3D } | null = null;
  let damagedPropeller: THREE.Object3D | null = null;
  const navigationLights: THREE.Mesh[] = [];
  for (const spec of NACELLES) {
    const nacelleGeometry = buildNacelleGeometry(spec);
    for (const side of [1, -1] as const) {
      const span = side * spec.span;
      // Each nacelle, its engine, cowl, turbosupercharger and propeller is one assembly.
      const nacelleId = engineAssembly(side, spec === NACELLES[0]);
      const nacelle = assignAssembly(new THREE.Group(), nacelleId);
      airframe.add(nacelle);
      const nacelleBody = part(nacelle, side > 0 ? nacelleGeometry : mirrorAcrossZ(nacelleGeometry), materials.nacelle, 0, 0, 0);
      // Cylinder plane sits just behind the cowl lip, so the heads show through the opening as on the real aircraft.
      const cylinderPlaneD = spec.cowlFrontD + 0.26;
      const engine = buildRadialEngine(cylinderPlaneD - (spec.propellerD + PROPELLER_HUB_REAR));
      engine.position.set(toX(cylinderPlaneD), spec.thrustLineH, span);
      nacelle.add(engine);
      part(nacelle, new THREE.TorusGeometry(COWL_RADIUS * 0.85, 0.028, 8, 48), materials.upperPaint, toX(spec.cowlFrontD + 0.01), spec.thrustLineH, span, { rotation: [0, Math.PI / 2, 0] });
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
      if (spec === NACELLES[0] && side > 0) {
        damagedEngine = { nacelle, nacelleBody, spec, smokePort: new THREE.Object3D() };
        // Just aft of the cowl flaps, on the nacelle's upper outboard quarter where the fire breaks out through them.
        damagedEngine.smokePort.position.set(toX(spec.cowlRearD + 0.12), spec.thrustLineH + COWL_RADIUS * 0.74, span + side * COWL_RADIUS * 0.74);
        damagedEngine.smokePort.userData.unmerged = true;
        nacelle.add(damagedEngine.smokePort);
      }

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
        // Feathering turns each blade about its own length (local y).
        bladeMesh.userData.blade = true;
        // Clamp ring where the shank leaves the hub barrel.
        part(bladeMesh, new THREE.CylinderGeometry(0.085, 0.09, 0.07, 18), materials.gunmetal, 0, 0.235, 0);
      }
      assignAssembly(propeller, nacelleId);
      propeller.userData.unmerged = true;
      root.add(propeller);
      propellers.push(propeller);
      if (spec === NACELLES[0] && side > 0) damagedPropeller = propeller;
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
  // Nose art on the port side below the navigator's windows, and the mission tally under the pilot's window.
  // Both artworks are on the ship, one shown at a time; kept out of the merge so either can be switched on.
  const noseArtSpot = STATIONS.noseArt;
  const noseArtCentre = new THREE.Vector3(toX(noseArtSpot.d), noseArtSpot.h, -hullHalfWidthAtHeight(noseArtSpot.d, noseArtSpot.h));
  const noseArt = livery.noseArt ? Object.fromEntries((['pinup', 'card'] as const).map((choice) => {
    const { width, height } = noseArtSpot.sizes[choice];
    // A deep projector: the nose curves away fast below the art's middle, and a shallow one would clip its foot.
    const decal = addDecal(airframe, hull, materials.noseArt[choice], noseArtCentre, PORT, FORWARD.clone().negate(), width, height, NOSE_ART_PROJECTOR_DEPTH);
    // Tagged whole to the nose, or the bake would cut the wider card at the joint behind it into new meshes.
    assignAssembly(decal, 'nose');
    decal.userData.unmerged = true;
    return [choice, decal];
  })) as Record<NoseArtChoice, THREE.Mesh> : null;
  let nextMissionBomb: THREE.Mesh | null = null;
  if (livery.noseArt) {
    const tally = STATIONS.missionTally;
    addDecal(airframe, hull, materials.missionTally, new THREE.Vector3(toX(tally.d), tally.h, -hullHalfWidthAtHeight(tally.d, tally.h)), PORT, FORWARD.clone().negate(), tally.width, tally.height, 0.4);
    nextMissionBomb = addNextMissionBomb(airframe, hull, materials.nextMission);
  }
  // The forward entrance hatch in the belly under the crawlway, port of the centreline.
  const hatch = CRAWLWAY.forwardHatch;
  const hatchD = (hatch.start + hatch.end) / 2;
  const hatchZ = (hatch.inner + hatch.outer) / 2;
  addDecal(airframe, hull, materials.hatchOutline, new THREE.Vector3(toX(hatchD), hullSurfaceHeight(hatchD, hatchZ, false), hatchZ), UP.clone().negate(), FORWARD, hatch.end - hatch.start, hatch.inner - hatch.outer, 0.3);
  const wingInsigniaSpan = 11.4;
  const wingInsigniaEdges = wingEdges(wingInsigniaSpan);
  const wingInsigniaD = (wingInsigniaEdges.leading + wingInsigniaEdges.trailing) / 2;
  const wingInsigniaSurface = wingSurfaceAt(wingInsigniaSpan, wingInsigniaD);
  // Upper surface of the port wing and lower surface of the starboard wing, per USAAF practice from 1943.
  assignAssembly(addDecal(airframe, portWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.upper, -wingInsigniaSpan), UP, STARBOARD, 2.87, 1.52, 0.28), 'wing-port');
  assignAssembly(addDecal(airframe, starboardWing, materials.insignia, new THREE.Vector3(toX(wingInsigniaD), wingInsigniaSurface.lower, wingInsigniaSpan), UP.clone().negate(), STARBOARD, 2.87, 1.52, 0.28), 'wing-starboard');

  if (!damagedEngine || !damagedPropeller) throw new Error('No. 3 engine was not built');
  const hitEngine = { smokePort: damagedEngine.smokePort, propeller: damagedPropeller };
  // Flak holes, hidden until the hit, where the livery puts them.
  const holes = livery.flakStrikes.map((strike) => {
    if (strike.surface === 'hull') {
      const z = strike.side * hullHalfWidthAtHeight(strike.d, strike.y);
      const hole = addDecal(airframe, hull, materials.flakDamage, new THREE.Vector3(toX(strike.d), strike.y, z), strike.side > 0 ? STARBOARD : PORT, FORWARD, 1.1, 0.8, 0.5);
      return assignAssembly(hole, fuselageSectionAt(strike.d));
    }
    const wing = strike.span > 0 ? starboardWing : portWing;
    const surface = wingSurfaceAt(Math.abs(strike.span), strike.d).upper;
    return assignAssembly(addDecal(airframe, wing, materials.flakDamage, new THREE.Vector3(toX(strike.d), surface, strike.span), UP, FORWARD, 0.9, 0.9, 0.3), strike.span > 0 ? 'wing-starboard' : 'wing-port');
  });
  // Oil and soot from No. 3: back over the top of its nacelle from the cowl flaps, and on across the wing behind it.
  const engine3 = damagedEngine.spec;
  const streakNormal = new THREE.Vector3(0, 1, 0.55).normalize();
  const streaks = [
    assignAssembly(addDecal(airframe, damagedEngine.nacelleBody, materials.oilStreak,
      new THREE.Vector3(toX(engine3.cowlRearD + OIL_STREAKS.nacelle.aftOfCowl), engine3.thrustLineH + COWL_RADIUS * 0.85, engine3.span + COWL_RADIUS * 0.45),
      streakNormal, AFT, OIL_STREAKS.nacelle.length, OIL_STREAKS.nacelle.width, 0.7), engineAssembly(1, true)),
    assignAssembly(addDecal(airframe, starboardWing, materials.oilStreak,
      new THREE.Vector3(toX(OIL_STREAKS.wing.d), wingSurfaceAt(engine3.span + OIL_STREAKS.wing.outboard, OIL_STREAKS.wing.d).upper, engine3.span + OIL_STREAKS.wing.outboard),
      UP, AFT, OIL_STREAKS.wing.length, OIL_STREAKS.wing.width, 0.35), 'wing-starboard'),
  ];
  for (const decal of [...holes, ...streaks]) {
    decal.visible = false;
    decal.userData.unmerged = true;
  }
  const burstPoint = new THREE.Object3D();
  burstPoint.position.set(toX(BURST.d), wingSurfaceAt(BURST.span, BURST.d).lower - BURST.below, BURST.span);
  root.add(burstPoint);

  // Bomb bay doors: patches of the skin hinged along the outer edges of the opening.
  const bay = STATIONS.bombBay;
  const bayMid = (bay.start + bay.end) / 2;
  const bombBayDoors: B17['bombBayDoors'] = [];
  for (const side of [1, -1] as const) {
    const hingeZ = side * bay.halfWidth;
    const hinge = assignAssembly(new THREE.Group(), 'bomb-doors');
    hinge.userData.unmerged = true;
    hinge.position.set(toX(bayMid), hullSurfaceHeight(bayMid, hingeZ, false), hingeZ);
    part(hinge, buildBayDoorGeometry(side), materials.bayDoor, 0, 0, 0);
    root.add(hinge);
    bombBayDoors.push({ hinge, side: side > 0 ? -1 : 1 });
  }

  // Top turret: Sperry A-1 behind the cockpit. The fixed ring is part of the fuselage; the rest turns with the turret.
  const topTurretSpec = STATIONS.topTurret;
  const turretBase = hullSectionAt(topTurretSpec.d).top - 0.03;
  part(airframe, buildTurretRingGeometry(topTurretSpec.d, turretBase), materials.upperPaint, 0, 0, 0);
  const topTurretYaw = assignAssembly(new THREE.Group(), 'top-turret');
  topTurretYaw.userData.unmerged = true;
  topTurretYaw.position.set(toX(topTurretSpec.d), turretBase, 0);
  const topTurretPitch = new THREE.Group();
  topTurretPitch.userData.unmerged = true;
  addTopTurretBody(topTurretYaw, materials, topTurretPitch);
  topTurretPitch.position.set(TOP_TURRET.gunPivot.x, TOP_TURRET.gunPivot.y, 0);
  const topTurretGuns = [-1, 1].map((side) => addM2(topTurretPitch, new THREE.Vector3(0, 0, (side * topTurretSpec.gunSpacing) / 2), FORWARD, 'turret'));
  topTurretYaw.add(topTurretPitch);
  root.add(topTurretYaw);

  // Sperry ball turret, hanging from its trunnion ring support in the hole in the belly behind the radio room.
  const ballYaw = assignAssembly(new THREE.Group(), 'ball-turret');
  ballYaw.userData.unmerged = true;
  ballYaw.position.copy(ballTurretCentre());
  addBallTurretMount(ballYaw, { structure: materials.lowerPaint, steel: materials.gunmetal });
  const ballPitch = new THREE.Group();
  ballPitch.userData.unmerged = true;
  addBallTurretShell(ballPitch, { shell: materials.lowerPaint, glass: materials.canopy, seam: materials.rubber, steel: materials.steel });
  const ballTurretGuns = ([-1, 1] as const).map((side) => addM2(ballPitch, ballGunOrigin(side), FORWARD, 'turret'));
  ballYaw.add(ballPitch);
  root.add(ballYaw);

  // Bendix chin turret on its fixed fairing.
  part(airframe, buildChinFairingGeometry(), materials.upperPaint, 0, 0, 0);
  const { turret: chinTurret, guns: chinGuns } = buildChinTurret(materials);
  chinTurret.userData.unmerged = true;
  root.add(assignAssembly(chinTurret, 'chin-turret'));

  addTailGunnerGlazing(airframe, tailHousing, materials, cutouts, livery.tailGunPosition);
  if (stinger) {
    addStingerGunBoots(airframe, materials);
  } else {
    const mount = buildTailGunMountGeometry();
    part(airframe, mount.dome, materials.upperPaint, 0, 0, 0);
    part(airframe, mount.slotLips, materials.gunmetal, 0, 0, 0);
    part(airframe, mount.backing, materials.cowlLiner, 0, 0, 0, { castShadow: false });
  }

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
  part(airframe, new THREE.SphereGeometry(0.16, 16, 10), materials.upperPaint, toX(4.55), hullSectionAt(4.55).bottom - 0.08, 0).scale.set(2.2, 0.7, 0.9);

  // Navigation lights: red port wingtip, green starboard, white on the tail.
  const tipEdges = wingEdges(WING_SEMISPAN - 0.08);
  const tipD = (tipEdges.leading + tipEdges.trailing) / 2;
  for (const [span, material] of [[WING_SEMISPAN - 0.06, materials.navGreen], [-(WING_SEMISPAN - 0.06), materials.navRed]] as const) {
    navigationLights.push(assignAssembly(part(root, new THREE.SphereGeometry(0.07, 12, 8), material, toX(tipD), wingChordHeight(Math.abs(span)), span, { castShadow: false }), span > 0 ? 'wing-starboard' : 'wing-port'));
  }
  // The white tail light sits on the cone's top: where the skin curls in over the Cheyenne mount, or at the stinger's end.
  const tailLightD = stinger ? STATIONS.stingerHousing.end : STATIONS.tailGunMount.opening;
  navigationLights.push(part(root, new THREE.SphereGeometry(0.04, 12, 8), materials.navWhite, toX(tailLightD), hullSectionAt(tailLightD).top - 0.01, 0, { castShadow: false }));

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
  // The cutaway hides the whole starboard wall at once, so each assembly's share of it is one group, kept apart.
  const starboardWall: THREE.Object3D[] = [];
  for (const group of opensUp ? assemblies.groups.values() : []) {
    const items = group.children.filter((child) => child.userData.hiddenInCutaway);
    if (items.length === 0) continue;
    const wall = new THREE.Group();
    wall.userData.unmerged = true;
    wall.add(...items);
    group.add(wall);
    starboardWall.push(wall);
  }
  // Everything that holds still in an assembly, or in the whole ship if it never opens up, becomes one mesh per material;
  // each moving part the same in its own space.
  for (const group of opensUp ? assemblies.groups.values() : [root]) mergeRigidMeshes(group);
  // Callouts ride with the assembly their man is in: the engineer with the top turret, the gunners with their sections.
  const interiorMeshes = collectInteriorMeshes(root);
  const crewMeshes = new Set<THREE.Object3D>(interior.crew.map((man) => man.mesh));
  const cabinFittings = interiorMeshes.filter((mesh) => !crewMeshes.has(mesh) && mesh.material !== interiorMaterials().skin);
  // The top turret's guns hold fire wherever its profile cam says the line of fire crosses the ship.
  const profileCam = topTurretProfileCam(root, topTurretYaw, propellers);
  for (const mounted of interior.guns) {
    if (!topTurretGuns.includes(mounted.gun)) continue;
    mounted.interrupted = () => {
      const step = Math.floor((THREE.MathUtils.euclideanModulo(topTurretYaw.rotation.y, Math.PI * 2) / (Math.PI * 2)) * PROFILE_CAM_STEPS);
      return topTurretPitch.rotation.z < profileCam[step % PROFILE_CAM_STEPS];
    };
  }
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
    guns: [...interior.guns, ...chinGuns.map((gun) => ({ gun, belt: null, caseFloorY: null, casesBagged: false, interrupted: null }))],
    cutawayMaterials: [
      materials.hull, materials.upperPaint, materials.canopy, materials.turretDome, materials.armourGlass, materials.paintChip, materials.windowPane, materials.insignia, materials.codes, materials.aircraftLetter,
      materials.noseArt.pinup, materials.noseArt.card, materials.missionTally, materials.nextMission,
      materials.lowerPaint, ballWindowMaskMaterial(materials.lowerPaint), materials.tailHousing, ...interior.clipMaterials,
    ],
    cutawayHidden: starboardWall,
    interiorMeshes,
    cabinFittings,
    noseArt,
    nextMissionBomb,
    exhaustPorts,
    battleDamage: { holes, streaks: { meshes: streaks, material: materials.oilStreak }, ...hitEngine, burstPoint },
    landingGear: buildLandingGear(root, materials),
    turboGlow: materials.turboGlow,
    navigationLights,
  };
}

/**
 * The meshes in the cabin's own materials, and the crew. The guns' black is left out: the barrels stand out of the
 * windows and turrets, where their shadows show.
 */
function collectInteriorMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const cabinMaterials = new Set<THREE.Material>(Object.entries(interiorMaterials()).filter(([name]) => name !== 'gunBlack').map(([, material]) => material));
  const meshes: THREE.Mesh[] = [];
  const visit = (object: THREE.Object3D, inCrew: boolean): void => {
    const crew = inCrew || object.userData.stationX !== undefined;
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && (crew || cabinMaterials.has(object.material))) meshes.push(object);
    for (const child of object.children) visit(child, crew);
  };
  visit(root, false);
  return meshes;
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
  const materials = aircraftMaterials(LEAD_LIVERY);
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
