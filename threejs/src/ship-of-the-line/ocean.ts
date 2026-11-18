import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Pale, hazy blue used for horizon fog so distant silhouettes dissolve softly. */
export const OCEAN_FOG_COLOR = new THREE.Color(0xc3d8e0);
export const OCEAN_FOG_DENSITY = 0.00055;
/** Shared golden low-sun direction, reused by the scene's key light for a matching glint. */
export const OCEAN_SUN_DIRECTION = new THREE.Vector3(
  0.52,
  0.58,
  -0.62,
).normalize();
export const OCEAN_SUN_COLOR = new THREE.Color(0xfff1d0);

const WATER_DEEP = new THREE.Color(0x0a3c4e);
const WATER_SHALLOW = new THREE.Color(0x1f8a95);
const WATER_FOAM = new THREE.Color(0xeef8f7);
const SKY_ZENITH = new THREE.Color(0x4f84c4);
const SKY_HORIZON = new THREE.Color(0xdcedf0);

export interface OceanUpdateInput {
  time: number;
  windDirectionDegrees: number;
  windSpeed: number;
  shipWorldX: number;
  shipWorldZ: number;
  shipHeadingDegrees: number;
  shipSpeed: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WATER_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vHeight;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  float amp = 0.18 + uWindSpeed * 0.012;
  float freq = 0.009;
  float speedScale = 0.55 + uWindSpeed * 0.05;
  float height = 0.0;
  vec3 grad = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float angle = float(i) * 0.85;
    vec2 dir = vec2(
      uWindDir.x * cos(angle) - uWindDir.y * sin(angle),
      uWindDir.x * sin(angle) + uWindDir.y * cos(angle)
    );
    float speed = 1.0 + float(i) * 0.55;
    float phase = dot(dir, worldPos.xz) * freq + uTime * speed * speedScale;
    height += amp * sin(phase);
    grad.x -= amp * freq * dir.x * cos(phase);
    grad.z -= amp * freq * dir.y * cos(phase);
    amp *= 0.52;
    freq *= 1.85;
  }
  vec3 displaced = position;
  displaced.y += height;
  worldPos.y += height;
  vHeight = height;
  vWaveNormal = normalize(vec3(grad.x, 1.0, grad.z));
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec2 uShipPos;
uniform float uShipHeading;
uniform float uShipSpeed;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vHeight;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}

