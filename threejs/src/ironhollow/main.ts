import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { GeometryBatch, Kit } from "../mech-village/batch";
import { createMaterials } from "./materials";
import { buildLandscape, buildRuins } from "./ruins";
import { buildVillage, buildTownExpansion } from "./village";
import { buildGrowth } from "./growth";
import { buildEffects } from "./effects";
import { buildReclamation } from "./reclamation";
import { MECH_SCALE, MECH_BURIAL_DEPTH, MECH_DECK_HEIGHT, SETTLEMENT_X, SETTLEMENT_Z, SETTLEMENT_FRAME_Y } from "./scale";
import "./style.css";

const VILLAGE_TARGET = new THREE.Vector3(SETTLEMENT_X + 5, MECH_DECK_HEIGHT + 3, SETTLEMENT_Z - 34);
const VILLAGE_CAMERA = VILLAGE_TARGET.clone().add(new THREE.Vector3(100, 55, 140));
const COLOSSUS_TARGET = new THREE.Vector3(0, MECH_DECK_HEIGHT + 35, 0);
const COLOSSUS_CAMERA = new THREE.Vector3(74, 55, 88).multiplyScalar(MECH_SCALE);
const FIELD_OF_VIEW = 40;
const viewport = document.querySelector<HTMLDivElement>("#viewport");
const orbitButton = document.querySelector<HTMLButtonElement>("#orbit");
const resetButton = document.querySelector<HTMLButtonElement>("#reset");
const scaleButton = document.querySelector<HTMLButtonElement>("#scale-view");
if (!viewport || !orbitButton || !resetButton || !scaleButton) throw new Error("Missing scene controls");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2("#a7b8b3", 0.00012);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.domElement.setAttribute("aria-label", "A town built across a colossal mech buried in earth. Drag to explore, scroll out or choose Reveal the giant to discover the machine.");
viewport.append(renderer.domElement);

const [materials, sky] = await Promise.all([
  createMaterials(),
  new HDRLoader().setDataType(THREE.FloatType).loadAsync(new URL("./textures/outdoor-sky.hdr", document.baseURI).href),
]);
sky.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(sky).texture;
scene.environmentIntensity = 0.9;
scene.background = sky;
scene.backgroundIntensity = 0.9;
scene.backgroundBlurriness = 0.015;
pmrem.dispose();

const image = sky.image;
const radiance = image.data as Float32Array;
let brightest = 0;
let sunPixel = 0;
for (let pixel = 0; pixel < image.width * image.height / 2; pixel++) {
  const light = radiance[pixel * 4] + radiance[pixel * 4 + 1] + radiance[pixel * 4 + 2];
  if (light > brightest) { brightest = light; sunPixel = pixel; }
}
const latitude = (0.5 - Math.floor(sunPixel / image.width) / image.height) * Math.PI;
const longitude = ((sunPixel % image.width) / image.width - 0.5) * Math.PI * 2;
const sunDirection = new THREE.Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
const sunlight = new THREE.DirectionalLight("#ffe5be", 3.2);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(4096, 4096);
sunlight.shadow.normalBias = 0.06;
sunlight.shadow.bias = -0.0001;
scene.add(sunlight, sunlight.target, new THREE.HemisphereLight("#bfd4df", "#565942", 0.6));

const root = new THREE.Group();
root.name = "ironhollow";
scene.add(root);
const worldBatch = new GeometryBatch();
const worldKit = new Kit(worldBatch, root);
buildLandscape(worldKit, materials, root);
buildRuins(worldKit.within([0, -MECH_BURIAL_DEPTH, 0], [0, 0, 0], [MECH_SCALE, MECH_SCALE, MECH_SCALE]), materials);
const expansion = buildTownExpansion(worldKit, materials);
buildReclamation(worldKit, materials, root);
worldBatch.build(root);

