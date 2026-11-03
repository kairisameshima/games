import * as THREE from 'three';

/** Materials are shared by every ship in the formation, and every ship has the same windows: patch each once. */
const patchedMaterials = new WeakSet<THREE.Material>();

/**
 * Windows as holes in the skin. Each pane is a decal projected by an oriented box; the same box discards the hull and
 * interior-skin fragments inside it, so the opening matches the pane exactly and the crew show through the glass.
 * Positions are tested in object space, which for the hull, the tail housing and the interior shells is model space.
 */
export class WindowCutouts {
  private readonly inverses: THREE.Matrix4[] = [];
  private readonly halfSizes: THREE.Vector3[] = [];

  /** Same arguments as the pane's projector box: centre, orientation, full size. */
  add(position: THREE.Vector3, orientation: THREE.Euler, size: THREE.Vector3): void {
    const box = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(orientation), new THREE.Vector3(1, 1, 1));
    this.inverses.push(box.invert());
    this.halfSizes.push(size.clone().multiplyScalar(0.5));
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
uniform vec3 uWindowHalfSize[${count}];`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${count}; i++) {
  vec3 local = (uWindowInverse[i] * vec4(vWindowPosition, 1.0)).xyz;
  if (all(lessThan(abs(local), uWindowHalfSize[i]))) discard;
}`);
    };
    material.customProgramCacheKey = () => `${baseKey}|windows-${count}`;
    material.needsUpdate = true;
  }
}
