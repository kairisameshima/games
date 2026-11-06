import * as THREE from 'three';
import { applyStudioShading, matteMaterial, metalMaterial } from '../render/studio';
import { part, roundedBox } from './kit';
import type { Finish } from './livery';
import { PALETTE } from './palette';
import { codeLettersDecal, decalSheetTexture, insigniaDecal, seededRandom, tailMarkingDecal, type DecalArt } from './textures';

/** A small enamel tin, 34 mm across and 26 mm tall, its lid's top painted in the colour inside. */
const TIN = { radius: 0.38, height: 0.58, lid: 0.06, lidOverhang: 0.02 } as const;
/** Tins stand on the floor off the mat's right-hand edge, at these spots, each nudged by up to `jitter`. */
const TIN_SPOTS = [
  new THREE.Vector2(7.0, 1.6), new THREE.Vector2(7.6, 3.0), new THREE.Vector2(6.9, 4.6), new THREE.Vector2(7.9, 5.6), new THREE.Vector2(6.3, 6.1),
] as const;
const TIN_SPOT_JITTER = 0.15;
const TINS_OUT = 4;
/** Chance each tin is left open, its lid upside down beside it. */
const OPEN_CHANCE = 0.45;
/** Enamels for a B-17 kit: the camouflage, the insignia's blue and white, the tail's yellow, the tyres' black. */
const PAINTS = [PALETTE.oliveDrab, PALETTE.neutralGray, PALETTE.insigniaBlue, PALETTE.insigniaWhite, PALETTE.tailYellow, PALETTE.aluminium, PALETTE.stencilBlack] as const;

/** The cutting mat: its middle on the floor, its surface's height and its turn (as the workshop lays it). */
const ON_MAT = { centre: new THREE.Vector2(3.6, 3.4), surface: 0.012, turn: 0.22 } as const;

/**
 * Where on the mat a thing may lie: ranges along the mat and across it from its middle (the steel rule lies across it
 * at −1.1), and how far it may be turned off the mat's edge, either way end for end. Each thing has its own band
 * across the mat, so none is left lying through another or over the rule.
 */
interface MatBand { along: [number, number]; across: [number, number]; turn: number }
const MAT_BANDS = {
  /** The sheet's near edge stays clear of the rule; its far edge may overhang the mat. */
  sheet: { along: [-0.8, 0.8], across: [0.5, 0.8], turn: 0.15 },
  brush: { along: [-0.6, 0.6], across: [0, 0.6], turn: 0.12 },
  scalpel: { along: [-0.7, 0.7], across: [-0.7, -0.5], turn: 0.12 },
} as const satisfies Record<string, MatBand>;
/** A 15 by 10 cm sheet. */
const SHEET = { width: 3.4, height: 2.3 } as const;
const BRUSH = { length: 2.6, radius: 0.045 } as const;
const SCALPEL = { handle: 2.2, blade: 0.7 } as const;

/** The next kits' markings: invented, in the group's codes, for the ships the animator builds next. */
const NEXT_KITS: readonly { codes: string; letter: string; tailSerial: string; finish: Finish }[] = [
  { codes: 'LG', letter: 'N', tailSerial: '297318', finish: 'oliveDrab' },
  { codes: 'LG', letter: 'P', tailSerial: '2107031', finish: 'naturalMetal' },
  { codes: 'OR', letter: 'T', tailSerial: '231442', finish: 'oliveDrab' },
  { codes: 'LL', letter: 'D', tailSerial: '2102847', finish: 'naturalMetal' },
];

interface Tin {
  root: THREE.Group;
  /** The lid, on the tin or upside down on the floor beside it. */
  lid: THREE.Group;
  /** What shows of the paint: the dab on the lid's top, the lid's underside, and the surface in the open tin. */
  paintSurfaces: THREE.Mesh[];
  /** The paint in the open tin. */
  paint: THREE.Mesh;
}

/**
 * The animator's bench things left on the set floor round the cutting mat, world units (about 4.4 cm each at the
 * model's 1/72): enamel tins, a brush, a scalpel, and the decal sheet for the next kit to be built. Between sorties he
 * has been at work on that kit, so they are never quite where they were: `arrange` lays them out afresh for each one.
 */
export class Workbench {
  readonly root = new THREE.Group();
  private readonly tins: Tin[];
  private readonly brush: THREE.Group;
  private readonly brushTip: THREE.Mesh;
  private readonly scalpel: THREE.Group;
  private readonly sheet: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;

