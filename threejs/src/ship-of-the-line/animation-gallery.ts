import "./animation-gallery.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ANIMATION_DURATION, ANIMATION_SPACING, ANIMATION_PREVIEWS,
  ANIMATION_TASK_COVERAGE, ANIMATION_LOCOMOTION_COVERAGE,
  createAnimationPreviewCrew, sampleAnimationPreview,
  type AnimationPreview,
} from "./animation-gallery-data";
import {
  CrewAnimator, MAX_ELBOW_FLEXION,
  type ArmPose, type CrewAnimationState,
} from "./crew-animation";
import type { CrewLocomotion, CrewMember, CrewTask } from "./types";

type DirectionView = "front" | "left" | "right" | "back";
type JointSide = "left" | "right";

interface GalleryState {
  time: number;
  playing: boolean;
  rate: number;
  view: DirectionView;
  overlay: boolean;
  query: string;
  group: string;
  isolate: string | null;
  focus: string | null;
}

interface CardEls {
  flexion: Record<JointSide, HTMLElement>;
  warn: Record<JointSide, HTMLElement>;
  readout: HTMLElement;
  permalink: HTMLAnchorElement;
  focusButton: HTMLButtonElement;
  isolateButton: HTMLButtonElement;
}

interface Card {
  readonly preview: AnimationPreview;
  readonly crew: CrewMember;
  readonly id: number;
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly lastAnchor: THREE.Vector3;
  readonly leftPose: ArmPose;
  readonly rightPose: ArmPose;
  readonly overlayLines: THREE.LineSegments;
  readonly overlayPoints: THREE.Points;
  readonly linePositions: Float32Array;
  readonly lineColors: Float32Array;
  readonly pointPositions: Float32Array;
  readonly pointColors: Float32Array;
  readonly els: CardEls;
}

const RATE_OPTIONS = [0.1, 0.25, 0.5, 1, 1.5, 2] as const;
const FRAME = 1 / 60;
const DEFAULT_DISTANCE = 3;
const CHEST_HEIGHT = 0.95;
const BG_COLOR = 0x0b1d24;
const OK_COLOR = new THREE.Color(0x8fe0c9);
const WARN_COLOR = new THREE.Color(0xff6a5a);
const PREVIEW_HALF_WIDTH = 2.4;
const PREVIEW_HALF_DEPTH = 2.4;
const PREVIEW_MIN_HEIGHT = -.4;
const PREVIEW_MAX_HEIGHT = 2.3;
const VIEW_OFFSETS: Record<DirectionView, THREE.Vector3> = {
  front: new THREE.Vector3(0, .55, 2.6).normalize(),
  back: new THREE.Vector3(0, .55, -2.6).normalize(),
  left: new THREE.Vector3(-2.6, .55, 0).normalize(),
  right: new THREE.Vector3(2.6, .55, 0).normalize(),
};

