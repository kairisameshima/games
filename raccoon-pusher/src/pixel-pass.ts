import * as THREE from "three";

/** View-depth jump (world units) between neighbouring art pixels that counts as an object's edge. */
const OUTLINE_DEPTH_THRESHOLD = 0.09;
/** Outline pixels keep this share of their colour, so outlines stay tinted like hand-drawn pixel art. */
const OUTLINE_DARKEN = 0.35;

const VERTEX_SHADER = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 lowResolution;
uniform float pixelSize;
uniform float cameraNear;
uniform float cameraFar;

vec2 texelUv(vec2 texel) {
  return (texel + 0.5) / lowResolution;
}

float viewDepth(vec2 texel) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, texelUv(texel)).x, cameraNear, cameraFar);
}

void main() {
  // Every art pixel covers an exact pixelSize x pixelSize block of the screen.
  vec2 texel = floor(gl_FragCoord.xy / pixelSize);
  vec4 color = texture2D(tColor, texelUv(texel));
  float depth = viewDepth(texel);
  float deepestNeighbour = max(
    max(viewDepth(texel + vec2(1.0, 0.0)), viewDepth(texel - vec2(1.0, 0.0))),
    max(viewDepth(texel + vec2(0.0, 1.0)), viewDepth(texel - vec2(0.0, 1.0)))
  );
  // Outline the near side of every depth step: silhouettes against the board and coins resting on coins.
  float edge = step(${OUTLINE_DEPTH_THRESHOLD.toFixed(3)}, deepestNeighbour - depth);
  color.rgb *= mix(1.0, ${OUTLINE_DARKEN.toFixed(3)}, edge);
  gl_FragColor = color;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Renders the scene at a fraction of the screen resolution, then scales it up with hard pixel edges and
 * draws a dark outline wherever depth jumps, so the 3D scene reads as pixel art.
 */
export class PixelPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly lowResolution = new THREE.Vector2(1, 1);

  constructor() {
    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depthTexture },
        lowResolution: { value: this.lowResolution },
        pixelSize: { value: 1 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /**
   * Sizes the low-resolution buffer for a drawing buffer of `width` x `height` device pixels.
   * Returns the buffer's aspect ratio, which the scene camera must use.
   */
  setSize(width: number, height: number, pixelSize: number): number {
    this.lowResolution.set(Math.max(1, Math.ceil(width / pixelSize)), Math.max(1, Math.ceil(height / pixelSize)));
    this.target.setSize(this.lowResolution.x, this.lowResolution.y);
    this.material.uniforms.pixelSize.value = pixelSize;
    return this.lowResolution.x / this.lowResolution.y;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.material.uniforms.cameraNear.value = camera.near;
    this.material.uniforms.cameraFar.value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }
}
