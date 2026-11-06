import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setCottonFrame } from './render/miniature';
import {
  addVirtualLight, bakeEnvironments, createStudioPipeline, initialPixelRatio, metalMaterial, PlanarReflection, setSaturation,
  type VirtualLight,
} from './render/studio';
import { buildB17, createBomb, type B17 } from './scene/b17';
import { LEAD_LIVERY, WINGMAN_LIVERIES } from './scene/livery';
import type { CrewStation } from './scene/interior';
import { Walkthrough } from './walkthrough';
import { Hardstand, PROLOGUE_FLIGHT, type EngineStart, type HardstandFrame } from './scene/hardstand';
import { Foley } from './audio/foley';
import { KitBench } from './scene/kit-bench';
import { Workbench } from './scene/workbench';
import { fittingHotspots } from './scene/interior/hotspots';
import { Hotspots } from './ui/hotspots';
import { Cutaway } from './scene/cutaway';
import { BombTrain, ChaffDrop, Contrails, CottonPuffs, ENGINE_SMOKE_LOOK, EngineFire, FIGHTER_SMOKE_LOOK, FlakField } from './scene/effects';
import { FighterAttack } from './scene/fighters';
import { Gunnery } from './scene/gunnery';
import { PALETTE } from './scene/palette';
import { StopMotionClock, type StopMotionRate } from './scene/stop-motion';
import { codeLettersDecal, insigniaDecal, loadNoseArt, missionTallyDecal, MISSIONS_FLOWN, noseArtDecal, tailMarkingDecal, type NoseArtChoice } from './scene/textures';
import { RenderLog } from './render/render-log';
import { FilmGatePass } from './render/film-gate';
import { OnionSkinPass } from './render/onion-skin';
import { buildDisplayStand, buildStudioSet, buildWorkshop, driftClouds, STAND_JOINT_RADIUS, type DisplayStand } from './scene/set';
import { hullSectionAt, toX } from './scene/hull';
import { BOMB_COUNT, EXTINGUISHER_SECONDS, FLAK_HIT_SECONDS, PHASES, SORTIE_LOOP_SECONDS, sortieStateAt, STRIKE_PHOTO, type SortieState } from './sortie';
import { Callouts } from './ui/callouts';
import { FpsMeter } from './ui/fps-meter';
import { TILT_SHIFT_STRENGTH, Ui, type ShowMode, type ViewMode } from './ui/ui';
import { updateInstrumentPanel, type InstrumentReadings } from './scene/interior/panels';
import { ExplodedView } from './scene/exploded';
import { fuselageSectionAt } from './scene/assemblies';
import { runAudits } from './debug/audits';

/** World units per metre: the 22.66 m fuselage becomes a 7.3-unit model. */
const MODEL_SCALE = 0.32;
/** Ground speed of the air mass past the formation, in world units per second. Slowed down so the eye can follow it. */
const AIR_DRIFT_SPEED = 2.4;
/** The cloud deck far below drifts aft slower than the air streaming past the ships. */
const CLOUD_DRIFT_SPEED = AIR_DRIFT_SPEED * 0.45;
/** The stand rod meets the belly just aft of the ball turret, clear of the bomb bay and the falling bombs. */
const STAND_MOUNT_D = 12.7;
const MAX_FRAME_SEC = 0.1;
/**
 * How far an animator's hand leaves a model off its pose between exposures (world units, radians): the fraction of a
 * millimetre and of a degree that makes a handled model shiver where a computer-animated one glides.
 */
const HANDLING = { offset: 0.006, turn: 0.0025 } as const;
const ADAPTIVE_WINDOW_SECONDS = 1.6;
/** Drawn frames a second below which quality steps down: the machine is missing exposures. */
/** Below the film's rate by this much, quality steps down (and a probe up fails); within this much, it may step up. */
const ADAPTIVE_LOW_MARGIN = 1;
const ADAPTIVE_HIGH_MARGIN = 0.5;
const PIXEL_RATIO_STEP = 0.25;
const VEIL_MS = 200;

function requireElement(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
}

const viewport = requireElement('viewport');
const uiRoot = requireElement('ui-root');
const veil = requireElement('veil');
const calloutRoot = requireElement('callouts');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(initialPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.transmissionResolutionScale = 0.6;
viewport.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.background);
const fog = new THREE.FogExp2(PALETTE.fog, 0.0065);
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 320);

const environments = bakeEnvironments(renderer);
const chrome = metalMaterial(PALETTE.chrome, { roughness: 0.22, metalness: 1 });