// Finish the human-sized geometry in its own identity frame before placing it on the giant deck.
// Kit bakes its frame matrix into static meshes, while leaf instances and the windmill stay local.
const settlement = new THREE.Group();
settlement.name = "human-scale-settlement";
root.add(settlement);
const settlementBatch = new GeometryBatch();
const settlementKit = new Kit(settlementBatch, settlement);
const village = buildVillage(settlementKit, materials, settlement);
const growth = buildGrowth(settlementKit, materials, settlement, village.clearings);
settlementBatch.build(settlement);
settlement.position.set(SETTLEMENT_X, SETTLEMENT_FRAME_Y, SETTLEMENT_Z);
settlement.updateMatrixWorld(true);
const smokeSources = [...expansion.smoke, ...village.smoke.map((source) => settlement.localToWorld(source.clone()))];
const effects = buildEffects(root, smokeSources);

const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, innerWidth / innerHeight, 0.25, 20000);
camera.position.copy(VILLAGE_CAMERA);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(VILLAGE_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 8;
controls.maxDistance = 8000;
controls.minPolarAngle = 0.15;
controls.maxPolarAngle = Math.PI * 0.48;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.25;
controls.update();

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
const occlusion = new SSAOPass(scene, camera, 1, 1, 16);
occlusion.kernelRadius = 1.1;
occlusion.minDistance = 0.00001;
occlusion.maxDistance = 0.0006;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(occlusion);
composer.addPass(new OutputPass());
let overview = false;

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}

function setView(showColossus: boolean): void {
  overview = showColossus;
  const focus = overview ? COLOSSUS_TARGET : VILLAGE_TARGET;
  const position = overview ? COLOSSUS_CAMERA : VILLAGE_CAMERA;
  const portraitScale = Math.max(1, 1 / camera.aspect);
  const wasRotating = controls.autoRotate;
  controls.autoRotate = false;
  controls.enableDamping = false;
  controls.update();
  camera.position.copy(position).sub(focus).multiplyScalar(portraitScale).add(focus);
  controls.target.copy(focus);
  controls.update();
  controls.enableDamping = true;
  controls.autoRotate = wasRotating;

  const shadowExtent = overview ? 80 * MECH_SCALE : 240;
  const lightDistance = overview ? 200 * MECH_SCALE : 2000;
  sunlight.target.position.copy(focus);
  sunlight.position.copy(focus).addScaledVector(sunDirection, lightDistance);
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -shadowExtent;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = shadowExtent;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = lightDistance * 2;
  sunlight.shadow.camera.updateProjectionMatrix();
  sunlight.target.updateMatrixWorld();
  scaleButton!.textContent = overview ? "Return to town" : "Reveal the giant";
  scaleButton!.setAttribute("aria-pressed", String(overview));
  document.body.dataset.view = overview ? "colossus" : "village";
}
resize();
setView(false);
window.addEventListener("resize", resize);

function toggleOrbit(): void {
  controls.autoRotate = !controls.autoRotate;
  orbitButton!.setAttribute("aria-pressed", String(controls.autoRotate));
  orbitButton!.textContent = controls.autoRotate ? "Pause orbit" : "Slow orbit";
}
orbitButton.addEventListener("click", toggleOrbit);
resetButton.addEventListener("click", () => setView(false));
scaleButton.addEventListener("click", () => setView(!overview));
window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") { event.preventDefault(); toggleOrbit(); }
  if (event.code === "KeyR") setView(false);
});

const timer = new THREE.Timer();
timer.connect(document);
let hasRendered = false;
renderer.setAnimationLoop((timestamp: number) => {
  timer.update(timestamp);
  const elapsed = timer.getElapsed();
  village.update(elapsed);
  growth.update(elapsed);
  effects.update(elapsed, innerHeight * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  controls.update(timer.getDelta());
  composer.render();
  if (!hasRendered) { document.body.dataset.ready = "true"; hasRendered = true; }
});