const previews = ANIMATION_PREVIEWS;
const previewIds = new Set(previews.map((p) => p.id));
const groups = Array.from(new Set(previews.map((p) => p.group)));

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(time: number): string {
  const clamped = Math.max(0, time);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function isFlagged(flexion: number): boolean {
  return flexion < -0.001 || flexion > MAX_ELBOW_FLEXION + 0.001;
}

const state: GalleryState = {
  time: 0, playing: true, rate: 1, view: "front", overlay: false,
  query: "", group: "all", isolate: null, focus: null,
};

function readInitialState(): void {
  const params = new URLSearchParams(location.search);
  const t = Number(params.get("t"));
  if (Number.isFinite(t)) state.time = THREE.MathUtils.clamp(t, 0, ANIMATION_DURATION);
  const rate = Number(params.get("rate"));
  if ((RATE_OPTIONS as readonly number[]).includes(rate)) state.rate = rate;
  const view = params.get("view");
  if (view === "front" || view === "left" || view === "right" || view === "back") state.view = view;
  state.overlay = params.get("overlay") === "1";
  state.query = params.get("q") ?? "";
  const group = params.get("group");
  if (group && groups.includes(group as AnimationPreview["group"])) state.group = group;
  const clip = params.get("clip");
  state.isolate = clip && previewIds.has(clip) ? clip : null;
  const focus = params.get("focus");
  state.focus = focus && previewIds.has(focus) ? focus : null;
  state.playing = params.has("paused") ? params.get("paused") !== "1" : !params.has("t");
}
readInitialState();

const emblem = `<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M22 3v27M11 13h23M8 25h29M22 5L10 23h11M25 8l9 14h-9M4 30h36l-8 9H14L4 30Z" stroke="currentColor" stroke-width="1.3"/><path d="M8 42q5-4 10 0t10 0t10 0" stroke="currentColor"/></svg>`;

function cardMarkup(preview: AnimationPreview): string {
  return `
    <article class="card" id="card-${preview.id}" data-id="${preview.id}">
      <div class="card-head">
        <div class="card-head-text">
          <h3>${escapeHtml(preview.label)}</h3>
          <div class="card-chips">
            <span class="chip chip-group">${escapeHtml(preview.group)}</span>
            <span class="chip">${escapeHtml(preview.role)}</span>
            <span class="chip">${escapeHtml(preview.task)}</span>
            <span class="chip">${escapeHtml(preview.locomotion)}</span>
          </div>
        </div>
        <div class="card-head-actions">
          <button type="button" class="icon-btn" data-action="focus" title="Enlarge this clip" aria-label="Enlarge this clip" aria-pressed="false">⤢</button>
          <button type="button" class="icon-btn" data-action="isolate" title="Show only this clip" aria-label="Show only this clip" aria-pressed="false">⊙</button>
        </div>
      </div>
      <div class="card-stage" data-stage>
        <div class="stage-readout" data-readout aria-hidden="true"></div>
      </div>
      <p class="card-desc">${escapeHtml(preview.description)}</p>
      <div class="card-diagnostics">
        <div class="joint-row" data-side="left"><span class="joint-label">Left elbow</span><strong data-flexion>—</strong><span class="joint-warn" data-warn hidden></span></div>
        <div class="joint-row" data-side="right"><span class="joint-label">Right elbow</span><strong data-flexion>—</strong><span class="joint-warn" data-warn hidden></span></div>
      </div>
      <div class="card-foot">
        <a class="permalink" data-permalink href="?clip=${preview.id}" title="Shareable link to this clip, time, and view">Link to this pose ↗</a>
      </div>
    </article>`;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <canvas id="gallery-canvas"></canvas>
  <header class="gallery-header">
    <a class="back-link" href="../">${emblem}<span>← Back to the ship</span></a>
    <div class="title-block">
      <span class="eyebrow">THE WOODEN WALL · HMS RESOLUTE</span>
      <h1>Animation review gallery</h1>
      <p class="subtitle">Every catalog motion, animated with the live crew rig, for pose and elbow-flexion review independent of the ship simulation.</p>
    </div>
  </header>
  <section class="toolbar" aria-label="Playback and filter controls">
    <div class="toolbar-group transport">
      <button id="play-pause" type="button" title="Play or pause (Space)" aria-pressed="false">Pause</button>
      <button id="step-back" type="button" title="Step back one frame (1/60s)">⟨</button>
      <input id="scrub" type="range" min="0" max="${ANIMATION_DURATION}" step="${FRAME}" value="0" aria-label="Clip time in seconds" />
      <button id="step-forward" type="button" title="Step forward one frame (1/60s)">⟩</button>
      <span id="time-readout" class="time-readout">0:00.000</span>
      <button id="reset-time" type="button" title="Reset to the start">Reset</button>
      <label class="rate-select"><span class="sr-only">Playback speed</span><select id="rate" aria-label="Playback speed"></select></label>
    </div>
    <div class="toolbar-group views" role="group" aria-label="Camera view presets">
      <span class="toolbar-label">VIEW</span>
      <button data-view="front" type="button">Front</button>
      <button data-view="left" type="button">Left</button>
      <button data-view="right" type="button">Right</button>
      <button data-view="back" type="button">Back</button>
      <button id="toggle-overlay" type="button" aria-pressed="false" title="Show shoulder/elbow/wrist markers from the live rig">Joint overlay</button>
    </div>
    <div class="toolbar-group filters">
      <input id="search" type="search" placeholder="Search label, role, task…" aria-label="Search clips" />
      <select id="group-filter" aria-label="Filter by group"></select>
      <span id="visible-count" class="visible-count">0 / 0</span>
    </div>
  </section>
  <div id="isolate-banner" class="isolate-banner" role="status" hidden>
    Showing only <strong data-isolate-label></strong> · <button id="clear-isolate" type="button" class="text-link">Show all clips</button>
  </div>
  <details class="coverage-panel">
    <summary>Task &amp; locomotion coverage</summary>
    <div id="coverage-body" class="coverage-body"></div>
  </details>
  <main id="gallery" class="gallery" aria-label="Animation clip cards">
    ${previews.map(cardMarkup).join("")}
  </main>
`;

const canvas = document.getElementById("gallery-canvas") as HTMLCanvasElement;
const galleryEl = document.getElementById("gallery") as HTMLElement;
const playPauseBtn = document.getElementById("play-pause") as HTMLButtonElement;
const stepBackBtn = document.getElementById("step-back") as HTMLButtonElement;
const stepForwardBtn = document.getElementById("step-forward") as HTMLButtonElement;
const scrubEl = document.getElementById("scrub") as HTMLInputElement;
const timeReadoutEl = document.getElementById("time-readout") as HTMLElement;
const resetBtn = document.getElementById("reset-time") as HTMLButtonElement;
const rateSelect = document.getElementById("rate") as HTMLSelectElement;
const overlayBtn = document.getElementById("toggle-overlay") as HTMLButtonElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const groupSelect = document.getElementById("group-filter") as HTMLSelectElement;
const visibleCountEl = document.getElementById("visible-count") as HTMLElement;
const isolateBanner = document.getElementById("isolate-banner") as HTMLElement;
const isolateLabelEl = isolateBanner.querySelector("[data-isolate-label]") as HTMLElement;
const clearIsolateBtn = document.getElementById("clear-isolate") as HTMLButtonElement;
const coverageBody = document.getElementById("coverage-body") as HTMLElement;
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));

rateSelect.innerHTML = RATE_OPTIONS.map((r) => `<option value="${r}">${r}×${r < 1 ? " slow" : ""}</option>`).join("");
rateSelect.value = String(state.rate);
groupSelect.innerHTML = `<option value="all">All groups</option>${groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("")}`;
groupSelect.value = state.group;
searchEl.value = state.query;
scrubEl.value = state.time.toFixed(6);
overlayBtn.setAttribute("aria-pressed", String(state.overlay));
overlayBtn.classList.toggle("active", state.overlay);

function renderCoverage(): void {
  const tasks = Object.entries(ANIMATION_TASK_COVERAGE) as [CrewTask, string][];
  const locomotions = Object.entries(ANIMATION_LOCOMOTION_COVERAGE) as [CrewLocomotion, string][];
  coverageBody.innerHTML = `
    <div class="coverage-column">
      <h4>${tasks.length} tasks demonstrated</h4>
      <ul>${tasks.map(([task, id]) => `<li><a href="#card-${id}">${escapeHtml(task)}</a></li>`).join("")}</ul>
    </div>
    <div class="coverage-column">
      <h4>${locomotions.length} locomotion states demonstrated</h4>
      <ul>${locomotions.map(([loco, id]) => `<li><a href="#card-${id}">${escapeHtml(loco)}</a></li>`).join("")}</ul>
    </div>
    <p class="coverage-note">Elbow flexion is read live from the rendered rig each frame; this list only confirms every task and locomotion state has a demonstrating clip, not that every pose aspect is correct.</p>`;
}
renderCoverage();

// --- Scene setup: one renderer, one scene, every catalog actor spaced along x. ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG_COLOR);
scene.add(new THREE.AmbientLight(0xe2e8ed, 1.1));
const sun = new THREE.DirectionalLight(0xfff3df, 2.5);
sun.position.set(6, 14, 8);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc9e2ee, 0x8d8170, 1.4));

const crewRoot = new THREE.Group();
scene.add(crewRoot);
const animator = new CrewAnimator(crewRoot, previews.length);

const crews: CrewMember[] = previews.map((preview, index) => createAnimationPreviewCrew(preview, index));
const animState: CrewAnimationState = { time: state.time, crew: crews };

for (let i = 0; i < previews.length; i++) {
  const preview = previews[i];
  const grid = new THREE.GridHelper(ANIMATION_SPACING * 0.92, 6, 0x3c5c63, 0x24414a);
  grid.position.set(i * ANIMATION_SPACING, preview.elevation ?? 0, 0);
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.35;
  scene.add(grid);
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
// Isolate the current actor without duplicating renderers or the instanced crew meshes.
const previewClips = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0)), new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
  new THREE.Plane(new THREE.Vector3(0, 1, 0)), new THREE.Plane(new THREE.Vector3(0, -1, 0)),
  new THREE.Plane(new THREE.Vector3(0, 0, 1)), new THREE.Plane(new THREE.Vector3(0, 0, -1)),
];
renderer.clippingPlanes = previewClips;

const tmpAnchor = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();
const linkedCamera = new THREE.Spherical();

function anchorOf(card: Card, out: THREE.Vector3): THREE.Vector3 {
  return out.set(card.crew.position.x, card.crew.position.y + CHEST_HEIGHT, card.crew.position.z);
}

function applyDirection(card: Card, view: DirectionView, distance: number): void {
  const damping = card.controls.enableDamping;
  card.controls.enableDamping = false;
  card.controls.update();
  card.controls.enableDamping = damping;
  anchorOf(card, tmpAnchor);
  card.camera.position.copy(tmpAnchor).addScaledVector(VIEW_OFFSETS[view], distance);
  card.controls.target.copy(tmpAnchor);
  card.controls.update();
}

function createOverlay(): {
  lines: THREE.LineSegments; points: THREE.Points;
  linePositions: Float32Array; lineColors: Float32Array;
  pointPositions: Float32Array; pointColors: Float32Array;
} {
  const linePositions = new Float32Array(8 * 3);
  const lineColors = new Float32Array(8 * 3);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  lines.visible = false;

  const pointPositions = new Float32Array(6 * 3);
  const pointColors = new Float32Array(6 * 3);
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
  pointGeometry.setAttribute("color", new THREE.BufferAttribute(pointColors, 3));
  const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ vertexColors: true, size: 0.05, sizeAttenuation: true, depthTest: false, depthWrite: false }));
  points.frustumCulled = false;
  points.renderOrder = 11;
  points.visible = false;

  return { lines, points, linePositions, lineColors, pointPositions, pointColors };
}

function createCard(preview: AnimationPreview, crew: CrewMember, id: number): Card {
  const root = document.getElementById(`card-${preview.id}`) as HTMLElement;
  const stage = root.querySelector("[data-stage]") as HTMLElement;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 200);
  const controls = new OrbitControls(camera, stage);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 0.6;
  controls.maxDistance = 7;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.7;

  const overlay = createOverlay();
  scene.add(overlay.lines);
  scene.add(overlay.points);

  const card: Card = {
    preview, crew, id, root, stage, camera, controls,
    lastAnchor: new THREE.Vector3(),
    leftPose: { shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), flexion: 0 },
    rightPose: { shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), flexion: 0 },
    overlayLines: overlay.lines,
    overlayPoints: overlay.points,
    linePositions: overlay.linePositions,
    lineColors: overlay.lineColors,
    pointPositions: overlay.pointPositions,
    pointColors: overlay.pointColors,
    els: {
      flexion: {
        left: root.querySelector('[data-side="left"] [data-flexion]') as HTMLElement,
        right: root.querySelector('[data-side="right"] [data-flexion]') as HTMLElement,
      },
      warn: {
        left: root.querySelector('[data-side="left"] [data-warn]') as HTMLElement,
        right: root.querySelector('[data-side="right"] [data-warn]') as HTMLElement,
      },
      readout: root.querySelector("[data-readout]") as HTMLElement,
      permalink: root.querySelector("[data-permalink]") as HTMLAnchorElement,
      focusButton: root.querySelector('[data-action="focus"]') as HTMLButtonElement,
      isolateButton: root.querySelector('[data-action="isolate"]') as HTMLButtonElement,
    },
  };
  anchorOf(card, card.lastAnchor);
  applyDirection(card, state.view, DEFAULT_DISTANCE);
  controls.addEventListener("change", () => {
    if (state.playing) return;
    updateCardPermalink(card);
  });
  return card;
}

const cards: Card[] = previews.map((preview, i) => createCard(preview, crews[i], i));
const cardsById = new Map(cards.map((c) => [c.preview.id, c]));

const cameraParams = new URLSearchParams(location.search);
const linkedCard = cardsById.get(state.isolate ?? state.focus ?? "");
const azimuth = Number(cameraParams.get("azimuth"));
const polar = Number(cameraParams.get("polar"));
const distance = Number(cameraParams.get("distance"));
if (linkedCard && cameraParams.has("azimuth") && cameraParams.has("polar") && cameraParams.has("distance")
  && Number.isFinite(azimuth) && Number.isFinite(polar) && Number.isFinite(distance)) {
  linkedCamera.set(
    THREE.MathUtils.clamp(distance, linkedCard.controls.minDistance, linkedCard.controls.maxDistance),
    THREE.MathUtils.clamp(polar, .001, Math.PI - .001), azimuth);
  tmpDelta.setFromSpherical(linkedCamera);
  linkedCard.camera.position.copy(linkedCard.controls.target).add(tmpDelta);
  linkedCard.controls.update();
}

if (state.focus) setFocus(state.focus, false);

function setVec3(arr: Float32Array, i: number, v: THREE.Vector3): void {
  arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
}
function setColor3(arr: Float32Array, i: number, c: THREE.Color): void {
  arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
}

function writeJoint(card: Card, side: JointSide, pose: ArmPose): string {
  const degrees = pose.flexion * (180 / Math.PI);
  const flagged = isFlagged(pose.flexion);
  card.els.flexion[side].textContent = `${degrees.toFixed(0)}°`;
  card.els.flexion[side].classList.toggle("flagged", flagged);
  card.els.warn[side].hidden = !flagged;
  card.els.warn[side].textContent = flagged ? (pose.flexion < 0 ? "⚠ backwards" : "⚠ over limit") : "";
  return `${side === "left" ? "L" : "R"} ${degrees.toFixed(0)}°${flagged ? "⚠" : ""}`;
}

function updateCardDiagnostics(card: Card): void {
  animator.readArmPose(card.id, "left", card.leftPose);
  animator.readArmPose(card.id, "right", card.rightPose);
  const leftSummary = writeJoint(card, "left", card.leftPose);
  const rightSummary = writeJoint(card, "right", card.rightPose);
  card.els.readout.textContent = `${leftSummary} · ${rightSummary}`;

  const leftColor = isFlagged(card.leftPose.flexion) ? WARN_COLOR : OK_COLOR;
  const rightColor = isFlagged(card.rightPose.flexion) ? WARN_COLOR : OK_COLOR;
  const lp = card.linePositions, lc = card.lineColors;
  setVec3(lp, 0, card.leftPose.shoulder); setVec3(lp, 1, card.leftPose.elbow);
  setVec3(lp, 2, card.leftPose.elbow); setVec3(lp, 3, card.leftPose.wrist);
  setVec3(lp, 4, card.rightPose.shoulder); setVec3(lp, 5, card.rightPose.elbow);
  setVec3(lp, 6, card.rightPose.elbow); setVec3(lp, 7, card.rightPose.wrist);
  for (let i = 0; i < 4; i++) setColor3(lc, i, leftColor);
  for (let i = 4; i < 8; i++) setColor3(lc, i, rightColor);
  card.overlayLines.geometry.attributes.position.needsUpdate = true;
  card.overlayLines.geometry.attributes.color.needsUpdate = true;

  const pp = card.pointPositions, pc = card.pointColors;
  setVec3(pp, 0, card.leftPose.shoulder); setVec3(pp, 1, card.leftPose.elbow); setVec3(pp, 2, card.leftPose.wrist);
  setVec3(pp, 3, card.rightPose.shoulder); setVec3(pp, 4, card.rightPose.elbow); setVec3(pp, 5, card.rightPose.wrist);
  for (let i = 0; i < 3; i++) setColor3(pc, i, leftColor);
  for (let i = 3; i < 6; i++) setColor3(pc, i, rightColor);
  card.overlayPoints.geometry.attributes.position.needsUpdate = true;
  card.overlayPoints.geometry.attributes.color.needsUpdate = true;
}

function updateCardFollow(card: Card): void {
  anchorOf(card, tmpAnchor);
  tmpDelta.copy(tmpAnchor).sub(card.lastAnchor);
  if (tmpDelta.lengthSq() > 1e-10) {
    card.camera.position.add(tmpDelta);
    card.controls.target.add(tmpDelta);
    card.lastAnchor.copy(tmpAnchor);
  }
  card.controls.update();
}

// --- Filtering ---
function matchesFilter(card: Card): boolean {
  if (state.isolate) return card.preview.id === state.isolate;
  if (state.group !== "all" && card.preview.group !== state.group) return false;
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  const haystack = `${card.preview.label} ${card.preview.description} ${card.preview.role} ${card.preview.task} ${card.preview.locomotion} ${card.preview.group}`.toLowerCase();
  return haystack.includes(q);
}
function applyFilters(): void {
  let visible = 0;
  for (const card of cards) {
    const match = matchesFilter(card);
    card.root.hidden = !match;
    if (match) visible++;
  }
  visibleCountEl.textContent = `${visible} / ${cards.length}`;
  isolateBanner.hidden = !state.isolate;
  if (state.isolate) isolateLabelEl.textContent = cardsById.get(state.isolate)?.preview.label ?? state.isolate;
  for (const card of cards) card.els.isolateButton.setAttribute("aria-pressed", String(state.isolate === card.preview.id));
}

// --- URL state ---
function buildParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set("t", String(state.time));
  p.set("rate", String(state.rate));
  p.set("view", state.view);
  p.set("overlay", state.overlay ? "1" : "0");
  if (state.query) p.set("q", state.query);
  if (state.group !== "all") p.set("group", state.group);
  if (state.isolate) p.set("clip", state.isolate);
  if (state.focus) p.set("focus", state.focus);
  p.set("paused", state.playing ? "0" : "1");
  const card = cardsById.get(state.isolate ?? state.focus ?? "");
  if (card) appendCameraParams(p, card);
  return p;
}
function syncUrl(): void {
  history.replaceState(null, "", `${location.pathname}?${buildParams().toString()}`);
}
function appendCameraParams(params: URLSearchParams, card: Card): void {
  tmpDelta.copy(card.camera.position).sub(card.controls.target);
  linkedCamera.setFromVector3(tmpDelta);
  params.set("azimuth", String(linkedCamera.theta));
  params.set("polar", String(linkedCamera.phi));
  params.set("distance", String(linkedCamera.radius));
}

function updateCardPermalink(card: Card): void {
  const params = new URLSearchParams();
  params.set("clip", card.preview.id);
  params.set("t", String(state.time));
  params.set("view", state.view);
  params.set("overlay", state.overlay ? "1" : "0");
  appendCameraParams(params, card);
  card.els.permalink.href = `?${params.toString()}#card-${card.preview.id}`;
}

function updatePermalinks(): void {
  for (const card of cards) updateCardPermalink(card);
}

// --- Discrete controls ---
let needsPoseReset = true;
function setTimeManual(t: number): void {
  state.time = THREE.MathUtils.clamp(t, 0, ANIMATION_DURATION);
  needsPoseReset = true;
  scrubEl.value = state.time.toFixed(6);
  timeReadoutEl.textContent = formatTime(state.time);
  setPlaying(false);
}
function setPlaying(playing: boolean): void {
  state.playing = playing;
  playPauseBtn.textContent = playing ? "Pause" : "Play";
  playPauseBtn.setAttribute("aria-pressed", String(!playing));
  syncUrl();
  updatePermalinks();
}
function updateViewButtonsUI(): void {
  for (const btn of viewButtons) btn.classList.toggle("active", btn.dataset.view === state.view);
}
function setGlobalView(view: DirectionView): void {
  state.view = view;
  for (const card of cards) {
    const distance = card.camera.position.distanceTo(card.controls.target) || DEFAULT_DISTANCE;
    applyDirection(card, view, distance);
  }
  updateViewButtonsUI();
  syncUrl();
  updatePermalinks();
}
function setFocus(id: string | null, scrollIntoView = true): void {
  if (state.focus) {
    const previous = cardsById.get(state.focus);
    previous?.root.classList.remove("enlarged");
    previous?.els.focusButton.setAttribute("aria-pressed", "false");
  }
  state.focus = id;
  if (id) {
    const card = cardsById.get(id)!;
    card.root.classList.add("enlarged");
    card.els.focusButton.setAttribute("aria-pressed", "true");
    if (scrollIntoView) card.root.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  syncUrl();
}
function setIsolate(id: string | null): void {
  state.isolate = id;
  applyFilters();
  syncUrl();
}

// --- Events ---
playPauseBtn.addEventListener("click", () => setPlaying(!state.playing));
stepBackBtn.addEventListener("click", () => setTimeManual(state.time - FRAME));
stepForwardBtn.addEventListener("click", () => setTimeManual(state.time + FRAME));
scrubEl.addEventListener("input", () => setTimeManual(Number(scrubEl.value)));
resetBtn.addEventListener("click", () => { setPlaying(false); setTimeManual(0); });
rateSelect.addEventListener("change", () => { state.rate = Number(rateSelect.value); syncUrl(); });
for (const btn of viewButtons) btn.addEventListener("click", () => setGlobalView(btn.dataset.view as DirectionView));
overlayBtn.addEventListener("click", () => {
  state.overlay = !state.overlay;
  overlayBtn.setAttribute("aria-pressed", String(state.overlay));
  overlayBtn.classList.toggle("active", state.overlay);
  for (const card of cards) { card.overlayLines.visible = state.overlay; card.overlayPoints.visible = state.overlay; }
  syncUrl();
  updatePermalinks();
});
searchEl.addEventListener("input", () => { state.query = searchEl.value; applyFilters(); syncUrl(); });
groupSelect.addEventListener("change", () => { state.group = groupSelect.value; applyFilters(); syncUrl(); });
clearIsolateBtn.addEventListener("click", () => setIsolate(null));
galleryEl.addEventListener("click", (event) => {
  const actionBtn = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!actionBtn) return;
  const cardEl = actionBtn.closest<HTMLElement>(".card")!;
  const id = cardEl.dataset.id!;
  if (actionBtn.dataset.action === "focus") setFocus(state.focus === id ? null : id);
  else if (actionBtn.dataset.action === "isolate") setIsolate(state.isolate === id ? null : id);
});
document.addEventListener("keydown", (event) => {
  const target = document.activeElement;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  if (event.code === "Space" && !typing) { event.preventDefault(); setPlaying(!state.playing); }
  else if (event.code === "ArrowLeft" && !typing) setTimeManual(state.time - FRAME);
  else if (event.code === "ArrowRight" && !typing) setTimeManual(state.time + FRAME);
});
window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));
setInterval(() => { if (state.playing) { syncUrl(); updatePermalinks(); } }, 400);

