import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { SceneMaterials } from "./materials";
import { createRandom, randomRange, type Random } from "./noise";
import { POND } from "./terrain";
import type { SceneTextures } from "./textures";

export const SUN_DIRECTION = new THREE.Vector3(0.82, 0.17, 0.52).normalize();
const FOG_COLOR = new THREE.Color("#cdb995");
const WIND = new THREE.Vector3(-0.55, 0, -0.35);
const MAX_LANTERN_LIGHTS = 10;

export interface Atmosphere {
  updaters: Array<(elapsedSeconds: number, deltaSeconds: number) => void>;
  setViewportHeight(pixels: number): void;
}

function configureSky(sky: Sky): void {
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.6;
  uniforms.rayleigh.value = 1.9;
  uniforms.mieCoefficient.value = 0.005;
  uniforms.mieDirectionalG.value = 0.86;
  uniforms.sunPosition.value.copy(SUN_DIRECTION);
}

function addSkyAndLight(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  configureSky(sky);
  scene.add(sky);

  const environmentScene = new THREE.Scene();
  const environmentSky = new Sky();
  environmentSky.scale.setScalar(50);
  configureSky(environmentSky);
  environmentScene.add(environmentSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#4a5530" }));
  ground.position.y = -2;
  environmentScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environmentScene, 0.02, 0.1, 200).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0011);

  const sun = new THREE.DirectionalLight("#ffc68c", 3.2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -125;
  shadowCamera.right = 125;
  shadowCamera.top = 125;
  shadowCamera.bottom = -125;
  shadowCamera.near = 20;
  shadowCamera.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  scene.add(new THREE.HemisphereLight("#a9c1e0", "#5e4a32", 0.32));
}

const PARTICLE_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = aSize * uScale / -viewPosition.z;
  vAlpha = aAlpha;
  vColor = aColor;
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 puff = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, puff.a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A pool of camera-facing soft puffs whose attributes are rewritten every frame. */
class ParticleField {
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
  readonly colors: Float32Array;
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(count: number, texture: THREE.Texture, additive: boolean) {
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.colors = new Float32Array(count * 3).fill(1);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 600 } },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  setColor(index: number, color: THREE.Color): void {
    this.colors[index * 3] = color.r;
    this.colors[index * 3 + 1] = color.g;
    this.colors[index * 3 + 2] = color.b;
  }

  commit(): void {
    for (const name of ["position", "aSize", "aAlpha"]) this.geometry.getAttribute(name).needsUpdate = true;
  }
}

function createSmoke(sources: THREE.Vector3[], texture: THREE.Texture, random: Random): [ParticleField, (elapsedSeconds: number) => void] {
  const perSource = 16;
  const lifetime = 11;
  const field = new ParticleField(sources.length * perSource, texture, false);
  const offsets = Array.from({ length: sources.length * perSource }, () => random());
  const drift = Array.from({ length: sources.length * perSource }, () => new THREE.Vector3(randomRange(random, -1, 1), 0, randomRange(random, -1, 1)));
  const smokeColor = new THREE.Color("#d8d0c4");
  for (let index = 0; index < offsets.length; index++) field.setColor(index, smokeColor);
  const update = (elapsedSeconds: number): void => {
    sources.forEach((source, sourceIndex) => {
      for (let puff = 0; puff < perSource; puff++) {
        const index = sourceIndex * perSource + puff;
        const age = ((elapsedSeconds / lifetime + offsets[index] + puff / perSource) % 1 + 1) % 1;
        const seconds = age * lifetime;
        field.positions[index * 3] = source.x + WIND.x * seconds * 0.9 + drift[index].x * seconds * 0.25;
        field.positions[index * 3 + 1] = source.y + seconds * 1.1 - seconds * seconds * 0.02;
        field.positions[index * 3 + 2] = source.z + WIND.z * seconds * 0.9 + drift[index].z * seconds * 0.25;
        field.sizes[index] = 1.2 + age * 7;
        field.alphas[index] = Math.min(1, age * 8) * Math.pow(1 - age, 1.6) * 0.6;
      }
    });
    field.commit();
  };
  return [field, update];
}

function createFireflies(centers: THREE.Vector3[], texture: THREE.Texture, random: Random): [ParticleField, (elapsedSeconds: number) => void] {
  const count = 360;
  const field = new ParticleField(count, texture, true);
  const anchors = Array.from({ length: count }, () => {
    const center = centers[Math.floor(random() * centers.length)];
    return center.clone().add(new THREE.Vector3(randomRange(random, -14, 14), randomRange(random, 0.3, 5), randomRange(random, -14, 14)));
  });
  const phases = Array.from({ length: count }, () => random() * 100);
  const glow = new THREE.Color("#ffe39a");
  for (let index = 0; index < count; index++) field.setColor(index, glow);
  const update = (elapsedSeconds: number): void => {
    for (let index = 0; index < count; index++) {
      const phase = phases[index];
      const anchor = anchors[index];
      field.positions[index * 3] = anchor.x + Math.sin(elapsedSeconds * 0.3 + phase) * 1.6;
      field.positions[index * 3 + 1] = anchor.y + Math.sin(elapsedSeconds * 0.5 + phase * 1.3) * 0.6;
      field.positions[index * 3 + 2] = anchor.z + Math.cos(elapsedSeconds * 0.27 + phase * 0.7) * 1.6;
      const blink = Math.max(0, Math.sin(elapsedSeconds * 1.4 + phase));
      field.sizes[index] = 0.5;
      field.alphas[index] = Math.pow(blink, 3) * 0.9;
    }
    field.commit();
  };
  return [field, update];
}

