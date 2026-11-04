import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setCottonFrame } from './render/miniature';
import {
  addVirtualLight, bakeEnvironments, createStudioPipeline, initialPixelRatio, metalMaterial, PlanarReflection, setSaturation,
  type VirtualLight,
} from './render/studio';
import { buildB17, createBomb, type B17 } from './scene/b17';
import { Cutaway } from './scene/cutaway';
import { BombTrain, Contrails, FlakField } from './scene/effects';
import { Gunnery } from './scene/gunnery';
import { PALETTE } from './scene/palette';
import { STOP_MOTION_FPS, StopMotionClock } from './scene/stop-motion';
import { RenderLog } from './render/render-log';
import { FilmGatePass } from './render/film-gate';
import { buildDisplayStand, buildStudioSet, buildWorkshop, driftClouds, type DisplayStand } from './scene/set';
import { BOMB_COUNT, PHASES, SORTIE_LOOP_SECONDS, sortieStateAt, type SortieState } from './sortie';
import { Callouts } from './ui/callouts';
import { FpsMeter } from './ui/fps-meter';
import { Ui, type ShowMode, type ViewMode } from './ui/ui';
import { ExplodedView } from './scene/exploded';
import { fuselageSectionAt } from './scene/assemblies';

/** World units per metre: the 22.66 m fuselage becomes a 7.3-unit model. */
const MODEL_SCALE = 0.32;
/** Ground speed of the air mass past the formation, in world units per second. Slowed down so the eye can follow it. */
const AIR_DRIFT_SPEED = 2.4;
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
const ADAPTIVE_LOW_FPS = STOP_MOTION_FPS - 1;
const ADAPTIVE_HIGH_FPS = STOP_MOTION_FPS - 0.5;
const ADAPTIVE_PROBE_FAIL_FPS = STOP_MOTION_FPS - 1;
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

const floorReflection = new PlanarReflection(0);
const set = buildStudioSet(floorReflection);
scene.add(set.lab, set.sweep, set.clouds, buildWorkshop());
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
}

const formationSlots = [
  { position: new THREE.Vector3(0, 3.6, 0), lag: 0, plaque: { title: 'B-17G FLYING FORTRESS', subtitle: '91st BG · 322nd BS · LG-K' } },
  { position: new THREE.Vector3(-7.5, 5.3, -7.2), lag: 0.45, plaque: null },
  { position: new THREE.Vector3(-9.0, 2.3, -1.2), lag: 0.8, plaque: null },
];

const formation: FormationShip[] = formationSlots.map((slot, index) => {
  const aircraft = buildB17({ crewDetail: index === 0 ? 'high' : 'low', opensUp: index === 0 });
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
  return { aircraft, holder, base, stand, lag: slot.lag, bombsDropped: 0, turboLights, exhaustWorld, handling: { offset: new THREE.Vector3(), turn: new THREE.Euler() } };
});
const contrailEmitters = formation.flatMap((ship) => ship.exhaustWorld);
const flak = new FlakField();
const contrails = new Contrails(contrailEmitters.length);
const stopMotion = new StopMotionClock();
const bombs = new BombTrain(createBomb, 1.0);
const gunnery = new Gunnery(MODEL_SCALE);
for (const ship of formation) gunnery.addShip(ship.aircraft.root, ship.aircraft.guns);
scene.add(flak.root, contrails.root, bombs.root, gunnery.root);

// Cutaway of the lead ship: the starboard skin peels back to show the crew at their stations.
const cutaway = new Cutaway(formation[0].aircraft);
const callouts = new Callouts(calloutRoot, formation[0].aircraft.root, formation[0].aircraft.crewStations);
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

const focusPoint = new THREE.Vector3();
const pipeline = createStudioPipeline(renderer, scene, camera, focusPoint);
const depthOfField = pipeline.depthOfField.uniforms;
depthOfField.uFocusRange.value = FOCUS_RANGE.exterior;
(depthOfField.uCocScale.value as THREE.Vector2).set(4.4, 2.4);
const filmGate = new FilmGatePass();
pipeline.composer.addPass(filmGate);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 6;
controls.maxDistance = 40;
controls.maxPolarAngle = 1.72;
controls.target.set(0.3, 3.9, 0);
camera.position.setFromSpherical(new THREE.Spherical(16, 1.36, 0.95)).add(controls.target);
controls.update();

