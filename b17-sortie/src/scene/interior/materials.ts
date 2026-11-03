import * as THREE from 'three';
import { applyStudioShading, glossyMaterial, matteMaterial, metalMaterial } from '../../render/studio';
import { FUSELAGE_LENGTH } from '../b17-dimensions';
import { BULKHEADS } from './layout';

/**
 * Interior finishes of a 1943–44 Boeing-built B-17G: bare aluminium skin and structure aft of the cockpit, the pilots'
 * compartment in Dull Dark Green, quilted kapok-and-fabric insulation on the walls of the nose, flight deck and radio
 * room, plywood floors, black crinkle-finish instruments and radios, yellow oxygen bottles.
 */

export interface InteriorMaterials {
  skin: THREE.MeshStandardMaterial;
  aluminium: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  /** Inside of the ball turret's shell. */
  turretLining: THREE.MeshStandardMaterial;
  /** Frames inside the pilots' compartment, painted with it. */
  frameGreen: THREE.MeshStandardMaterial;
  cockpitGreen: THREE.MeshStandardMaterial;
  plywood: THREE.MeshStandardMaterial;
  insulation: THREE.MeshStandardMaterial;
  crinkle: THREE.MeshStandardMaterial;
  instrumentPanel: THREE.MeshStandardMaterial;
  seatCushion: THREE.MeshStandardMaterial;
  armour: THREE.MeshStandardMaterial;
  oxygen: THREE.MeshStandardMaterial;
  extinguisher: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  gunBlack: THREE.MeshStandardMaterial;
  ammunitionBox: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  chartPaper: THREE.MeshStandardMaterial;
  bulkheadWeb: THREE.MeshStandardMaterial;
  radioFace: THREE.MeshStandardMaterial;
  regulatorFace: THREE.MeshStandardMaterial;
  lampLens: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
}

let shared: InteriorMaterials | null = null;

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  return [element, context];
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function finish(element: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Quilted insulation blanket: stitched diamonds with a soft pillow shade between seams. */
function quilt(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, cell: number): void {
  context.fillStyle = '#6f6650';
  context.fillRect(x, y, width, height);
  for (let row = 0; row * cell * 0.5 < height + cell; row++) {
    for (let column = -1; column * cell < width + cell; column++) {
      const cx = x + column * cell + (row % 2 ? cell / 2 : 0);
      const cy = y + row * cell * 0.5;
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.55);
      gradient.addColorStop(0, 'rgba(255,248,225,0.13)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.12)');
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(cx, cy - cell * 0.5);
      context.lineTo(cx + cell * 0.5, cy);
      context.lineTo(cx, cy + cell * 0.5);
      context.lineTo(cx - cell * 0.5, cy);
      context.closePath();
      context.fill();
    }
  }
  context.strokeStyle = 'rgba(40,34,24,0.55)';
  context.lineWidth = 1.2;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  for (let offset = -height; offset < width + height; offset += cell / 2) {
    context.beginPath();
    context.moveTo(x + offset, y);
    context.lineTo(x + offset + height, y + height);
    context.moveTo(x + offset, y + height);
    context.lineTo(x + offset + height, y);
    context.stroke();
  }
  context.restore();
}

/**
 * Inside of the fuselage skin. UV x runs nose to tail (d / length), UV y round the section from the bottom through
 * starboard, the top and port, matching the hull loft.
 */
