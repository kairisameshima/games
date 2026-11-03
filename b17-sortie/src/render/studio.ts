import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

type RGB = [number, number, number];
type XYZ = [number, number, number];

interface Softbox { width: number; height: number; color: RGB; position: XYZ }
interface LightStrip { size: XYZ; color: RGB; position: XYZ }

const MAX_RENDER_PIXELS = 2_500_000;

export function initialPixelRatio(): number {
  const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / (innerWidth * innerHeight));
  return THREE.MathUtils.clamp(Math.min(devicePixelRatio, 2, pixelBudgetRatio), 1, 2);
}

// Environment maps: gradient sky plus HDR softboxes, baked through PMREM.

const ENVIRONMENT_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

function bakeEnvironment(
  pmrem: THREE.PMREMGenerator,
  skyFragmentShader: string,
  softboxes: Softbox[],
  strips: LightStrip[],
  blurSigma: number,
): THREE.Texture {
  const environmentScene = new THREE.Scene();
  environmentScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: ENVIRONMENT_VERTEX_SHADER, fragmentShader: skyFragmentShader }),
  ));
  for (const softbox of softboxes) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(softbox.width, softbox.height, 0.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...softbox.color) }),
    );
    panel.position.set(...softbox.position);
    panel.lookAt(0, 0, 0);
    environmentScene.add(panel);
  }
  for (const strip of strips) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(...strip.size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...strip.color) }),
    );
    bar.position.set(...strip.position);
    environmentScene.add(bar);
  }
  return pmrem.fromScene(environmentScene, blurSigma).texture;
}

const SHOW_SKY = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    vec3 color = mix(vec3(0.10, 0.085, 0.07), vec3(0.16, 0.19, 0.26), smoothstep(-0.4, 0.1, d.y));
    color = mix(color, vec3(0.06, 0.08, 0.13), smoothstep(0.2, 0.9, d.y));
    float warmSide = smoothstep(0.55, 0.95, d.x) * smoothstep(-0.1, 0.25, d.y) * (1.0 - smoothstep(0.3, 0.7, d.y));
    color += vec3(1.4, 0.8, 0.42) * warmSide;
    gl_FragColor = vec4(color, 1.0);
  }`;

const SHOW_SOFTBOX_COLORS: RGB[] = [[5.5, 4.2, 3], [1.8, 3.6, 5.2], [4.6, 3, 1.5], [2.6, 2.9, 3.4], [1.5, 4.2, 5.5], [3.4, 3.4, 3.4]];

// Horizon band with vertical light stripes: gives chrome long specular streaks.
const STEEL_SKY = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    float azimuth = atan(d.z, d.x);
    vec3 ground = mix(vec3(0.1, 0.12, 0.15), vec3(0.66, 0.74, 0.84), smoothstep(-0.4, -0.03, d.y));
    vec3 wall = mix(vec3(0.03, 0.035, 0.045), vec3(0.11, 0.12, 0.14), smoothstep(0.12, 0.6, d.y));
    vec3 color = mix(ground, wall, smoothstep(-0.03, 0.03, d.y));
    float stripes = pow(max(cos(azimuth * 9.0 + 0.4), 0.0), 36.0) * (0.6 + 0.4 * sin(azimuth * 2.0 + 1.0));
    color += vec3(1.7, 1.7, 1.8) * stripes * smoothstep(-0.02, 0.1, d.y) * (1.0 - smoothstep(0.45, 0.7, d.y));
    color += vec3(0.95, 0.92, 0.9) * smoothstep(0.7, 0.9, d.y);
    gl_FragColor = vec4(color, 1.0);
  }`;