overlayBtn.classList.toggle("active", state.overlay);
for (const card of cards) { card.overlayLines.visible = state.overlay; card.overlayPoints.visible = state.overlay; }
applyFilters();
updateViewButtonsUI();
updatePermalinks();
syncUrl();
timeReadoutEl.textContent = formatTime(state.time);
playPauseBtn.textContent = state.playing ? "Pause" : "Play";
playPauseBtn.setAttribute("aria-pressed", String(!state.playing));

// --- Render loop: single renderer, scissor+viewport per visible card. ---
function renderVisibleCards(): void {
  const canvasRect = canvas.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  renderer.setScissorTest(false);
  renderer.setClearColor(BG_COLOR, 1);
  renderer.clear();
  renderer.setScissorTest(true);
  for (const card of cards) {
    if (card.root.hidden) continue;
    const rect = card.stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
    const position = card.crew.position;
    previewClips[0].constant = PREVIEW_HALF_WIDTH - position.x;
    previewClips[1].constant = PREVIEW_HALF_WIDTH + position.x;
    previewClips[2].constant = -position.y - PREVIEW_MIN_HEIGHT;
    previewClips[3].constant = position.y + PREVIEW_MAX_HEIGHT;
    previewClips[4].constant = PREVIEW_HALF_DEPTH - position.z;
    previewClips[5].constant = PREVIEW_HALF_DEPTH + position.z;
    const left = rect.left - canvasRect.left;
    const bottom = canvasRect.bottom - rect.bottom;
    renderer.setViewport(left, bottom, rect.width, rect.height);
    renderer.setScissor(left, bottom, rect.width, rect.height);
    card.camera.aspect = rect.width / rect.height;
    card.camera.updateProjectionMatrix();
    renderer.render(scene, card.camera);
  }
  renderer.setScissorTest(false);
}

