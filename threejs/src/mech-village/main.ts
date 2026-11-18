import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { createAtmosphere } from "./atmosphere";
import { GeometryBatch, Kit, toWorld } from "./batch";
import { createSceneMaterials } from "./materials";
import { buildMechRuin } from "./mech";
import { POND, createTerrain } from "./terrain";
import { createSceneTextures } from "./textures";
import { buildVegetation } from "./vegetation";
import { buildVillage } from "./village";
import "./style.css";

const INITIAL_CAMERA = new THREE.Vector3(98, 50, 94);
const INITIAL_TARGET = new THREE.Vector3(6, 22, 6);
const AUTO_ROTATE_SPEED = 0.18;

const viewport = document.querySelector<HTMLDivElement>("#viewport");
const orbitToggle = document.querySelector<HTMLButtonElement>("#orbit-toggle");
if (!viewport || !orbitToggle) throw new Error("Scene markup is missing #viewport or #orbit-toggle");

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
viewport.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 6000);
camera.position.copy(INITIAL_CAMERA);

const textures = createSceneTextures();
const materials = createSceneMaterials(textures);
scene.add(createTerrain(materials));

const world = new THREE.Group();
world.name = "world";
scene.add(world);
const batch = new GeometryBatch();
const kit = new Kit(batch, world);
const ruin = buildMechRuin(kit, materials, world);
const village = buildVillage(kit, materials, ruin, world);
const vegetation = buildVegetation(kit, materials, ruin, village, world);
batch.build(world);

const atmosphere = createAtmosphere({
  scene,
  renderer,
  materials,
  textures,
  smokeSources: [...village.smokeSources, ruin.smokeSources[0]],
  lanternLights: village.lanternLights,
  fireflyCenters: [
    new THREE.Vector3(POND.x, POND.waterLevel, POND.z),
    ruin.fallenMuzzle.getWorldPosition(new THREE.Vector3()),
    toWorld(ruin.hull, [14, 0, 0]),
    toWorld(ruin.hull, [-20, 0, 20]),
    new THREE.Vector3(-58, 0, 62),
  ],
  waterfallSource: ruin.waterfallSource,
  waterfallDirection: ruin.waterfallDirection,
  birdCenter: toWorld(ruin.intactBarrel, [ruin.intactBarrelLength - 8, 8, 0]),
  lensCenter: ruin.lensCenter,
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(INITIAL_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 18;
controls.maxDistance = 360;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true;
controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
controls.update();

const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.3, 2.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
  atmosphere.setViewportHeight(height * renderer.getPixelRatio());
}
window.addEventListener("resize", resize);
resize();

function setAutoRotate(enabled: boolean): void {
  controls.autoRotate = enabled;
  orbitToggle!.textContent = enabled ? "Pause orbit" : "Resume orbit";
  orbitToggle!.setAttribute("aria-pressed", String(enabled));
}
orbitToggle.addEventListener("click", () => setAutoRotate(!controls.autoRotate));
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    setAutoRotate(!controls.autoRotate);
  }
  if (event.code === "KeyR") {
    camera.position.copy(INITIAL_CAMERA);
    controls.target.copy(INITIAL_TARGET);
  }
});
setAutoRotate(true);

const updaters = [...village.updaters, ...vegetation.updaters, ...atmosphere.updaters];
const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const elapsedSeconds = timer.getElapsed();
  const deltaSeconds = timer.getDelta();
  for (const update of updaters) update(elapsedSeconds, deltaSeconds);
  controls.update(deltaSeconds);
  composer.render(deltaSeconds);
});