const STUDIO_SKY = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    vec3 color = mix(vec3(0.62, 0.56, 0.49), vec3(1.02, 0.97, 0.9), smoothstep(-0.35, 0.15, d.y));
    color = mix(color, vec3(1.1, 1.08, 1.04), smoothstep(0.4, 0.95, d.y));
    gl_FragColor = vec4(color, 1.0);
  }`;

// Studio variant of the steel sky: warm grey ground, a brighter upper hemisphere, and fewer, softer stripes.
const LIGHT_STEEL_SKY = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    float azimuth = atan(d.z, d.x);
    vec3 ground = mix(vec3(0.07, 0.06, 0.055), vec3(0.3, 0.255, 0.21), smoothstep(-0.4, -0.03, d.y));
    vec3 wall = mix(vec3(1.2), vec3(0.42), smoothstep(0.0, 0.9, d.y));
    vec3 color = mix(ground, wall, smoothstep(-0.03, 0.03, d.y));
    float stripes = pow(max(cos(azimuth * 5.0 + 0.8), 0.0), 30.0);
    color += vec3(2.2) * stripes * smoothstep(-0.02, 0.1, d.y) * (1.0 - smoothstep(0.45, 0.7, d.y));
    gl_FragColor = vec4(color, 1.0);
  }`;

export interface Environments { show: THREE.Texture; studio: THREE.Texture; steel: THREE.Texture; lightSteel: THREE.Texture }

export function bakeEnvironments(webglRenderer: THREE.WebGLRenderer): Environments {
  const pmrem = new THREE.PMREMGenerator(webglRenderer);
  const showSoftboxes: Softbox[] = SHOW_SOFTBOX_COLORS.map((color, index) => {
    const angle = (index / 6) * Math.PI * 2 + 0.4;
    return { width: 12, height: 2.4, color, position: [Math.sin(angle) * 28, 12 + (index % 2) * 9, Math.cos(angle) * 28] };
  });
  const environments: Environments = {
    show: bakeEnvironment(pmrem, SHOW_SKY, showSoftboxes, [{ size: [40, 1.2, 1.2], color: [6, 3.4, 1.2], position: [0, -6, -30] }], 0.03),
    studio: bakeEnvironment(pmrem, STUDIO_SKY, [
      { width: 26, height: 12, color: [7, 6.8, 6.4], position: [-14, 22, 12] },
      { width: 18, height: 9, color: [4.2, 4.4, 4.8], position: [24, 12, 6] },
      { width: 30, height: 6, color: [3.2, 3.1, 3], position: [0, 30, -10] },
      { width: 8, height: 20, color: [5, 4.8, 4.6], position: [-26, 8, -6] },
    ], [], 0.03),
    steel: bakeEnvironment(pmrem, STEEL_SKY, [], [], 0.02),
    lightSteel: bakeEnvironment(pmrem, LIGHT_STEEL_SKY, [], [], 0.02),
  };
  pmrem.dispose();
  return environments;
}

// Virtual lights and saturation, patched into every standard material.

const VIRTUAL_LIGHT_COUNT = 10;
const LUMA_WEIGHTS = 'vec3(0.2126, 0.7152, 0.0722)';

export interface VirtualLight { position: THREE.Vector3; color: THREE.Color; radius: number; intensity: number; score: number }

