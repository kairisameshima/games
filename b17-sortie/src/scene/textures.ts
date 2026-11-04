import * as THREE from 'three';
import hallucinatinHattieUrl from '../assets/nose-art-hallucinatin-hattie.png';
import { PALETTE } from './palette';
import type { Finish } from './livery';

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
  finish: Finish;
  /** Half the angular width of the Olive Drab band either side of the top, as a fraction of a full turn. */
  oliveDrabHalfBand: number;
  /** On bare metal, the Olive Drab anti-glare panel over the top of the nose ahead of the windscreen, in metres. */
  antiGlare?: [number, number];
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

  const pixelsPerMetre = width / options.lengthMetres;
  if (options.finish === 'naturalMetal') {
    bareMetalPanels(context, width, height, options.frameSpacing * pixelsPerMetre, height / 24, random);
    if (options.antiGlare) {
      const [start, end] = options.antiGlare;
      const halfBand = options.oliveDrabHalfBand * 0.35 * height;
      context.fillStyle = PALETTE.oliveDrab;
      context.fillRect(start * pixelsPerMetre, height / 2 - halfBand, (end - start) * pixelsPerMetre, halfBand * 2);
    }
  } else {
    sprayCamouflage(context, width, height, options, random);
  }
  hullPanelLines(context, width, height, options, pixelsPerMetre);

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

/** Olive Drab sprayed over the Neutral Gray, the band either side of the top with a soft, wandering demarcation. */
function sprayCamouflage(context: CanvasRenderingContext2D, width: number, height: number, options: HullPaintOptions, random: () => number): void {
  context.fillStyle = PALETTE.neutralGray;
  context.fillRect(0, 0, width, height);
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
}

/** How far a bare skin panel's tone strays from the aluminium, either way: sheets from different batches and tempers. */
const BARE_PANEL_TONE_SPREAD = 0.07;

/** Bare aluminium, panel by panel, each sheet a slightly different tone. */
function bareMetalPanels(context: CanvasRenderingContext2D, width: number, height: number, panelWidth: number, panelHeight: number, random: () => number): void {
  context.fillStyle = PALETTE.aluminium;
  context.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x += panelWidth) {
    for (let y = 0; y < height; y += panelHeight) {
      const tone = (random() * 2 - 1) * BARE_PANEL_TONE_SPREAD;
      context.fillStyle = tone > 0 ? `rgba(255,255,255,${tone})` : `rgba(40,44,48,${-tone})`;
      context.fillRect(x, y, panelWidth, panelHeight);
    }
  }
}

