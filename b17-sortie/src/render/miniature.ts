import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyStudioShading } from './studio';

// The miniature world: the aircraft is a brush-painted plastic kit, the sky round it cotton wool on a stop-motion set.

/** Texels per side of the tiling noise volume both shaders read. */
const NOISE_VOLUME_SIZE = 64;

/**
 * Four independent channels of tiling value noise in a 3D texture: one trilinear fetch stands in for four hashed
 * noise evaluations of eight hashes each, which matters when every painted pixel samples nine and every fibre shell
 * three.
 */
function noiseVolume(): THREE.Data3DTexture {
  const size = NOISE_VOLUME_SIZE;
  const data = new Uint8Array(size * size * size * 4);
  let state = 4099;
  for (let index = 0; index < data.length; index++) {
    state = (state * 16807) % 2147483647;
    data[index] = state % 256;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Shared by every miniature material. */
const miniatureUniforms = { uMiniatureNoise: { value: noiseVolume() } };

/** Value noise and the surface-gradient bump both shaders share. */
const NOISE_FUNCTIONS = /* glsl */ `
  #define NOISE_VOLUME_SCALE ${(1 / NOISE_VOLUME_SIZE).toFixed(6)}
  float miniatureHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  precision highp sampler3D;
  uniform sampler3D uMiniatureNoise;
  vec4 miniatureNoise4(vec3 p) {
    return texture(uMiniatureNoise, p * NOISE_VOLUME_SCALE);
  }
  float miniatureNoise(vec3 p) {
    return miniatureNoise4(p).r;
  }
  // Tilts the view-space normal by the screen-space slope of a height field (Mikkelsen's surface gradient).
  vec3 miniatureBump(vec3 surfacePosition, vec3 surfaceNormal, float height, float faceSign) {
    vec3 sigmaX = dFdx(surfacePosition);
    vec3 sigmaY = dFdy(surfacePosition);
    vec3 r1 = cross(sigmaY, surfaceNormal);
    vec3 r2 = cross(surfaceNormal, sigmaX);
    float determinant = dot(sigmaX, r1) * faceSign;
    vec3 gradient = sign(determinant) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(abs(determinant) * surfaceNormal - gradient);
  }`;

/** Adds a shader patch on top of a material's existing one (the studio shading), with its own program cache key. */
function extendShader(material: THREE.Material, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  const base = material.onBeforeCompile.bind(material);
  const baseKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${baseKey()}|${key}`;
}

// Brushwork: enamel laid on with a flat brush. Strokes run along the part (nose to tail, root to tip in chord), each a
// band of paint whose load thins as the brush drags; the bristles leave fine parallel grooves, and paint piles up a
// little along the edges where strokes overlap. All in the model's own metres, so every part shares one brush size.

const BRUSHWORK_VERTEX = /* glsl */ `
  #include <begin_vertex>
  vBrushPosition = position;
  vBrushNormal = normal;`;

const BRUSHWORK_FUNCTIONS = /* glsl */ `
  varying vec3 vBrushPosition;
  varying vec3 vBrushNormal;
  ${NOISE_FUNCTIONS}
  // Paint height in one projection: u runs along the stroke, v across it. x: paint load, y: bristle grooves.
  vec2 brushStroke(vec2 uv, float seed, float grooveFade) {
    float wander = miniatureNoise(vec3(uv.x * 0.35, uv.y * 0.8, seed)) * 0.6;
    float v = uv.y + wander;
    float load = miniatureNoise(vec3(uv.x * 0.42, v * 3.4, seed + 7.0));
    float grooves = miniatureNoise(vec3(uv.x * 1.1, v * 58.0, seed + 3.0)) * 0.65
      + miniatureNoise(vec3(uv.x * 2.3, v * 131.0, seed + 5.0)) * 0.35;
    float ridge = 1.0 - abs(load - 0.5) * 2.0;
    return vec2(load * 0.7 + pow(ridge, 6.0) * 0.5, mix(0.5, grooves, grooveFade * (0.35 + load * 0.65)));
  }`;

const BRUSHWORK_FRAGMENT = /* glsl */ `
  #include <normal_fragment_maps>
  {
    vec3 weights = pow(abs(normalize(vBrushNormal)), vec3(4.0));
    weights /= weights.x + weights.y + weights.z;
    // Grooves finer than a pixel would only shimmer; fade them out as the model recedes.
    float footprint = length(fwidth(vBrushPosition));
    float grooveFade = 1.0 - smoothstep(0.004, 0.016, footprint);
    vec2 paint = brushStroke(vBrushPosition.zy, 1.0, grooveFade) * weights.x
      + brushStroke(vBrushPosition.xz, 11.0, grooveFade) * weights.y
      + brushStroke(vBrushPosition.xy, 23.0, grooveFade) * weights.z;
    float height = paint.x * 0.55 + paint.y * 0.45;
    normal = miniatureBump(-vViewPosition, normal, height * BRUSH_RELIEF, faceDirection);
    diffuseColor.rgb *= 0.92 + paint.x * 0.14 + (paint.y - 0.5) * 0.1;
    roughnessFactor = clamp(roughnessFactor - paint.x * 0.1 + (0.5 - paint.y) * 0.06, 0.04, 1.0);
    // A model left on the shelf between shots: dust settles on what faces up, in drifts and specks, and dulls the paint.
    float upward = smoothstep(0.3, 0.9, normalize(vBrushNormal).y);
    float drift = miniatureNoise(vBrushPosition * 3.1) * 0.45 + miniatureNoise4(vBrushPosition * 170.0).g * 0.55;
    float dust = smoothstep(0.5, 0.82, drift) * upward * DUST_AMOUNT;
    diffuseColor.rgb = mix(diffuseColor.rgb, DUST_COLOR, dust);
    roughnessFactor = mix(roughnessFactor, 1.0, dust);
  }`;

/** Shelf dust on upward faces: how far it covers the paint at its thickest, and its colour (linear RGB). */
const DUST = { amount: 0.16, color: [0.62, 0.6, 0.56] } as const;

/** Relief of the brush marks, in world units (the model is 0.32 scale, so this is a fraction of a millimetre of kit). */
const BRUSH_RELIEF = 0.0035;

/** Brush-painted enamel over the material's own paint and markings. */
export function applyBrushwork<T extends THREE.MeshStandardMaterial>(material: T): T {
  extendShader(material, 'brushwork', (shader) => {
    Object.assign(shader.uniforms, miniatureUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrushPosition;\nvarying vec3 vBrushNormal;')
      .replace('#include <begin_vertex>', BRUSHWORK_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BRUSHWORK_FUNCTIONS}`)
      // roughnessFactor is declared in roughnessmap_fragment, before the normal maps; the patch adjusts it there.
      .replace('#include <normal_fragment_maps>', BRUSHWORK_FRAGMENT);
    shader.fragmentShader = `#define BRUSH_RELIEF ${BRUSH_RELIEF.toFixed(5)}\n#define DUST_AMOUNT ${DUST.amount.toFixed(2)}\n`
      + `#define DUST_COLOR vec3(${DUST.color.map((value) => value.toFixed(2)).join(', ')})\n${shader.fragmentShader}`;
  });
  return material;
}

