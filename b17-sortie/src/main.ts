import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  addVirtualLight, bakeEnvironments, createStudioPipeline, initialPixelRatio, metalMaterial, PlanarReflection, setSaturation,
  type VirtualLight,
} from './render/studio';
import { buildB17, createBomb, type B17 } from './scene/b17';
import { Cutaway } from './scene/cutaway';
import { BombTrain, Contrails, FlakField } from './scene/effects';
import { Gunnery } from './scene/gunnery';
import { PALETTE } from './scene/palette';
import { buildDisplayStand, buildStudioSet, driftClouds, type DisplayStand } from './scene/set';
import { BOMB_COUNT, PHASES, SORTIE_LOOP_SECONDS, sortieStateAt, type SortieState } from './sortie';
import { Callouts } from './ui/callouts';
import { Ui, type ViewMode } from './ui/ui';

/** World units per metre: the 22.66 m fuselage becomes a 7.3-unit model. */
const MODEL_SCALE = 0.32;
/** Ground speed of the air mass past the formation, in world units per second. Slowed down so the eye can follow it. */
const AIR_DRIFT_SPEED = 2.4;
/** The stand rod meets the belly just aft of the ball turret, clear of the bomb bay and the falling bombs. */
const STAND_MOUNT_D = 12.7;
const MAX_FRAME_SEC = 0.1;
/** Propeller speed as the eye reads it under a fast shutter: a strobed, slow turn over the blurred disc. */
const PROPELLER_DISPLAY_RATE = Math.PI * 2 * 0.85;
const ADAPTIVE_WINDOW_SECONDS = 1.6;
const ADAPTIVE_LOW_FPS = 50;
const ADAPTIVE_LOW_RATIO = 0.74;
const ADAPTIVE_HIGH_FPS = 58;
const ADAPTIVE_PROBE_FAIL_FPS = 55;
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
scene.add(set.lab, set.sweep, set.clouds);
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
}

const formationSlots = [
  { position: new THREE.Vector3(0, 3.6, 0), lag: 0, plaque: { title: 'B-17G FLYING FORTRESS', subtitle: '91st BG · 322nd BS · LG-K' } },
  { position: new THREE.Vector3(-7.5, 5.3, -7.2), lag: 0.45, plaque: null },
  { position: new THREE.Vector3(-9.0, 2.3, -1.2), lag: 0.8, plaque: null },
];

const formation: FormationShip[] = formationSlots.map((slot, index) => {
  const aircraft = buildB17(index === 0 ? 'high' : 'low');
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
  const exhaustWorld = aircraft.exhaustPorts.map((port) => holder.localToWorld(port.clone()));
  return { aircraft, holder, base, stand, lag: slot.lag, bombsDropped: 0, turboLights, exhaustWorld };
});
const contrailEmitters = formation.flatMap((ship) => ship.exhaustWorld);
const flak = new FlakField();
const contrails = new Contrails(contrailEmitters.length);
const bombs = new BombTrain(createBomb, 1.0);
const gunnery = new Gunnery(MODEL_SCALE);
for (const ship of formation) gunnery.addShip(ship.aircraft.root, ship.aircraft.guns);
scene.add(flak.root, contrails.mesh, bombs.root, gunnery.root);

// Cutaway of the lead ship: the starboard skin peels back to show the crew at their stations.
const cutaway = new Cutaway(formation[0].aircraft);
const callouts = new Callouts(calloutRoot, formation[0].aircraft.root, formation[0].aircraft.crewStations);
const CUTAWAY_SHOT = { target: new THREE.Vector3(0.2, 3.65, 0), spherical: new THREE.Spherical(11.5, 1.0, 0.2) };
const CAMERA_TWEEN_SECONDS = 1.3;
const FOCUS_RANGE = { exterior: 4.2, cutaway: 6.0 } as const;