interface CameraTween { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPosition: THREE.Vector3; toPosition: THREE.Vector3; progress: number }
let cameraTween: CameraTween | null = null;
controls.addEventListener('start', () => {
  cameraTween = null;
  bumpTripod();
});

/**
 * A tripod knocked as a camera move begins: over the next exposures the camera jolts off and settles back, each step a
 * fraction of its distance to the target, the way a hand on the head shakes a set camera.
 */
const TRIPOD_BUMP_STEPS = [0.006, -0.003, 0.0012, 0];
const tripodBump = { step: TRIPOD_BUMP_STEPS.length, direction: new THREE.Vector3(), applied: new THREE.Vector3() };

function bumpTripod(): void {
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

// Playback.

let sortieTime = 0;
let playing = true;

function resetEffects(): void {
  flak.reset();
  bombs.reset();
  gunnery.resetTracers();
  for (const ship of formation) ship.bombsDropped = 0;
}

function jumpToPhase(index: number): void {
  const wrapped = (index + PHASES.length) % PHASES.length;
  sortieTime = PHASES[wrapped].start;
  resetEffects();
  for (const ship of formation) ship.bombsDropped = sortieStateAt(sortieTime - ship.lag).bombsReleased;
}

let show: ShowMode = 'exterior';

/** Cutaway and exploded are exclusive: opening one closes the other, and each brings its own camera shot. */
function setShow(mode: ShowMode): void {
  show = mode;
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

const ui = new Ui(uiRoot, { onJumpToPhase: jumpToPhase, onViewChange: switchView, onShowChange: setShow, onRecordLog: () => renderLog.start() });
const fpsMeter = new FpsMeter(ui.meterSlot);
ui.setShow('exterior');
applyView('lab');

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
  } else if (event.key === 'l' || event.key === 'L') {
    renderLog.start();
  }
});

// Render log: what this machine makes of the scene, saved as JSON to share. Each probe switches one cost off.
const cottonSet = [set.clouds, contrails.root, flak.root];
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
const standMount = new THREE.Vector3(9.0 - STAND_MOUNT_D, -1.22, 0);

function animateShip(ship: FormationShip, state: SortieState, elapsed: number, deltaSec: number, shipIndex: number): void {
  const { aircraft, holder } = ship;
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
    ship.handling.offset.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(2 * HANDLING.offset);
    ship.handling.turn.set((random() - 0.5) * 2 * HANDLING.turn, (random() - 0.5) * 2 * HANDLING.turn, (random() - 0.5) * 2 * HANDLING.turn);
    for (const propeller of aircraft.propellers) propeller.rotation.x = random() * Math.PI * 2;
  }
  holder.position.x = formationSlots[shipIndex].position.x + ship.handling.offset.x;
  holder.position.y += ship.handling.offset.y;
  holder.position.z = formationSlots[shipIndex].position.z + ship.handling.offset.z;
  holder.rotation.x += ship.handling.turn.x;
  holder.rotation.y += ship.handling.turn.y;
  holder.rotation.z += ship.handling.turn.z;

  const onRun = state.phase.id === 'bomb-run' || state.phase.id === 'bombs-away';
  aircraft.topTurret.yaw.rotation.y = Math.sin(elapsed * 0.31 + wander) * (onRun ? 0.6 : 1.4) + Math.sin(elapsed * 0.83) * 0.2;
  aircraft.topTurret.pitch.rotation.z = 0.12 + Math.sin(elapsed * 0.47 + wander) * 0.1;
  aircraft.ballTurret.yaw.rotation.y = elapsed * 0.35 + wander;
  aircraft.ballTurret.pitch.rotation.z = -0.35 + Math.sin(elapsed * 0.29 + wander) * 0.3;
  aircraft.chinTurret.rotation.y = onRun ? 0 : Math.sin(elapsed * 0.4 + wander) * 0.45;

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
    if (fps < ADAPTIVE_PROBE_FAIL_FPS) {
      probeWindows = Math.min(ADAPTIVE_PROBE_WINDOWS_MAX, probeWindows * 2);
      lowerQuality();
      return;
    }
    probeWindows = ADAPTIVE_PROBE_WINDOWS;
  }
  if (fps < ADAPTIVE_LOW_FPS) {
    highWindows = 0;
    lowerQuality();
    return;
  }
  highWindows = fps >= ADAPTIVE_HIGH_FPS ? highWindows + 1 : 0;
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
let lastDrawnAt = 0;

