import * as THREE from "three";
import { createRandom } from "../mech-village/noise";

function softParticle(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.4)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function buildEffects(root: THREE.Object3D, sources: THREE.Vector3[]): { update: (seconds: number, pixelsPerUnit: number) => void } {
  const random = createRandom(451);
  const puff = softParticle();
  const count = sources.length * 14;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 2);
  for (let index = 0; index < count; index++) {
    sources[Math.floor(index / 14)].toArray(positions, index * 3);
    seeds[index * 2] = random();
    seeds[index * 2 + 1] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 2));
  const smokeMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixels: { value: 8 }, uPuff: { value: puff } },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec2 aSeed;
      uniform float uTime;
      uniform float uPixels;
      varying float vAlpha;
      void main() {
        float age = fract(aSeed.x + uTime * 0.07);
        vec3 p = position;
        p.y += age * 7.0;
        p.x -= age * age * 4.0;
        p.z += sin(age * 4.0 + aSeed.y * 6.28) * age;
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = (0.55 + age * 2.3) * uPixels / max(1.0, -viewPosition.z);
        vAlpha = smoothstep(0.0, 0.16, age) * pow(1.0 - age, 1.4) * 0.32;
      }`,
    fragmentShader: `
      uniform sampler2D uPuff;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vec3(0.85, 0.87, 0.83), texture2D(uPuff, gl_PointCoord).a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const smoke = new THREE.Points(geometry, smokeMaterial);
  smoke.frustumCulled = false;
  root.add(smoke);

  return {
    update(seconds, pixelsPerUnit) {
      smokeMaterial.uniforms.uTime.value = seconds;
      smokeMaterial.uniforms.uPixels.value = pixelsPerUnit;
    },
  };
}