const focusPoint = new THREE.Vector3();
const pipeline = createStudioPipeline(renderer, scene, camera, focusPoint);
const depthOfField = pipeline.depthOfField.uniforms;
depthOfField.uFocusRange.value = FOCUS_RANGE.exterior;
(depthOfField.uCocScale.value as THREE.Vector2).set(2.2, 1.1);

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
controls.addEventListener('start', () => { cameraTween = null; });

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
  setSaturation(preset.saturation);
  set.lab.visible = next === 'lab';
  set.sweep.visible = next === 'studio';
  set.practicalLights.forEach((light, index) => { light.intensity = next === 'lab' ? practicalIntensities[index] : 0; });
  contrails.setStudioMode(next === 'studio');
  document.body.classList.toggle('is-studio', next === 'studio');
  ui.setView(next);
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

function setCutawayOpen(open: boolean): void {
  cutaway.setOpen(open);
  ui.setCutaway(open);
  if (!open) return;
  cameraTween = {
    fromTarget: controls.target.clone(),
    toTarget: CUTAWAY_SHOT.target.clone(),
    fromPosition: camera.position.clone(),
    toPosition: new THREE.Vector3().setFromSpherical(CUTAWAY_SHOT.spherical).add(CUTAWAY_SHOT.target),
    progress: 0,
  };
}

const ui = new Ui(uiRoot, { onJumpToPhase: jumpToPhase, onViewChange: switchView, onCutawayChange: setCutawayOpen });
ui.setCutaway(false);
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
    setCutawayOpen(!cutaway.isOpen);
  }
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

  for (const propeller of aircraft.propellers) propeller.rotation.x += PROPELLER_DISPLAY_RATE * deltaSec;

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
    holder.getWorldQuaternion(scratchQuaternion);
    bombs.release(scratchPosition, scratchQuaternion, MODEL_SCALE);
    ship.bombsDropped += 1;
  }
  aircraft.rackedBombs.forEach((bomb, index) => { bomb.visible = index >= ship.bombsDropped; });

  ship.stand.aimAt(holder.localToWorld(scratchPosition.copy(standMount)));

  aircraft.turboGlow.color.setRGB(1.0, 0.54, 0.24).multiplyScalar(2.3 + Math.sin(elapsed * 23) * 0.15 + Math.sin(elapsed * 37) * 0.1);
  aircraft.exhaustPorts.forEach((port, index) => {
    const world = holder.localToWorld(ship.exhaustWorld[index].copy(port));
    const light = ship.turboLights[index];
    if (light) light.position.copy(world);
  });
}

// Adaptive quality: pixel ratio, then reflection, then MSAA, then AO; probe back up when there is headroom.

let pixelRatio = renderer.getPixelRatio();
let pixelRatioCeiling = Math.min(devicePixelRatio, 2);
let adaptiveElapsed = 0;
let adaptiveFrames = 0;
let bestFps = 0;
let warmupWindows = 2;
let highWindows = 0;
let probing = false;

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipeline.resize(innerWidth, innerHeight, pixelRatio);
  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  floorReflection.setSize(drawingBuffer.x, drawingBuffer.y);
}
addEventListener('resize', resize);
resize();