function interiorSkinTexture(): THREE.CanvasTexture {
  const width = 4096;
  const height = 1024;
  const [element, context] = canvas(width, height);
  const random = seeded(29);
  const toX = (d: number) => (d / FUSELAGE_LENGTH) * width;
  // Canvas y is flipped against UV y: bottom of the section (UV 0 and 1) is canvas top and bottom, the top is mid-height.
  const band = (fromV: number, toV: number) => [(1 - toV) * height, (toV - fromV) * height] as const;

  context.fillStyle = '#9da2a3';
  context.fillRect(0, 0, width, height);
  // Mill-finish variation between skin sheets.
  for (let sheet = 0; sheet < 160; sheet++) {
    context.fillStyle = `rgba(${random() > 0.5 ? '255,255,255' : '40,45,50'},${0.03 + random() * 0.05})`;
    context.fillRect(random() * width, random() * height, 80 + random() * 260, 60 + random() * 180);
  }
  // Pilots' compartment in Dull Dark Green.
  context.fillStyle = '#3e4536';
  context.fillRect(toX(BULKHEADS.noseToCockpit), 0, toX(4.75) - toX(BULKHEADS.noseToCockpit), height);

  // Insulation blankets on the upper walls of the nose, flight deck and radio room.
  for (const [from, to] of [[0.85, 2.8], [4.75, 5.72], [BULKHEADS.rearSpar + 0.05, BULKHEADS.radioToWaist - 0.05]] as const) {
    for (const [lowV, highV] of [[0.17, 0.43], [0.57, 0.83]] as const) {
      const [y, h] = band(lowV, highV);
      quilt(context, toX(from), y, toX(to) - toX(from), h, 42);
    }
  }

  // Skin seams and rivet lines: frames every 0.5 m, stringers every 1/32 of the section.
  context.strokeStyle = 'rgba(30,32,34,0.35)';
  context.lineWidth = 2;
  for (let d = 0.5; d < FUSELAGE_LENGTH; d += 0.5) {
    context.beginPath();
    context.moveTo(toX(d), 0);
    context.lineTo(toX(d), height);
    context.stroke();
  }
  context.fillStyle = 'rgba(230,232,235,0.35)';
  for (let stringer = 1; stringer < 32; stringer++) {
    const y = (stringer / 32) * height;
    for (let x = 0; x < width; x += 7) context.fillRect(x, y - 0.8, 1.6, 1.6);
  }
  return finish(element);
}

function plywoodTexture(): THREE.CanvasTexture {
  const [element, context] = canvas(512, 512);
  const random = seeded(7);
  context.fillStyle = '#8b7150';
  context.fillRect(0, 0, 512, 512);
  for (let grain = 0; grain < 260; grain++) {
    const y = random() * 512;
    context.strokeStyle = `rgba(${random() > 0.5 ? '60,40,20' : '200,170,120'},${0.06 + random() * 0.08})`;
    context.lineWidth = 1 + random() * 2;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) context.lineTo(x, y + Math.sin(x * 0.02 + grain) * 3);
    context.stroke();
  }
  // Scuffing down the walkway and countersunk screws along the edges.
  context.fillStyle = 'rgba(40,30,20,0.12)';
  context.fillRect(180, 0, 150, 512);
  context.fillStyle = 'rgba(35,30,25,0.6)';
  for (let y = 16; y < 512; y += 64) {
    context.fillRect(8, y, 4, 4);
    context.fillRect(500, y, 4, 4);
  }
  const texture = finish(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Black crinkle-finish radio face: dial windows, knobs and engraved legends. */
function radioFaceTexture(): THREE.CanvasTexture {
  const [element, context] = canvas(512, 256);
  context.fillStyle = '#1c1d1e';
  context.fillRect(0, 0, 512, 256);
  const random = seeded(3);
  for (let speck = 0; speck < 2600; speck++) {
    context.fillStyle = `rgba(255,255,255,${random() * 0.05})`;
    context.fillRect(random() * 512, random() * 256, 1.5, 1.5);
  }
  // Tuning dial window with a frequency scale.
  context.fillStyle = '#d8ceb0';
  context.fillRect(40, 30, 220, 70);
  context.strokeStyle = '#222';
  context.lineWidth = 1.5;
  for (let tick = 0; tick <= 40; tick++) {
    const x = 50 + tick * 5;
    context.beginPath();
    context.moveTo(x, 40);
    context.lineTo(x, tick % 5 === 0 ? 62 : 52);
    context.stroke();
  }
  context.fillStyle = '#b8261c';
  context.fillRect(138, 34, 3, 62);
  for (const [x, y, r] of [[330, 70, 34], [430, 70, 26], [90, 180, 26], [200, 180, 22], [320, 180, 22], [430, 180, 30]] as const) {
    context.fillStyle = '#0c0c0c';
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(220,220,210,0.7)';
    context.lineWidth = 2;
    for (let tick = 0; tick < 11; tick++) {
      const angle = Math.PI * (0.75 + tick * 0.15);
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * (r + 4), y + Math.sin(angle) * (r + 4));
      context.lineTo(x + Math.cos(angle) * (r + 10), y + Math.sin(angle) * (r + 10));
      context.stroke();
    }
  }
  context.fillStyle = 'rgba(225,225,215,0.75)';
  context.font = '600 15px "DM Mono", monospace';
  context.fillText('BC-348', 40, 128);
  context.fillText('BAND', 300, 125);
  context.fillText('GAIN', 405, 125);
  return finish(element);
}