// Cotton wool: a tuft is a dense body wrapped in a halo of loose fibres. The halo is drawn as shells, copies of the
// tuft pushed out along its normals; each shell keeps only where a tangle of thin filaments (domain-warped noise in
// the tuft's own space, so strands curve through the halo) is dense enough, fewer the further out. Alpha-to-coverage
// softens what survives into fuzz. `wisp` (0 dense, 1 gone) thins a tuft to a few strands as it forms or dissipates.

/** Shared by every cotton material: the stop-motion frame, which nudges the fibres the way handling cotton does. */
const cottonUniforms = { uCottonFrame: { value: 0 } };

const COTTON_VERTEX_DECLARATIONS = /* glsl */ `
  attribute float aShell;
  varying vec3 vCottonPosition;
  varying float vWisp;
  varying float vShell;
  #ifdef COTTON_INSTANCED
    attribute float aWisp;
  #else
    uniform float uWisp;
  #endif`;

const COTTON_VERTEX = /* glsl */ `
  #include <begin_vertex>
  transformed += normalize(objectNormal) * aShell * COTTON_FUZZ;
  vShell = aShell;
  #ifdef COTTON_INSTANCED
    // Fibres keep their size whatever an instance's scale; a stretched tuft's fibres stretch with it, as pulled cotton's do.
    vCottonPosition = transformed * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vWisp = aWisp;
  #else
    vCottonPosition = transformed;
    vWisp = uWisp;
  #endif`;

const COTTON_FUNCTIONS = /* glsl */ `
  varying vec3 vCottonPosition;
  varying float vWisp;
  varying float vShell;
  uniform float uCottonFrame;
  #ifdef COTTON_GLOW
    uniform float uGlow;
    uniform vec3 uGlowColor;
  #endif
  ${NOISE_FUNCTIONS}
  // x: clumping of the wool, y: filament strength.
  vec2 cottonFibres(vec3 p) {
    vec3 nudge = vec3(miniatureHash(vec3(uCottonFrame, 1.0, 2.0)), miniatureHash(vec3(uCottonFrame, 3.0, 4.0)), miniatureHash(vec3(uCottonFrame, 5.0, 6.0))) * 0.15;
    p = p * COTTON_FREQUENCY + nudge;
    vec4 tangle = miniatureNoise4(p * 0.35);
    float strand = miniatureNoise4(p * 1.3 + tangle.rgb * 3.6).r;
    float fineStrand = miniatureNoise4(p * 2.9 + tangle.gbr * 5.5 + 9.0).g;
    float filament = max(pow(1.0 - abs(strand * 2.0 - 1.0), 4.0), pow(1.0 - abs(fineStrand * 2.0 - 1.0), 6.0) * 0.85);
    return vec2(tangle.a, filament);
  }`;

