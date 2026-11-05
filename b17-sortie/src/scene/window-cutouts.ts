import * as THREE from 'three';

/** Materials are shared by every ship in the formation, and every ship has the same windows: patch each once. */
const patchedMaterials = new WeakSet<THREE.Material>();

/**
 * Windows (and the ball turret's opening) as holes in the skin. Each pane is a decal projected by an oriented box; the same box discards the hull and
 * interior-skin fragments inside it, so the opening matches the pane exactly and the crew show through the glass.
 * Positions are tested in object space, which for the hull, the tail housing and the interior shells is model space.
 */
export class WindowCutouts {
  /**
   * `cut` discards what falls inside any box (holes); `keep` discards what falls outside every box, trimming a marking
   * to a door that carries its piece of it.
   */
  constructor(private readonly mode: 'cut' | 'keep' = 'cut') {}

  private readonly inverses: THREE.Matrix4[] = [];
  /** Half extents in xyz; w is 1 for a round opening (an ellipse in the box's local xy), 0 for a rectangular one. */
  private readonly halfSizes: THREE.Vector4[] = [];

  /** Same arguments as the pane's projector box: centre, orientation, full size. */
  add(position: THREE.Vector3, orientation: THREE.Euler, size: THREE.Vector3, shape: 'box' | 'round' = 'box'): void {
    const box = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(orientation), new THREE.Vector3(1, 1, 1));
    this.inverses.push(box.invert());
    this.halfSizes.push(new THREE.Vector4(size.x / 2, size.y / 2, size.z / 2, shape === 'round' ? 1 : 0));
  }

  /** Chains onto the material's existing shader patch (studio shading), keeping its program cache key distinct. */
  apply(material: THREE.MeshStandardMaterial): void {
    if (patchedMaterials.has(material)) return;
    patchedMaterials.add(material);
    const count = this.inverses.length;
    if (count === 0) throw new Error('No windows registered');
    const uniforms = { uWindowInverse: { value: this.inverses }, uWindowHalfSize: { value: this.halfSizes } };
    const basePatch = material.onBeforeCompile;
    const baseKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      basePatch.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWindowPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWindowPosition = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWindowPosition;
uniform mat4 uWindowInverse[${count}];
uniform vec4 uWindowHalfSize[${count}];`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
bool kept = false;
for (int i = 0; i < ${count}; i++) {
  vec3 local = (uWindowInverse[i] * vec4(vWindowPosition, 1.0)).xyz;
  vec4 extent = uWindowHalfSize[i];
  bool inside = extent.w > 0.5
    ? length(local.xy / extent.xy) < 1.0 && abs(local.z) < extent.z
    : all(lessThan(abs(local), extent.xyz));
  if (inside) ${this.mode === 'cut' ? 'discard' : 'kept = true'};
}${this.mode === 'keep' ? '\nif (!kept) discard;' : ''}`);
    };
    material.customProgramCacheKey = () => `${baseKey}|windows-${this.mode}-${count}`;
    material.needsUpdate = true;
  }
}