/** A-12 demand regulator face: pressure gauge, flow blinker, diluter lever. */
function regulatorFaceTexture(): THREE.CanvasTexture {
  const [element, context] = canvas(256, 256);
  context.fillStyle = '#26282a';
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = '#eae4d2';
  context.beginPath();
  context.arc(128, 100, 70, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#111';
  context.lineWidth = 2;
  for (let tick = 0; tick <= 10; tick++) {
    const angle = Math.PI * (0.8 + tick * 0.14);
    context.beginPath();
    context.moveTo(128 + Math.cos(angle) * 52, 100 + Math.sin(angle) * 52);
    context.lineTo(128 + Math.cos(angle) * 64, 100 + Math.sin(angle) * 64);
    context.stroke();
  }
  context.strokeStyle = '#c0281f';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(128, 100);
  context.lineTo(128 + Math.cos(Math.PI * 1.9) * 55, 100 + Math.sin(Math.PI * 1.9) * 55);
  context.stroke();
  context.fillStyle = '#c9b84a';
  context.fillRect(96, 196, 64, 30);
  return finish(element);
}

export function interiorMaterials(): InteriorMaterials {
  if (shared) return shared;
  const plywood = plywoodTexture();
  shared = {
    skin: applyStudioShading(new THREE.MeshStandardMaterial({
      map: interiorSkinTexture(), roughness: 0.62, metalness: 0.35, side: THREE.BackSide, envMapIntensity: 0.45,
    })),
    aluminium: metalMaterial('#9ea3a6', { roughness: 0.5, metalness: 0.6, envMapIntensity: 0.6 }),
    frame: metalMaterial('#80868a', { roughness: 0.58, metalness: 0.45, envMapIntensity: 0.5, side: THREE.DoubleSide }),
    turretLining: metalMaterial('#7d8286', { roughness: 0.6, metalness: 0.4, envMapIntensity: 0.5, side: THREE.BackSide }),
    frameGreen: matteMaterial('#3e4536', { roughness: 0.7, side: THREE.DoubleSide }),
    cockpitGreen: matteMaterial('#3e4536', { roughness: 0.72 }),
    plywood: applyStudioShading(new THREE.MeshStandardMaterial({ map: plywood, roughness: 0.78 })),
    insulation: matteMaterial('#6f6650', { roughness: 0.95 }),
    crinkle: matteMaterial('#1c1d1e', { roughness: 0.7 }),
    instrumentPanel: matteMaterial('#ffffff', { roughness: 0.6 }),
    seatCushion: matteMaterial('#44372b', { roughness: 0.75 }),
    armour: metalMaterial('#4c4f41', { roughness: 0.6, metalness: 0.4 }),
    oxygen: glossyMaterial('#b8922e'),
    extinguisher: glossyMaterial('#9b2a20'),
    rubber: matteMaterial('#151617', { roughness: 0.72, envMapIntensity: 0.35 }),
    gunBlack: metalMaterial('#15171b', { roughness: 0.46, metalness: 0.55 }),
    ammunitionBox: matteMaterial('#575a42', { roughness: 0.7 }),
    brass: metalMaterial('#b38a45', { roughness: 0.32, metalness: 1 }),
    chartPaper: matteMaterial('#ddd6c0', { roughness: 0.9 }),
    bulkheadWeb: metalMaterial('#868c90', { roughness: 0.6, metalness: 0.45, envMapIntensity: 0.5, side: THREE.DoubleSide }),
    radioFace: applyStudioShading(new THREE.MeshStandardMaterial({ map: radioFaceTexture(), roughness: 0.6 })),
    regulatorFace: applyStudioShading(new THREE.MeshStandardMaterial({ map: regulatorFaceTexture(), roughness: 0.5 })),
    lampLens: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf8a').multiplyScalar(1.6) }),
    glass: applyStudioShading(new THREE.MeshPhysicalMaterial({ color: '#cfe2ea', roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false })),
  };
  return shared;
}