function stepAdaptiveQuality(deltaSec: number): void {
  if (document.hidden) return;
  adaptiveElapsed += deltaSec;
  adaptiveFrames += 1;
  if (adaptiveElapsed < ADAPTIVE_WINDOW_SECONDS) return;
  const fps = adaptiveFrames / adaptiveElapsed;
  adaptiveElapsed = 0;
  adaptiveFrames = 0;
  if (warmupWindows > 0) {
    warmupWindows -= 1;
    return;
  }
  if (probing) {
    probing = false;
    if (fps < ADAPTIVE_PROBE_FAIL_FPS) {
      pixelRatioCeiling = pixelRatio - PIXEL_RATIO_STEP;
      pixelRatio = pixelRatioCeiling;
      resize();
      return;
    }
  }
  bestFps = Math.max(bestFps, fps);
  if (fps < bestFps * ADAPTIVE_LOW_RATIO && fps < ADAPTIVE_LOW_FPS) {
    highWindows = 0;
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - PIXEL_RATIO_STEP);
      resize();
    } else if (reflectionQualityEnabled) {
      reflectionQualityEnabled = false;
      floorReflection.uniforms.uReflectionStrength.value = 0;
    } else if (pipeline.sceneTarget.samples > 0) {
      pipeline.sceneTarget.samples = 0;
      pipeline.sceneTarget.dispose();
    } else {
      pipeline.ambientOcclusion.enabled = false;
    }
    return;
  }
  highWindows = fps >= ADAPTIVE_HIGH_FPS ? highWindows + 1 : 0;
  if (highWindows >= 3 && pixelRatio < pixelRatioCeiling) {
    highWindows = 0;
    probing = true;
    pixelRatio = Math.min(pixelRatioCeiling, pixelRatio + PIXEL_RATIO_STEP);
    resize();
  }
}

const flakZone = {
  centre: new THREE.Vector3(4, 4.4, -2.5),
  minimumDistance: 4.2,
  halfExtents: new THREE.Vector3(9, 3.2, 7),
};

const timer = new THREE.Timer();
timer.connect(document);

function frame(timestamp: number): void {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const realDelta = Math.min(timer.getDelta(), MAX_FRAME_SEC);
  const deltaSec = playing ? realDelta : 0;
  const elapsed = timer.getElapsed();

  const previousTime = sortieTime;
  sortieTime = (sortieTime + deltaSec) % SORTIE_LOOP_SECONDS;
  if (sortieTime < previousTime) resetEffects();
  const leadState = sortieStateAt(sortieTime);

  formation.forEach((ship, index) => {
    const state = index === 0 ? leadState : sortieStateAt(Math.max(sortieTime - ship.lag, 0));
    if (state.bombsReleased < ship.bombsDropped) ship.bombsDropped = state.bombsReleased;
    animateShip(ship, state, playing ? elapsed : 0, deltaSec, index);
    gunnery.updateShip(index, state.time, state.gunfire, deltaSec);
  });
  gunnery.update(deltaSec, AIR_DRIFT_SPEED);

  driftClouds(set.clouds, deltaSec, AIR_DRIFT_SPEED * 0.45);
  flak.update(deltaSec, leadState.flakRate, AIR_DRIFT_SPEED, flakZone);
  bombs.update(deltaSec);
  ui.update(leadState);

  stepCameraTween(realDelta);
  controls.update();
  if (camera.position.y < 0.4) camera.position.y = 0.4;
  focusPoint.copy(controls.target);
  formation[0].holder.updateMatrixWorld(true);
  cutaway.update(realDelta);
  depthOfField.uFocusRange.value = THREE.MathUtils.lerp(FOCUS_RANGE.exterior, FOCUS_RANGE.cutaway, cutaway.amount);
  depthOfField.uFocusDistance.value = camera.position.distanceTo(controls.target);
  callouts.update(camera, innerWidth, innerHeight, THREE.MathUtils.smoothstep(cutaway.amount, 0.6, 1), BOMB_COUNT - formation[0].bombsDropped);
  contrails.update(deltaSec, AIR_DRIFT_SPEED, contrailEmitters, camera.position);

  renderer.shadowMap.needsUpdate = true;
  stepAdaptiveQuality(realDelta);
  floorReflection.render(renderer, scene, camera, focusPoint);
  pipeline.composer.render(realDelta);
}

if (import.meta.env.DEV) {
  Object.assign(window, { b17Debug: { THREE, renderer, scene, camera, controls, formation, cutaway, gunnery, jumpToPhase, switchView, setCutawayOpen, setPlaying: (value: boolean) => { playing = value; } } });
}

requestAnimationFrame(frame);
ui.hideLoading();