interface Waterfall {
  objects: THREE.Object3D[];
  spray: ParticleField;
  update: (elapsedSeconds: number) => void;
}

function createWaterfall(source: THREE.Vector3, direction: THREE.Vector3, textures: SceneTextures, random: Random): Waterfall {
  const horizontalSpeed = 4.6;
  const gravity = 9.8;
  const fallHeight = source.y - POND.waterLevel;
  const fallTime = Math.sqrt((2 * fallHeight) / gravity);
  const flat = new THREE.Vector3(direction.x, 0, direction.z).normalize();
  const points: THREE.Vector3[] = [];
  for (let step = 0; step <= 30; step++) {
    const t = (step / 30) * fallTime;
    points.push(source.clone().addScaledVector(flat, horizontalSpeed * t).add(new THREE.Vector3(0, -0.5 * gravity * t * t, 0)));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tubularSegments = 60;
  const radialSegments = 12;
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, 0.85, radialSegments, false);
  const uvs = geometry.getAttribute("uv");
  for (let index = 0; index < uvs.count; index++) {
    uvs.setXY(index, uvs.getY(index), uvs.getX(index) * 6);
  }
  // Tube rings are emitted in order along the curve, so each ring can fan out as the water falls.
  const positions = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    const progress = Math.floor(index / (radialSegments + 1)) / tubularSegments;
    const center = curve.getPointAt(progress);
    vertex.fromBufferAttribute(positions, index).sub(center).multiplyScalar(0.8 + progress * 1.4).add(center);
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  const texture = textures.waterfall;
  texture.repeat.set(2, 1);
  const waterMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: new THREE.Color("#6f8f96"),
    emissiveMap: texture,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ribbon = new THREE.Mesh(geometry, waterMaterial);
  ribbon.name = "waterfall";

  const landing = points[points.length - 1];
  const foam = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: textures.puff, transparent: true, opacity: 0.55, depthWrite: false, color: "#f2f6f2" }),
  );
  foam.position.set(landing.x, POND.waterLevel + 0.05, landing.z);

  const sprayCount = 70;
  const spray = new ParticleField(sprayCount, textures.puff, false);
  const sprayPhases = Array.from({ length: sprayCount }, () => random());
  const sprayDirections = Array.from({ length: sprayCount }, () => new THREE.Vector3(randomRange(random, -1, 1), randomRange(random, 0.6, 1.4), randomRange(random, -1, 1)));
  const sprayColor = new THREE.Color("#e9f1f0");
  for (let index = 0; index < sprayCount; index++) spray.setColor(index, sprayColor);

  const update = (elapsedSeconds: number): void => {
    texture.offset.y = -elapsedSeconds * 1.6;
    foam.scale.setScalar(1 + Math.sin(elapsedSeconds * 3) * 0.05);
    for (let index = 0; index < sprayCount; index++) {
      const age = (elapsedSeconds * 0.7 + sprayPhases[index]) % 1;
      const heading = sprayDirections[index];
      spray.positions[index * 3] = landing.x + heading.x * age * 3.2;
      spray.positions[index * 3 + 1] = POND.waterLevel + heading.y * age * 4 - age * age * 3;
      spray.positions[index * 3 + 2] = landing.z + heading.z * age * 3.2;
      spray.sizes[index] = 1.5 + age * 3;
      spray.alphas[index] = (1 - age) * 0.35;
    }
    spray.commit();
  };
  return { objects: [ribbon, foam, spray.points], spray, update };
}

interface Bird {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

function createBirds(center: THREE.Vector3, random: Random): [THREE.Group, (elapsedSeconds: number) => void] {
  const flock = new THREE.Group();
  flock.name = "birds";
  const material = new THREE.MeshStandardMaterial({ color: "#2b2724", roughness: 0.9, side: THREE.DoubleSide });
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.25, 0, 0, 0.3, 1.3, 0, 0.05], 3));
  wingGeometry.computeVertexNormals();
  const bodyGeometry = new THREE.ConeGeometry(0.16, 0.9, 5).rotateX(Math.PI / 2);
  const birds: Bird[] = [];
  for (let index = 0; index < 11; index++) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, material);
    const leftWing = new THREE.Mesh(wingGeometry, material);
    const rightWing = new THREE.Mesh(wingGeometry, material);
    rightWing.scale.x = -1;
    group.add(body, leftWing, rightWing);
    group.scale.setScalar(1.1 + random() * 0.5);
    flock.add(group);
    birds.push({
      group,
      leftWing,
      rightWing,
      radius: 14 + random() * 26,
      height: center.y + randomRange(random, -6, 14),
      speed: (0.12 + random() * 0.1) * (random() < 0.5 ? 1 : -1),
      phase: random() * Math.PI * 2,
    });
  }
  const update = (elapsedSeconds: number): void => {
    for (const bird of birds) {
      const angle = bird.phase + elapsedSeconds * bird.speed;
      bird.group.position.set(
        center.x + Math.cos(angle) * bird.radius,
        bird.height + Math.sin(elapsedSeconds * 0.5 + bird.phase) * 2,
        center.z + Math.sin(angle) * bird.radius,
      );
      bird.group.rotation.y = -angle + (bird.speed > 0 ? Math.PI : 0);
      bird.group.rotation.z = bird.speed > 0 ? -0.3 : 0.3;
      const flap = Math.sin(elapsedSeconds * 9 + bird.phase * 5) * 0.6;
      bird.leftWing.rotation.z = flap;
      bird.rightWing.rotation.z = -flap;
    }
  };
  return [flock, update];
}