/**
 * One stop-motion exposure of the whole film: the sortie, the formation, the guns and the cotton set all advance by
 * the exposure's time, `deltaSec` while playing, nothing while paused (the shot holds, but the cutaway and the
 * exploded view still move, as an animator would move them).
 */
function exposeFrame(exposureSec: number): void {
  const deltaSec = playing ? stopMotion.space(exposureSec) : 0;
  filmTime += deltaSec;
  const previousTime = sortieTime;
  sortieTime = (sortieTime + deltaSec) % SORTIE_LOOP_SECONDS;
  if (sortieTime < previousTime) resetEffects();
  const leadState = sortieStateAt(sortieTime);
  exploded.update(exposureSec);

  formation.forEach((ship, index) => {
    const state = index === 0 ? leadState : sortieStateAt(Math.max(sortieTime - ship.lag, 0));
    if (state.bombsReleased < ship.bombsDropped) ship.bombsDropped = state.bombsReleased;
    animateShip(ship, state, filmTime, deltaSec, index);
    gunnery.updateShip(index, state.time, state.gunfire, deltaSec);
  });
  gunnery.update(deltaSec, AIR_DRIFT_SPEED);

  if (deltaSec > 0) setCottonFrame(stopMotion.frame);
  driftClouds(set.clouds, deltaSec, AIR_DRIFT_SPEED * 0.45, stopMotion.random);
  flak.update(deltaSec, leadState.flakRate, AIR_DRIFT_SPEED, flakZone);
  bombs.update(deltaSec);
  ui.update(leadState);

  formation[0].holder.updateMatrixWorld(true);
  cutaway.update(exposureSec);
  updateLeadCabinShadows();
  contrails.update(deltaSec, AIR_DRIFT_SPEED, contrailEmitters, stopMotion.random);
  if (deltaSec > 0) {
    flickerLamps();
    filmGate.advance(stopMotion.random);
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
  liftTripodBump();
  controls.update();
  applyTripodBump(exposureSec > 0);
  if (exposureSec === 0 && !cameraMoved) return;
  cameraMoved = false;

  renderLog.beginFrame();
  const drawnSec = lastDrawnAt === 0 ? exposureSec : (timestamp - lastDrawnAt) / 1000;
  lastDrawnAt = timestamp;
  fpsMeter.record(drawnSec);
  if (exposureSec > 0) exposeFrame(exposureSec);

  if (camera.position.y < 0.4) camera.position.y = 0.4;
  focusPoint.copy(controls.target);
  updateWingmanCabins();
  depthOfField.uFocusRange.value = THREE.MathUtils.lerp(FOCUS_RANGE.exterior, FOCUS_RANGE.cutaway, Math.max(cutaway.amount, exploded.amount));
  depthOfField.uFocusDistance.value = camera.position.distanceTo(controls.target);
  callouts.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(cutaway.amount, 0.6, 1), BOMB_COUNT - formation[0].bombsDropped);
  assemblyCallouts.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(exploded.amount, 0.6, 1), BOMB_COUNT - formation[0].bombsDropped);

  stepAdaptiveQuality(drawnSec);
  floorReflection.render(renderer, scene, camera, focusPoint);
  pipeline.composer.render(drawnSec);
  renderLog.endFrame(drawnSec);
}

if (import.meta.env.DEV) {
  Object.assign(window, { b17Debug: { THREE, renderer, scene, camera, controls, formation, cutaway, gunnery, jumpToPhase, switchView, setShow, exploded, pinQuality, setPlaying: (value: boolean) => { playing = value; } } });
}

requestAnimationFrame(frame);
ui.hideLoading();