void main() {
  vec2 point = vWorldPos.xz;
  vec2 ripple = vec2(0.0);
  float wave = 0.0;
  float frequency = 0.34;
  float amplitude = 0.045;
  for (int i = 0; i < 5; i++) {
    float angle = float(i) * 1.31 + 0.6;
    vec2 direction = vec2(cos(angle), sin(angle));
    float phase = dot(point, direction) * frequency + uTime * (0.8 + float(i) * 0.4);
    ripple += direction * cos(phase) * amplitude;
    wave += sin(phase) * amplitude;
    frequency *= 1.93;
    amplitude *= 0.63;
  }
  vec3 normal = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.y));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
  float diffuse = max(dot(normal, uSunDirection), 0.0);
  vec3 base = mix(uDeepColor, uShallowColor, 0.34 + wave * 0.8);
  vec3 reflectedSky = mix(vec3(0.54, 0.69, 0.74), vec3(0.22, 0.43, 0.58), clamp(reflect(-viewDir, normal).y, 0.0, 1.0));
  vec3 color = mix(base * (0.62 + diffuse * 0.5), reflectedSky, 0.12 + fresnel * 0.72);
  vec3 halfVector = normalize(viewDir + uSunDirection);
  float spec = pow(max(dot(normal, halfVector), 0.0), 360.0);
  color += uSunColor * spec * 0.8;

  vec2 rel = point - uShipPos;
  float c = cos(-uShipHeading);
  float s = sin(-uShipHeading);
  vec2 local = vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  float behind = -local.x - 27.0;
  float speedFactor = clamp(uShipSpeed / 9.0, 0.0, 1.0);
  float wake = 0.0;
  if (behind > 0.0 && behind < 100.0) {
    float spread = 3.5 + behind * 0.18;
    float edgeDist = abs(abs(local.y) - spread);
    float line = (1.0 - smoothstep(0.1, 1.5, edgeDist)) * (1.0 - smoothstep(10.0, 100.0, behind));
    float turbulence = (sin(point.x * 3.1 + uTime * 2.0) * sin(point.y * 4.7 - uTime) + 1.0) * 0.5;
    wake = line * turbulence * speedFactor * 0.38;
  }
  float bow = (1.0 - smoothstep(0.1, 1.2, abs(local.x - 29.0))) * (1.0 - smoothstep(0.5, 3.0, abs(local.y)));
  color = mix(color, uFoamColor, clamp(wake + bow * speedFactor * 0.32, 0.0, 0.55));

  float dist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float t = clamp(dir.y * 0.9 + 0.08, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(t, 0.55));
  float sunDot = max(dot(dir, uSunDirection), 0.0);
  float sunDisc = pow(sunDot, 420.0);
  float sunGlow = pow(sunDot, 7.0) * 0.4;
  color += uSunColor * (sunDisc * 2.4 + sunGlow);
  float haze = smoothstep(0.3, -0.08, dir.y);
  color = mix(color, uHorizon, haze * 0.65);
  gl_FragColor = vec4(color, 1.0);
}
`;

function buildWater(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geometry = new THREE.PlaneGeometry(5200, 5200, 140, 140);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWindSpeed: { value: 6 },
      uDeepColor: { value: WATER_DEEP.clone() },
      uShallowColor: { value: WATER_SHALLOW.clone() },
      uFoamColor: { value: WATER_FOAM.clone() },
      uSunDirection: { value: OCEAN_SUN_DIRECTION.clone() },
      uSunColor: { value: OCEAN_SUN_COLOR.clone() },
      uFogColor: { value: OCEAN_FOG_COLOR.clone() },
      uFogDensity: { value: OCEAN_FOG_DENSITY },
      uShipPos: { value: new THREE.Vector2(0, 0) },
      uShipHeading: { value: 0 },
      uShipSpeed: { value: 0 },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return { mesh, material };
}

function buildSky(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geometry = new THREE.SphereGeometry(4600, 24, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: SKY_ZENITH.clone() },
      uHorizon: { value: SKY_HORIZON.clone() },
      uSunDirection: { value: OCEAN_SUN_DIRECTION.clone() },
      uSunColor: { value: OCEAN_SUN_COLOR.clone() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, material };
}

/** Low, hazy island silhouettes scattered around the horizon, merged into one draw call. */
function buildIslands(): THREE.Mesh {
  const random = mulberry32(777);
  const geometries: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 1500 + random() * 1400;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const baseRadius = 70 + random() * 190;
    const height = 16 + random() * 42;
    const geometry = new THREE.IcosahedronGeometry(baseRadius, 2);
    const positions = geometry.getAttribute("position");
    for (let v = 0; v < positions.count; v++) {
      const x = positions.getX(v);
      const y = positions.getY(v);
      const z = positions.getZ(v);
      const bump = Math.sin(x * 0.05 + i) * Math.cos(z * 0.045 + i * 1.7);
      const lift = Math.max(y, -baseRadius * 0.1);
      const shaped = lift * (height / baseRadius) + bump * 2.2;
      positions.setXYZ(v, x, shaped, z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.deleteAttribute("uv");
    geometry.translate(cx, -baseRadius * 0.35, cz);
    const tint = new THREE.Color().lerpColors(
      new THREE.Color(0x27454d),
      new THREE.Color(0x8fadb3),
      0.3 + random() * 0.5,
    );
    const colorCount = positions.count;
    const colors = new Float32Array(colorCount * 3);
    for (let v = 0; v < colorCount; v++) {
      colors[v * 3] = tint.r;
      colors[v * 3 + 1] = tint.g;
      colors[v * 3 + 2] = tint.b;
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error("Island geometry merge failed");
  for (const geometry of geometries) geometry.dispose();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return mesh;
}

/** Animated, hazy sea, sky dome and distant islands that stay centred under the ship. */
export class Ocean {
  readonly group = new THREE.Group();
  private readonly water: THREE.Mesh;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly islands: THREE.Mesh;

  constructor() {
    this.group.name = "ocean";
    const water = buildWater();
    this.water = water.mesh;
    this.waterMaterial = water.material;
    this.group.add(this.water);
    const sky = buildSky();
    this.sky = sky.mesh;
    this.skyMaterial = sky.material;
    this.group.add(this.sky);
    this.islands = buildIslands();
    this.group.add(this.islands);
  }

  setInspection(active: boolean): void {
    // The sea must not hide the orlop and keel below the design waterline.
    this.waterMaterial.depthWrite = !active;
    this.water.renderOrder = active ? -5 : 0;
  }

  update(input: OceanUpdateInput): void {
    const uniforms = this.waterMaterial.uniforms;
    uniforms.uTime.value = input.time;
    const windRad = (input.windDirectionDegrees * Math.PI) / 180;
    (uniforms.uWindDir.value as THREE.Vector2).set(
      Math.cos(windRad),
      Math.sin(windRad),
    );
    uniforms.uWindSpeed.value = input.windSpeed;
    (uniforms.uShipPos.value as THREE.Vector2).set(
      input.shipWorldX,
      input.shipWorldZ,
    );
    uniforms.uShipHeading.value = (input.shipHeadingDegrees * Math.PI) / 180;
    uniforms.uShipSpeed.value = input.shipSpeed;
    this.water.position.set(input.shipWorldX, 0, input.shipWorldZ);
    this.sky.position.set(input.shipWorldX, 0, input.shipWorldZ);
    this.islands.position.set(input.shipWorldX, 0, input.shipWorldZ);
  }

  dispose(): void {
    this.water.geometry.dispose();
    this.waterMaterial.dispose();
    this.sky.geometry.dispose();
    this.skyMaterial.dispose();
    this.islands.geometry.dispose();
    (this.islands.material as THREE.Material).dispose();
  }
}