  constructor() {
    this.tins = Array.from({ length: TINS_OUT }, () => buildTin());
    for (const tin of this.tins) this.root.add(tin.root);
    [this.brush, this.brushTip] = buildBrush();
    this.scalpel = buildScalpel();
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.width, SHEET.height), applyStudioShading(new THREE.MeshStandardMaterial({ roughness: 0.35 })));
    this.sheet.rotation.x = -Math.PI / 2;
    this.sheet.receiveShadow = true;
    this.root.add(this.brush, this.scalpel, this.sheet);
  }

  /** Lays the bench out as the animator left it before sortie `sortie` (0 the first): the same sortie, the same layout. */
  arrange(sortie: number): void {
    const random = seededRandom(1 + sortie * 7919);
    const spots = [...TIN_SPOTS].sort(() => random() - 0.5);
    const paints = [...PAINTS].sort(() => random() - 0.5);
    this.tins.forEach((tin, index) => {
      const spot = spots[index];
      tin.root.position.set(spot.x + (random() - 0.5) * 2 * TIN_SPOT_JITTER, 0, spot.y + (random() - 0.5) * 2 * TIN_SPOT_JITTER);
      const paint = matteMaterial(paints[index], { roughness: 0.25 });
      for (const surface of tin.paintSurfaces) surface.material = paint;
      tin.paint.visible = random() < OPEN_CHANCE;
    });
    for (const tin of this.tins) {
      const open = tin.paint.visible;
      // Shut, the lid sits pressed on; open, it lies upside down on the floor beside the tin, paint side up, on the
      // side away from the other tins and the mat.
      const away = open ? awayFromOthers(tin, this.tins) : new THREE.Vector2();
      tin.lid.position.set(away.x * TIN.radius * 2.4, open ? TIN.lid / 2 : TIN.height + TIN.lid / 2, away.y * TIN.radius * 2.4);
      tin.lid.rotation.set(open ? Math.PI : 0, 0, 0);
    }
    // The brush was last in the first tin's colour.
    this.brushTip.material = this.tins[0].paintSurfaces[0].material;
    placeOnMat(this.brush, random, BRUSH.radius, MAT_BANDS.brush);
    placeOnMat(this.scalpel, random, 0, MAT_BANDS.scalpel);
    // Just over the mat, under the brush and the scalpel where they cross it.
    placeOnMat(this.sheet, random, 0.004, MAT_BANDS.sheet);
    // Flat on the mat: the plane faces up, and its turn is about the floor's normal, its local z once laid down.
    this.sheet.rotation.set(-Math.PI / 2, 0, this.sheet.rotation.y);
    this.paintSheet(NEXT_KITS[sortie % NEXT_KITS.length]);
  }

  /** Prints the next kit's sheet; the last one's texture is let go. */
  private paintSheet(kit: (typeof NEXT_KITS)[number]): void {
    const arts: DecalArt[] = [
      insigniaDecal(), codeLettersDecal(kit.codes, kit.finish), codeLettersDecal(kit.letter, kit.finish), tailMarkingDecal(kit.tailSerial, kit.letter, kit.finish),
    ];
    const material = this.sheet.material;
    material.map?.dispose();
    material.map = decalSheetTexture(arts);
    material.needsUpdate = true;
    // Only their canvases were wanted; none was uploaded.
    for (const art of arts) {
      art.map.dispose();
      art.bumpMap.dispose();
    }
  }
}

/** Somewhere in its band on the mat, lying at `lift` over the mat's surface; the turn is about the floor's normal. */
function placeOnMat(object: THREE.Object3D, random: () => number, lift: number, band: MatBand): void {
  const along = THREE.MathUtils.lerp(band.along[0], band.along[1], random());
  const across = THREE.MathUtils.lerp(band.across[0], band.across[1], random());
  // Along the mat is its turned x, (cos, −sin) on the floor; across it is (sin, cos).
  const cos = Math.cos(ON_MAT.turn);
  const sin = Math.sin(ON_MAT.turn);
  object.position.set(ON_MAT.centre.x + along * cos + across * sin, ON_MAT.surface + lift, ON_MAT.centre.y - along * sin + across * cos);
  const endForEnd = random() < 0.5 ? Math.PI : 0;
  object.rotation.set(0, ON_MAT.turn + (random() - 0.5) * 2 * band.turn + endForEnd, 0);
}