const COTTON_ALPHA = /* glsl */ `
  #include <alphamap_fragment>
  // Fibre shells only show as fuzz where the tuft turns away at its silhouette; facing the eye they would sit over the
  // body and cost a full fragment each, so they are dropped before any fibre is read.
  float cottonFacing = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), normalize(vViewPosition)));
  if (vShell > 0.0 && cottonFacing > COTTON_SHELL_FACING) discard;
  vec2 fibres = cottonFibres(vCottonPosition);
  {
    float density = fibres.y * 0.85 + fibres.x * 0.45;
    // The body is solid until it wisps away; each shell out keeps only the stronger filaments.
    float needed = vShell > 0.0 ? 0.32 + vShell * 0.7 + vWisp * 0.7 : vWisp * 1.6 - 0.9;
    diffuseColor.a = 0.5 + (density - needed) * 3.0;
  }`;

const COTTON_SHADING = /* glsl */ `
  #include <normal_fragment_maps>
  if (vShell == 0.0) normal = miniatureBump(-vViewPosition, normal, (fibres.y * 0.6 + fibres.x * 0.4) * COTTON_RELIEF, faceDirection);
  // Fibres deeper in the halo sit in the shadow of those over them.
  diffuseColor.rgb *= 0.84 + vShell * 0.12 + fibres.y * 0.08;`;

// Loose fibres scatter light back towards a grazing eye: a soft bright rim in the wool's own colour, a cheap stand-in
// for a sheen lobe.
const COTTON_RIM = /* glsl */ `
  #include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - cottonFacing, 3.0) * COTTON_RIM_STRENGTH;
  #ifdef COTTON_GLOW
    // A bulb inside the tuft: it shines through the wool where the tuft faces the eye, the thin skin straight over it,
    // and dies away toward the silhouette, where the light crosses the most wool; the outer fibres stand dark against it,
    // and the clumps let more through than the gaps.
    totalEmissiveRadiance += uGlowColor * uGlow * pow(cottonFacing, 1.6) * (1.0 - vShell * 0.85) * (0.45 + fibres.x * 0.9);
  #endif`;

export interface CottonOptions {
  color: THREE.ColorRepresentation;
  /**
   * For an instanced mesh: a per-instance `aWisp` attribute instead of the material's own `wisp` uniform, and fibres
   * sized in the instances' parent space rather than shrinking and growing with each tuft.
   */
  instanced?: boolean;
  /** Filaments per unit of the geometry's own space (or, instanced, of its parent's). */
  frequency: number;
  /** How far the outermost fibre shell stands off the body, in the geometry's own units. */
  fuzz: number;
  /** A light inside the tuft, in this colour: `glow` on the material sets how bright it burns. */
  glowColor?: THREE.ColorRepresentation;
}

export type CottonMaterial = THREE.MeshStandardMaterial & { wisp: { value: number }; glow: { value: number } };

/** Relief of the fibres on a tuft's body, in world units. */
const COTTON_RELIEF = 0.004;
/** Shell fragments facing the eye more squarely than this (|cos| of the view angle) are dropped. */
const COTTON_SHELL_FACING = 0.55;
const COTTON_RIM_STRENGTH = 0.22;

