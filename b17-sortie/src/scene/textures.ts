import * as THREE from 'three';
import { PALETTE } from './palette';

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  return [canvas, context];
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Sun-faded Olive Drab: large soft blotches, lighter and browner where the paint has chalked. */
function fadeMottle(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, random: () => number, count: number): void {
  for (let blotch = 0; blotch < count; blotch++) {
    const centreX = x + random() * width;
    const centreY = y + random() * height;
    const radius = 20 + random() * 90;
    const gradient = context.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius);
    const light = random() > 0.45;
    const alpha = 0.05 + random() * 0.07;
    gradient.addColorStop(0, light ? `rgba(150,138,98,${alpha})` : `rgba(30,32,20,${alpha})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(centreX - radius, centreY - radius, radius * 2, radius * 2);
  }
}

function panelLine(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, alpha: number, width = 1.6): void {
  context.strokeStyle = `rgba(12,12,8,${alpha})`;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function rivetRow(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, spacing: number): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  context.fillStyle = 'rgba(255,250,230,0.08)';
  for (let distance = 0; distance < length; distance += spacing) {
    const t = distance / length;
    context.fillRect(x1 + (x2 - x1) * t - 0.7, y1 + (y2 - y1) * t - 0.7, 1.4, 1.4);
  }
}

export interface HullPaintOptions {
  lengthMetres: number;
  /** Frame stations in metres along the hull, drawn as circumferential panel lines. */
  majorJoints: number[];
  frameSpacing: number;
  /** Half the angular width of the Olive Drab band either side of the top, as a fraction of a full turn. */
  oliveDrabHalfBand: number;
  /** Station range (fraction of length) where turbo exhaust soot streaks the underside, if any. */
  sootFrom?: number;
  seed: number;
  width: number;
  height: number;
}

/**
 * Paint for lofted hulls whose UV x runs nose to tail and UV y runs round the section from the bottom,
 * through starboard and the top, to port. Canvas y is flipped against UV y, so the top centreline is at half height.
 */
export function hullPaintTexture(options: HullPaintOptions): THREE.CanvasTexture {
  const { width, height } = options;
  const [canvas, context] = createCanvas(width, height);
  const random = seededRandom(options.seed);

  context.fillStyle = PALETTE.neutralGray;
  context.fillRect(0, 0, width, height);
  // Soft-edged spray demarcation that wanders a little along the hull.
  const bandHalf = options.oliveDrabHalfBand * height;
  for (let x = 0; x < width; x += 4) {
    const wobble = Math.sin(x * 0.011 + options.seed) * height * 0.008 + Math.sin(x * 0.037) * height * 0.003;
    const gradient = context.createLinearGradient(0, height / 2 - bandHalf - wobble - 6, 0, height / 2 + bandHalf + wobble + 6);
    const edge = 6 / (2 * (bandHalf + wobble + 6));
    gradient.addColorStop(0, 'rgba(91,88,67,0)');
    gradient.addColorStop(edge, PALETTE.oliveDrab);
    gradient.addColorStop(1 - edge, PALETTE.oliveDrab);
    gradient.addColorStop(1, 'rgba(91,88,67,0)');
    context.fillStyle = gradient;
    context.fillRect(x, height / 2 - bandHalf - wobble - 6, 4, 2 * (bandHalf + wobble + 6));
  }
  fadeMottle(context, 0, height / 2 - bandHalf, width, bandHalf * 2, random, 160);

  const pixelsPerMetre = width / options.lengthMetres;
  for (let station = options.frameSpacing; station < options.lengthMetres; station += options.frameSpacing) {
    panelLine(context, station * pixelsPerMetre, 0, station * pixelsPerMetre, height, 0.12, 1.1);
  }
  for (const joint of options.majorJoints) {
    const x = joint * pixelsPerMetre;
    panelLine(context, x, 0, x, height, 0.38, 2);
    rivetRow(context, x + 4, 0, x + 4, height, 6);
  }
  for (let stringer = 1; stringer < 24; stringer++) {
    const y = (stringer / 24) * height;
    panelLine(context, 0, y, width, y, stringer % 3 === 0 ? 0.22 : 0.08, stringer % 3 === 0 ? 1.6 : 1);
  }

  if (options.sootFrom !== undefined) {
    // Exhaust soot along the underside (UV y near 0 and 1, which is canvas top and bottom).
    for (const edgeY of [0, height]) {
      const gradient = context.createLinearGradient(0, edgeY, 0, edgeY === 0 ? height * 0.22 : height * 0.78);
      gradient.addColorStop(0, 'rgba(20,18,16,0.55)');
      gradient.addColorStop(1, 'rgba(20,18,16,0)');
      context.fillStyle = gradient;
      const startX = options.sootFrom * width;
      context.fillRect(startX, edgeY === 0 ? 0 : height * 0.78, width - startX, height * 0.22);
    }
  }
  return finishTexture(canvas);
}

export interface SurfacePaintOptions {
  spanMetres: number;
  upperColor: string;
  lowerColor: string;
  /** Spanwise ranges in metres with black rubber de-icer boots on the leading edge. */
  deIcerBoots: [number, number][];
  /** Spanwise ranges in metres of the control surfaces (aileron, flap, elevator) behind the rear spar. */
  controlSurfaces: [number, number][];
  ribSpacing: number;
  seed: number;
}

/**
 * Paint for lifting surfaces: UV x runs root to tip, UV y runs round the airfoil from the upper trailing edge
 * (0) through the leading edge (0.5) to the lower trailing edge (1).
 */
export function surfacePaintTexture(options: SurfacePaintOptions): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const [canvas, context] = createCanvas(width, height);
  const random = seededRandom(options.seed);
  const canvasY = (aroundParam: number) => (1 - aroundParam) * height;
  const spanX = (metres: number) => (metres / options.spanMetres) * width;
  // Chord fraction from the leading edge to the ring parameter on each surface (cosine spacing).
  const upperParam = (chordFraction: number) => (1 - Math.acos(1 - 2 * chordFraction) / Math.PI) / 2;
  const lowerParam = (chordFraction: number) => 1 - upperParam(chordFraction);

  context.fillStyle = options.lowerColor;
  context.fillRect(0, 0, width, height / 2);
  context.fillStyle = options.upperColor;
  // Factory Olive Drab wraps a few percent of chord under the leading edge.
  context.fillRect(0, canvasY(lowerParam(0.03)), width, height - canvasY(lowerParam(0.03)));
  if (options.upperColor === PALETTE.oliveDrab) fadeMottle(context, 0, height / 2, width, height / 2, random, 140);
  if (options.lowerColor === PALETTE.oliveDrab) fadeMottle(context, 0, 0, width, height / 2, random, 140);

  for (const [start, end] of options.deIcerBoots) {
    context.fillStyle = '#16171a';
    context.fillRect(spanX(start), canvasY(lowerParam(0.09)), spanX(end) - spanX(start), canvasY(upperParam(0.11)) - canvasY(lowerParam(0.09)));
    for (let tube = 0; tube < 5; tube++) {
      const y = canvasY(upperParam(0.015 + tube * 0.02));
      panelLine(context, spanX(start), y, spanX(end), y, 0.5, 1);
    }
  }

  for (let rib = options.ribSpacing; rib < options.spanMetres; rib += options.ribSpacing) {
    panelLine(context, spanX(rib), 0, spanX(rib), height, 0.1, 1);
  }
  for (const chordFraction of [0.15, 0.6]) {
    for (const param of [upperParam(chordFraction), lowerParam(chordFraction)]) {
      panelLine(context, 0, canvasY(param), width, canvasY(param), 0.3, 1.6);
      rivetRow(context, 0, canvasY(param) + 3, width, canvasY(param) + 3, 7);
    }
  }
  for (const [start, end] of options.controlSurfaces) {
    for (const param of [upperParam(0.75), lowerParam(0.75)]) {
      panelLine(context, spanX(start), canvasY(param), spanX(end), canvasY(param), 0.55, 2);
    }
    for (const x of [spanX(start), spanX(end)]) {
      panelLine(context, x, canvasY(lowerParam(0.75)), x, canvasY(lowerParam(1)), 0.55, 2);
      panelLine(context, x, canvasY(upperParam(0.75)), x, canvasY(upperParam(1)), 0.55, 2);
    }
    // Fabric-covered control surfaces show their ribs through the dope.
    for (let rib = start + 0.25; rib < end; rib += 0.25) {
      panelLine(context, spanX(rib), canvasY(upperParam(0.76)), spanX(rib), height, 0.14, 2.2);
      panelLine(context, spanX(rib), 0, spanX(rib), canvasY(lowerParam(0.76)), 0.14, 2.2);
    }
  }
  return finishTexture(canvas);
}

/** A kit's water-slide decal: the printed art, and the height its film and ink stand off the paint. */
export interface DecalArt {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  /** How much larger than the art the decal must be projected, per axis, to take in the film's margin. */
  growth: THREE.Vector2;
}

const DECAL_FILM_ALPHA = 0.07;

/**
 * Lays printed art on its carrier film: a clear, faintly ivory film trimmed `marginPx` round the art, with the soft
 * shadow its lip throws on the paint; the bump map stands the film off the paint and the ink off the film.
 */
function waterSlideDecal(art: HTMLCanvasElement, marginPx: number): DecalArt {
  const pad = marginPx + 8;
  const width = art.width + pad * 2;
  const height = art.height + pad * 2;
  const [filmCanvas, film] = createCanvas(width, height);
  for (let step = 0; step < 32; step++) {
    const angle = (step / 16) * Math.PI;
    const reach = step < 16 ? marginPx : marginPx * 0.55;
    film.drawImage(art, pad + Math.cos(angle) * reach, pad + Math.sin(angle) * reach);
  }
  film.globalCompositeOperation = 'source-in';
  film.fillStyle = '#ffffff';
  film.fillRect(0, 0, width, height);

  const [canvas, context] = createCanvas(width, height);
  // The film's edge stands a fraction of a millimetre proud and throws a soft line of shadow just outside it.
  context.filter = 'blur(2px)';
  context.globalAlpha = 0.5;
  context.drawImage(tinted(filmCanvas, '#000000'), 1.5, 2.5);
  context.globalAlpha = 1;
  context.filter = 'none';
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(filmCanvas, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = DECAL_FILM_ALPHA;
  context.drawImage(tinted(filmCanvas, '#efeadb'), 0, 0);
  context.globalAlpha = 1;
  context.drawImage(art, pad, pad);
  context.drawImage(silvering(filmCanvas, art, pad), 0, 0);

  const [bumpCanvas, bump] = createCanvas(width, height);
  bump.fillStyle = '#000000';
  bump.fillRect(0, 0, width, height);
  bump.filter = 'blur(1.5px)';
  bump.globalAlpha = 0.5;
  bump.drawImage(filmCanvas, 0, 0);
  bump.globalAlpha = 1;
  bump.filter = 'blur(1px)';
  bump.drawImage(tinted(art, '#ffffff'), pad, pad);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 8;
  return { map: finishTexture(canvas), bumpMap, growth: new THREE.Vector2(width / art.width, height / art.height) };
}

/**
 * Silvering: air trapped under the clear film where it did not settle onto the paint, flecks of bright silver in the
 * film's margin round the art, thickest at its outer edge where the decal setting solution never reached.
 */
function silvering(film: HTMLCanvasElement, art: HTMLCanvasElement, pad: number): HTMLCanvasElement {
  const [canvas, context] = createCanvas(film.width, film.height);
  const random = seededRandom(film.width * 7 + film.height);
  const flecks = Math.round((film.width + film.height) * 0.9);
  for (let fleck = 0; fleck < flecks; fleck++) {
    const x = random() * film.width;
    const y = random() * film.height;
    context.fillStyle = `rgba(222,226,230,${0.35 + random() * 0.4})`;
    context.beginPath();
    context.ellipse(x, y, 0.8 + random() * 2.6, 0.6 + random() * 1.8, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(film, 0, 0);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(art, pad, pad);
  return canvas;
}

/** `source` with every opaque pixel turned `color`, keeping its alpha. */
function tinted(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const [canvas, context] = createCanvas(source.width, source.height);
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, source.width, source.height);
  return canvas;
}

/** 1943–44 national insignia: white star on a blue disc, white bars, all outlined in insignia blue. */
export function insigniaDecal(): DecalArt {
  const radius = 220;
  const border = radius / 8;
  const width = Math.round(radius * 4 + border * 2) + 8;
  const height = Math.round(radius * 2 + border * 2) + 8;
  const [canvas, context] = createCanvas(width, height);
  const centreX = width / 2;
  const centreY = height / 2;
  const barHalfHeight = radius / 4;

  context.fillStyle = PALETTE.insigniaBlue;
  context.beginPath();
  context.arc(centreX, centreY, radius + border, 0, Math.PI * 2);
  context.fill();
  context.fillRect(centreX - 2 * radius - border, centreY - barHalfHeight - border, 4 * radius + 2 * border, 2 * (barHalfHeight + border));
  context.fillStyle = PALETTE.insigniaWhite;
  context.fillRect(centreX - 2 * radius, centreY - barHalfHeight, 4 * radius, 2 * barHalfHeight);
  context.fillStyle = PALETTE.insigniaBlue;
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = PALETTE.insigniaWhite;
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const pointRadius = point % 2 === 0 ? radius : radius * 0.382;
    context.lineTo(centreX + Math.cos(angle) * pointRadius, centreY + Math.sin(angle) * pointRadius);
  }
  context.closePath();
  context.fill();
  return waterSlideDecal(canvas, 12);
}

/** Fuselage codes in the medium-grey stencil the 91st BG used on camouflaged aircraft. */
export function codeLettersDecal(letters: string): DecalArt {
  const [canvas, context] = createCanvas(256 * letters.length, 320);
  context.fillStyle = PALETTE.codeGray;
  context.font = '700 300px "DM Mono", Menlo, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letters, canvas.width / 2, canvas.height / 2 + 12);
  return waterSlideDecal(canvas, 10);
}

/** 91st BG "Triangle A" in white with the group letter in insignia blue, and the tail serial below in yellow. */
export function tailMarkingDecal(serial: string, aircraftLetter: string): DecalArt {
  const [canvas, context] = createCanvas(512, 760);
  context.fillStyle = PALETTE.insigniaWhite;
  context.beginPath();
  context.moveTo(256, 20);
  context.lineTo(486, 400);
  context.lineTo(26, 400);
  context.closePath();
  context.fill();
  context.fillStyle = PALETTE.insigniaBlue;
  context.font = '800 250px Outfit, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('A', 256, 280);
  context.fillStyle = PALETTE.tailYellow;
  context.font = '700 112px "DM Mono", Menlo, monospace';
  context.fillText(serial, 256, 500);
  context.font = '700 170px "DM Mono", Menlo, monospace';
  context.fillText(aircraftLetter, 256, 660);
  return waterSlideDecal(canvas, 12);
}


/** How many hand-cut flash pieces the props box holds; each shot or burst picks one. */
export const HAND_CUT_FLASH_PIECES = 4;

let flashPieces: THREE.CanvasTexture[] | null = null;

/**
 * Flashes for stop motion are replacement pieces cut from painted paper, not glows: a ragged star of flat colour bands,
 * pale yellow in the middle through orange to a red rim, with the scissor cuts left straight. Each piece is cut
 * differently.
 */
export function handCutFlashTextures(): THREE.CanvasTexture[] {
  if (flashPieces) return flashPieces;
  flashPieces = Array.from({ length: HAND_CUT_FLASH_PIECES }, (_, piece) => {
    const size = 256;
    const [canvas, context] = createCanvas(size, size);
    const random = seededRandom(301 + piece * 59);
    const points = 9 + Math.floor(random() * 5);
    const tips = Array.from({ length: points }, () => 0.7 + random() * 0.3);
    const notches = Array.from({ length: points }, () => 0.28 + random() * 0.22);
    const turn = random() * Math.PI;
    for (const [scale, colour] of [[1, '#c2301b'], [0.78, '#f07a1e'], [0.52, '#ffc23a'], [0.26, '#fff4c4']] as const) {
      context.fillStyle = colour;
      context.beginPath();
      for (let index = 0; index < points * 2; index++) {
        const angle = turn + (index / (points * 2)) * Math.PI * 2;
        const radius = (index % 2 === 0 ? tips[index / 2] : notches[(index - 1) / 2]) * scale * (size / 2 - 4);
        context.lineTo(size / 2 + Math.cos(angle) * radius, size / 2 + Math.sin(angle) * radius);
      }
      context.closePath();
      context.fill();
    }
    return finishTexture(canvas);
  });
  return flashPieces;
}

/**
 * Polystyrene cement fogging clear plastic: a frosted, milky blotch where a careless brush touched the glazing, crazed
 * at its heart and creeping out in a ragged edge. White on transparent.
 */
export function glueFogTexture(): THREE.CanvasTexture {
  const size = 256;
  const [canvas, context] = createCanvas(size, size);
  const random = seededRandom(613);
  for (let blot = 0; blot < 60; blot++) {
    const angle = random() * Math.PI * 2;
    const reach = Math.pow(random(), 0.7) * size * 0.34;
    const x = size / 2 + Math.cos(angle) * reach;
    const y = size / 2 + Math.sin(angle) * reach * 0.7;
    const radius = 10 + random() * 26;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(240,242,236,${0.18 + random() * 0.12})`);
    gradient.addColorStop(1, 'rgba(240,242,236,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  // Crazing: fine cracks where the solvent bit hardest.
  context.strokeStyle = 'rgba(255,255,255,0.35)';
  context.lineWidth = 1;
  for (let crack = 0; crack < 26; crack++) {
    let x = size / 2 + (random() - 0.5) * 60;
    let y = size / 2 + (random() - 0.5) * 40;
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 5; step++) {
      x += (random() - 0.5) * 22;
      y += (random() - 0.5) * 22;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  return finishTexture(canvas);
}

/**
 * A thumbprint in skin oil: whorl ridges round an off-centre core, broken where the ridges split, fading to the edge.
 * Pale grey on transparent; on glass it reads as a greasy smudge that catches the light.
 */
export function fingerprintTexture(): THREE.CanvasTexture {
  const size = 256;
  const [canvas, context] = createCanvas(size, size);
  const random = seededRandom(271);
  const core = { x: size * 0.47, y: size * 0.55 };
  context.lineWidth = 2.2;
  for (let ridge = 1; ridge < 34; ridge++) {
    const radius = ridge * 3.6;
    const breaks = 2 + Math.floor(random() * 3);
    for (let arc = 0; arc < breaks; arc++) {
      const start = (arc / breaks) * Math.PI * 2 + random() * 0.4;
      const end = ((arc + 1) / breaks) * Math.PI * 2 - random() * 0.35;
      const fade = 1 - ridge / 34;
      context.strokeStyle = `rgba(214,214,206,${0.5 * fade})`;
      context.beginPath();
      for (let step = 0; step <= 24; step++) {
        const angle = start + ((end - start) * step) / 24;
        // Ridges flatten towards the tip of the thumb, as a pressed print does.
        const x = core.x + Math.cos(angle) * radius * 1.05;
        const y = core.y + Math.sin(angle) * radius * (Math.sin(angle) < 0 ? 0.82 : 1.15);
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  }
  return finishTexture(canvas);
}