/** Frame lines, the section joints with their rivet rows, and the stringer lines. */
function hullPanelLines(context: CanvasRenderingContext2D, width: number, height: number, options: HullPaintOptions, pixelsPerMetre: number): void {
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
  if (options.upperColor === PALETTE.aluminium) bareMetalPanels(context, width, height, spanX(options.ribSpacing * 2), height / 16, random);
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
 * Lays printed art on its carrier film: a clear, faintly ivory film trimmed `marginPx` round the art (or, `sheet`, left
 * as one rounded rectangle round art too fiddly to cut round, like a row of tally marks), with the soft shadow its lip
 * throws on the paint; the bump map stands the film off the paint and the ink off the film.
 */
function waterSlideDecal(art: HTMLCanvasElement, marginPx: number, film: 'trimmed' | 'sheet' = 'trimmed'): DecalArt {
  const pad = marginPx + 8;
  const width = art.width + pad * 2;
  const height = art.height + pad * 2;
  const [filmCanvas, filmContext] = createCanvas(width, height);
  if (film === 'sheet') {
    filmContext.fillStyle = '#ffffff';
    filmContext.beginPath();
    filmContext.roundRect(pad - marginPx, pad - marginPx, art.width + marginPx * 2, art.height + marginPx * 2, marginPx * 0.6);
    filmContext.fill();
  } else {
    for (let step = 0; step < 32; step++) {
      const angle = (step / 16) * Math.PI;
      const reach = step < 16 ? marginPx : marginPx * 0.55;
      filmContext.drawImage(art, pad + Math.cos(angle) * reach, pad + Math.sin(angle) * reach);
    }
    filmContext.globalCompositeOperation = 'source-in';
    filmContext.fillStyle = '#ffffff';
    filmContext.fillRect(0, 0, width, height);
  }

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
  // Only along the film's edge: further in, the setting solution pulled the film down.
  context.drawImage(eroded(film, SILVERING_BAND_PX), 0, 0);
  return canvas;
}

/** How far in from the film's edge silvering reaches, in texture pixels. */
const SILVERING_BAND_PX = 7;

/** `mask` shrunk by `radius` pixels: what stays opaque under every shifted copy. */
function eroded(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const [canvas, context] = createCanvas(mask.width, mask.height);
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  for (let step = 0; step < 12; step++) {
    const angle = (step / 12) * Math.PI * 2;
    context.drawImage(mask, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
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

/** Fuselage codes: medium grey on camouflage, black on bare metal (303rd BG markings notes, after Freeman). */
export function codeLettersDecal(letters: string, finish: Finish): DecalArt {
  const [canvas, context] = createCanvas(256 * letters.length, 320);
  context.fillStyle = finish === 'naturalMetal' ? PALETTE.stencilBlack : PALETTE.codeGray;
  context.font = '700 300px "DM Mono", Menlo, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(letters, canvas.width / 2, canvas.height / 2 + 12);
  return waterSlideDecal(canvas, 10);
}

/**
 * 91st BG "Triangle A" with the tail serial and call letter below: on camouflage a white triangle with the letter in
 * insignia blue and the serial in yellow; on bare metal a black triangle with a white letter and black stencils, as
 * 42-102509 wears them (reference/photo-91bg-b17g-42-102509.jpg).
 */
export function tailMarkingDecal(serial: string, aircraftLetter: string, finish: Finish): DecalArt {
  const bareMetal = finish === 'naturalMetal';
  const [canvas, context] = createCanvas(512, 760);
  context.fillStyle = bareMetal ? PALETTE.stencilBlack : PALETTE.insigniaWhite;
  context.beginPath();
  context.moveTo(256, 20);
  context.lineTo(486, 400);
  context.lineTo(26, 400);
  context.closePath();
  context.fill();
  context.fillStyle = bareMetal ? PALETTE.insigniaWhite : PALETTE.insigniaBlue;
  context.font = '800 250px Outfit, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('A', 256, 280);
  context.fillStyle = bareMetal ? PALETTE.stencilBlack : PALETTE.tailYellow;
  context.font = `700 ${serial.length > 6 ? 98 : 112}px "DM Mono", Menlo, monospace`;
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

/** Missions the lead ship has flown, one bomb each in the tally under the pilot's window. */
export const MISSIONS_FLOWN = 24;

/** The nose art the lead ship can carry: Hattie, or the playing card. */
export type NoseArtChoice = 'pinup' | 'card';

let noseArtPainting: HTMLImageElement | null = null;

/**
 * Loads the pin-up, "Hallucinatin' Hattie": a 1944-style calendar girl on a typewriter, its ticker tape curling into
 * her name banner. `noseArtDecal('pinup')` needs it loaded first.
 */
export async function loadNoseArt(): Promise<void> {
  const image = new Image();
  image.src = hallucinatinHattieUrl;
  await image.decode();
  noseArtPainting = image;
}

/** The chosen nose art as a kit decal, its film trimmed round the art. */
export function noseArtDecal(choice: NoseArtChoice): DecalArt {
  if (choice === 'card') return waterSlideDecal(kingOfHeartsArt(), 10);
  if (!noseArtPainting) throw new Error('Nose art not loaded: await loadNoseArt() before building the aircraft');
  const [canvas, context] = createCanvas(noseArtPainting.naturalWidth, noseArtPainting.naturalHeight);
  context.drawImage(noseArtPainting, 0, 0);
  return waterSlideDecal(canvas, 10);
}

/**
 * "King of Hearts" in the 1944 manner: a playing card tilted as if tossed on the table, crowned and with a big red
 * heart, over a banner with the name in sign-painter's script. Black keylines round everything, as the group's
 * painters outlined their work to stand off the Olive Drab.
 */
function kingOfHeartsArt(): HTMLCanvasElement {
  const [canvas, context] = createCanvas(1024, 760);
  const keyline = (width: number) => {
    context.lineJoin = 'round';
    context.lineWidth = width;
    context.strokeStyle = '#111111';
    context.stroke();
  };

  // The card.
  context.save();
  context.translate(470, 330);
  context.rotate(-0.16);
  const cardWidth = 400;
  const cardHeight = 560;
  context.beginPath();
  context.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 34);
  context.fillStyle = '#efe6cf';
  context.fill();
  keyline(12);
  context.beginPath();
  context.roundRect(-cardWidth / 2 + 22, -cardHeight / 2 + 22, cardWidth - 44, cardHeight - 44, 20);
  context.lineWidth = 6;
  context.strokeStyle = '#b3241d';
  context.stroke();
  // Corner indices: K over a small heart, and the same turned round in the opposite corner.
  for (const turn of [0, Math.PI]) {
    context.save();
    context.rotate(turn);
    context.fillStyle = '#b3241d';
    context.font = '800 76px Outfit, Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText('K', -cardWidth / 2 + 62, -cardHeight / 2 + 104);
    heartPath(context, -cardWidth / 2 + 62, -cardHeight / 2 + 136, 26);
    context.fill();
    context.restore();
  }
  // The heart, with a crown resting on it.
  heartPath(context, 0, 40, 132);
  context.fillStyle = '#c7271e';
  context.fill();
  keyline(9);
  heartPath(context, -34, 0, 34);
  context.fillStyle = 'rgba(255,255,255,0.32)';
  context.fill();
  crownPath(context, 0, -110, 190, 120);
  context.fillStyle = '#e2b13a';
  context.fill();
  keyline(8);
  for (const [x, y, colour] of [[-62, -104, '#2a58b0'], [0, -96, '#c7271e'], [62, -104, '#2a58b0']] as const) {
    context.beginPath();
    context.arc(x, y, 13, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
    keyline(4);
  }
  context.restore();

  // The banner across the card's foot, its tails folded behind.
  const bannerY = 600;
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(512 + side * 360, bannerY - 50);
    context.lineTo(512 + side * 490, bannerY - 40);
    context.lineTo(512 + side * 445, bannerY + 10);
    context.lineTo(512 + side * 495, bannerY + 62);
    context.lineTo(512 + side * 360, bannerY + 58);
    context.closePath();
    context.fillStyle = '#1b2f63';
    context.fill();
    keyline(8);
  }
  context.beginPath();
  context.moveTo(512 - 400, bannerY - 72);
  context.quadraticCurveTo(512, bannerY - 112, 512 + 400, bannerY - 72);
  context.lineTo(512 + 400, bannerY + 38);
  context.quadraticCurveTo(512, bannerY - 2, 512 - 400, bannerY + 38);
  context.closePath();
  context.fillStyle = '#25417f';
  context.fill();
  keyline(9);
  context.save();
  context.translate(512, bannerY - 2);
  context.rotate(-0.015);
  context.font = 'italic 700 104px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 12;
  context.strokeStyle = '#111111';
  context.strokeText('King of Hearts', 0, -18);
  context.fillStyle = '#f2c544';
  context.fillText('King of Hearts', 0, -18);
  context.restore();
  return canvas;
}

/** A heart `size` wide, its notch at (x, y - size / 4) and its point below. */
function heartPath(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const half = size / 2;
  context.beginPath();
  context.moveTo(x, y + size * 0.62);
  context.bezierCurveTo(x - size * 0.9, y + size * 0.05, x - half * 0.95, y - size * 0.55, x, y - size * 0.22);
  context.bezierCurveTo(x + half * 0.95, y - size * 0.55, x + size * 0.9, y + size * 0.05, x, y + size * 0.62);
  context.closePath();
}

/** A five-pointed crown `width` by `height`, centred on (x, y). */
function crownPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  const left = x - width / 2;
  const bottom = y + height / 2;
  const top = y - height / 2;
  context.beginPath();
  context.moveTo(left, bottom);
  context.lineTo(left, top + height * 0.3);
  for (let point = 0; point < 5; point++) {
    context.lineTo(left + (width * point) / 4, point % 2 === 0 ? top : top + height * 0.12);
    if (point < 4) context.lineTo(left + (width * (point + 0.5)) / 4, top + height * 0.45);
  }
  context.lineTo(left + width, bottom);
  context.closePath();
}

/**
 * A door's outline in the skin: the panel line all round it, the hinge line along its forward edge, and the flush
 * handle recess at its aft edge. Dark lines on transparent; the door itself is the skin.
 */
export function hatchOutlineTexture(): THREE.CanvasTexture {
  const [canvas, context] = createCanvas(520, 340);
  context.strokeStyle = 'rgba(14,14,10,0.85)';
  context.lineWidth = 7;
  context.beginPath();
  context.roundRect(12, 12, 496, 316, 18);
  context.stroke();
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(34, 30);
  context.lineTo(34, 310);
  context.stroke();
  context.fillStyle = 'rgba(14,14,10,0.7)';
  context.beginPath();
  context.roundRect(450, 140, 34, 60, 8);
  context.fill();
  return finishTexture(canvas);
}

/**
 * Flak damage as a modeller paints it over a scratch-built hole: soot scorched out round each strike, the hole itself
 * black, and its torn edge picked out in bare aluminium where the paint flaked off. Transparent everywhere else.
 */
export function flakDamageTexture(seed: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, context] = createCanvas(size, size);
  const random = seededRandom(seed);
  const strikes = Array.from({ length: 5 }, () => ({
    x: size * (0.2 + random() * 0.6), y: size * (0.2 + random() * 0.6), radius: size * (0.025 + random() * 0.05),
  }));
  for (const strike of strikes) {
    const soot = context.createRadialGradient(strike.x, strike.y, strike.radius, strike.x, strike.y, strike.radius * 4.2);
    soot.addColorStop(0, 'rgba(18,16,14,0.85)');
    soot.addColorStop(1, 'rgba(18,16,14,0)');
    context.fillStyle = soot;
    context.fillRect(0, 0, size, size);
  }
  for (const strike of strikes) {
    const points = 11;
    const outline = Array.from({ length: points }, (_, index) => {
      const angle = (index / points) * Math.PI * 2;
      const reach = strike.radius * (0.6 + random() * 0.8);
      return [strike.x + Math.cos(angle) * reach, strike.y + Math.sin(angle) * reach] as const;
    });
    context.beginPath();
    outline.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.lineWidth = 5;
    context.strokeStyle = PALETTE.aluminium;
    context.stroke();
    context.fillStyle = '#060606';
    context.fill();
  }
  return finishTexture(canvas);
}

/** The box painting's area on the lid, above the title band, in lid pixels. */
export const KIT_BOX_ART = { width: 1536, height: 820 } as const;

/** The box painting's sky: night blue to a dusk glow low down, with searchlight beams across it. */
export function kitBoxSkyTexture(): THREE.CanvasTexture {
  const { width, height } = KIT_BOX_ART;
  const [canvas, context] = createCanvas(width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0d1b33');
  sky.addColorStop(0.7, '#3b4d6b');
  sky.addColorStop(1, '#c9864a');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255,240,200,0.1)';
  for (const [x, lean] of [[220, 0.5], [1250, -0.4], [900, 0.2]]) {
    context.beginPath();
    context.moveTo(x - 30, height);
    context.lineTo(x + 30, height);
    context.lineTo(x + lean * 900 + 120, 0);
    context.lineTo(x + lean * 900 - 120, 0);
    context.fill();
  }
  return finishTexture(canvas);
}

/**
 * The kit box's lid: the box painting (the model itself in flight over the sky), the nose art inset in its corner, and
 * the title band under it, the way 1950s kit boxes put the subject over the name.
 */
export function kitBoxLidTexture(painting: CanvasImageSource): THREE.CanvasTexture {
  if (!noseArtPainting) throw new Error('Nose art not loaded: await loadNoseArt() before building the kit box');
  const [canvas, context] = createCanvas(KIT_BOX_ART.width, 1024);
  context.drawImage(painting, 0, 0, KIT_BOX_ART.width, KIT_BOX_ART.height);
  const insetHeight = 300;
  const insetWidth = (noseArtPainting.naturalWidth / noseArtPainting.naturalHeight) * insetHeight;
  context.drawImage(noseArtPainting, KIT_BOX_ART.width - insetWidth - 40, KIT_BOX_ART.height - insetHeight - 20, insetWidth, insetHeight);
  context.fillStyle = PALETTE.tailYellow;
  context.fillRect(0, 820, 1536, 204);
  context.fillStyle = '#1b1c1d';
  context.font = '800 112px Outfit, Arial, sans-serif';
  context.textBaseline = 'middle';
  context.fillText('B-17G FLYING FORTRESS', 48, 905);
  context.font = '700 52px "DM Mono", Menlo, monospace';
  context.fillText('1/72 · 91st BG · 1944', 52, 985);
  context.font = '700 64px "DM Mono", Menlo, monospace';
  context.fillStyle = '#f3ebe0';
  context.fillText('KIT No. 17', 52, 80);
  return finishTexture(canvas);
}

/** One of the box's sides: the title in a band, plain card round it. */
export function kitBoxSideTexture(): THREE.CanvasTexture {
  const [canvas, context] = createCanvas(1024, 160);
  context.fillStyle = '#0d1b33';
  context.fillRect(0, 0, 1024, 160);
  context.fillStyle = PALETTE.tailYellow;
  context.fillRect(0, 100, 1024, 60);
  context.fillStyle = '#f3ebe0';
  context.font = '800 60px Outfit, Arial, sans-serif';
  context.textBaseline = 'middle';
  context.fillText('B-17G FLYING FORTRESS', 24, 52);
  context.fillStyle = '#1b1c1d';
  context.font = '700 34px "DM Mono", Menlo, monospace';
  context.fillText('1/72 SCALE PLASTIC KIT', 24, 131);
  return finishTexture(canvas);
}

/** The decal sheet as it came in the box: every marking the lead wears, laid out on its blue backing paper. */
export function decalSheetTexture(arts: DecalArt[]): THREE.CanvasTexture {
  const width = 2048;
  const height = 1400;
  const [canvas, context] = createCanvas(width, height);
  context.fillStyle = '#d9dde3';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#20406e';
  context.font = '700 40px "DM Mono", Menlo, monospace';
  context.fillText('B-17G  ·  1/72  ·  DECALS  ·  91st BG', 40, 70);
  // Shelf-pack the pieces in rows, each scaled to the row height.
  const rowHeight = 300;
  let x = 40;
  let y = 110;
  for (const art of arts) {
    const image = art.map.image as HTMLCanvasElement;
    const scale = Math.min(rowHeight / image.height, 1);
    const pieceWidth = image.width * scale;
    if (x + pieceWidth > width - 40) {
      x = 40;
      y += rowHeight + 30;
    }
    context.drawImage(image, x, y, pieceWidth, image.height * scale);
    x += pieceWidth + 30;
  }
  return finishTexture(canvas);
}

/**
 * Oil and soot thrown back from a hit engine, as a modeller airbrushes it: streaks starting thin where the oil leaves
 * the cowl (canvas left) and spreading and fading as the airflow carries them aft (right), brown-black over the paint.
 */
export function oilStreakTexture(seed: number): THREE.CanvasTexture {
  const width = 1024;
  const height = 256;
  const [canvas, context] = createCanvas(width, height);
  const random = seededRandom(seed);
  for (let streak = 0; streak < 16; streak++) {
    const startY = height * (0.4 + random() * 0.2);
    const spread = (random() - 0.5) * height * 0.6;
    const reach = width * (0.45 + random() * 0.55);
    const thickness = 3 + random() * 9;
    const gradient = context.createLinearGradient(0, 0, reach, 0);
    const alpha = 0.3 + random() * 0.35;
    gradient.addColorStop(0, `rgba(14,12,10,${alpha})`);
    gradient.addColorStop(0.6, `rgba(20,17,14,${alpha * 0.55})`);
    gradient.addColorStop(1, 'rgba(24,20,16,0)');
    context.strokeStyle = gradient;
    context.lineWidth = thickness;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(8, startY);
    context.quadraticCurveTo(reach * 0.5, startY + spread * 0.4, reach, startY + spread);
    context.stroke();
  }
  return finishTexture(canvas);
}

/** The mission tally under the pilot's window: one small yellow bomb per mission, in rows of twelve. */
export function missionTallyDecal(missions: number): DecalArt {
  const perRow = 12;
  const rows = Math.ceil(missions / perRow);
  const [canvas, context] = createCanvas(perRow * 64 + 16, rows * 40 + 16);
  for (let mission = 0; mission < missions; mission++) {
    const x = 8 + (mission % perRow) * 64;
    const y = 8 + Math.floor(mission / perRow) * 40 + 16;
    // Noses towards the canvas's left, which is the aircraft's nose on the port side, where the tally sits.
    context.fillStyle = PALETTE.tailYellow;
    context.beginPath();
    context.ellipse(x + 26, y, 20, 9, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x + 44, y);
    context.lineTo(x + 54, y - 11);
    context.lineTo(x + 54, y + 11);
    context.closePath();
    context.fill();
  }
  return waterSlideDecal(canvas, 8, 'sheet');
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