let lastFrame = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) {
    let next = state.time + dt * state.rate;
    if (next >= ANIMATION_DURATION) { next -= ANIMATION_DURATION; needsPoseReset = true; }
    state.time = next;
  }
  if (needsPoseReset) { animator.resetPoseHistory(); needsPoseReset = false; }
  animState.time = state.time;
  for (const card of cards) sampleAnimationPreview(card.preview, card.crew, state.time);
  const focusedId = state.focus ? cardsById.get(state.focus)?.id ?? null : null;
  animator.update(animState, Infinity, focusedId);
  for (const card of cards) { updateCardFollow(card); updateCardDiagnostics(card); }
  timeReadoutEl.textContent = formatTime(state.time);
  scrubEl.value = state.time.toFixed(6);
  renderVisibleCards();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

Object.assign(window, {
  animationGallery: {
    animator, state, previews, cards, scene, renderer,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    seek: (t: number) => setTimeManual(t),
    setRate: (r: number) => { state.rate = r; rateSelect.value = String(r); syncUrl(); },
    setView: (view: DirectionView) => setGlobalView(view),
    setOverlay: (on: boolean) => { if (on !== state.overlay) overlayBtn.click(); },
    focus: (id: string | null) => setFocus(id),
    isolate: (id: string | null) => setIsolate(id),
  },
});
