import * as THREE from "three";

export const DECK_HEIGHT = 12;
export const DECK_X = 25;
export const DECK_Z = 19;

export const COLORS = {
  steel: "#737b6c", paleSteel: "#9c9d89", darkSteel: "#424a41",
  rust: "#87583d", orangeRust: "#a36b42", brass: "#958365",
  wood: "#66533f", planks: "#9c8565", plaster: "#d7ccb0",
  moss: "#536b35", mossLight: "#78834a", foliage: "#3e593a", leaves: "#657643",
  tealRoof: "#536268", redRoof: "#89584a",
} as const;

export interface Materials {
  matte: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  polishedMetal: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  leaves: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
}

export interface Clearing { x: number; z: number; radius: number }

interface SurfaceMaps { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture }
interface SurfaceOptions { scale: number; normalStrength: number; metalness: number; moss: number }

const SURFACE_DECLARATIONS = /* glsl */ `
uniform sampler2D uSurfaceColor;
uniform sampler2D uSurfaceNormal;
uniform sampler2D uSurfaceRoughness;
uniform float uSurfaceScale;
uniform float uNormalStrength;
uniform float uSurfaceMetal;
uniform float uSurfaceMoss;
varying vec3 vSurfacePosition;
varying vec3 vSurfaceNormal;
float surfaceNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(cell, vec2(127.1,311.7)), dot(cell + vec2(1,0), vec2(127.1,311.7)), dot(cell + vec2(0,1), vec2(127.1,311.7)), dot(cell + vec2(1,1), vec2(127.1,311.7)))) * 43758.5453);
  return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
}
`;

const SURFACE_COLOR = /* glsl */ `
vec3 surfaceN = normalize(vSurfaceNormal);
vec3 surfaceWeights = pow(abs(surfaceN), vec3(6.0));
surfaceWeights /= dot(surfaceWeights, vec3(1.0));
vec3 surfaceP = vSurfacePosition * uSurfaceScale;
vec3 photoColor = texture2D(uSurfaceColor, surfaceP.zy).rgb * surfaceWeights.x
  + texture2D(uSurfaceColor, surfaceP.xz).rgb * surfaceWeights.y
  + texture2D(uSurfaceColor, surfaceP.xy).rgb * surfaceWeights.z;
float photoLuma = dot(photoColor, vec3(0.2126,0.7152,0.0722));
vec3 photoDetail = clamp(photoColor / max(photoLuma, 0.08), 0.5, 1.8) * mix(0.42, 1.4, smoothstep(0.025, 0.72, photoLuma));
float corrosionField = surfaceNoise(vSurfacePosition.xy * vec2(0.6,0.2)) * 0.6 + surfaceNoise(vSurfacePosition.zy * vec2(0.4,0.7)) * 0.4;
float corrosionPatch = smoothstep(0.55, 0.76, corrosionField) * step(0.1, uSurfaceMetal);
float surfaceRust = max(smoothstep(0.025, 0.16, photoColor.r - photoColor.g), corrosionPatch) * step(0.1, uSurfaceMetal);
float surfaceRoughness = texture2D(uSurfaceRoughness, surfaceP.zy).g * surfaceWeights.x
  + texture2D(uSurfaceRoughness, surfaceP.xz).g * surfaceWeights.y
  + texture2D(uSurfaceRoughness, surfaceP.xy).g * surfaceWeights.z;
float surfaceDamp = surfaceNoise(vSurfacePosition.xz * 0.18) * 0.65 + surfaceNoise(vSurfacePosition.xz * 0.57) * 0.35;
float surfaceMoss = smoothstep(0.42, 0.72, surfaceDamp) * smoothstep(0.4, 0.85, surfaceN.y) * uSurfaceMoss;
`;

