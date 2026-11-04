import * as THREE from 'three';
import { applyStudioShading, matteMaterial, metalMaterial } from '../render/studio';
import type { B17 } from './b17';
import { PALETTE } from './palette';
import { decalSheetTexture, kitBoxLidTexture, kitBoxSideTexture, type DecalArt } from './textures';

/**
 * The finished model shown off on the floor of the set: it stands on its wheels on a slowly turning turntable, beside
 * the box it came in (the nose art as the box painting) and the decal sheet its markings were cut from. World units;
 * at the model's 1/72 one is about 4.4 cm, so the box is a 37 cm kit box and the sheet a 20 cm decal sheet.
 */

const TURNTABLE = { centre: new THREE.Vector3(-12, 0, 11), radius: 5.6, baseHeight: 0.22, platterHeight: 0.06 } as const;
/** Radians per film second: a full turn in about forty seconds. */
const TURN_SPEED = 0.16;
const BOX = { centre: new THREE.Vector3(-3.4, 0.7, 17), size: [8.4, 1.4, 5.5] as [number, number, number], turn: -0.35 } as const;
const SHEET = { centre: new THREE.Vector3(-4.6, 0.012, 9.4), width: 4.6, height: 3.15, turn: 0.28 } as const;

export class KitBench {
  readonly root = new THREE.Group();
  private readonly platter = new THREE.Group();
  private readonly pose = { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YZX') };

  /** `decals` are the lead's markings, for the sheet. */
  constructor(private readonly lead: B17, private readonly scale: number, decals: DecalArt[]) {
    this.root.visible = false;
    this.root.add(buildTurntable(this.platter), buildBox(), buildSheet(decals));
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

function buildBox(): THREE.Mesh {
  const side = applyStudioShading(new THREE.MeshStandardMaterial({ map: kitBoxSideTexture(), roughness: 0.6 }));
  const lid = applyStudioShading(new THREE.MeshStandardMaterial({ map: kitBoxLidTexture(), roughness: 0.45 }));
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