const virtualLights: VirtualLight[] = [];
const sharedShadingUniforms = {
  uVirtualLightPosition: { value: Array.from({ length: VIRTUAL_LIGHT_COUNT }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uVirtualLightColor: { value: Array.from({ length: VIRTUAL_LIGHT_COUNT }, () => new THREE.Vector3()) },
  uSaturation: { value: 1.16 * 1.4 },
};

export function addVirtualLight(position: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, intensity: number): VirtualLight {
  const light = { position: position.clone(), color: new THREE.Color(color), radius, intensity, score: 0 };
  virtualLights.push(light);
  return light;
}

export function removeVirtualLight(light: VirtualLight): void {
  const index = virtualLights.indexOf(light);
  if (index >= 0) virtualLights.splice(index, 1);
}

export function setSaturation(saturation: number): void {
  sharedShadingUniforms.uSaturation.value = saturation;
}

const viewSpacePosition = new THREE.Vector3();

/** Positions are uploaded in view space, so call this again for every camera that renders the scene. */
function uploadVirtualLights(viewCamera: THREE.Camera, focusPoint: THREE.Vector3): void {
  for (const light of virtualLights) {
    light.score = light.intensity <= 0.001 ? -1 : (light.intensity * light.radius) / (1 + light.position.distanceToSquared(focusPoint) * 0.01);
  }
  virtualLights.sort((a, b) => b.score - a.score);
  for (let slot = 0; slot < VIRTUAL_LIGHT_COUNT; slot++) {
    const light = virtualLights[slot];
    if (!light || light.score < 0) {
      sharedShadingUniforms.uVirtualLightPosition.value[slot].set(0, -999, 0, 1);
      sharedShadingUniforms.uVirtualLightColor.value[slot].set(0, 0, 0);
      continue;
    }
    viewSpacePosition.copy(light.position).applyMatrix4(viewCamera.matrixWorldInverse);
    sharedShadingUniforms.uVirtualLightPosition.value[slot].set(viewSpacePosition.x, viewSpacePosition.y, viewSpacePosition.z, 1 / (light.radius * light.radius));
    sharedShadingUniforms.uVirtualLightColor.value[slot].set(light.color.r * light.intensity, light.color.g * light.intensity, light.color.b * light.intensity);
  }
}

const SHADING_DECLARATIONS = /* glsl */ `
  #define VIRTUAL_LIGHT_COUNT ${VIRTUAL_LIGHT_COUNT}
  uniform vec4 uVirtualLightPosition[VIRTUAL_LIGHT_COUNT]; // xyz view-space position, w = 1 / radius^2
  uniform vec3 uVirtualLightColor[VIRTUAL_LIGHT_COUNT];
  uniform float uSaturation;`;

const VIRTUAL_LIGHT_ACCUMULATION = /* glsl */ `
  #include <lights_fragment_end>
  {
    vec3 fragmentViewPosition = -vViewPosition;
    for (int i = 0; i < VIRTUAL_LIGHT_COUNT; i++) {
      vec3 toLight = uVirtualLightPosition[i].xyz - fragmentViewPosition;
      float distanceSquared = dot(toLight, toLight);
      float falloff = max(0.0, 1.0 - distanceSquared * uVirtualLightPosition[i].w);
      falloff *= falloff;
      float facing = dot(normal, toLight) * inversesqrt(distanceSquared + 1e-4);
      // 0.2 wrap term keeps surfaces facing away faintly lit, like light bouncing in a small set
      reflectedLight.directDiffuse += uVirtualLightColor[i] * falloff * (max(facing, 0.0) * 0.8 + 0.2) * material.diffuseContribution;
    }
  }`;

const SATURATION_AND_OUTPUT = /* glsl */ `
  outgoingLight = max(mix(vec3(dot(outgoingLight, ${LUMA_WEIGHTS})), outgoingLight, uSaturation), 0.0);
  #include <opaque_fragment>`;

export function applyStudioShading<T extends THREE.MeshStandardMaterial>(material: T, reflection?: PlanarReflection): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedShadingUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SHADING_DECLARATIONS}`)
      .replace('#include <lights_fragment_end>', VIRTUAL_LIGHT_ACCUMULATION)
      .replace('#include <opaque_fragment>', SATURATION_AND_OUTPUT);
    if (reflection) reflection.patchShader(shader);
  };
  material.customProgramCacheKey = () => (reflection ? 'studio-shading-reflective' : 'studio-shading');
  return material;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function cachedMaterial(key: string, create: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const existing = materialCache.get(key);
  if (existing) return existing;
  const material = applyStudioShading(create());
  material.userData.shared = true;
  materialCache.set(key, material);
  return material;
}

export function matteMaterial(color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return cachedMaterial(`matte${String(color)}${JSON.stringify(options)}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.5, ...options }));
}

export function glossyMaterial(color: THREE.ColorRepresentation, options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshStandardMaterial {
  return cachedMaterial(`glossy${String(color)}${JSON.stringify(options)}`, () =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.16, envMapIntensity: 1.1, ...options }));
}

export function metalMaterial(color: THREE.ColorRepresentation, options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshStandardMaterial {
  return cachedMaterial(`metal${String(color)}${JSON.stringify(options)}`, () =>
    new THREE.MeshPhysicalMaterial({
      color, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.25, clearcoat: 0.35, clearcoatRoughness: 0.3, ...options,
    }));
}

/** Unlit HDR emissive for light strips and LEDs. Not fogged, so it reads as a light source at any distance. */
export function emissiveMaterial(color: THREE.ColorRepresentation, intensity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), fog: false });
}

