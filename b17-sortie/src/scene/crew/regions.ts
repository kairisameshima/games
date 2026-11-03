import * as THREE from 'three';
import { applyStudioShading } from '../../render/studio';

/**
 * Surface regions of the crew figures. Each region is one real material of 1943–44 USAAF flight clothing and gear; the
 * figure mesh carries the region's colour, roughness and metalness per vertex, so a whole figure renders in one draw.
 */
export const REGION = {
  skin: 0,
  /** B-3 jacket and A-3 trousers: brown sheepskin with the leather side out. */
  sheepskinLeather: 1,
  /** Cream shearling showing at collars, cuffs and boot tops. */
  shearling: 2,
  /** Olive drab wool: officers' trousers, the F-2/F-3 heated suit's outer shell. */
  wool: 3,
  /** Olive drab cotton duck of the M1 flyer's vest and M3 apron. */
  flakCanvas: 4,
  /** Khaki parachute harness and helmet chin straps. */
  webbing: 5,
  /** A-14 oxygen mask and hose rubber. */
  maskRubber: 6,
  /** M4 flak helmet: olive drab painted steel. */
  helmetSteel: 7,
  /** B-4 life vest. */
  lifeVest: 8,
  /** Buckles, D-rings, zips, snaps. */
  hardware: 9,
  /** Goggle lenses. */
  lens: 10,
  /** A-11 helmet leather. */
  helmetLeather: 11,
  /** A-6 boot suede. */
  bootSuede: 12,
  /** Flying gloves. */
  gloveLeather: 13,
  /** F-3 electrically heated suit. */
  heatedSuit: 14,
  hair: 15,
  /** A-2 jacket: seal-brown horsehide. */
  horsehide: 16,
  /** Knit wool cuffs and waistbands. */
  knit: 17,
  eye: 18,
  /** Black rubber of goggle frames, boot soles and the mask's hose. */
  blackRubber: 19,
  /** B-8 goggle frame and earphone cups. */
  bakelite: 20,
} as const;

interface RegionLook { color: string; roughness: number; metalness: number }

const LOOKS: Record<number, RegionLook> = {
  [REGION.skin]: { color: '#a3836f', roughness: 0.55, metalness: 0 },
  [REGION.sheepskinLeather]: { color: '#3b332c', roughness: 0.6, metalness: 0 },
  [REGION.shearling]: { color: '#c2b8a2', roughness: 0.97, metalness: 0 },
  [REGION.wool]: { color: '#555245', roughness: 0.92, metalness: 0 },
  [REGION.flakCanvas]: { color: '#575645', roughness: 0.88, metalness: 0 },
  [REGION.webbing]: { color: '#7c7663', roughness: 0.86, metalness: 0 },
  [REGION.maskRubber]: { color: '#454a43', roughness: 0.48, metalness: 0 },
  [REGION.helmetSteel]: { color: '#4b4d3e', roughness: 0.58, metalness: 0.3 },
  [REGION.lifeVest]: { color: '#a8913f', roughness: 0.72, metalness: 0 },
  [REGION.hardware]: { color: '#9d9a8f', roughness: 0.32, metalness: 0.9 },
  [REGION.lens]: { color: '#1c252c', roughness: 0.04, metalness: 0.1 },
  [REGION.helmetLeather]: { color: '#4e3b2f', roughness: 0.5, metalness: 0 },
  [REGION.bootSuede]: { color: '#5a4a3c', roughness: 0.93, metalness: 0 },
  [REGION.gloveLeather]: { color: '#3a2e26', roughness: 0.58, metalness: 0 },
  [REGION.heatedSuit]: { color: '#4d4e44', roughness: 0.88, metalness: 0 },
  [REGION.hair]: { color: '#2b1d14', roughness: 0.8, metalness: 0 },
  [REGION.horsehide]: { color: '#3c2519', roughness: 0.45, metalness: 0 },
  [REGION.knit]: { color: '#615a42', roughness: 0.96, metalness: 0 },
  [REGION.eye]: { color: '#2a1f18', roughness: 0.15, metalness: 0 },
  [REGION.blackRubber]: { color: '#191a1b', roughness: 0.55, metalness: 0 },
  [REGION.bakelite]: { color: '#221c18', roughness: 0.32, metalness: 0 },
};

export function regionLook(region: number): { color: THREE.Color; roughness: number; metalness: number } {
  const look = LOOKS[region] ?? LOOKS[REGION.wool];
  return { color: new THREE.Color(look.color), roughness: look.roughness, metalness: look.metalness };
}

let sharedCrewMaterial: THREE.MeshPhysicalMaterial | null = null;

/** One material for every figure: colour from the vertex, roughness and metalness from the `aSurface` attribute. */
export function crewMaterial(): THREE.MeshPhysicalMaterial {
  if (sharedCrewMaterial) return sharedCrewMaterial;
  const material = applyStudioShading(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 0.75, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color('#8a7a64'),
  }));
  const studioPatch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    studioPatch.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSurface;\nvarying vec2 vSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = aSurface;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurface;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;');
  };
  material.customProgramCacheKey = () => 'crew-surface';
  sharedCrewMaterial = material;
  return material;
}
