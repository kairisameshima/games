import * as THREE from 'three';
import { applyStudioShading, matteMaterial, metalMaterial } from '../render/studio';
import type { B17 } from './b17';
import { PALETTE } from './palette';
import { toX } from './hull';
import { decalSheetTexture, KIT_BOX_ART, kitBoxLidTexture, kitBoxSideTexture, kitBoxSkyTexture, type DecalArt } from './textures';

/**
 * The finished model shown off on the floor of the set: it stands on its wheels on a slowly turning turntable, beside
 * the box it came in (the nose art as the box painting) and the decal sheet its markings were cut from. World units;
 * at the model's 1/72 one is about 4.4 cm, so the box is a 37 cm kit box and the sheet a 20 cm decal sheet.
 */

const TURNTABLE = { centre: new THREE.Vector3(-12, 0, 11), radius: 5.6, baseHeight: 0.22, platterHeight: 0.06 } as const;
/** Radians per film second: a full turn in about forty seconds. */
const TURN_SPEED = 0.16;
const BOX = { centre: new THREE.Vector3(-3.4, 0.7, 17), size: [8.4, 1.4, 5.5] as [number, number, number], turn: -0.35 } as const;
/**
 * The box painting's shot of the model in flight: from ahead, port side and above, framed on the fuselage's middle, the
 * model banked a little into the turn. Model space: nose +x, port −z.
 */
const BOX_ART_SHOT = { camera: new THREE.Vector3(16, 7, -22), lookAtD: 10, fov: 30, bank: -0.18 } as const;

const SHEET = { centre: new THREE.Vector3(-4.6, 0.012, 9.4), width: 4.6, height: 3.15, turn: 0.28 } as const;

export class KitBench {
  readonly root = new THREE.Group();
  private readonly platter = new THREE.Group();
  private readonly pose = { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YZX') };
  private readonly lid: THREE.MeshStandardMaterial;
  private boxArtPainted = false;

  /** `decals` are the lead's markings, for the sheet. */
  constructor(private readonly lead: B17, private readonly scale: number, decals: DecalArt[]) {
    this.root.visible = false;
    this.lid = applyStudioShading(new THREE.MeshStandardMaterial({ map: kitBoxLidTexture(kitBoxSkyTexture().image as HTMLCanvasElement), roughness: 0.45 }));
    this.root.add(buildTurntable(this.platter), buildBox(this.lid), buildSheet(decals));
  }

  /**
   * Paints the lid's box art once: the lead itself, gear up, rendered in the set's own lights with everything else
   * hidden and the box's sky behind it, straight to the canvas and copied off before anything else draws. Rendering in
   * the same scene, lights and fog keeps every material's shader as compiled. Leaves the renderer at the box art's size; the
   * caller restores its own.
   */
  paintBoxArt(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.boxArtPainted) return;
    this.boxArtPainted = true;
    const { root } = this.lead;
    const holder = root.parent;
    const hidden = scene.children.filter((child) => child.visible && child !== holder && !(child instanceof THREE.Light));
    for (const child of hidden) child.visible = false;
    const { background } = scene;
    scene.background = kitBoxSkyTexture();
    // Thinned to nothing rather than removed: with no fog every material's shader would recompile, seconds of stall.
    const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : null;
    const density = fog?.density ?? 0;
    if (fog) fog.density = 0;
    this.lead.landingGear.setExtension(0);
    const rotation = root.rotation.clone();
    root.rotation.set(BOX_ART_SHOT.bank, 0, 0);
    root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(BOX_ART_SHOT.fov, KIT_BOX_ART.width / KIT_BOX_ART.height, 0.05, 100);
    root.localToWorld(camera.position.copy(BOX_ART_SHOT.camera));
    camera.lookAt(root.localToWorld(new THREE.Vector3(toX(BOX_ART_SHOT.lookAtD), 0, 0)));
    // Into a linear target as the film's own scene pass draws, so the materials' shaders are the ones already compiled;
    // drawing straight to the canvas would bake tone mapping into every one of them, seconds of recompiling. One quad
    // then tone-maps the target onto the canvas.
    const target = new THREE.WebGLRenderTarget(KIT_BOX_ART.width, KIT_BOX_ART.height, { type: THREE.HalfFloatType, samples: 4 });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(1);
    renderer.setSize(KIT_BOX_ART.width, KIT_BOX_ART.height, false);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false }));
    renderer.render(quad, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    // Copied in the same task as the draw, while the drawing buffer still holds it.
    const art = document.createElement('canvas');
    art.width = KIT_BOX_ART.width;
    art.height = KIT_BOX_ART.height;
    art.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
    target.dispose();
    quad.geometry.dispose();
    quad.material.dispose();
    (scene.background as THREE.Texture).dispose();
    scene.background = background;
    if (fog) fog.density = density;
    root.rotation.copy(rotation);
    for (const child of hidden) child.visible = true;
    this.lid.map?.dispose();
    this.lid.map = kitBoxLidTexture(art);
    this.lid.needsUpdate = true;
  }

  setShown(shown: boolean): void {
    this.root.visible = shown;
  }

  /** The turntable's angle `time` film seconds in, and the lead's holder pose on it, standing on its wheels. */
  update(time: number): { position: THREE.Vector3; rotation: THREE.Euler } {
    const angle = time * TURN_SPEED;
    this.platter.rotation.y = angle;
    const { ground } = this.lead.landingGear;
    this.pose.position.copy(TURNTABLE.centre).setY(TURNTABLE.baseHeight + TURNTABLE.platterHeight + ground.height * this.scale);
    this.pose.rotation.set(0, angle, ground.pitch, 'YZX');
    return this.pose;
  }

  /** The point the camera frames: between the turntable, the box and the sheet. */
  static readonly focus = new THREE.Vector3(-8, 1, 12.5);
}