const SURFACE_TINT = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), photoDetail, 0.85);
vec3 oxidizedColor = mix(photoColor * 0.85, mix(vec3(0.09,0.031,0.012),vec3(0.29,0.12,0.038),clamp(photoLuma * 2.0,0.0,1.0)), corrosionPatch);
diffuseColor.rgb = mix(diffuseColor.rgb, oxidizedColor, surfaceRust * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.055,0.078,0.024),vec3(0.14,0.17,0.05),surfaceDamp), surfaceMoss * 0.8);
`;

const SURFACE_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
vec3 nx = texture2D(uSurfaceNormal, surfaceP.zy).xyz * 2.0 - 1.0;
vec3 ny = texture2D(uSurfaceNormal, surfaceP.xz).xyz * 2.0 - 1.0;
vec3 nz = texture2D(uSurfaceNormal, surfaceP.xy).xyz * 2.0 - 1.0;
nx.xy *= uNormalStrength; ny.xy *= uNormalStrength; nz.xy *= uNormalStrength;
nx = vec3(nx.xy + surfaceN.zy, abs(nx.z) * surfaceN.x);
ny = vec3(ny.xy + surfaceN.xz, abs(ny.z) * surfaceN.y);
nz = vec3(nz.xy + surfaceN.xy, abs(nz.z) * surfaceN.z);
vec3 mappedSurfaceNormal = normalize(nx.zyx * surfaceWeights.x + ny.xzy * surfaceWeights.y + nz * surfaceWeights.z);
normal = normalize(mat3(viewMatrix) * mappedSurfaceNormal);
`;

async function loadSurface(id: string): Promise<SurfaceMaps> {
  const loader = new THREE.TextureLoader();
  const directory = new URL("./textures/", document.baseURI).href;
  const [color, normal, roughness] = await Promise.all([
    loader.loadAsync(`${directory}${id}-color.jpg`),
    loader.loadAsync(`${directory}${id}-normal.jpg`),
    loader.loadAsync(`${directory}${id}-roughness.jpg`),
  ]);
  color.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [color, normal, roughness]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  return { color, normal, roughness };
}

function createSurface(maps: SurfaceMaps, options: SurfaceOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: options.metalness });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSurfaceColor: { value: maps.color }, uSurfaceNormal: { value: maps.normal }, uSurfaceRoughness: { value: maps.roughness },
      uSurfaceScale: { value: options.scale }, uNormalStrength: { value: options.normalStrength },
      uSurfaceMetal: { value: options.metalness }, uSurfaceMoss: { value: options.moss },
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSurfacePosition;\nvarying vec3 vSurfaceNormal;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vSurfacePosition = (modelMatrix * vec4(transformed,1.0)).xyz;
        vSurfaceNormal = mat3(modelMatrix) * objectNormal;
        #ifdef USE_INSTANCING
          vSurfacePosition = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
          vSurfaceNormal = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SURFACE_DECLARATIONS}`)
      .replace("#include <map_fragment>", SURFACE_COLOR)
      .replace("#include <color_fragment>", SURFACE_TINT)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(surfaceRoughness * 0.85 + 0.15 + surfaceMoss * 0.2, 0.25, 1.0);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - max(surfaceRust, surfaceMoss);")
      .replace("#include <normal_fragment_maps>", SURFACE_NORMAL);
  };
  return material;
}

export async function createMaterials(): Promise<Materials> {
  const [metal, wood, plaster, stone, ground, roof] = await Promise.all([
    loadSurface("green_metal_rust"), loadSurface("rough_wood"), loadSurface("white_plaster_rough_01"),
    loadSurface("mossy_rock"), loadSurface("forest_floor"), loadSurface("grey_roof_tiles"),
  ]);
  return {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }),
    metal: createSurface(metal, { scale: 0.3, normalStrength: 0.75, metalness: 0.65, moss: 0.45 }),
    polishedMetal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.24 }),
    wood: createSurface(wood, { scale: 0.65, normalStrength: 0.65, metalness: 0, moss: 0.05 }),
    plaster: createSurface(plaster, { scale: 0.6, normalStrength: 0.5, metalness: 0, moss: 0.1 }),
    stone: createSurface(stone, { scale: 0.4, normalStrength: 1, metalness: 0, moss: 0.25 }),
    ground: createSurface(ground, { scale: 0.2, normalStrength: 0.8, metalness: 0, moss: 0.18 }),
    roof: createSurface(roof, { scale: 0.9, normalStrength: 0.5, metalness: 0, moss: 0.25 }),
    leaves: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, color: "#6b705d", emissive: "#ffc47d", emissiveIntensity: 0.35, roughness: 0.2 }),
    water: new THREE.MeshStandardMaterial({ color: "#4c7166", roughness: 0.15, metalness: 0.28, transparent: true, opacity: 0.88 }),
  };
}
