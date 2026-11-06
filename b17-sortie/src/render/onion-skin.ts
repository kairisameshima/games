import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/** How strongly the previous exposure shows through the live frame, as a frame grabber's mix does. */
const ONION_SKIN_MIX = 0.42;
/** Before the grabber has held two exposures there is no previous one to show. */
const EXPOSURES_TO_HOLD = 2;

const VERTEX_SHADER = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * The animator's onion skin: the frame grabber keeps the last exposure and mixes it over the live view, so each new
 * pose can be judged against the one before. It grabs on exposures only, never on the redraws between them (a drag of
 * the camera), so what shows through is always the previous frame of film.
 */
export class OnionSkinPass extends Pass {
  private held = new THREE.WebGLRenderTarget(1, 1);
  private latest = new THREE.WebGLRenderTarget(1, 1);
  private exposed = false;
  private grabbed = 0;
  private readonly uniforms: Record<string, THREE.IUniform> = {
    tDiffuse: { value: null },
    tHeld: { value: null },
    uMix: { value: 0 },
  };
  private readonly copyQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: this.uniforms.tDiffuse },
    vertexShader: VERTEX_SHADER,
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
    depthTest: false, depthWrite: false,
  }));
  private readonly mixQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tHeld;
      uniform float uMix;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(mix(texture2D(tDiffuse, vUv).rgb, texture2D(tHeld, vUv).rgb, uMix), 1.0); }`,
    depthTest: false, depthWrite: false,
  }));

  constructor() {
    super();
    this.enabled = false;
  }

  /** Switched on, it starts grabbing afresh: an exposure held from before would be a frame from some other moment. */
  setShown(shown: boolean): void {
    this.enabled = shown;
    this.grabbed = 0;
  }

  /** A new exposure is about to be drawn: the grabber keeps it, and the one before becomes the held frame. */
  markExposure(): void {
    this.exposed = true;
  }

  /** Resizing clears both grabs, so it starts holding afresh. */
  setSize(width: number, height: number): void {
    this.held.setSize(width, height);
    this.latest.setSize(width, height);
    this.grabbed = 0;
  }

  render(webglRenderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.exposed) {
      this.exposed = false;
      [this.held, this.latest] = [this.latest, this.held];
      webglRenderer.setRenderTarget(this.latest);
      this.copyQuad.render(webglRenderer);
      this.grabbed += 1;
    }
    this.uniforms.tHeld.value = this.held.texture;
    this.uniforms.uMix.value = this.grabbed >= EXPOSURES_TO_HOLD ? ONION_SKIN_MIX : 0;
    webglRenderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.mixQuad.render(webglRenderer);
  }
}
