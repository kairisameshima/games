import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * The film the stop motion is shot on, applied last: grain that is new on every exposure, gate weave (each frame sits
 * a fraction of a pixel off in the projector gate), and the vignette of a macro lens close to a tabletop set.
 */
const FILM = {
  /** Grain amplitude in display values, strongest in the mid-tones. */
  grain: 0.045,
  /** Grain clump size in display pixels. */
  grainSize: 1.6,
  /** Furthest a frame sits off in the gate, in display pixels. */
  weave: 0.6,
  /** Darkening at the corners, and how far in it reaches (0 corners only, 1 the whole frame). */
  vignette: 0.32,
  vignetteReach: 0.75,
} as const;

const FILM_GATE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWeave: { value: new THREE.Vector2() },
    uSeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform vec2 uWeave;
    uniform float uSeed;
    varying vec2 vUv;
    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float grain(vec2 pixel) {
      vec2 cell = floor(pixel / ${FILM.grainSize.toFixed(2)});
      vec2 f = fract(pixel / ${FILM.grainSize.toFixed(2)});
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(grainHash(cell), grainHash(cell + vec2(1, 0)), f.x), mix(grainHash(cell + vec2(0, 1)), grainHash(cell + vec2(1, 1)), f.x), f.y) - 0.5;
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv + uWeave / uResolution);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float midtones = 4.0 * luma * (1.0 - luma);
      color.rgb += grain(gl_FragCoord.xy) * ${FILM.grain.toFixed(3)} * (0.35 + midtones);
      vec2 centred = vUv - 0.5;
      centred.x *= uResolution.x / uResolution.y;
      float vignette = smoothstep(${(1 - FILM.vignetteReach).toFixed(2)}, 1.25, length(centred) * 1.4);
      color.rgb *= 1.0 - vignette * ${FILM.vignette.toFixed(2)};
      gl_FragColor = color;
    }`,
};

export class FilmGatePass extends ShaderPass {
  constructor() {
    super(FILM_GATE_SHADER);
  }

  setSize(width: number, height: number): void {
    (this.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  /** A new exposure: fresh grain, and the frame lands somewhere new in the gate. */
  advance(random: () => number): void {
    this.uniforms.uSeed.value = random() * 97;
    (this.uniforms.uWeave.value as THREE.Vector2).set((random() - 0.5) * 2 * FILM.weave, (random() - 0.5) * 2 * FILM.weave);
  }
}
