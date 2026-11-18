import * as THREE from "three";
import type { SceneTextures } from "./textures";

interface TriplanarOptions {
  map: THREE.Texture;
  noise: THREE.Texture;
  /** Texture repeats per metre. */
  scale: number;
  /** 0 keeps the surface clean, 1 lets moss claim most upward-facing area. */
  moss: number;
  metalness: number;
  roughness: number;
}

const TRIPLANAR_VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vTriPosition;
varying vec3 vTriNormal;
`;

const TRIPLANAR_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
vTriPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTriNormal = mat3(modelMatrix) * objectNormal;
#ifdef USE_INSTANCING
  vTriPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vTriNormal = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#endif
`;

const TRIPLANAR_FRAGMENT_DECLARATIONS = /* glsl */ `
uniform sampler2D uTriMap;
uniform sampler2D uTriNoise;
uniform float uTriScale;
uniform float uMossAmount;
varying vec3 vTriPosition;
varying vec3 vTriNormal;
`;

// Samples the colour map along three world axes and blends by the surface normal,
// so merged geometry of any size keeps a constant texel density. Rust is read back
// from the colour (red over blue) to roughen and de-metal those areas.
const TRIPLANAR_MAP_FRAGMENT = /* glsl */ `
vec3 triNormal = normalize(vTriNormal);
vec3 triBlend = pow(abs(triNormal), vec3(4.0));
triBlend /= triBlend.x + triBlend.y + triBlend.z;
vec3 triPosition = vTriPosition * uTriScale;
vec4 triSample = texture2D(uTriMap, triPosition.zy) * triBlend.x
  + texture2D(uTriMap, triPosition.xz) * triBlend.y
  + texture2D(uTriMap, triPosition.xy) * triBlend.z;
vec3 noisePosition = vTriPosition * 0.045;
vec4 triNoise = texture2D(uTriNoise, noisePosition.zy) * triBlend.x
  + texture2D(uTriNoise, noisePosition.xz) * triBlend.y
  + texture2D(uTriNoise, noisePosition.xy) * triBlend.z;
diffuseColor.rgb *= triSample.rgb;
float triRust = clamp((triSample.r - triSample.b) * 5.0, 0.0, 1.0);
`;

// Moss gathers on upward faces and only creeps down the sides where the noise peaks.
const TRIPLANAR_MOSS_FRAGMENT = /* glsl */ `
#include <color_fragment>
vec3 finePosition = vTriPosition * 0.32;
float mossFine = texture2D(uTriNoise, finePosition.zy).g * triBlend.x
  + texture2D(uTriNoise, finePosition.xz).g * triBlend.y
  + texture2D(uTriNoise, finePosition.xy).g * triBlend.z;
float mossDrip = triNoise.r * 0.62 + mossFine * 0.3;
float mossMask = smoothstep(0.52, 0.62, mossDrip + triNormal.y * 0.34 + (uMossAmount - 0.5) * 0.5 - 0.1);
mossMask *= step(-0.25, triNormal.y) * step(0.001, uMossAmount);
vec3 mossColor = mix(vec3(0.06, 0.09, 0.022), vec3(0.12, 0.16, 0.035), mossFine);
diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, mossMask);
`;

function createTriplanarMaterial(options: TriplanarOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: options.metalness,
    roughness: options.roughness,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTriMap = { value: options.map };
    shader.uniforms.uTriNoise = { value: options.noise };
    shader.uniforms.uTriScale = { value: options.scale };
    shader.uniforms.uMossAmount = { value: options.moss };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TRIPLANAR_VERTEX_DECLARATIONS}`)
      .replace("#include <begin_vertex>", TRIPLANAR_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TRIPLANAR_FRAGMENT_DECLARATIONS}`)
      .replace("#include <map_fragment>", TRIPLANAR_MAP_FRAGMENT)
      .replace("#include <color_fragment>", TRIPLANAR_MOSS_FRAGMENT)
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, max(triRust, mossMask));",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - max(triRust, mossMask);",
      );
  };
  return material;
}

export interface SceneMaterials {
  steel: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  shingle: THREE.MeshStandardMaterial;
  thatch: THREE.MeshStandardMaterial;
  plain: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  lanternGlow: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  lensCore: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
}

export function createSceneMaterials(textures: SceneTextures): SceneMaterials {
  return {
    steel: createTriplanarMaterial({
      map: textures.steel,
      noise: textures.noise,
      scale: 1 / 12,
      moss: 0.55,
      metalness: 0.35,
      roughness: 0.62,
    }),
    stone: createTriplanarMaterial({
      map: textures.stone,
      noise: textures.noise,
      scale: 1 / 4,
      moss: 0.5,
      metalness: 0,
      roughness: 0.92,
    }),
    wood: createTriplanarMaterial({
      map: textures.wood,
      noise: textures.noise,
      scale: 1 / 3,
      moss: 0.12,
      metalness: 0,
      roughness: 0.85,
    }),
    plaster: createTriplanarMaterial({
      map: textures.plaster,
      noise: textures.noise,
      scale: 1 / 4,
      moss: 0,
      metalness: 0,
      roughness: 0.9,
    }),
    shingle: new THREE.MeshStandardMaterial({ map: textures.shingle, vertexColors: true, roughness: 0.8 }),
    thatch: new THREE.MeshStandardMaterial({ map: textures.thatch, vertexColors: true, roughness: 0.95 }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    window: new THREE.MeshStandardMaterial({
      map: textures.window,
      emissiveMap: textures.window,
      emissive: new THREE.Color("#ffb860"),
      emissiveIntensity: 1.1,
      roughness: 0.4,
    }),
    lanternGlow: new THREE.MeshStandardMaterial({
      color: "#ffcf7a",
      emissive: new THREE.Color("#ffb347"),
      emissiveIntensity: 7,
    }),
    lens: new THREE.MeshStandardMaterial({
      color: "#0a1416",
      emissive: new THREE.Color("#1f7d72"),
      emissiveIntensity: 0.35,
      metalness: 0.5,
      roughness: 0.06,
    }),
    lensCore: new THREE.MeshStandardMaterial({
      color: "#c8fff6",
      emissive: new THREE.Color("#3ff2d8"),
      emissiveIntensity: 3.6,
    }),
    ground: new THREE.MeshStandardMaterial({ map: textures.ground, vertexColors: true, roughness: 0.97 }),
    water: new THREE.MeshStandardMaterial({
      color: "#2c5a63",
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    }),
  };
}