function buildTurntable(platter: THREE.Group): THREE.Group {
  const turntable = new THREE.Group();
  turntable.position.copy(TURNTABLE.centre);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(TURNTABLE.radius + 0.15, TURNTABLE.radius + 0.25, TURNTABLE.baseHeight, 64), matteMaterial('#1a1b1d', { roughness: 0.5 }));
  base.position.y = TURNTABLE.baseHeight / 2;
  base.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TURNTABLE.radius, TURNTABLE.radius, TURNTABLE.platterHeight, 64), metalMaterial(PALETTE.chrome, { roughness: 0.35, metalness: 0.9 }));
  top.position.y = TURNTABLE.baseHeight + TURNTABLE.platterHeight / 2;
  top.receiveShadow = true;
  // A strip of tape on the platter's rim, so its turning shows.
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.18), matteMaterial(PALETTE.maskingTape, { roughness: 0.8 }));
  tape.position.set(TURNTABLE.radius - 0.6, TURNTABLE.baseHeight + TURNTABLE.platterHeight + 0.006, 0);
  platter.add(top, tape);
  turntable.add(base, platter);
  return turntable;
}

function buildBox(lid: THREE.Material): THREE.Mesh {
  const side = applyStudioShading(new THREE.MeshStandardMaterial({ map: kitBoxSideTexture(), roughness: 0.6 }));
  const plain = matteMaterial('#0d1b33', { roughness: 0.7 });
  // BoxGeometry faces: +x, −x, +y (the lid), −y, +z, −z.
  const box = new THREE.Mesh(new THREE.BoxGeometry(...BOX.size), [plain, plain, lid, plain, side, side]);
  box.position.copy(BOX.centre);
  box.rotation.y = BOX.turn;
  box.castShadow = true;
  box.receiveShadow = true;
  return box;
}

function buildSheet(decals: DecalArt[]): THREE.Mesh {
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.width, SHEET.height), applyStudioShading(new THREE.MeshStandardMaterial({
    map: decalSheetTexture(decals), roughness: 0.35,
  })));
  sheet.rotation.set(-Math.PI / 2, 0, SHEET.turn);
  sheet.position.copy(SHEET.centre);
  sheet.receiveShadow = true;
  return sheet;
}