const hemisphereLight = new THREE.HemisphereLight('#8fa6d8', '#262c3a', 0.55);
const keyLight = new THREE.DirectionalLight('#ffd9b4', 1.3);
keyLight.target.position.set(0, 3, -2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096);
Object.assign(keyLight.shadow.camera, { left: -16, right: 16, top: 13, bottom: -11, near: 1, far: 80 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.03;
keyLight.shadow.radius = 2;
const rimLight = new THREE.DirectionalLight('#8fd8ff', 1.2);
// Steeper than the guide's rim: from the usual three-quarter camera, a lower rim mirrors off the glossy floor as a glare spot.
rimLight.position.set(-3, 16, -8);
const secondaryKeyLight = new THREE.DirectionalLight('#fff1e0', 0.7);
secondaryKeyLight.position.set(-8, 12, 10);
scene.add(hemisphereLight, keyLight, keyLight.target, rimLight, secondaryKeyLight);

await Promise.all([document.fonts.load('700 40px Outfit'), document.fonts.load('500 20px "DM Mono"')])
  .catch((error: unknown) => console.warn('UI fonts unavailable; markings fall back to system fonts', error));
await loadNoseArt();

const floorReflection = new PlanarReflection(0);
const set = buildStudioSet(floorReflection);
// The animator's tins, brush, scalpel and next decal sheet round the cutting mat, laid out afresh for each sortie.
const workbench = new Workbench();
/** Sorties begun, the boarding on load the first: each finds the bench as the animator last left it. */
let sortiesBegun = 0;
scene.add(set.lab, set.sweep, set.clouds, set.overcast.root, buildWorkshop(), workbench.root);
floorReflection.hiddenDuringReflection.push(set.floor);

// The formation: lead ship in front, two wingmen stepped up and down behind it, each on its own display stand.
interface FormationShip {
  aircraft: B17;
  holder: THREE.Group;
  base: THREE.Vector3;
  stand: DisplayStand;
  /** Seconds this ship lags the lead, so the wingmen open doors and drop just after it. */
  lag: number;
  bombsDropped: number;
  turboLights: VirtualLight[];
  /** World-space turbo exhaust positions, refreshed every frame; the contrail ribbons start here. */
  exhaustWorld: THREE.Vector3[];
  /** Where the animator's hand left the model off its true pose this exposure. */
  handling: { offset: THREE.Vector3; turn: THREE.Euler };
  /** Where each turret points now; it slews from here toward a fighter, or toward its gunner's scan. */
  turretAim: TurretAim | null;
}

interface TurretAim {
  topYaw: number;
  topPitch: number;
  ballYaw: number;
  ballPitch: number;
  chinYaw: number;
}

const formationSlots = [
  { position: new THREE.Vector3(0, 3.6, 0), lag: 0, livery: LEAD_LIVERY, plaque: { title: 'B-17G FLYING FORTRESS', subtitle: '91st BG · 322nd BS · LG-K' } },
  { position: new THREE.Vector3(-7.5, 5.3, -7.2), lag: 0.45, livery: WINGMAN_LIVERIES[0], plaque: null },
  { position: new THREE.Vector3(-9.0, 2.3, -1.2), lag: 0.8, livery: WINGMAN_LIVERIES[1], plaque: null },
];

const formation: FormationShip[] = formationSlots.map((slot, index) => {
  const aircraft = buildB17({ crewDetail: index === 0 ? 'high' : 'low', opensUp: index === 0, livery: slot.livery });
  const holder = new THREE.Group();
  holder.position.copy(slot.position);
  holder.scale.setScalar(MODEL_SCALE);
  holder.add(aircraft.root);
  scene.add(holder);
  const base = new THREE.Vector3(slot.position.x - 0.9, 0, slot.position.z);
  const stand = buildDisplayStand(base, slot.plaque, index === 0 ? set.practicalLights : null);
  scene.add(stand.root);
  const turboLights = index === 0
    ? aircraft.exhaustPorts.map(() => addVirtualLight(new THREE.Vector3(), PALETTE.turboGlow, 1.1, 0.85))
    : [];
  const exhaustWorld = aircraft.exhaustPorts.map((port) => port.getWorldPosition(new THREE.Vector3()));
  return { aircraft, holder, base, stand, lag: slot.lag, bombsDropped: 0, turboLights, exhaustWorld, handling: { offset: new THREE.Vector3(), turn: new THREE.Euler() }, turretAim: null };
});
const contrailEmitters = formation.flatMap((ship) => ship.exhaustWorld);
const flak = new FlakField();
const contrails = new Contrails(contrailEmitters.length);
/** Oil smoke from the lead's hit engine. */
const engineSmoke = new Contrails(1, ENGINE_SMOKE_LOOK);
const engineSmokeEmitter = [new THREE.Vector3()];
/** The lead's No. 3 on fire after the flak hit. */
const engineFire = new EngineFire();
/** The extinguisher's second puff, a little aft and below the first, world units. */
const EXTINGUISHER_SECOND_PUFF = new THREE.Vector3(-0.12, -0.05, 0.04);
/** Extinguisher clouds and starting coughs. */
const puffs = new CottonPuffs();
const stopMotion = new StopMotionClock();
/** A falling bomb bursts once its middle is this far off the set floor: lying on it. */
const BOMB_BURST_HEIGHT = 0.08;
const bombs = new BombTrain(createBomb, BOMB_BURST_HEIGHT);
const gunnery = new Gunnery(MODEL_SCALE);
const fighters = new FighterAttack(MODEL_SCALE);
/** The chaff chute in the radio room's floor, under the belly, model metres from the nose. */
const CHAFF_CHUTE_D = 9.4;
const chaffChute = new THREE.Vector3(toX(CHAFF_CHUTE_D), hullSectionAt(CHAFF_CHUTE_D).bottom - 0.05, 0);
const chaff = new ChaffDrop(formation.length);
const chaffChutesWorld = formation.map(() => new THREE.Vector3());
/** The shot-down fighter's smoke. */
const fighterSmoke = new Contrails(1, FIGHTER_SMOKE_LOOK);
const fighterSmokeEmitter = [new THREE.Vector3()];
/** The nearest fighter's distance from the camera on the last exposure, for the foley's pitch. */
let lastFighterDistance: number | null = null;
const fighterNearest = new THREE.Vector3();
/** A fighter is heard within this range of the camera, world units. */
const FIGHTER_HEARD_WITHIN = 40;
for (const ship of formation) gunnery.addShip(ship.aircraft.root, ship.aircraft.guns);
scene.add(chaff.root, flak.root, contrails.root, engineSmoke.root, fighterSmoke.root, engineFire.root, puffs.root, bombs.root, gunnery.root, fighters.root);

// Cutaway of the lead ship: the starboard skin peels back to show the crew at their stations.
const cutaway = new Cutaway(formation[0].aircraft);
const callouts = new Callouts(calloutRoot, formation[0].aircraft.root, formation[0].aircraft.crewStations, true, walkToStation);
const walkthrough = new Walkthrough(formation[0].aircraft.root);
const hotspots = new Hotspots(calloutRoot, formation[0].aircraft.root, fittingHotspots());
// Exploded view of the lead ship: compartments, wings, engines, tail surfaces and turrets pulled apart and named.
const exploded = new ExplodedView(formation[0].aircraft.assemblies);

// A closed ship's cabin shows only through its glazing, so it casts no shadows and stays out of the floor's
// reflection; the lead's cabin casts again while the cutaway or the exploded view has it open.
const leadCabinShadowCasters = formation[0].aircraft.interiorMeshes.filter((mesh) => mesh.castShadow);
for (const ship of formation) {
  floorReflection.hiddenDuringReflection.push(...ship.aircraft.interiorMeshes);
  for (const mesh of ship.aircraft.interiorMeshes) mesh.castShadow = false;
}
let leadCabinOpen = false;
/** A wingman's cabin fittings are drawn only with the camera this close (world units); farther, the glazing hides them. */
const WINGMAN_CABIN_DETAIL_DISTANCE = 7;
const wingmanCabins = formation.slice(1).map((ship) => ({ holder: ship.holder, fittings: ship.aircraft.cabinFittings, shown: true }));

function updateWingmanCabins(): void {
  for (const cabin of wingmanCabins) {
    const shown = camera.position.distanceTo(cabin.holder.position) < WINGMAN_CABIN_DETAIL_DISTANCE;
    if (shown === cabin.shown) continue;
    cabin.shown = shown;
    for (const mesh of cabin.fittings) mesh.visible = shown;
  }
}

/**
 * Grain-of-wheat bulbs the animator tucks inside the lead along its centreline, lit when the cutaway opens it so each
 * compartment reads from outside: nose, pilots, bomb bay, radio room, waist and tail, in model space.
 */
const CABIN_BULBS = [
  new THREE.Vector3(9 - 1.8, 0.25, 0), new THREE.Vector3(9 - 4.6, 0.95, 0), new THREE.Vector3(9 - 7.1, 0.35, 0),
  new THREE.Vector3(9 - 9.6, 0.4, 0), new THREE.Vector3(9 - 13.5, 0.2, 0), new THREE.Vector3(9 - 19.8, 0.15, 0),
];
const CABIN_BULB = { colour: '#ffe0b0', radius: 1.3, intensity: 0.7 } as const;
const cabinBulbs = CABIN_BULBS.map(() => addVirtualLight(new THREE.Vector3(), CABIN_BULB.colour, CABIN_BULB.radius, 0));

/** Moves the bulbs with the lead and brings them up as the cutaway opens. */
function updateCabinBulbs(): void {
  const lit = CABIN_BULB.intensity * THREE.MathUtils.smoothstep(cutaway.amount, 0.3, 1);
  cabinBulbs.forEach((bulb, index) => {
    bulb.intensity = lit;
    if (lit > 0) formation[0].aircraft.root.localToWorld(bulb.position.copy(CABIN_BULBS[index]));
  });
}

function updateLeadCabinShadows(): void {
  const open = cutaway.amount > 0 || exploded.amount > 0;
  if (open === leadCabinOpen) return;
  leadCabinOpen = open;
  for (const mesh of leadCabinShadowCasters) mesh.castShadow = open;
}
const assemblyCallouts = new Callouts(calloutRoot, formation[0].aircraft.root, exploded.labels(formation[0].aircraft.root), false);
const CUTAWAY_SHOT = { target: new THREE.Vector3(0.2, 3.65, 0), spherical: new THREE.Spherical(11.5, 1.0, 0.2) };
/** Three-quarter view from ahead and above, wide enough for the spread-out assemblies. */
const EXPLODED_SHOT = { target: new THREE.Vector3(-0.2, 3.5, 0), spherical: new THREE.Spherical(19, 0.98, 0.5) };
const CAMERA_TWEEN_SECONDS = 1.3;
/** In-focus depth either side of the target: shallow, as a macro lens close to a tabletop set gives. */
const FOCUS_RANGE = { exterior: 2.6, cutaway: 5.0 } as const;

/** The macro look at full strength: blur, half-res pixels per world unit out of focus (near, far), and the most it blurs. */
const MACRO_BLUR = { near: 4.4, far: 2.4, max: 13 } as const;
/** The gather pass's taps reach about this radius, half-res pixels; a stronger blur would leave a hard edge. */
const MAX_REACHABLE_COC = 16;

const focusPoint = new THREE.Vector3();
const pipeline = createStudioPipeline(renderer, scene, camera, focusPoint);
const depthOfField = pipeline.depthOfField.uniforms;
let tiltShiftStrength: number = TILT_SHIFT_STRENGTH.initial;
// Ahead of the film gate: the grabber mixes the frames as shot, and the grain on top is this exposure's alone.
const onionSkin = new OnionSkinPass();
pipeline.composer.addPass(onionSkin);
const filmGate = new FilmGatePass();
pipeline.composer.addPass(filmGate);

/** How close the orbit may come to its target: outside the ship, and inside it once a walk has taken the camera in. */
const ORBIT_MIN_DISTANCE = { outside: 6, inside: 0.05 } as const;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = ORBIT_MIN_DISTANCE.outside;
controls.maxDistance = 40;
controls.maxPolarAngle = 1.72;
controls.target.set(0.3, 3.9, 0);
camera.position.setFromSpherical(new THREE.Spherical(16, 1.36, 0.95)).add(controls.target);
controls.update();

interface CameraTween { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPosition: THREE.Vector3; toPosition: THREE.Vector3; progress: number }
let cameraTween: CameraTween | null = null;
controls.addEventListener('start', () => {
  cameraTween = null;
  walkthrough.cancel();
  bumpTripod();
});

/**
 * A tripod knocked as a camera move begins: over the next exposures the camera jolts off and settles back, each step a
 * fraction of its distance to the target, the way a hand on the head shakes a set camera.
 */
const TRIPOD_BUMP_STEPS = [0.006, -0.003, 0.0012, 0];
const tripodBump = { step: TRIPOD_BUMP_STEPS.length, direction: new THREE.Vector3(), applied: new THREE.Vector3() };

function bumpTripod(): void {
  if (!stopMotion.jitter) return;
  tripodBump.step = 0;
  const random = stopMotion.random;
  tripodBump.direction.set(random() - 0.5, -0.6 - random() * 0.4, random() - 0.5).normalize();
}

/** Takes the bump off before the orbit controls integrate the camera, so it never accumulates into the shot. */
function liftTripodBump(): void {
  camera.position.sub(tripodBump.applied);
}

/** Puts the bump back after the controls; a new exposure moves it to its next step. */
function applyTripodBump(exposed: boolean): void {
  if (exposed && tripodBump.step < TRIPOD_BUMP_STEPS.length) {
    const distance = camera.position.distanceTo(controls.target);
    tripodBump.applied.copy(tripodBump.direction).multiplyScalar(TRIPOD_BUMP_STEPS[tripodBump.step] * distance);
    tripodBump.step += 1;
  }
  camera.position.add(tripodBump.applied);
}

function stepCameraTween(deltaSec: number): void {
  if (!cameraTween) return;
  cameraTween.progress = Math.min(cameraTween.progress + deltaSec / CAMERA_TWEEN_SECONDS, 1);
  const eased = THREE.MathUtils.smootherstep(cameraTween.progress, 0, 1);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  if (cameraTween.progress >= 1) cameraTween = null;
}

// View presets: one function sets every knob behind a short veil.

interface ViewPreset {
  background: string;
  fog: [string, number];
  toneMapping: THREE.ToneMapping;
  exposure: number;
  environment: THREE.Texture;
  environmentIntensity: number;
  chromeEnvironment: THREE.Texture;
  chromeIntensity: number;
  bloom: [number, number];
  reflection: number;
  hemisphere: [string, string, number];
  key: [string, number, THREE.Vector3];
  rim: number;
  secondary: number;
  saturation: number;
  veil: string;
}

const VIEW_PRESETS: Record<ViewMode, ViewPreset> = {
  lab: {
    background: PALETTE.background, fog: [PALETTE.fog, 0.0065], toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.0,
    environment: environments.show, environmentIntensity: 0.7, chromeEnvironment: environments.steel, chromeIntensity: 1.25,
    bloom: [1.25, 0.42], reflection: 0.5, hemisphere: ['#8fa6d8', '#262c3a', 0.55], key: ['#ffd9b4', 1.3, new THREE.Vector3(0.62, 0.62, 0.48)],
    rim: 1.2, secondary: 0.7, saturation: 1.16 * 1.4, veil: '#0b0f1a',
  },
  studio: {
    background: PALETTE.studioBackground, fog: [PALETTE.studioBackground, 0.0045], toneMapping: THREE.NeutralToneMapping, exposure: 0.96,
    environment: environments.studio, environmentIntensity: 0.62, chromeEnvironment: environments.lightSteel, chromeIntensity: 0.95,
    bloom: [2.6, 0.18], reflection: 0, hemisphere: ['#f6f8ff', '#c9c4bd', 0.5], key: ['#fff6ea', 3.4, new THREE.Vector3(-0.55, 0.75, 0.4)],
    rim: 0.35, secondary: 0.3, saturation: 1.16 * 0.86, veil: '#efe7dc',
  },
};

let view: ViewMode = 'lab';
let reflectionQualityEnabled = true;
const practicalIntensities = set.practicalLights.map((light) => light.intensity);

function applyView(next: ViewMode): void {
  const preset = VIEW_PRESETS[next];
  view = next;
  (scene.background as THREE.Color).set(preset.background);
  fog.color.set(preset.fog[0]);
  fog.density = preset.fog[1];
  renderer.toneMapping = preset.toneMapping;
  renderer.toneMappingExposure = preset.exposure;
  scene.environment = preset.environment;
  scene.environmentIntensity = preset.environmentIntensity;
  chrome.envMap = preset.chromeEnvironment;
  chrome.envMapIntensity = preset.chromeIntensity;
  chrome.needsUpdate = true;
  pipeline.bloom.threshold = preset.bloom[0];
  pipeline.bloom.strength = preset.bloom[1];
  floorReflection.uniforms.uReflectionStrength.value = reflectionQualityEnabled ? preset.reflection : 0;
  hemisphereLight.color.set(preset.hemisphere[0]);
  hemisphereLight.groundColor.set(preset.hemisphere[1]);
  hemisphereLight.intensity = preset.hemisphere[2];
  keyLight.color.set(preset.key[0]);
  keyLight.intensity = preset.key[1];
  keyLight.position.copy(preset.key[2]).normalize().multiplyScalar(30).add(keyLight.target.position);
  rimLight.intensity = preset.rim;
  secondaryKeyLight.intensity = preset.secondary;
  Object.assign(lampBase, { key: preset.key[1], rim: preset.rim, secondary: preset.secondary, hemisphere: preset.hemisphere[2] });
  lampBase.keyColor.copy(keyLight.color);
  setSaturation(preset.saturation);
  set.lab.visible = next === 'lab';
  set.sweep.visible = next === 'studio';
  set.practicalLights.forEach((light, index) => { light.intensity = next === 'lab' ? practicalIntensities[index] : 0; });
  contrails.setStudioMode(next === 'studio');
  fighterSmoke.setStudioMode(next === 'studio');
  engineSmoke.setStudioMode(next === 'studio');
  document.body.classList.toggle('is-studio', next === 'studio');
  ui.setView(next);
}

/**
 * Hand-set lamps and a stopped-down lens never quite repeat: each exposure the lamps come out up to 1.5 % brighter or
 * dimmer and a shade warmer or cooler.
 */
const LAMP_FLICKER = { intensity: 0.015, warmth: 0.02 } as const;
const lampBase = { key: 0, rim: 0, secondary: 0, hemisphere: 0, keyColor: new THREE.Color() };
const lampTint = new THREE.Color();

function flickerLamps(): void {
  const random = stopMotion.random;
  const vary = () => 1 + (random() - 0.5) * 2 * LAMP_FLICKER.intensity;
  keyLight.intensity = lampBase.key * vary();
  rimLight.intensity = lampBase.rim * vary();
  secondaryKeyLight.intensity = lampBase.secondary * vary();
  hemisphereLight.intensity = lampBase.hemisphere * vary();
  const warmth = (random() - 0.5) * 2 * LAMP_FLICKER.warmth;
  keyLight.color.copy(lampBase.keyColor).multiply(lampTint.setRGB(1 + warmth, 1, 1 - warmth));
}

let veilTimer = 0;
function switchView(next: ViewMode): void {
  if (next === view) return;
  veil.style.background = VIEW_PRESETS[next].veil;
  veil.classList.add('is-on');
  window.clearTimeout(veilTimer);
  veilTimer = window.setTimeout(() => {
    applyView(next);
    veil.classList.remove('is-on');
  }, VEIL_MS);
}

// Nose art: only the lead carries it; the wingmen are real aircraft whose own art is not modelled.

let noseArt: NoseArtChoice = 'pinup';

function setNoseArt(choice: NoseArtChoice): void {
  noseArt = choice;
  for (const ship of formation) {
    if (!ship.aircraft.noseArt) continue;
    for (const [option, decal] of Object.entries(ship.aircraft.noseArt)) decal.visible = option === choice;
  }
  ui.setNoseArt(choice);
}

// Playback.

let sortieTime = 0;

// The prologue: the lead boards on its hardstand and takes off onto its stand; it runs once on load, and again on H.
const foley = new Foley();

// The kit bench: the finished lead on a turntable on the set floor, by its box and decal sheet.
const kitBench = new KitBench(formation[0].aircraft, MODEL_SCALE, [
  insigniaDecal(), codeLettersDecal(LEAD_LIVERY.codes, LEAD_LIVERY.finish), codeLettersDecal(LEAD_LIVERY.letter, LEAD_LIVERY.finish),
  tailMarkingDecal(LEAD_LIVERY.tailSerial, LEAD_LIVERY.letter, LEAD_LIVERY.finish), noseArtDecal('pinup'), noseArtDecal('card'), missionTallyDecal(MISSIONS_FLOWN),
]);
scene.add(kitBench.root);
/** Film seconds the lead has been on the turntable, or null while it flies. */
let kitTime: number | null = null;
const KIT_SHOT = { target: KitBench.focus, spherical: new THREE.Spherical(21, 1.05, 0.5) };

function setKitBench(shown: boolean): void {
  if (shown) setGunnerView(false);
  if (shown && prologueTime !== null) finishPrologue();
  if (shown && landingShown) endLanding();
  if (shown && show !== 'exterior') setShow('exterior');
  if (shown) {
    kitBench.paintBoxArt(renderer, scene);
    resize();
  }
  kitTime = shown ? 0 : null;
  kitBench.setShown(shown);
  formation[0].stand.root.visible = !shown;
  formation[0].aircraft.landingGear.setExtension(shown ? 1 : 0);
  ui.setKitBench(shown);
  tweenCamera(shown ? KIT_SHOT : FORMATION_SHOT);
}

/** Puts the lead on the turntable over whatever the formation gave it this exposure. */
function stepKitBench(deltaSec: number): void {
  if (kitTime === null) return;
  kitTime += deltaSec;
  const pose = kitBench.update(kitTime);
  formation[0].holder.position.copy(pose.position);
  formation[0].holder.rotation.copy(pose.rotation);
}

async function setSound(enabled: boolean): Promise<void> {
  await foley.setEnabled(enabled);
  ui.setSound(foley.enabled);
}

const hardstand = new Hardstand(formation[0].aircraft, MODEL_SCALE, formationSlots[0].position);
scene.add(hardstand.root);
/** Film seconds into the prologue, or null once the lead is on its stand. */
let prologueTime: number | null = null;
/** Where each propeller (in build order) stands while its engine is cold. */
const COLD_PROPELLER_ANGLES = [0.5, 1.4, 2.2, 0.9];
/**
 * Engines No. 1 to No. 4 as indices into the ship's propellers and exhausts, which are built inboard pair first,
 * starboard before port: No. 1 is the port outboard, No. 4 the starboard outboard.
 */
const ENGINE_PROPELLER = [3, 1, 0, 2];
/** A catching engine coughs smoke out under its lower cowl flaps: this far aft of and below its propeller, model metres. */
const COUGH_FROM_PROPELLER = new THREE.Vector3(-1.9, -1.15, 0);
/** How far a starter turns its propeller over each exposure. */
const STARTER_TURN = 0.45;
/** Each engine's state in the prologue last exposure, to see the moment it catches. */
const prologueEngines: EngineStart[] = ['cold', 'cold', 'cold', 'cold'];
/** Each engine's propeller angle while it is cold or being cranked, by engine number less one. */
const crankAngles = [0, 0, 0, 0];
/** A starting engine's speed on the tachometer while its starter turns it over. */
const CRANKING_SPEED = 0.12;
/** How far No. 3's speed falls on a rough exposure between the hit and its feathering. */
const SPUTTER_DROP = 0.45;

/** Engine speeds from stopped (0) to cruise (1), from whichever of the hardstand, the landing or the mission has the lead. */
function leadEngineSpeeds(state: SortieState): [number, number, number, number] {
  const speedOf = (engine: EngineStart) => (engine === 'running' ? 1 : engine === 'cranking' ? CRANKING_SPEED : 0);
  if (prologueTime !== null) return [speedOf(prologueEngines[0]), speedOf(prologueEngines[1]), speedOf(prologueEngines[2]), speedOf(prologueEngines[3])];
  if (landingShown) return [speedOf(landingEngines[0]), speedOf(landingEngines[1]), 0, speedOf(landingEngines[3])];
  const no3 = state.propellerFeathered ? 0 : state.engineSputtering ? 1 - stopMotion.random() * SPUTTER_DROP : 1;
  return [1, 1, no3, 1];
}

/** What the lead's live instruments read this exposure. */
function instrumentReadings(state: SortieState): InstrumentReadings {
  const aSecondAgo = sortieStateAt(Math.max(state.time - 1, 0));
  return {
    headingDegrees: state.headingDegrees,
    bankRadians: state.bankRadians,
    pitchRadians: state.pitchRadians,
    altitudeFeet: state.altitudeFeet,
    airspeedMph: state.airspeedMph,
    // Over the last second of film, as feet a minute.
    climbFeetPerMinute: (state.altitudeFeet - aSecondAgo.altitudeFeet) * 60,
    engines: leadEngineSpeeds(state),
    // The pilot holds No. 3's button in from the hit until its propeller is feathered.
    featheringEngine: state.engineSputtering ? NO_3_ENGINE : null,
  };
}

/** No. 3, by engine number less one: the engine the flak hit and the pilot feathered. */
const NO_3_ENGINE = 2;
/** Engines the lead has running, for the foley: all four in flight until No. 3 is feathered. */
let leadEnginesRunning = 4;
const HARDSTAND_SHOT = { target: new THREE.Vector3(-10, 0.9, 10), spherical: new THREE.Spherical(13, 1.22, 0.75) };
/**
 * The lead's way down, from off the end of the field: the camera holds here and pans with the ship, which stays more
 * than 22 units off all the way round onto final and down the taxiway.
 */
const LANDING_SHOT = { target: new THREE.Vector3(-2, 1.5, 9), spherical: new THREE.Spherical(24.3, 1.257, -0.087) };
const FORMATION_SHOT = { target: new THREE.Vector3(0.3, 3.9, 0), spherical: new THREE.Spherical(16, 1.36, 0.95) };

/** On load the prologue holds this long first, while the boarding men are still being meshed. */
const PROLOGUE_LOAD_HOLD = 3;

/** The shot the landing's camera is on or moving to, null when the lead is not landing. */
let landingCameraShot: typeof LANDING_SHOT | null = null;
/** The co-pilot's No. 3 figure is in. */
let coPilotReacting = false;
/** The lead is off its stand landing, or on the hardstand after it. */
let landingShown = false;
/** Each engine's state on the landing's last exposure, No. 1 first. */
const landingEngines: EngineStart[] = ['running', 'running', 'running', 'running'];

/**
 * Engines the frame has stopped hold their propellers still where they were left; No. 3, feathered, is posed by the
 * ship's animation.
 */
function holdStoppedPropellers(frame: HardstandFrame, featheredEngine: number | null): void {
  const { aircraft } = formation[0];
  frame.engines.forEach((engine, index) => {
    if (engine === 'running' || index === featheredEngine) return;
    aircraft.propellers[ENGINE_PROPELLER[index]].rotation.x = COLD_PROPELLER_ANGLES[ENGINE_PROPELLER[index]];
  });
}

/** Poses the lead on its way home and on the hardstand, `seconds` after it left its stand, over the formation's pose. */
function stepLanding(seconds: number): void {
  const { aircraft, holder, stand } = formation[0];
  if (!landingShown) {
    landingShown = true;
    hardstand.setShown(true);
    stand.root.visible = false;
  }
  // Panning with the ship until it has stopped, then in close on the pan; a jump back into the landing pans again.
  const shot = seconds >= hardstand.rolledOutSeconds ? HARDSTAND_SHOT : LANDING_SHOT;
  if (shot !== landingCameraShot) {
    landingCameraShot = shot;
    tweenCamera(shot);
  }
  const frame = hardstand.landing(seconds);
  holder.position.copy(frame.position);
  // The camera pans with the ship all the way down and along the taxiway, then moves in once it has stopped.
  // While the camera swings round to its spot it already looks at the ship, so the pan never jumps when it gets there.
  if (seconds < hardstand.rolledOutSeconds) {
    controls.target.copy(frame.position);
    // Aimed now, for this exposure's frame: the orbit controls only re-aim on the next, so the ship would be drawn
    // off-centre and then snap back, a stutter on every exposure.
    camera.lookAt(controls.target);
  }
  holder.rotation.copy(frame.rotation);
  aircraft.landingGear.setExtension(frame.gearExtension);
  aircraft.setHatchesOpen(frame.hatchesOpen);
  holdStoppedPropellers(frame, NO_3_ENGINE);
  setCrewAboard(frame.crewAboard);
  frame.engines.forEach((engine, index) => { landingEngines[index] = engine; });
  leadEnginesRunning = frame.engines.filter((engine) => engine === 'running').length;
}

/** Shows or hides the men inside the lead (the engineer stays hidden in the gunner's view, where the camera is). */
function setCrewAboard(aboard: boolean): void {
  for (const man of formation[0].aircraft.crew) man.mesh.visible = aboard && !(gunnerView && man.mesh === engineerMesh);
}

/** Back in the air from the hardstand: the lead on its stand again, unless the prologue has it. */
function endLanding(): void {
  landingShown = false;
  setCrewAboard(true);
  landingCameraShot = null;
  if (prologueTime !== null) return;
  hardstand.setShown(false);
  formation[0].stand.root.visible = true;
  formation[0].aircraft.landingGear.setExtension(0);
  formation[0].aircraft.setHatchesOpen(0);
  tweenCamera(FORMATION_SHOT);
}

/** Where the camera was when the take-off run began: it dollies from there to the formation shot. */
const takeoffCameraStart = new THREE.Vector3();
const formationCameraPosition = new THREE.Vector3().setFromSpherical(FORMATION_SHOT.spherical).add(FORMATION_SHOT.target);
/** Over the end of the flight, as a fraction of it, the camera's aim settles from the ship onto the formation shot's. */
const TAKEOFF_AIM_SETTLE_FROM = 0.8;

/**
 * Follows the lead from the start of its take-off run until it docks: the camera keeps it in the middle of the frame
 * while it dollies evenly from where it stood to the formation shot, and its aim settles onto that shot's at the end,
 * so the film's own shot takes over without a cut.
 */
function followTakeoff(before: number, time: number, ship: THREE.Vector3): void {
  if (time < PROLOGUE_FLIGHT.from) return;
  if (before < PROLOGUE_FLIGHT.from) {
    cameraTween = null;
    takeoffCameraStart.copy(camera.position);
  }
  const flown = THREE.MathUtils.clamp((time - PROLOGUE_FLIGHT.from) / (PROLOGUE_FLIGHT.to - PROLOGUE_FLIGHT.from), 0, 1);
  camera.position.lerpVectors(takeoffCameraStart, formationCameraPosition, THREE.MathUtils.smootherstep(flown, 0, 1));
  controls.target.copy(ship).lerp(FORMATION_SHOT.target, THREE.MathUtils.smootherstep(flown, TAKEOFF_AIM_SETTLE_FROM, 1));
  camera.lookAt(controls.target);
  cameraMoved = true;
}

function startPrologue(hold = 0): void {
  workbench.arrange(sortiesBegun++);
  setGunnerView(false);
  if (kitTime !== null) setKitBench(false);
  if (show !== 'exterior') setShow('exterior');
  jumpToPhase(0);
  prologueTime = -hold;
  prologueEngines.fill('cold');
  playing = true;
  ui.setPlaying(true);
  hardstand.setShown(true);
  formation[0].stand.root.visible = false;
  for (const man of formation[0].aircraft.crew) man.mesh.visible = false;
  tweenCamera(HARDSTAND_SHOT);
}

function finishPrologue(): void {
  prologueTime = null;
  hardstand.setShown(false);
  formation[0].stand.root.visible = true;
  formation[0].aircraft.landingGear.setExtension(0);
  formation[0].aircraft.setHatchesOpen(0);
  for (const man of formation[0].aircraft.crew) man.mesh.visible = true;
}

/** Poses the lead from the prologue over whatever the formation gave it this exposure. */
function stepPrologue(deltaSec: number): void {
  if (prologueTime === null) return;
  const before = prologueTime;
  prologueTime += deltaSec;
  const frame = hardstand.update(prologueTime);
  const { aircraft, holder } = formation[0];
  holder.position.copy(frame.position);
  holder.rotation.copy(frame.rotation);
  aircraft.landingGear.setExtension(frame.gearExtension);
  aircraft.setHatchesOpen(frame.hatchesOpen);
  for (const man of aircraft.crew) man.mesh.visible = frame.crewAboard;
  frame.engines.forEach((engine, index) => {
    const propeller = ENGINE_PROPELLER[index];
    if (engine === 'cold') crankAngles[index] = COLD_PROPELLER_ANGLES[propeller];
    // The starter turns the propeller over slowly, a blade at a time across a few exposures.
    if (engine === 'cranking' && deltaSec > 0) crankAngles[index] += STARTER_TURN;
    if (engine !== 'running') aircraft.propellers[propeller].rotation.x = crankAngles[index];
    if (engine === 'running' && prologueEngines[index] !== 'running') {
      const cowlFlaps = scratchPosition.copy(aircraft.propellers[propeller].position).add(COUGH_FROM_PROPELLER);
      puffs.emit('cough', aircraft.root.localToWorld(cowlFlaps), false, stopMotion.random);
    }
    prologueEngines[index] = engine;
  });
  leadEnginesRunning = frame.engines.filter((engine) => engine === 'running').length;
  followTakeoff(before, prologueTime, frame.position);
  if (frame.finished) finishPrologue();
}

function tweenCamera(shot: { target: THREE.Vector3; spherical: THREE.Spherical }): void {
  cameraTween = {
    fromTarget: controls.target.clone(), toTarget: shot.target.clone(),
    fromPosition: camera.position.clone(), toPosition: new THREE.Vector3().setFromSpherical(shot.spherical).add(shot.target), progress: 0,
  };
  bumpTripod();
}
let playing = true;

function resetEffects(): void {
  flak.reset();
  puffs.reset();
  bombs.reset();
  strikePoints.length = 0;
  chaff.reset();
  gunnery.resetTracers();
  for (const ship of formation) ship.bombsDropped = 0;
}

function jumpToPhase(index: number): void {
  if (prologueTime !== null && index !== 0) finishPrologue();
  const wrapped = (index + PHASES.length) % PHASES.length;
  sortieTime = PHASES[wrapped].start;
  if (landingShown && sortieStateAt(sortieTime).landingSeconds === null) endLanding();
  resetEffects();
  for (const ship of formation) ship.bombsDropped = sortieStateAt(sortieTime - ship.lag).bombsReleased;
}

let show: ShowMode = 'exterior';

/** Cutaway and exploded are exclusive: opening one closes the other, and each brings its own camera shot. */
function setShow(mode: ShowMode): void {
  if (prologueTime !== null && mode !== 'exterior') finishPrologue();
  if (kitTime !== null && mode !== 'exterior') setKitBench(false);
  if (gunnerView && mode !== 'exterior') setGunnerView(false);
  // The cutaway and the exploded view are of the ship on its stand: from the field it goes back up to the box.
  if (landingShown && mode !== 'exterior') jumpToPhase(0);
  show = mode;
  walkthrough.cancel();
  controls.minDistance = ORBIT_MIN_DISTANCE.outside;
  cutaway.setOpen(mode === 'cutaway');
  exploded.setOpen(mode === 'exploded');
  ui.setShow(mode);
  const shot = mode === 'cutaway' ? CUTAWAY_SHOT : mode === 'exploded' ? EXPLODED_SHOT : null;
  if (!shot) return;
  cameraTween = {
    fromTarget: controls.target.clone(),
    toTarget: shot.target.clone(),
    fromPosition: camera.position.clone(),
    toPosition: new THREE.Vector3().setFromSpherical(shot.spherical).add(shot.target),
    progress: 0,
  };
  bumpTripod();
}

/** Opens the cutaway and walks the camera along the crew's route to the station whose callout was clicked. */
/** The engineer's eye behind the K-3's reflector glass, in the top turret's yaw space, model metres. */
const GUNNER_EYE = new THREE.Vector3(0.1, 0.37, 0);
/** How far along the guns the gunner's view looks, world units: where a fighter comes into the reticle. */
const GUNNER_LOOK_DISTANCE = 12;
let gunnerView = false;
/** Hidden in the gunner's view: the camera is where his head is. */
const engineerMesh = formation[0].aircraft.crew.find(({ station }) => station.member.role === 'Flight engineer')?.mesh ?? null;
const gunnerAhead = new THREE.Vector3();

/** Where this sortie's bombs have burst, for the strike photograph to look down on. */
const strikePoints: THREE.Vector3[] = [];
/** The strike photograph's print size, pixels; the K-21's frame is 4:3 here. */
const STRIKE_PHOTO_SIZE = { width: 640, height: 480 } as const;
const STRIKE_PHOTO_QUALITY = 0.85;
/**
 * Made once: a new framebuffer on the frame the photograph is taken would stall it. Linear, like the film's own
 * targets, so every material draws into it with the shader it already has; the print is gamma-encoded on the way out.
 */
const strikePhotoTarget = new THREE.WebGLRenderTarget(STRIKE_PHOTO_SIZE.width, STRIKE_PHOTO_SIZE.height);
/** Linear 0–255 to sRGB 0–255, for the print. */
const LINEAR_TO_SRGB = Uint8Array.from({ length: 256 }, (_, value) => {
  const linear = value / 255;
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
});
/** The K-21 looks straight down from just under the lead's belly, with this field of view. */
const STRIKE_CAMERA = { fov: 62, belowLead: 0.4, ownBombsWithin: 3 } as const;

/**
 * Takes the strike photograph: a still looking straight down from the lead onto where the bombs have burst, rendered
 * apart from the film's own frame and handed to the UI as a print.
 */
function takeStrikePhoto(): void {
  // The lead's own bombs: those that burst under it, not the wingmen's.
  const lead = formation[0].holder.position;
  const own = strikePoints.filter((point) => Math.hypot(point.x - lead.x, point.z - lead.z) < STRIKE_CAMERA.ownBombsWithin);
  if (own.length === 0) return;
  const centre = own.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(own.length);
  const photoCamera = new THREE.PerspectiveCamera(STRIKE_CAMERA.fov, STRIKE_PHOTO_SIZE.width / STRIKE_PHOTO_SIZE.height, 0.1, 50);
  photoCamera.position.set(centre.x, formation[0].holder.position.y - STRIKE_CAMERA.belowLead, centre.z);
  // Nose of the ship toward the top of the print.
  photoCamera.up.set(1, 0, 0);
  photoCamera.lookAt(centre);
  const previous = renderer.getRenderTarget();
  // The film's frame has just drawn the shadows; the photograph uses them as they are.
  const shadowsDue = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;
  // Taken through a gap in the undercast, from the ship itself: the cloud deck and the lead's stand are lifted out for
  // the photograph, so the bursts show and no rig does.
  const leadStand = formation[0].stand.root;
  const standShown = leadStand.visible;
  set.clouds.visible = false;
  leadStand.visible = false;
  renderer.setRenderTarget(strikePhotoTarget);
  renderer.render(scene, photoCamera);
  set.clouds.visible = true;
  leadStand.visible = standShown;
  renderer.shadowMap.needsUpdate = shadowsDue;
  const pixels = new Uint8Array(STRIKE_PHOTO_SIZE.width * STRIKE_PHOTO_SIZE.height * 4);
  renderer.readRenderTargetPixels(strikePhotoTarget, 0, 0, STRIKE_PHOTO_SIZE.width, STRIKE_PHOTO_SIZE.height, pixels);
  renderer.setRenderTarget(previous);
  const canvas = document.createElement('canvas');
  canvas.width = STRIKE_PHOTO_SIZE.width;
  canvas.height = STRIKE_PHOTO_SIZE.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const image = context.createImageData(STRIKE_PHOTO_SIZE.width, STRIKE_PHOTO_SIZE.height);
  // GL rows run bottom up.
  const row = STRIKE_PHOTO_SIZE.width * 4;
  for (let y = 0; y < STRIKE_PHOTO_SIZE.height; y++) {
    const from = y * row;
    const to = (STRIKE_PHOTO_SIZE.height - 1 - y) * row;
    for (let index = 0; index < row; index += 4) {
      image.data[to + index] = LINEAR_TO_SRGB[pixels[from + index]];
      image.data[to + index + 1] = LINEAR_TO_SRGB[pixels[from + index + 1]];
      image.data[to + index + 2] = LINEAR_TO_SRGB[pixels[from + index + 2]];
      image.data[to + index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  // Encoded off the frame's time: the print is up a moment later.
  canvas.toBlob((blob) => {
    if (blob) ui.setStrikePhoto(URL.createObjectURL(blob));
  }, 'image/jpeg', STRIKE_PHOTO_QUALITY);
}

/** How near the nearest fighter is to the camera and how fast it is closing, or null when none is heard. */
function fighterHeard(deltaSec: number): { distance: number; closing: number } | null {
  if (!fighters.nearest(camera.position, FIGHTER_HEARD_WITHIN, fighterNearest)) {
    lastFighterDistance = null;
    return null;
  }
  const distance = fighterNearest.distanceTo(camera.position);
  const closing = lastFighterDistance === null ? 0 : (lastFighterDistance - distance) / deltaSec;
  lastFighterDistance = distance;
  return { distance, closing };
}

/** Looks out through the top turret's sight, along its guns, with the reticle over the frame; off returns to the box. */
function setGunnerView(on: boolean): void {
  if (on === gunnerView) return;
  if (on && prologueTime !== null) finishPrologue();
  if (on && kitTime !== null) setKitBench(false);
  if (on && show !== 'exterior') setShow('exterior');
  gunnerView = on;
  controls.enabled = !on;
  controls.minDistance = on ? ORBIT_MIN_DISTANCE.inside : ORBIT_MIN_DISTANCE.outside;
  walkthrough.cancel();
  cameraTween = null;
  document.body.classList.toggle('is-gunner', on);
  if (engineerMesh) engineerMesh.visible = !on;
  if (on) placeGunnerCamera();
  else tweenCamera(landingShown ? HARDSTAND_SHOT : FORMATION_SHOT);
  cameraMoved = true;
}

/** Puts the camera at the engineer's eye, looking along the guns as they lie this exposure. */
function placeGunnerCamera(): void {
  const { topTurret } = formation[0].aircraft;
  topTurret.pitch.updateWorldMatrix(true, false);
  topTurret.yaw.localToWorld(camera.position.copy(GUNNER_EYE));
  gunnerAhead.set(1, 0, 0).transformDirection(topTurret.pitch.matrixWorld);
  controls.target.copy(camera.position).addScaledVector(gunnerAhead, GUNNER_LOOK_DISTANCE);
  camera.lookAt(controls.target);
}

function walkToStation(station: CrewStation): void {
  if (show !== 'cutaway') setShow('cutaway');
  cameraTween = null;
  controls.minDistance = ORBIT_MIN_DISTANCE.inside;
  walkthrough.walkTo(station, camera.position, controls.target);
}

const ui = new Ui(uiRoot, {
  onJumpToPhase: jumpToPhase, onViewChange: switchView, onShowChange: setShow, onRecordLog: () => renderLog.start(), onNoseArtChange: setNoseArt, onHardstand: () => startPrologue(), onSoundToggle: () => void setSound(!foley.enabled), onPhoto: takePhoto, onKitBench: () => setKitBench(kitTime === null), onFilmRateChange: setFilmRate, onJitterToggle: () => setJitter(!stopMotion.jitter),
  onTiltShiftChange: setTiltShiftStrength,
  onOnionSkinToggle: () => setOnionSkin(!onionSkinShown),
  onStepFrame: shootFrame,
});
const fpsMeter = new FpsMeter(ui.meterSlot);

/** Switches the animator's hand on or off: uneven spacing, handled models, the tripod bump and gate weave. */
let onionSkinShown = false;
/** Frames the animator asked to shoot while paused, taken one an exposure. */
let framesToShoot = 0;
let framesShot = 0;

function setOnionSkin(shown: boolean): void {
  onionSkinShown = shown;
  onionSkin.setShown(shown);
  ui.setOnionSkin(shown);
  cameraMoved = true;
}

/** Shoots one frame while paused; playing, the film is already being shot. */
function shootFrame(): void {
  if (!playing) framesToShoot += 1;
}

function setTiltShiftStrength(strength: number): void {
  tiltShiftStrength = strength;
  (depthOfField.uCocScale.value as THREE.Vector2).set(MACRO_BLUR.near * strength, MACRO_BLUR.far * strength);
  depthOfField.uMaxCoc.value = Math.min(MACRO_BLUR.max * strength, MAX_REACHABLE_COC);
  ui.setTiltShift(strength);
  cameraMoved = true;
}

function setJitter(on: boolean): void {
  stopMotion.jitter = on;
  ui.setJitter(on);
  if (!on) {
    tripodBump.step = TRIPOD_BUMP_STEPS.length;
    tripodBump.applied.set(0, 0, 0);
    for (const ship of formation) {
      ship.handling.offset.set(0, 0, 0);
      ship.handling.turn.set(0, 0, 0);
    }
  }
}

/** Shoots the film on twos (12 exposures a second) or on ones (24); adaptive quality re-measures at the new rate. */
function setFilmRate(fps: StopMotionRate): void {
  stopMotion.fps = fps;
  fpsMeter.setTargetFps(fps);
  ui.setFilmRate(fps);
  warmupWindows = 2;
  highWindows = 0;
}
ui.setShow('exterior');
setNoseArt('pinup');
applyView('lab');
startPrologue(PROLOGUE_LOAD_HOLD);

addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
  if (event.key === ' ') {
    playing = !playing;
    ui.setPlaying(playing);
    event.preventDefault();
  } else if (event.key === 'ArrowRight') {
    jumpToPhase(sortieStateAt(sortieTime).phaseIndex + 1);
  } else if (event.key === 'ArrowLeft') {
    jumpToPhase(sortieStateAt(sortieTime).phaseIndex - 1);
  } else if (event.key === 'v' || event.key === 'V') {
    switchView(view === 'lab' ? 'studio' : 'lab');
  } else if (event.key === 'c' || event.key === 'C') {
    setShow(show === 'cutaway' ? 'exterior' : 'cutaway');
  } else if (event.key === 'e' || event.key === 'E') {
    setShow(show === 'exploded' ? 'exterior' : 'exploded');
  } else if (event.key === 'n' || event.key === 'N') {
    setNoseArt(noseArt === 'pinup' ? 'card' : 'pinup');
  } else if (event.key === 'o' || event.key === 'O') {
    setOnionSkin(!onionSkinShown);
  } else if (event.key === '.') {
    shootFrame();
  } else if (event.key === 'j' || event.key === 'J') {
    setJitter(!stopMotion.jitter);
  } else if (event.key === 'f' || event.key === 'F') {
    setFilmRate(stopMotion.fps === 12 ? 24 : 12);
  } else if (event.key === 'g' || event.key === 'G') {
    setGunnerView(!gunnerView);
  } else if (event.key === 'k' || event.key === 'K') {
    setKitBench(kitTime === null);
  } else if (event.key === 'p' || event.key === 'P') {
    takePhoto();
  } else if (event.key === 'Escape' && photoMode) {
    leavePhotoMode();
  } else if (event.key === 'm' || event.key === 'M') {
    void setSound(!foley.enabled);
  } else if (event.key === 'h' || event.key === 'H') {
    startPrologue();
  } else if (event.key === 'l' || event.key === 'L') {
    renderLog.start();
  }
});

// Render log: what this machine makes of the scene, saved as JSON to share. Each probe switches one cost off.
const cottonSet = [set.clouds, set.overcast.root, contrails.root, engineSmoke.root, fighterSmoke.root, engineFire.root, puffs.root, flak.root];
const wingmen = formation.slice(1).flatMap((ship) => [ship.holder, ship.stand.root]);
const renderLog = new RenderLog(renderer, {
  context: () => ({
    view, show, phase: sortieStateAt(sortieTime).phase.label, playing, pixelRatio,
    featuresShed: SHEDDABLE_FEATURES.slice(0, featuresShed), qualityPinned,
  }),
  pinQuality,
  probes: [
    { label: 'full quality', apply: () => {}, restore: () => {} },
    {
      label: 'cotton hidden (clouds, contrails, flak)',
      apply: () => cottonSet.forEach((object) => { object.visible = false; }),
      restore: () => cottonSet.forEach((object) => { object.visible = true; }),
    },
    {
      label: 'wingmen hidden',
      apply: () => wingmen.forEach((object) => { object.visible = false; }),
      restore: () => wingmen.forEach((object) => { object.visible = true; }),
    },
    { label: 'shadow map held', apply: () => { shadowMapHeld = true; }, restore: () => { shadowMapHeld = false; } },
    {
      label: 'pixel ratio 1, no reflection, MSAA or AO',
      apply: () => {
        pixelRatio = 1;
        resize();
        applyFeaturesShed(SHEDDABLE_FEATURES.length);
      },
      restore: () => pinQuality(true),
    },
  ],
  onStatus: (text) => ui.setLogStatus(text),
});

// Per-ship animation.

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
/**
 * The rod's ball joint is centred this far below the belly skin, in model metres, so the ball stays outside the hull
 * and never rises through the waist floor above it.
 */
const STAND_JOINT_DROP = STAND_JOINT_RADIUS / MODEL_SCALE - 0.02;
const standMount = new THREE.Vector3(9.0 - STAND_MOUNT_D, hullSectionAt(STAND_MOUNT_D).bottom - STAND_JOINT_DROP, 0);

/** Where No. 3's feathered propeller stops, and how far its blades turn about their length to stand edge-on. */
const FEATHERED_PROPELLER = { restAngle: 0.4, bladeTurn: 1.25 } as const;

/**
 * How fast a gunner slews his turret, radians per second: faster than the A-1A's 33° a second, as a head-on pass
 * crosses the box in a few seconds of film.
 */
const TURRET_SLEW = 1.6;
/** A gunner picks up a fighter inside this range of his turret, world units. */
const FIGHTER_TRACKING_RANGE = 40;
/**
 * How far each turret's guns can be laid: the top turret within its shutters' travel, the ball from the horizon down,
 * the chin either side of the nose.
 */
const TURRET_LIMITS = { topPitch: [0, 0.45], ballPitch: [-1.45, 0], chinYaw: [-1.2, 1.2] } as const;
const scratchTarget = new THREE.Vector3();
const scratchFighter = new THREE.Vector3();

/** Turns `from` toward `to` by at most `step`, the short way round when `wraps`. */
function slew(from: number, to: number, step: number, wraps: boolean): number {
  const difference = wraps ? THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI : to - from;
  return from + THREE.MathUtils.clamp(difference, -step, step);
}

/**
 * Where a turret on `mount` must turn to bear on the fighter nearest it: azimuth about the mount's y and elevation
 * above its horizon, or null when no fighter is in range.
 */
function bearingOnFighter(mount: THREE.Object3D): { azimuth: number; elevation: number } | null {
  mount.getWorldPosition(scratchTarget);
  if (!fighters.nearest(scratchTarget, FIGHTER_TRACKING_RANGE, scratchFighter)) return null;
  const parent = mount.parent;
  if (!parent) return null;
  const local = parent.worldToLocal(scratchFighter).sub(mount.position);
  return { azimuth: Math.atan2(-local.z, local.x), elevation: Math.atan2(local.y, Math.hypot(local.x, local.z)) };
}

/** Each gunner scans his sector until a fighter comes in range, then slews on to it and follows it through. */
function aimTurrets(ship: FormationShip, state: SortieState, elapsed: number, deltaSec: number, wander: number): void {
  const { aircraft } = ship;
  const onRun = state.phase.id === 'bomb-run' || state.phase.id === 'flak-hit' || state.phase.id === 'bombs-away';
  const scan: TurretAim = {
    topYaw: Math.sin(elapsed * 0.31 + wander) * (onRun ? 0.6 : 1.4) + Math.sin(elapsed * 0.83) * 0.2,
    topPitch: 0.12 + Math.sin(elapsed * 0.47 + wander) * 0.1,
    ballYaw: elapsed * 0.35 + wander,
    ballPitch: -0.35 + Math.sin(elapsed * 0.29 + wander) * 0.3,
    chinYaw: onRun ? 0 : Math.sin(elapsed * 0.4 + wander) * 0.45,
  };
  const aim = ship.turretAim ??= { ...scan };
  const top = bearingOnFighter(aircraft.topTurret.yaw);
  const ball = bearingOnFighter(aircraft.ballTurret.yaw);
  const chin = bearingOnFighter(aircraft.chinTurret);
  const target: TurretAim = {
    topYaw: top?.azimuth ?? scan.topYaw,
    topPitch: THREE.MathUtils.clamp(top?.elevation ?? scan.topPitch, ...TURRET_LIMITS.topPitch),
    ballYaw: ball?.azimuth ?? scan.ballYaw,
    ballPitch: THREE.MathUtils.clamp(ball?.elevation ?? scan.ballPitch, ...TURRET_LIMITS.ballPitch),
    chinYaw: THREE.MathUtils.clamp(chin?.azimuth ?? scan.chinYaw, ...TURRET_LIMITS.chinYaw),
  };
  const step = TURRET_SLEW * deltaSec;
  aim.topYaw = slew(aim.topYaw, target.topYaw, step, true);
  aim.topPitch = slew(aim.topPitch, target.topPitch, step, false);
  aim.ballYaw = slew(aim.ballYaw, target.ballYaw, step, true);
  aim.ballPitch = slew(aim.ballPitch, target.ballPitch, step, false);
  aim.chinYaw = slew(aim.chinYaw, target.chinYaw, step, false);
  aircraft.topTurret.yaw.rotation.y = aim.topYaw;
  aircraft.topTurret.pitch.rotation.z = aim.topPitch;
  aircraft.ballTurret.yaw.rotation.y = aim.ballYaw;
  aircraft.ballTurret.pitch.rotation.z = aim.ballPitch;
  aircraft.chinTurret.rotation.y = aim.chinYaw;
}

function animateShip(ship: FormationShip, state: SortieState, elapsed: number, deltaSec: number, shipIndex: number): void {
  const { aircraft, holder } = ship;
  const damaged = shipIndex === 0;
  // Each ship holds its own slightly different station in the box.
  const wander = shipIndex * 1.7;
  holder.rotation.set(
    state.bankRadians + Math.sin(elapsed * 0.7 + wander) * 0.01 * shipIndex,
    0,
    state.pitchRadians + Math.sin(elapsed * 0.5 + wander) * 0.006 * shipIndex,
    'YZX',
  );
  holder.position.y = formationSlots[shipIndex].position.y + Math.sin(elapsed * 0.6 + wander) * 0.04;
  // A held frame is the same pose exactly; only a frame the animator moved picks up his hand's error and a new
  // propeller angle (a stop-motion prop strobes from pose to pose, it never blurs).
  if (deltaSec > 0) {
    const random = stopMotion.random;
    const hand = stopMotion.jitter ? 1 : 0;
    ship.handling.offset.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(2 * HANDLING.offset * hand);
    ship.handling.turn.set((random() - 0.5) * 2 * HANDLING.turn * hand, (random() - 0.5) * 2 * HANDLING.turn * hand, (random() - 0.5) * 2 * HANDLING.turn * hand);
    for (const propeller of aircraft.propellers) {
      if (propeller === aircraft.battleDamage.propeller && damaged && state.propellerFeathered) continue;
      propeller.rotation.x = random() * Math.PI * 2;
    }
  }
  // Each ship's holes show from its flak hit (Nine-O-Nine has none). Only the lead's No. 3 is hit: oil streaks build
  // back from it, and its propeller stops with its blades turned edge-on to the air.
  for (const hole of aircraft.battleDamage.holes) hole.visible = state.flakHit;
  const { streaks } = aircraft.battleDamage;
  for (const streak of streaks.meshes) streak.visible = damaged && state.oilStreaks > 0;
  if (damaged) streaks.material.opacity = state.oilStreaks;
  const feathered = damaged && state.propellerFeathered;
  if (feathered) aircraft.battleDamage.propeller.rotation.x = FEATHERED_PROPELLER.restAngle;
  for (const blade of aircraft.battleDamage.propeller.children) {
    if (blade.userData.blade) blade.rotation.y = feathered ? FEATHERED_PROPELLER.bladeTurn : 0;
  }
  holder.position.x = formationSlots[shipIndex].position.x + ship.handling.offset.x;
  holder.position.y += ship.handling.offset.y;
  holder.position.z = formationSlots[shipIndex].position.z + ship.handling.offset.z;
  holder.rotation.x += ship.handling.turn.x;
  holder.rotation.y += ship.handling.turn.y;
  holder.rotation.z += ship.handling.turn.z;

  aimTurrets(ship, state, elapsed, deltaSec, wander);

  const doorAngle = state.bayDoors * THREE.MathUtils.degToRad(84);
  for (const door of aircraft.bombBayDoors) door.hinge.rotation.x = door.side * doorAngle;

  // Bombs leave the racks bottom tier first, alternating sides, and fall from where they hung.
  while (ship.bombsDropped < state.bombsReleased) {
    const racked = aircraft.rackedBombs[ship.bombsDropped];
    racked.getWorldPosition(scratchPosition);
    racked.getWorldQuaternion(scratchQuaternion);
    bombs.release(scratchPosition, scratchQuaternion, MODEL_SCALE);
    ship.bombsDropped += 1;
  }
  aircraft.rackedBombs.forEach((bomb, index) => { bomb.visible = index >= ship.bombsDropped; });

  // The stand holds the waist section, and follows it when the lead ship is exploded.
  ship.stand.aimAt(aircraft.assemblies.get(fuselageSectionAt(STAND_MOUNT_D)).localToWorld(scratchPosition.copy(standMount)));

  aircraft.turboGlow.color.setRGB(1.0, 0.54, 0.24).multiplyScalar(2.3 + Math.sin(elapsed * 23) * 0.15 + Math.sin(elapsed * 37) * 0.1);
  aircraft.exhaustPorts.forEach((port, index) => {
    const world = port.getWorldPosition(ship.exhaustWorld[index]);
    const light = ship.turboLights[index];
    if (light) light.position.copy(world);
  });
}

// Adaptive quality: pixel ratio, then reflection, then MSAA, then AO; probe back up when there is headroom.

/** Features shed after the pixel ratio is down to 1, in this order; `featuresShed` counts how many are off. */
const SHEDDABLE_FEATURES = ['reflection', 'multisampling', 'ambientOcclusion'] as const;
const FULL_MULTISAMPLES = pipeline.sceneTarget.samples;
/** Steady windows before probing back up; doubled after every failed probe, so a transient dip never locks quality off. */
const ADAPTIVE_PROBE_WINDOWS = 3;
const ADAPTIVE_PROBE_WINDOWS_MAX = 48;

let pixelRatio = renderer.getPixelRatio();
const pixelRatioCeiling = Math.min(devicePixelRatio, 2);
let featuresShed = 0;
let adaptiveElapsed = 0;
let adaptiveFrames = 0;
let warmupWindows = 2;
let highWindows = 0;
let probeWindows = ADAPTIVE_PROBE_WINDOWS;
let probing = false;
let qualityPinned = false;
let lastAdaptiveFps = 0;
/** Holds the shadow map still for the render log's shadow probe. */
let shadowMapHeld = false;

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipeline.resize(innerWidth, innerHeight, pixelRatio);
  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  floorReflection.setSize(drawingBuffer.x, drawingBuffer.y);
}
addEventListener('resize', resize);
resize();
setFilmRate(12);
setJitter(true);
ui.setFramesShot(framesShot);

// Photo mode: the film stops on the frame, the overlays step aside, and each press of P saves the frame re-rendered at
// several times the screen's resolution with every quality feature back on.

/** The still's pixels per CSS pixel, before the GPU's largest texture caps it. */
const PHOTO_PIXEL_RATIO = 3;
let photoMode = false;
let playingBeforePhoto = true;

function takePhoto(): void {
  if (!photoMode) {
    photoMode = true;
    playingBeforePhoto = playing;
    playing = false;
    ui.setPlaying(false);
    document.body.classList.add('is-photo');
  }
  const shed = featuresShed;
  applyFeaturesShed(0);
  const ratio = Math.min(PHOTO_PIXEL_RATIO, renderer.capabilities.maxTextureSize / Math.max(innerWidth, innerHeight));
  pipeline.resize(innerWidth, innerHeight, ratio);
  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  floorReflection.setSize(drawingBuffer.x, drawingBuffer.y);
  renderer.shadowMap.needsUpdate = true;
  floorReflection.render(renderer, scene, camera, focusPoint);
  pipeline.composer.render(0);
  // Read straight after drawing, before the browser may clear the drawing buffer.
  const link = document.createElement('a');
  link.download = `b17-sortie-${drawingBuffer.x}x${drawingBuffer.y}.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
  applyFeaturesShed(shed);
  resize();
  cameraMoved = true;
}

function leavePhotoMode(): void {
  photoMode = false;
  document.body.classList.remove('is-photo');
  playing = playingBeforePhoto;
  ui.setPlaying(playing);
}

function applyFeaturesShed(count: number): void {
  featuresShed = count;
  const isShed = (feature: (typeof SHEDDABLE_FEATURES)[number]): boolean => SHEDDABLE_FEATURES.indexOf(feature) < count;
  reflectionQualityEnabled = !isShed('reflection');
  floorReflection.uniforms.uReflectionStrength.value = reflectionQualityEnabled ? VIEW_PRESETS[view].reflection : 0;
  const samples = isShed('multisampling') ? 0 : FULL_MULTISAMPLES;
  if (pipeline.sceneTarget.samples !== samples) {
    pipeline.sceneTarget.samples = samples;
    pipeline.sceneTarget.dispose();
  }
  pipeline.ambientOcclusion.enabled = !isShed('ambientOcclusion');
}

function lowerQuality(): void {
  renderLog.note('quality lowered', { fps: Math.round(lastAdaptiveFps), pixelRatio, featuresShed });
  if (pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - PIXEL_RATIO_STEP);
    resize();
  } else if (featuresShed < SHEDDABLE_FEATURES.length) {
    applyFeaturesShed(featuresShed + 1);
  }
}

/** Raises quality one step, features first; false when already at full quality. */
function raiseQuality(): boolean {
  if (featuresShed > 0) {
    applyFeaturesShed(featuresShed - 1);
  } else if (pixelRatio < pixelRatioCeiling) {
    pixelRatio = Math.min(pixelRatioCeiling, pixelRatio + PIXEL_RATIO_STEP);
    resize();
  } else {
    return false;
  }
  renderLog.note('quality raised', { fps: Math.round(lastAdaptiveFps), pixelRatio, featuresShed });
  return true;
}

/** Full quality at the starting pixel ratio, with adaptation off: a fixed workload to measure frame cost against. */
function pinQuality(pinned: boolean): void {
  qualityPinned = pinned;
  if (!pinned) return;
  pixelRatio = initialPixelRatio();
  resize();
  applyFeaturesShed(0);
}

function stepAdaptiveQuality(deltaSec: number): void {
  if (document.hidden || qualityPinned) return;
  adaptiveElapsed += deltaSec;
  adaptiveFrames += 1;
  if (adaptiveElapsed < ADAPTIVE_WINDOW_SECONDS) return;
  const fps = adaptiveFrames / adaptiveElapsed;
  lastAdaptiveFps = fps;
  adaptiveElapsed = 0;
  adaptiveFrames = 0;
  if (warmupWindows > 0) {
    warmupWindows -= 1;
    return;
  }
  if (probing) {
    probing = false;
    if (fps < stopMotion.fps - ADAPTIVE_LOW_MARGIN) {
      probeWindows = Math.min(ADAPTIVE_PROBE_WINDOWS_MAX, probeWindows * 2);
      lowerQuality();
      return;
    }
    probeWindows = ADAPTIVE_PROBE_WINDOWS;
  }
  if (fps < stopMotion.fps - ADAPTIVE_LOW_MARGIN) {
    highWindows = 0;
    lowerQuality();
    return;
  }
  highWindows = fps >= stopMotion.fps - ADAPTIVE_HIGH_MARGIN ? highWindows + 1 : 0;
  if (highWindows >= probeWindows) {
    highWindows = 0;
    probing = raiseQuality();
  }
}

const flakZone = {
  centre: new THREE.Vector3(4, 4.4, -2.5),
  minimumDistance: 4.2,
  halfExtents: new THREE.Vector3(9, 3.2, 7),
};

const timer = new THREE.Timer();
timer.connect(document);

/** The film's own clock: it stops while paused and on held frames, so everything posed from it holds with them. */
let filmTime = 0;
/** The camera moved since the last drawn frame: a drag or a scroll draws at once, between exposures. */
let cameraMoved = true;
controls.addEventListener('change', () => { cameraMoved = true; });
setTiltShiftStrength(TILT_SHIFT_STRENGTH.initial);
let lastDrawnAt = 0;

/**
 * One stop-motion exposure of the whole film: the sortie, the formation, the guns and the cotton set all advance by
 * the exposure's time, `deltaSec` while playing, nothing while paused (the shot holds, but the cutaway and the
 * exploded view still move, as an animator would move them).
 */
function exposeFrame(exposureSec: number): void {
  // The ship's flights on and off its stand are charted: spaced evenly, never held, as an animator plans a fast move.
  stopMotion.charted = prologueTime !== null || landingShown;
  // Paused, the animator can still shoot one frame at a time: each moves the film one exposure, evenly.
  const shootingOne = !playing && framesToShoot > 0;
  if (shootingOne) framesToShoot -= 1;
  const deltaSec = playing ? stopMotion.space(exposureSec) : shootingOne ? 1 / stopMotion.fps : 0;
  // A held frame is still a frame shot: the counter runs while the film does.
  if (playing || shootingOne) ui.setFramesShot(++framesShot);
  filmTime += deltaSec;
  const previousTime = sortieTime;
  // The sortie holds at the start of the cruise while the lead is still on the hardstand; after the debrief the crew
  // board again for the next mission.
  if (prologueTime === null) sortieTime += deltaSec;
  if (sortieTime >= SORTIE_LOOP_SECONDS) startPrologue();
  if (sortieTime < previousTime) resetEffects();
  const leadState = sortieStateAt(sortieTime);
  exploded.update(exposureSec);

  fighters.update(leadState.time, deltaSec, stopMotion.random);
  formation.forEach((ship, index) => {
    const state = index === 0 ? leadState : sortieStateAt(Math.max(sortieTime - ship.lag, 0));
    if (state.bombsReleased < ship.bombsDropped) ship.bombsDropped = state.bombsReleased;
    animateShip(ship, state, filmTime, deltaSec, index);
    gunnery.updateShip(index, state.time, state.gunfire, deltaSec);
  });
  gunnery.update(deltaSec, AIR_DRIFT_SPEED);
  if (prologueTime !== null) stepPrologue(deltaSec);
  else if (leadState.landingSeconds !== null && kitTime === null) stepLanding(leadState.landingSeconds);
  // While No. 3 burns the co-pilot's replacement figure is in, holding its feathering button and looking out at it.
  const reacting = leadState.engineFire > 0;
  if (reacting !== coPilotReacting) {
    coPilotReacting = reacting;
    for (const { calm, reacting: figure } of formation[0].aircraft.crewReactions) {
      calm.visible = !reacting;
      figure.mesh.visible = reacting;
    }
  }
  const nextMissionBomb = formation[0].aircraft.nextMissionBomb;
  if (nextMissionBomb) nextMissionBomb.visible = leadState.tallyAdded;
  stepKitBench(deltaSec);

  if (deltaSec > 0) setCottonFrame(stopMotion.frame);
  driftClouds(set.clouds, deltaSec, CLOUD_DRIFT_SPEED, stopMotion.random);
  // Posed every exposure, held or not, so a jump while paused finds the overcast where it should be.
  set.overcast.pose(sortieTime, CLOUD_DRIFT_SPEED, stopMotion.random, deltaSec > 0);
  for (const ship of formation) ship.aircraft.setGlassMist(set.overcast.mistAt(ship.holder.position.y, sortieTime));
  flak.update(deltaSec, leadState.flakRate, AIR_DRIFT_SPEED, flakZone);
  bombs.update(deltaSec);
  formation.forEach((ship, index) => ship.aircraft.root.localToWorld(chaffChutesWorld[index].copy(chaffChute)));
  chaff.update(deltaSec, AIR_DRIFT_SPEED, chaffChutesWorld, leadState.chaffing, stopMotion.random);
  const bombBursts = bombs.takeImpacts();
  for (const impact of bombBursts) puffs.emit('bombBurst', impact, false, stopMotion.random);
  strikePoints.push(...bombBursts);
  if (previousTime < STRIKE_PHOTO.at && sortieTime >= STRIKE_PHOTO.at) takeStrikePhoto();
  const fighterSmoking = fighters.smoke(fighterSmokeEmitter[0]);
  fighterSmoke.update(deltaSec, AIR_DRIFT_SPEED, fighterSmokeEmitter, stopMotion.random, fighterSmoking);
  const crash = fighters.takeCrash();
  if (crash) puffs.emit('crash', crash, false, stopMotion.random);
  ui.update(leadState);

  formation[0].holder.updateMatrixWorld(true);
  cutaway.update(exposureSec);
  // The panel is only seen with the ship opened up; its face is redrawn and uploaded on those exposures alone.
  if (deltaSec > 0 && (cutaway.amount > 0 || exploded.amount > 0)) updateInstrumentPanel(instrumentReadings(leadState));
  updateLeadCabinShadows();
  updateCabinBulbs();
  // No trails while the lead is on the ground or climbing out; the box forms up behind it.
  contrails.update(deltaSec, AIR_DRIFT_SPEED, contrailEmitters, stopMotion.random, prologueTime === null && kitTime === null && !landingShown && leadState.contrailing);
  const damage = formation[0].aircraft.battleDamage;
  damage.smokePort.getWorldPosition(engineSmokeEmitter[0]);
  engineSmoke.update(deltaSec, AIR_DRIFT_SPEED, engineSmokeEmitter, stopMotion.random, leadState.engineSmoking);
  engineFire.update(deltaSec, leadState.engineFire, engineSmokeEmitter[0], stopMotion.random);
  if (previousTime < EXTINGUISHER_SECONDS && sortieTime >= EXTINGUISHER_SECONDS) {
    // The CO2 bottle fires into No. 3: a white cloud bursts out of its cowl flaps and is carried aft.
    puffs.emit('extinguisher', engineSmokeEmitter[0], true, stopMotion.random);
    puffs.emit('extinguisher', scratchPosition.copy(engineSmokeEmitter[0]).add(EXTINGUISHER_SECOND_PUFF), true, stopMotion.random);
  }
  puffs.update(deltaSec, AIR_DRIFT_SPEED);
  if (previousTime < FLAK_HIT_SECONDS && sortieTime >= FLAK_HIT_SECONDS) flak.burstAt(damage.burstPoint.getWorldPosition(scratchPosition));
  if (deltaSec > 0) {
    flickerLamps();
    onionSkin.markExposure();
    filmGate.advance(stopMotion.random, stopMotion.jitter);
    const leadEngines = prologueTime !== null || landingShown ? leadEnginesRunning : leadState.propellerFeathered ? 3 : 4;
    foley.expose({
      enginesRunning: leadEngines, sputtering: leadState.engineSputtering, fire: leadState.engineFire,
      gunfire: leadState.gunfire, flakBursts: flak.takeBurstCount(),
      fighter: fighterHeard(deltaSec), fighterGuns: fighters.firing, bombBursts: bombBursts.length, crashed: crash !== null,
    }, stopMotion.random);
  }
  renderer.shadowMap.needsUpdate = !shadowMapHeld;
}

/**
 * The film runs at the stop-motion rate: a frame is drawn on each exposure and held between them. Only the viewer's
 * own camera is live, so a drag never waits for the next exposure.
 */
function frame(timestamp: number): void {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const exposureSec = stopMotion.advance(Math.min(timer.getDelta(), MAX_FRAME_SEC));
  if (exposureSec > 0) stepCameraTween(exposureSec);
  if (exposureSec > 0 && walkthrough.active) {
    walkthrough.step(exposureSec, camera.position, controls.target);
    cameraMoved = true;
  }
  liftTripodBump();
  // In the gunner's view the camera rides the turret: it moves on exposures, never between them.
  if (!gunnerView) controls.update();
  applyTripodBump(exposureSec > 0);
  if (exposureSec === 0 && !cameraMoved) return;
  cameraMoved = false;

  renderLog.beginFrame();
  const drawnSec = lastDrawnAt === 0 ? exposureSec : (timestamp - lastDrawnAt) / 1000;
  lastDrawnAt = timestamp;
  fpsMeter.record(drawnSec);
  if (exposureSec > 0) exposeFrame(exposureSec);
  if (gunnerView) placeGunnerCamera();

  if (camera.position.y < 0.4) camera.position.y = 0.4;
  focusPoint.copy(controls.target);
  updateWingmanCabins();
  // Stronger than the macro look also narrows the band in focus, as a wider aperture would.
  depthOfField.uFocusRange.value = THREE.MathUtils.lerp(FOCUS_RANGE.exterior, FOCUS_RANGE.cutaway, Math.max(cutaway.amount, exploded.amount)) / Math.max(tiltShiftStrength, 1);
  depthOfField.uFocusDistance.value = camera.position.distanceTo(controls.target);
  callouts.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(cutaway.amount, 0.6, 1), BOMB_COUNT - formation[0].bombsDropped);
  assemblyCallouts.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(exploded.amount, 0.6, 1), BOMB_COUNT - formation[0].bombsDropped);
  hotspots.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(cutaway.amount, 0.6, 1));

  stepAdaptiveQuality(drawnSec);
  floorReflection.render(renderer, scene, camera, focusPoint);
  pipeline.composer.render(drawnSec);
  renderLog.endFrame(drawnSec);
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    b17Debug: {
      THREE, renderer, scene, camera, controls, formation, cutaway, gunnery, fighters, renderLog, jumpToPhase, switchView, setShow, exploded, pinQuality,
      setPlaying: (value: boolean) => { playing = value; },
      setGunnerView,
      seek: (time: number) => { sortieTime = time; },
      /** Every man is meshed: his figure is built in a worker and arrives after load. */
      crewMeshed: () => formation.every(({ aircraft }) => [...aircraft.crew, ...aircraft.crewReactions.map(({ reacting }) => reacting)].every(({ mesh }) => mesh.geometry.getAttribute('position')?.count > 0)),
      audit: () => runAudits(formation[0].aircraft, formation[1].aircraft),
    },
  });
}

/** Side of the scratch target the warm-up frames are drawn into. */
const WARM_UP_TARGET_SIZE = 64;

/**
 * Draws one throwaway frame of everything, hidden or out of shot (the fighters, the hardstand, flak, the kit bench), with
 * its shadows, so every shader and shadow variant is compiled before the film starts rather than on an exposure the
 * first time something is seen.
 */
function warmUpShaders(): void {
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (!object.visible) hidden.push(object);
    if (object.frustumCulled) culled.push(object);
  });
  for (const object of hidden) object.visible = true;
  for (const object of culled) object.frustumCulled = false;
  const target = new THREE.WebGLRenderTarget(WARM_UP_TARGET_SIZE, WARM_UP_TARGET_SIZE);
  renderer.setRenderTarget(target);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  target.dispose();
  for (const object of hidden) object.visible = false;
  for (const object of culled) object.frustumCulled = true;
}

// In both views: each lights and reflects the set differently.
applyView('studio');
warmUpShaders();
applyView('lab');
warmUpShaders();
requestAnimationFrame(frame);
ui.hideLoading();