/**
 * Unit floor direction from `tin` away from the other tins (the nearest pushing hardest) and from the mat, which lies
 * towards −x of them all.
 */
function awayFromOthers(tin: Tin, tins: Tin[]): THREE.Vector2 {
  const away = new THREE.Vector2(1, 0);
  for (const other of tins) {
    if (other === tin) continue;
    const apart = new THREE.Vector2(tin.root.position.x - other.root.position.x, tin.root.position.z - other.root.position.z);
    away.addScaledVector(apart, 2 / Math.max(apart.lengthSq(), 0.01));
  }
  return away.normalize();
}

function buildTin(): Tin {
  const root = new THREE.Group();
  const tinPlate = metalMaterial(PALETTE.chrome, { roughness: 0.38, metalness: 0.9, side: THREE.DoubleSide });
  // Open-topped, so an open tin shows its paint inside the rim.
  part(root, new THREE.CylinderGeometry(TIN.radius, TIN.radius, TIN.height, 28, 1, true), tinPlate, 0, TIN.height / 2, 0);
  const paint = part(root, new THREE.CircleGeometry(TIN.radius - 0.015, 28), tinPlate, 0, TIN.height - 0.06, 0, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
  const lid = new THREE.Group();
  const lidRadius = TIN.radius + TIN.lidOverhang;
  part(lid, new THREE.CylinderGeometry(lidRadius, lidRadius, TIN.lid, 28), tinPlate, 0, 0, 0);
  const top = part(lid, new THREE.CylinderGeometry(lidRadius * 0.72, lidRadius * 0.72, 0.006, 28), tinPlate, 0, TIN.lid / 2 + 0.003, 0, { castShadow: false });
  const underside = part(lid, new THREE.CircleGeometry(lidRadius * 0.9, 28), tinPlate, 0, -TIN.lid / 2 - 0.002, 0, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
  root.add(lid);
  return { root, lid, paintSurfaces: [top, underside, paint], paint };
}

/** A brush lying along its local x: wooden handle, ferrule, and the bristles with paint on their tip. */
function buildBrush(): [THREE.Group, THREE.Mesh] {
  const brush = new THREE.Group();
  const lying: [number, number, number] = [0, 0, Math.PI / 2];
  part(brush, new THREE.CylinderGeometry(BRUSH.radius * 0.7, BRUSH.radius, BRUSH.length, 12), matteMaterial('#9c6a35', { roughness: 0.55 }), 0, 0, 0, { rotation: lying });
  const ferruleLength = 0.3;
  part(brush, new THREE.CylinderGeometry(BRUSH.radius * 1.1, BRUSH.radius * 1.1, ferruleLength, 12), metalMaterial(PALETTE.chrome), -BRUSH.length / 2 - ferruleLength / 2, 0, 0, { rotation: lying });
  const bristles = 0.32;
  part(brush, new THREE.ConeGeometry(BRUSH.radius * 1.05, bristles, 12), matteMaterial('#2c241b'), -BRUSH.length / 2 - ferruleLength - bristles / 2, 0, 0, { rotation: lying });
  const tip = part(brush, new THREE.ConeGeometry(BRUSH.radius * 0.6, bristles * 0.45, 12), matteMaterial('#2c241b'), -BRUSH.length / 2 - ferruleLength - bristles * 0.86, 0, 0, { rotation: lying });
  return [brush, tip];
}

/** A scalpel lying flat along its local x: a steel handle and a curved blade, lifted on its handle's thickness. */
function buildScalpel(): THREE.Group {
  const scalpel = new THREE.Group();
  const steel = metalMaterial(PALETTE.chrome, { roughness: 0.25, metalness: 1, side: THREE.DoubleSide });
  const handleThickness = 0.07;
  part(scalpel, roundedBox(SCALPEL.handle, handleThickness, 0.16, 0.03), steel, 0, handleThickness / 2, 0);
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.06);
  blade.lineTo(SCALPEL.blade * 0.6, -0.08);
  blade.quadraticCurveTo(SCALPEL.blade, -0.06, SCALPEL.blade, 0.04);
  blade.lineTo(0, 0.06);
  blade.closePath();
  part(scalpel, new THREE.ShapeGeometry(blade), steel, SCALPEL.handle / 2, 0.006, 0, { rotation: [-Math.PI / 2, 0, 0] });
  return scalpel;
}