export function cottonMaterial(options: CottonOptions): CottonMaterial {
  const material = applyStudioShading(new THREE.MeshStandardMaterial({
    color: options.color, roughness: 1, metalness: 0, envMapIntensity: 0.6, alphaTest: 0.5, alphaToCoverage: true,
  }));
  const wisp = { value: 0 };
  const glow = { value: 0 };
  const glowColor = { value: new THREE.Color(options.glowColor ?? '#000000') };
  const glowing = options.glowColor !== undefined;
  const instanced = options.instanced === true;
  const frequency = options.frequency.toFixed(2);
  const fuzz = options.fuzz.toFixed(4);
  extendShader(material, `cotton-${instanced ? 'instanced' : 'single'}-${frequency}-${fuzz}${glowing ? '-glow' : ''}`, (shader) => {
    Object.assign(shader.uniforms, miniatureUniforms, cottonUniforms, { uWisp: wisp, uGlow: glow, uGlowColor: glowColor });
    const defines = [
      `#define COTTON_FREQUENCY ${frequency}`, `#define COTTON_FUZZ ${fuzz}`, `#define COTTON_RELIEF ${COTTON_RELIEF.toFixed(4)}`,
      `#define COTTON_SHELL_FACING ${COTTON_SHELL_FACING.toFixed(2)}`, `#define COTTON_RIM_STRENGTH ${COTTON_RIM_STRENGTH.toFixed(2)}`,
      instanced ? '#define COTTON_INSTANCED' : '', glowing ? '#define COTTON_GLOW' : '', '',
    ].join('\n');
    shader.vertexShader = defines + shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COTTON_VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', COTTON_VERTEX);
    shader.fragmentShader = defines + shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COTTON_FUNCTIONS}`)
      .replace('#include <alphamap_fragment>', COTTON_ALPHA)
      .replace('#include <normal_fragment_maps>', COTTON_SHADING)
      .replace('#include <emissivemap_fragment>', COTTON_RIM);
  });
  return Object.assign(material, { wisp, glow });
}

/** Advances the shared cotton fibres one stop-motion frame. */
export function setCottonFrame(frame: number): void {
  cottonUniforms.uCottonFrame.value = frame % 997;
}

export interface CottonTuftOptions {
  /** Segments each icosahedron edge of the body is split into, less one (three's `IcosahedronGeometry` detail). */
  detail: number;
  /** Subdivision of the fibre shells, which need less, their edges lost in fuzz. */
  shellDetail: number;
  /** Fibre shells round the body. */
  shells: number;
  /** How far lumps push the surface in and out, as a fraction of the radius. */
  lumpiness?: number;
}

/**
 * A lumpy unit tuft with its fibre shells: a sphere pushed in and out by low-frequency noise so no two read as balls,
 * smooth-shaded, carrying `aShell` (0 on the body, rising to 1 on the outermost shell) for `cottonMaterial`. Body and
 * shells come apart so a caller can keep the shells out of the shadow pass, where they would only repeat the body.
 */
export function cottonTuftLayers(seed: number, options: CottonTuftOptions): { body: THREE.BufferGeometry; shells: THREE.BufferGeometry } {
  const lumpiness = options.lumpiness ?? 0.22;
  const body = withShellIndex(lumpySphere(options.detail, seed, lumpiness), 0);
  const shellLayers: THREE.BufferGeometry[] = [];
  for (let shell = 1; shell <= options.shells; shell++) {
    shellLayers.push(withShellIndex(lumpySphere(options.shellDetail, seed, lumpiness), shell / options.shells));
  }
  const shells = mergeGeometries(shellLayers);
  if (!shells) throw new Error('Cannot merge cotton fibre shells');
  return { body, shells };
}

/** `cottonTuftLayers` as one geometry, body first. */
export function cottonTuftGeometry(seed: number, options: CottonTuftOptions): THREE.BufferGeometry {
  const { body, shells } = cottonTuftLayers(seed, options);
  const geometry = mergeGeometries([body, shells]);
  if (!geometry) throw new Error('Cannot merge cotton tuft layers');
  return geometry;
}

function withShellIndex(geometry: THREE.BufferGeometry, shell: number): THREE.BufferGeometry {
  geometry.setAttribute('aShell', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(shell), 1));
  return geometry;
}

function lumpySphere(detail: number, seed: number, lumpiness: number): THREE.BufferGeometry {
  const sphere = new THREE.IcosahedronGeometry(1, detail);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = mergeVertices(sphere);
  const position = geometry.getAttribute('position');
  const direction = new THREE.Vector3();
  for (let index = 0; index < position.count; index++) {
    direction.fromBufferAttribute(position, index).normalize();
    const lump = lumpNoise(direction.x * 2.1 + seed, direction.y * 2.1, direction.z * 2.1) * 0.7
      + lumpNoise(direction.x * 4.6, direction.y * 4.6 + seed, direction.z * 4.6) * 0.3;
    direction.multiplyScalar(1 + (lump - 0.5) * 2 * lumpiness);
    position.setXYZ(index, direction.x, direction.y, direction.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function lumpHash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function lumpNoise(x: number, y: number, z: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const fx = smooth(x - cellX);
  const fy = smooth(y - cellY);
  const fz = smooth(z - cellZ);
  const corner = (dx: number, dy: number, dz: number) => lumpHash(cellX + dx, cellY + dy, cellZ + dz);
  const lerp = THREE.MathUtils.lerp;
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), fx), lerp(corner(0, 1, 0), corner(1, 1, 0), fx), fy),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), fx), lerp(corner(0, 1, 1), corner(1, 1, 1), fx), fy),
    fz,
  );
}