function createClouds(texture: THREE.Texture, random: Random): THREE.Group {
  const clouds = new THREE.Group();
  clouds.name = "clouds";
  for (let cloud = 0; cloud < 16; cloud++) {
    const angle = random() * Math.PI * 2;
    const distance = 900 + random() * 900;
    const center = new THREE.Vector3(Math.cos(angle) * distance, 260 + random() * 260, Math.sin(angle) * distance);
    const towardSun = Math.max(0, new THREE.Vector3(center.x, 0, center.z).normalize().dot(new THREE.Vector3(SUN_DIRECTION.x, 0, SUN_DIRECTION.z).normalize()));
    const tint = new THREE.Color("#f6efe6").lerp(new THREE.Color("#ffd6a8"), towardSun * 0.7);
    for (let puff = 0; puff < 7; puff++) {
      const material = new THREE.SpriteMaterial({ map: texture, color: tint, transparent: true, opacity: 0.38 + random() * 0.2, fog: false, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      const size = 120 + random() * 160;
      sprite.scale.set(size * 1.8, size * 0.8, 1);
      sprite.position.copy(center).add(new THREE.Vector3(randomRange(random, -160, 160), randomRange(random, -20, 30), randomRange(random, -160, 160)));
      clouds.add(sprite);
    }
  }
  return clouds;
}

export interface AtmosphereInputs {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  materials: SceneMaterials;
  textures: SceneTextures;
  smokeSources: THREE.Vector3[];
  lanternLights: THREE.Vector3[];
  fireflyCenters: THREE.Vector3[];
  waterfallSource: THREE.Vector3;
  waterfallDirection: THREE.Vector3;
  birdCenter: THREE.Vector3;
  lensCenter: THREE.Vector3;
}

export function createAtmosphere(inputs: AtmosphereInputs): Atmosphere {
  const { scene, renderer, materials, textures } = inputs;
  const random = createRandom(2026);
  addSkyAndLight(scene, renderer);
  scene.add(createClouds(textures.puff, random));

  const lanternGlows: THREE.PointLight[] = [];
  for (const position of inputs.lanternLights.slice(0, MAX_LANTERN_LIGHTS)) {
    const light = new THREE.PointLight("#ffb257", 26, 16, 2);
    light.position.copy(position);
    scene.add(light);
    lanternGlows.push(light);
  }
  const lensLight = new THREE.PointLight("#45f0d6", 60, 26, 2);
  lensLight.position.copy(inputs.lensCenter);
  scene.add(lensLight);

  const [smoke, updateSmoke] = createSmoke(inputs.smokeSources, textures.puff, random);
  const [fireflies, updateFireflies] = createFireflies(inputs.fireflyCenters, textures.puff, random);
  const waterfall = createWaterfall(inputs.waterfallSource, inputs.waterfallDirection, textures, random);
  const [birds, updateBirds] = createBirds(inputs.birdCenter, random);
  scene.add(smoke.points, fireflies.points, birds, ...waterfall.objects);
  const particleFields = [smoke, fireflies, waterfall.spray];

  return {
    setViewportHeight(pixels) {
      const scale = pixels * 0.5;
      for (const field of particleFields) field.material.uniforms.uScale.value = scale;
    },
    updaters: [
      (elapsedSeconds) => {
        updateSmoke(elapsedSeconds);
        updateFireflies(elapsedSeconds);
        waterfall.update(elapsedSeconds);
        updateBirds(elapsedSeconds);
        const pulse = 0.75 + Math.sin(elapsedSeconds * 0.7) * 0.35 + (Math.sin(elapsedSeconds * 23) > 0.97 ? 0.4 : 0);
        materials.lensCore.emissiveIntensity = 3.6 * pulse;
        lensLight.intensity = 30 * pulse;
        lanternGlows.forEach((light, index) => {
          light.intensity = 26 * (0.9 + Math.sin(elapsedSeconds * 7 + index * 3.1) * 0.06 + Math.sin(elapsedSeconds * 13 + index) * 0.04);
        });
      },
    ],
  };
}