export function glassMaterial(options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return applyStudioShading(new THREE.MeshPhysicalMaterial({
    color: '#e6fbff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.14, envMapIntensity: 0.35, depthWrite: false, ...options,
  }));
}

// Planar floor reflection: a mirrored camera renders into a mipmapped target that floor materials sample with blur.

const REFLECTION_SHADER_DECLARATIONS = /* glsl */ `
  uniform sampler2D tReflection;
  uniform float uReflectionStrength;
  varying vec4 vReflectionCoord;`;

const REFLECTION_BLEND = /* glsl */ `
  {
    float facing = saturate(dot(normal, normalize(vViewPosition)));
    float gloss = 1.0 - roughnessFactor;
    vec3 mirrored = texture2D(tReflection, vReflectionCoord.xy / max(vReflectionCoord.w, 1e-4), 1.6).rgb; // mip bias blurs the mirror
    float fresnel = 0.25 + 0.75 * pow(max(1.0 - facing, 0.0), 2.0);
    outgoingLight = mix(outgoingLight, mirrored, uReflectionStrength * gloss * fresnel);
  }`;

const UP = new THREE.Vector3(0, 1, 0);
const TEXTURE_BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class PlanarReflection {
  readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  readonly uniforms = {
    tReflection: { value: this.target.texture },
    uReflectionMatrix: { value: new THREE.Matrix4() },
    uReflectionStrength: { value: 0.5 },
  };
  /** Objects to hide while rendering the mirror: the floor itself and anything that should not reflect. */
  readonly hiddenDuringReflection: THREE.Object3D[] = [];
  private readonly mirrorCamera = new THREE.PerspectiveCamera();
  private readonly planePoint: THREE.Vector3;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraRotation = new THREE.Matrix4();
  private readonly lookTarget = new THREE.Vector3();
  private readonly clipPlane = new THREE.Plane();
  private readonly clipVector = new THREE.Vector4();
  private readonly projectionCorner = new THREE.Vector4();

  constructor(planeHeight: number, private readonly resolutionScale = 0.5) {
    this.planePoint = new THREE.Vector3(0, planeHeight, 0);
  }

  patchShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uReflectionMatrix;\nvarying vec4 vReflectionCoord;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvReflectionCoord = uReflectionMatrix * modelMatrix * vec4(transformed, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${REFLECTION_SHADER_DECLARATIONS}`)
      .replace('outgoingLight = max(mix(', `${REFLECTION_BLEND}\noutgoingLight = max(mix(`);
  }

  setSize(drawingBufferWidth: number, drawingBufferHeight: number): void {
    this.target.setSize(Math.round(drawingBufferWidth * this.resolutionScale), Math.round(drawingBufferHeight * this.resolutionScale));
  }

  render(webglRenderer: THREE.WebGLRenderer, renderScene: THREE.Scene, viewCamera: THREE.PerspectiveCamera, focusPoint: THREE.Vector3): void {
    if (this.uniforms.uReflectionStrength.value <= 0) return;
    this.cameraPosition.setFromMatrixPosition(viewCamera.matrixWorld);
    if (this.cameraPosition.y <= this.planePoint.y + 0.02) return;

    this.cameraRotation.extractRotation(viewCamera.matrixWorld);
    const mirror = this.mirrorCamera;
    mirror.position.subVectors(this.planePoint, this.cameraPosition).reflect(UP).negate().add(this.planePoint);
    this.lookTarget.set(0, 0, -1).applyMatrix4(this.cameraRotation).add(this.cameraPosition);
    this.lookTarget.subVectors(this.planePoint, this.lookTarget).reflect(UP).negate().add(this.planePoint);
    mirror.up.set(0, 1, 0).applyMatrix4(this.cameraRotation).reflect(UP);
    mirror.lookAt(this.lookTarget);
    mirror.far = viewCamera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(viewCamera.projectionMatrix);
    this.uniforms.uReflectionMatrix.value.copy(TEXTURE_BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Oblique near plane: clip everything below the floor out of the mirror image.
    this.clipPlane.setFromNormalAndCoplanarPoint(UP, this.planePoint).applyMatrix4(mirror.matrixWorldInverse);
    this.clipVector.set(this.clipPlane.normal.x, this.clipPlane.normal.y, this.clipPlane.normal.z, this.clipPlane.constant);
    const projection = mirror.projectionMatrix.elements;
    this.projectionCorner.set(
      (Math.sign(this.clipVector.x) + projection[8]) / projection[0],
      (Math.sign(this.clipVector.y) + projection[9]) / projection[5],
      -1,
      (1 + projection[10]) / projection[14],
    );
    this.clipVector.multiplyScalar(2 / this.clipVector.dot(this.projectionCorner));
    projection[2] = this.clipVector.x;
    projection[6] = this.clipVector.y;
    projection[10] = this.clipVector.z + 1;
    projection[14] = this.clipVector.w;

    const visibility = this.hiddenDuringReflection.map((object) => object.visible);
    this.hiddenDuringReflection.forEach((object) => { object.visible = false; });
    const shadowNeedsUpdate = webglRenderer.shadowMap.needsUpdate;
    webglRenderer.shadowMap.needsUpdate = false;
    uploadVirtualLights(mirror, focusPoint);
    webglRenderer.setRenderTarget(this.target);
    webglRenderer.clear();
    webglRenderer.render(renderScene, mirror);
    webglRenderer.setRenderTarget(null);
    this.hiddenDuringReflection.forEach((object, index) => { object.visible = visibility[index]; });
    webglRenderer.shadowMap.needsUpdate = shadowNeedsUpdate;
  }
}

// Post-processing: MSAA scene pass, half-res GTAO and bloom, gather bokeh DOF, output, SMAA.

const FULLSCREEN_VERTEX_SHADER = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function fullscreenMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERTEX_SHADER, fragmentShader, depthTest: false, depthWrite: false });
}

class MultisampledScenePass extends Pass {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly sanitizeQuad: FullScreenQuad;

  constructor(private readonly renderScene: THREE.Scene, private readonly viewCamera: THREE.Camera, private readonly focusPoint: THREE.Vector3, samples: number) {
    super();
    this.needsSwap = false;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(1, 1) });
    this.sanitizeQuad = new FullScreenQuad(fullscreenMaterial(/* glsl */ `
      uniform sampler2D tScene;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(tScene, vUv);
        bool invalid = any(isnan(color.rgb)) || any(isinf(color.rgb));
        gl_FragColor = invalid ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(color.rgb, vec3(6.0)), color.a);
      }`, { tScene: { value: this.sceneTarget.texture } }));
  }

  setSize(width: number, height: number): void {
    this.sceneTarget.setSize(width, height);
  }

  render(webglRenderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    uploadVirtualLights(this.viewCamera, this.focusPoint);
    webglRenderer.setRenderTarget(this.sceneTarget);
    webglRenderer.clear();
    webglRenderer.render(this.renderScene, this.viewCamera);
    webglRenderer.setRenderTarget(readBuffer);
    this.sanitizeQuad.render(webglRenderer);
  }
}

const CIRCLE_OF_CONFUSION_FUNCTIONS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear, uFar, uFocusDistance, uFocusRange, uMaxCoc;
  uniform vec2 uCocScale; // x: near-field pixels per world unit, y: far-field
  float viewDistance(float depth) { return uNear * uFar / (uFar - depth * (uFar - uNear)); }
  float signedCoc(float depth) {
    float offset = viewDistance(depth) - uFocusDistance;
    bool isNear = offset < 0.0;
    float outsideFocus = max(abs(offset) - uFocusRange * (isNear ? 1.6 : 1.0), 0.0);
    return sign(offset) * min(outsideFocus * (isNear ? uCocScale.x : uCocScale.y), uMaxCoc);
  }`;

export class BokehDepthOfFieldPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly halfTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly blurTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly prepassQuad: FullScreenQuad;
  private readonly gatherQuad: FullScreenQuad;
  private readonly compositeQuad: FullScreenQuad;

  constructor(depthTexture: THREE.DepthTexture, viewCamera: THREE.PerspectiveCamera) {
    super();
    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: depthTexture },
      tHalf: { value: this.halfTarget.texture },
      tBlur: { value: this.blurTarget.texture },
      uNear: { value: viewCamera.near },
      uFar: { value: viewCamera.far },
      uFocusDistance: { value: 14 },
      uFocusRange: { value: 3 },
      uCocScale: { value: new THREE.Vector2(4, 2) },
      uMaxCoc: { value: 13 },
      uHalfTexel: { value: new THREE.Vector2() },
      uFullTexel: { value: new THREE.Vector2() },
    };
    this.prepassQuad = new FullScreenQuad(fullscreenMaterial(/* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uFullTexel;
      varying vec2 vUv;
      ${CIRCLE_OF_CONFUSION_FUNCTIONS}
      void main() {
        vec2 o = uFullTexel * 0.5;
        vec3 color = (texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
                    + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + o).rgb) * 0.25;
        float nearestDepth = min(
          min(texture2D(tDepth, vUv + vec2(-o.x, -o.y)).x, texture2D(tDepth, vUv + vec2(o.x, -o.y)).x),
          min(texture2D(tDepth, vUv + vec2(-o.x, o.y)).x, texture2D(tDepth, vUv + o).x));
        gl_FragColor = vec4(min(color, vec3(24.0)), signedCoc(nearestDepth));
      }`, this.uniforms));
    this.gatherQuad = new FullScreenQuad(fullscreenMaterial(/* glsl */ `
      uniform sampler2D tHalf;
      uniform vec2 uHalfTexel;
      uniform float uMaxCoc;
      varying vec2 vUv;
      const float GOLDEN_ANGLE = 2.39996323;
      const float RADIUS_STEP = 2.0;
      void main() {
        vec4 center = texture2D(tHalf, vUv);
        float centerCoc = abs(center.a);
        vec3 accumulated = center.rgb;
        float sampleCount = 1.0;
        float nearBlur = 0.0;
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float radius = 1.2 + jitter * 0.8;
        float angle = jitter * 6.2831853;
        for (int i = 0; i < 72; i++) {
          if (radius >= uMaxCoc) break;
          vec4 tap = texture2D(tHalf, vUv + vec2(cos(angle), sin(angle)) * uHalfTexel * radius);
          float tapCoc = abs(tap.a);
          if (tap.a > center.a) tapCoc = min(tapCoc, centerCoc * 2.0); // farther taps cannot bleed over a sharper foreground
          float weight = smoothstep(radius - 0.8, radius + 0.8, tapCoc);
          accumulated += mix(accumulated / sampleCount, tap.rgb, weight);
          sampleCount += 1.0;
          if (tap.a < 0.0) nearBlur = max(nearBlur, weight * tapCoc);
          angle += GOLDEN_ANGLE;
          radius += RADIUS_STEP / radius;
        }
        gl_FragColor = vec4(accumulated / sampleCount, nearBlur);
      }`, this.uniforms));
    this.compositeQuad = new FullScreenQuad(fullscreenMaterial(/* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tBlur;
      uniform vec2 uFullTexel;
      varying vec2 vUv;
      ${CIRCLE_OF_CONFUSION_FUNCTIONS}
      float cocAt(vec2 uv) { return abs(signedCoc(texture2D(tDepth, uv).x)); }
      void main() {
        vec3 sharp = texture2D(tColor, vUv).rgb;
        vec4 blurred = texture2D(tBlur, vUv);
        vec2 o = uFullTexel;
        float coc = min(cocAt(vUv), min(min(cocAt(vUv + vec2(o.x, 0.0)), cocAt(vUv - vec2(o.x, 0.0))),
                                         min(cocAt(vUv + vec2(0.0, o.y)), cocAt(vUv - vec2(0.0, o.y)))));
        gl_FragColor = vec4(mix(sharp, blurred.rgb, smoothstep(0.45, 1.8, max(coc, blurred.a))), 1.0);
      }`, this.uniforms));
  }

  setSize(width: number, height: number): void {
    const halfWidth = Math.ceil(width / 2);
    const halfHeight = Math.ceil(height / 2);
    this.halfTarget.setSize(halfWidth, halfHeight);
    this.blurTarget.setSize(halfWidth, halfHeight);
    this.uniforms.uHalfTexel.value.set(1 / halfWidth, 1 / halfHeight);
    this.uniforms.uFullTexel.value.set(1 / width, 1 / height);
  }

  render(webglRenderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tColor.value = readBuffer.texture;
    webglRenderer.setRenderTarget(this.halfTarget);
    this.prepassQuad.render(webglRenderer);
    webglRenderer.setRenderTarget(this.blurTarget);
    this.gatherQuad.render(webglRenderer);
    webglRenderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(webglRenderer);
  }
}

export interface StudioPipeline {
  composer: EffectComposer;
  depthOfField: BokehDepthOfFieldPass;
  bloom: UnrealBloomPass;
  ambientOcclusion: GTAOPass;
  /** Multisampled scene target. Set `samples = 0` and dispose it to turn MSAA off. */
  sceneTarget: THREE.WebGLRenderTarget;
  resize: (width: number, height: number, pixelRatio: number) => void;
}

/**
 * Unlit emissive meshes, and anything flagged `userData.skipAmbientOcclusion` (soft transparent effects), are hidden
 * while GTAO renders its normal/depth pass, so neither glowing strips nor smoke ribbons darken their surroundings.
 */
export function createStudioPipeline(
  webglRenderer: THREE.WebGLRenderer,
  renderScene: THREE.Scene,
  viewCamera: THREE.PerspectiveCamera,
  focusPoint: THREE.Vector3,
): StudioPipeline {
  const multisampleCount = webglRenderer.getPixelRatio() >= 1.5 ? 2 : 4;
  const composer = new EffectComposer(webglRenderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  composer.setPixelRatio(webglRenderer.getPixelRatio());

  const scenePass = new MultisampledScenePass(renderScene, viewCamera, focusPoint, multisampleCount);
  composer.addPass(scenePass);

  const ambientOcclusion = new GTAOPass(renderScene, viewCamera, 1, 1);
  ambientOcclusion.output = GTAOPass.OUTPUT.Default;
  ambientOcclusion.blendIntensity = 1;
  ambientOcclusion.updateGtaoMaterial({ radius: 0.6, thickness: 0.8, distanceExponent: 1.4, distanceFallOff: 1, scale: 1.1, samples: 12 });
  ambientOcclusion.updatePdMaterial({ radius: 6, rings: 2, samples: 12, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
  const setFullResolutionAmbientOcclusionSize = ambientOcclusion.setSize.bind(ambientOcclusion);
  ambientOcclusion.setSize = (width: number, height: number) => setFullResolutionAmbientOcclusionSize(Math.ceil(width / 2), Math.ceil(height / 2));
  const renderAmbientOcclusion = ambientOcclusion.render.bind(ambientOcclusion);
  const hiddenEmissives: THREE.Object3D[] = [];
  ambientOcclusion.render = (...args: Parameters<GTAOPass['render']>) => {
    hiddenEmissives.length = 0;
    renderScene.traverseVisible((object) => {
      const isUnlitEmissive = object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial && !object.material.map;
      if (isUnlitEmissive || object.userData.skipAmbientOcclusion === true) hiddenEmissives.push(object);
    });
    for (const object of hiddenEmissives) object.visible = false;
    renderAmbientOcclusion(...args);
    for (const object of hiddenEmissives) object.visible = true;
  };
  composer.addPass(ambientOcclusion);

  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.25); // strength, radius, threshold
  const setFullResolutionBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width: number, height: number) => setFullResolutionBloomSize(Math.ceil(width / 2), Math.ceil(height / 2));
  composer.addPass(bloom);

  const depthOfField = new BokehDepthOfFieldPass(scenePass.sceneTarget.depthTexture as THREE.DepthTexture, viewCamera);
  composer.addPass(depthOfField);

  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());

  const resize = (width: number, height: number, pixelRatio: number) => {
    webglRenderer.setPixelRatio(pixelRatio);
    webglRenderer.setSize(width, height);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
  };
  return { composer, depthOfField, bloom, ambientOcclusion, sceneTarget: scenePass.sceneTarget, resize };
}
