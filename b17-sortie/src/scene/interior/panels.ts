import * as THREE from 'three';

/**
 * The B-17's main instrument panel, laid out from figure 21 of the Pilot's Manual: the pilot's sub-panel on the left
 * (pilot director, bomb-door light, oil and hydraulic pressures, suction, oxygen), the flight group in the centre
 * (radio compass, directional gyro, gyro horizon over altimeter, airspeed, turn and bank, rate of climb, with manifold
 * pressure and tachometer for engines 1–2 beside them and the feathering buttons below), and the engine group on the
 * right (manifold pressure and tachometer for 3–4, fuel and oil pressures, oil temperatures, flap position,
 * thermocouples, carburettor air temperatures, de-icer pressure, fuel quantity). Black crinkle finish, black dials,
 * luminous white markings.
 */

/** Panel size in metres, matching `COCKPIT.panel`. */
export const PANEL_WIDTH = 1.24;
export const PANEL_HEIGHT = 0.52;

const PIXELS_PER_METRE = 1650;

type DialKind = 'clock' | 'gauge' | 'horizon' | 'twin' | 'quantity';

/** Instruments that read the lead's flight: their needles are drawn each update rather than painted in. */
type LiveInstrument = 'heading' | 'horizon' | 'altimeter' | 'airspeed' | 'turn' | 'climb' | 'manifold12' | 'tach12' | 'manifold34' | 'tach34';

interface Dial { x: number; y: number; r: number; label: string; kind?: DialKind; needle?: number; live?: LiveInstrument }

/** What the live instruments show. */
export interface InstrumentReadings {
  headingDegrees: number;
  /** Positive is right wing down. */
  bankRadians: number;
  pitchRadians: number;
  altitudeFeet: number;
  airspeedMph: number;
  climbFeetPerMinute: number;
  /** Each engine's speed from stopped (0) to cruise (1), No. 1 first. */
  engines: [number, number, number, number];
  /** The feathering button lit while it holds its engine's propeller feathering, by engine number less one. */
  featheringEngine: number | null;
}

/** Scale of each live dial: the reading at the needle's full sweep. */
const DIAL_SCALES = { airspeedMph: 400, climbFeetPerMinute: 2000, altimeterFeet: 1000, bankRadians: 0.6, horizonPitch: 0.4 } as const;
/** Cruise manifold pressure and engine speed as a fraction of each dial; a stopped engine shows field pressure. */
const ENGINE_DIALS = { manifoldCruise: 0.62, manifoldStopped: 0.3, tachCruise: 0.55 } as const;

/** Dial centres and radii in metres from the panel's top-left corner. */
const DIALS: Dial[] = [
  // Pilot's sub-panel.
  { x: 0.24, y: 0.1, r: 0.045, label: 'PILOT DIRECTOR', needle: 0.5 },
  { x: 0.06, y: 0.31, r: 0.032, label: 'A.C. VOLTS', needle: 0.35 },
  { x: 0.14, y: 0.31, r: 0.032, label: 'EMERG OIL', needle: 0.2 },
  { x: 0.22, y: 0.31, r: 0.032, label: 'HYD OIL', needle: 0.6 },
  { x: 0.3, y: 0.31, r: 0.032, label: 'SUCTION', needle: 0.45 },
  { x: 0.1, y: 0.42, r: 0.026, label: 'OXY FLOW', needle: 0.3 },
  { x: 0.17, y: 0.42, r: 0.026, label: 'OXY PRESS', needle: 0.7 },
  { x: 0.26, y: 0.42, r: 0.026, label: 'OXY FLOW', needle: 0.3 },
  { x: 0.33, y: 0.42, r: 0.026, label: 'OXY PRESS', needle: 0.7 },
  // Flight group.
  { x: 0.47, y: 0.1, r: 0.04, label: 'RADIO COMPASS', needle: 0.12 },
  { x: 0.57, y: 0.1, r: 0.04, label: 'DIRECTIONAL GYRO', live: 'heading' },
  { x: 0.67, y: 0.1, r: 0.045, label: 'GYRO HORIZON', kind: 'horizon', live: 'horizon' },
  { x: 0.45, y: 0.22, r: 0.04, label: 'ALTIMETER', live: 'altimeter' },
  { x: 0.545, y: 0.22, r: 0.04, label: 'AIR SPEED', live: 'airspeed' },
  { x: 0.64, y: 0.22, r: 0.04, label: 'TURN & BANK', live: 'turn' },
  { x: 0.735, y: 0.22, r: 0.04, label: 'RATE OF CLIMB', live: 'climb' },
  { x: 0.81, y: 0.1, r: 0.036, label: 'MANIFOLD 1-2', kind: 'twin', live: 'manifold12' },
  { x: 0.81, y: 0.2, r: 0.036, label: 'TACH 1-2', kind: 'twin', live: 'tach12' },
  // Engine group.
  { x: 0.9, y: 0.1, r: 0.036, label: 'MANIFOLD 3-4', kind: 'twin', live: 'manifold34' },
  { x: 0.9, y: 0.2, r: 0.036, label: 'TACH 3-4', kind: 'twin', live: 'tach34' },
  { x: 0.98, y: 0.1, r: 0.033, label: 'FUEL PRESS', kind: 'twin', needle: 0.5 },
  { x: 1.055, y: 0.1, r: 0.033, label: 'FUEL PRESS', kind: 'twin', needle: 0.5 },
  { x: 0.98, y: 0.19, r: 0.033, label: 'OIL PRESS', kind: 'twin', needle: 0.66 },
  { x: 1.055, y: 0.19, r: 0.033, label: 'OIL PRESS', kind: 'twin', needle: 0.66 },
  { x: 0.98, y: 0.28, r: 0.033, label: 'OIL TEMP', kind: 'twin', needle: 0.58 },
  { x: 1.055, y: 0.28, r: 0.033, label: 'OIL TEMP', kind: 'twin', needle: 0.58 },
  { x: 0.9, y: 0.3, r: 0.03, label: 'FLAP POS', needle: 0.02 },
  { x: 0.9, y: 0.4, r: 0.03, label: 'CYL TEMP 1-2', kind: 'twin', needle: 0.6 },
  { x: 0.98, y: 0.4, r: 0.03, label: 'CYL TEMP 3-4', kind: 'twin', needle: 0.6 },
  { x: 1.055, y: 0.4, r: 0.03, label: 'CARB AIR', kind: 'twin', needle: 0.4 },
  { x: 1.13, y: 0.4, r: 0.03, label: 'CARB AIR', kind: 'twin', needle: 0.4 },
  { x: 1.13, y: 0.1, r: 0.027, label: 'DE-ICE', needle: 0.1 },
  { x: 1.135, y: 0.24, r: 0.035, label: 'FUEL QTY', kind: 'quantity', needle: 0.55 },
];

/** The feathering buttons, No. 1 to No. 4, and small warning lamps. */
const FEATHERING_BUTTONS: { x: number; y: number; r: number }[] = [
  { x: 0.46, y: 0.32, r: 0.013 }, { x: 0.5, y: 0.32, r: 0.013 }, { x: 0.64, y: 0.32, r: 0.013 }, { x: 0.68, y: 0.32, r: 0.013 },
];
/** Where a feathering button is on the panel, metres from its top-left corner; `engine` is the engine number less one. */
export function featheringButtonOnPanel(engine: number): { x: number; y: number } {
  const { x, y } = FEATHERING_BUTTONS[engine];
  return { x, y };
}

const FEATHERING_COLOURS = { off: '#a5231b', lit: '#ff5a3a', glow: 'rgba(255,90,58,0.45)' } as const;
const BUTTONS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.2, y: 0.18, r: 0.009, color: '#2f8a3a' }, { x: 0.27, y: 0.2, r: 0.009, color: '#b8862a' },
  { x: 0.78, y: 0.32, r: 0.008, color: '#2f8a3a' }, { x: 0.82, y: 0.32, r: 0.008, color: '#c23a2a' },
];

/** Panel outline, metres, origin bottom-left: the top follows the windscreen frame, the right drops to the side console. */
export function panelOutline(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(PANEL_WIDTH, 0);
  shape.lineTo(PANEL_WIDTH, PANEL_HEIGHT * 0.78);
  shape.quadraticCurveTo(PANEL_WIDTH * 0.97, PANEL_HEIGHT, PANEL_WIDTH * 0.62, PANEL_HEIGHT);
  shape.lineTo(PANEL_WIDTH * 0.36, PANEL_HEIGHT);
  shape.quadraticCurveTo(PANEL_WIDTH * 0.06, PANEL_HEIGHT * 0.98, 0, PANEL_HEIGHT * 0.62);
  shape.closePath();
  return shape;
}

function drawDial(context: CanvasRenderingContext2D, dial: Dial): void {
  const k = PIXELS_PER_METRE;
  const x = dial.x * k, y = dial.y * k, r = dial.r * k;
  // A live horizon is drawn whole on each update.
  if (dial.kind === 'horizon' && dial.live) return;
  // Bezel, black face, luminous scale.
  context.fillStyle = '#2e3031';
  context.beginPath();
  context.arc(x, y, r * 1.12, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#0b0b0c';
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fill();

  if (dial.kind === 'horizon') {
    drawHorizon(context, dial, 0, 0);
    return;
  }

  context.strokeStyle = '#e9e3cf';
  const ticks = dial.kind === 'quantity' ? 8 : 30;
  for (let tick = 0; tick <= ticks; tick++) {
    const angle = NEEDLE_START + (tick / ticks) * NEEDLE_SWEEP;
    const major = tick % 5 === 0;
    context.lineWidth = major ? r * 0.05 : r * 0.025;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * r * (major ? 0.72 : 0.8), y + Math.sin(angle) * r * (major ? 0.72 : 0.8));
    context.lineTo(x + Math.cos(angle) * r * 0.9, y + Math.sin(angle) * r * 0.9);
    context.stroke();
  }
  context.fillStyle = '#e9e3cf';
  context.font = `600 ${Math.round(r * 0.18)}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(dial.label, x, y + r * 0.42);
  if (dial.live) return;
  drawNeedles(context, dial, dial.kind === 'twin' ? [dial.needle ?? 0.5, (dial.needle ?? 0.5) + 0.03] : [dial.needle ?? 0.5]);
}

/** Where a needle at 0 points, and how far round it sweeps to 1. */
const NEEDLE_START = Math.PI * 0.75;
const NEEDLE_SWEEP = Math.PI * 1.5;

/** The dial's needles, first white, second (a twin's other engine) yellow, each at its 0–1 value, and the hub. */
function drawNeedles(context: CanvasRenderingContext2D, dial: Dial, values: number[]): void {
  const k = PIXELS_PER_METRE;
  const x = dial.x * k, y = dial.y * k, r = dial.r * k;
  values.forEach((value, index) => {
    const angle = NEEDLE_START + THREE.MathUtils.clamp(value, 0, 1) * NEEDLE_SWEEP;
    context.strokeStyle = index === 0 ? '#f2eedf' : '#e2c85a';
    context.lineWidth = r * 0.07;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * r * 0.78, y + Math.sin(angle) * r * 0.78);
    context.stroke();
  });
  context.fillStyle = '#3a3a3a';
  context.beginPath();
  context.arc(x, y, r * 0.09, 0, Math.PI * 2);
  context.fill();
}

/** The gyro horizon: sky over ground, the horizon bar rolled and lifted with the ship, the fixed miniature aircraft. */
function drawHorizon(context: CanvasRenderingContext2D, dial: Dial, bankRadians: number, pitchRadians: number): void {
  const k = PIXELS_PER_METRE;
  const x = dial.x * k, y = dial.y * k, r = dial.r * k;
  context.fillStyle = '#2e3031';
  context.beginPath();
  context.arc(x, y, r * 1.12, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.beginPath();
  context.arc(x, y, r * 0.92, 0, Math.PI * 2);
  context.clip();
  // Nose up puts the horizon below centre; right wing down rolls the horizon the other way.
  context.translate(x, y + (pitchRadians / DIAL_SCALES.horizonPitch) * r * 0.6);
  context.rotate(-bankRadians);
  context.fillStyle = '#20314a';
  context.fillRect(-r * 2, -r * 2, r * 4, r * 2);
  context.fillStyle = '#2b2219';
  context.fillRect(-r * 2, 0, r * 4, r * 2);
  context.strokeStyle = '#e8e2cc';
  context.lineWidth = r * 0.05;
  context.beginPath();
  context.moveTo(-r * 2, 0);
  context.lineTo(r * 2, 0);
  context.stroke();
  context.restore();
  context.strokeStyle = '#e6b84a';
  context.lineWidth = r * 0.07;
  context.beginPath();
  context.moveTo(x - r * 0.5, y + r * 0.05);
  context.lineTo(x - r * 0.15, y + r * 0.05);
  context.lineTo(x, y + r * 0.2);
  context.lineTo(x + r * 0.15, y + r * 0.05);
  context.lineTo(x + r * 0.5, y + r * 0.05);
  context.stroke();
}

/** The needle values a live dial shows for `readings`. */
function liveNeedles(instrument: LiveInstrument, readings: InstrumentReadings): number[] {
  const manifold = (engine: number) => THREE.MathUtils.lerp(ENGINE_DIALS.manifoldStopped, ENGINE_DIALS.manifoldCruise, readings.engines[engine]);
  const tach = (engine: number) => ENGINE_DIALS.tachCruise * readings.engines[engine];
  switch (instrument) {
    case 'heading': return [THREE.MathUtils.euclideanModulo(readings.headingDegrees, 360) / 360];
    case 'altimeter': return [(readings.altitudeFeet % DIAL_SCALES.altimeterFeet) / DIAL_SCALES.altimeterFeet, (readings.altitudeFeet / 10000) % 1];
    case 'airspeed': return [readings.airspeedMph / DIAL_SCALES.airspeedMph];
    case 'turn': return [0.5 + (readings.bankRadians / DIAL_SCALES.bankRadians) * 0.5];
    // The film's climb is many times a real one's: the needle pegs at the dial's stop, as a real one would.
    case 'climb': return [0.5 + THREE.MathUtils.clamp(readings.climbFeetPerMinute / DIAL_SCALES.climbFeetPerMinute, -1, 1) * 0.5];
    case 'manifold12': return [manifold(0), manifold(1)];
    case 'tach12': return [tach(0), tach(1)];
    case 'manifold34': return [manifold(2), manifold(3)];
    case 'tach34': return [tach(2), tach(3)];
    case 'horizon': return [];
  }
}

/** The panel as painted, live needles left off, and the face the cockpit shows, redrawn from it on each update. */
interface PanelFace { base: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture }

let face: PanelFace | null = null;

function paintBase(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  context.fillStyle = '#18191a';
  context.fillRect(0, 0, width, height);
  let seed = 11;
  for (let speck = 0; speck < 26000; speck++) {
    seed = (seed * 16807) % 2147483647;
    const a = seed / 2147483647;
    seed = (seed * 16807) % 2147483647;
    context.fillStyle = `rgba(255,255,255,${0.02 + (seed / 2147483647) * 0.035})`;
    context.fillRect(a * width, (seed % 997) / 997 * height, 1.5, 1.5);
  }
  // Shock-mounted flight group sits on its own sub-panel.
  context.strokeStyle = 'rgba(200,200,200,0.25)';
  context.lineWidth = 3;
  context.strokeRect(0.405 * PIXELS_PER_METRE, 0.035 * PIXELS_PER_METRE, 0.45 * PIXELS_PER_METRE, 0.33 * PIXELS_PER_METRE);
  context.strokeRect(0.865 * PIXELS_PER_METRE, 0.04 * PIXELS_PER_METRE, 0.31 * PIXELS_PER_METRE, 0.42 * PIXELS_PER_METRE);
  for (const dial of DIALS) drawDial(context, dial);
  for (const button of BUTTONS) {
    context.fillStyle = button.color;
    context.beginPath();
    context.arc(button.x * PIXELS_PER_METRE, button.y * PIXELS_PER_METRE, button.r * PIXELS_PER_METRE, 0, Math.PI * 2);
    context.fill();
  }
  // Placards.
  context.fillStyle = '#d9d2bb';
  context.font = '600 20px Arial, sans-serif';
  context.textAlign = 'left';
  context.fillText('WARNING', 0.04 * PIXELS_PER_METRE, 0.49 * PIXELS_PER_METRE);
  context.fillText('ALTIMETER CORRECTION CARD', 0.27 * PIXELS_PER_METRE, 0.2 * PIXELS_PER_METRE);
  return canvas;
}

/** The cruise the panel shows until it is first updated. */
const CRUISE_READINGS: InstrumentReadings = {
  headingDegrees: 95, bankRadians: 0, pitchRadians: 0, altitudeFeet: 25000, airspeedMph: 150, climbFeetPerMinute: 0, engines: [1, 1, 1, 1], featheringEngine: null,
};

function panelFace(): PanelFace {
  if (face) return face;
  const base = paintBase(Math.round(PANEL_WIDTH * PIXELS_PER_METRE), Math.round(PANEL_HEIGHT * PIXELS_PER_METRE));
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  face = { base, context, texture };
  updateInstrumentPanel(CRUISE_READINGS);
  return face;
}

/** Panel face texture, mapped 1:1 onto `panelOutline()` (UV = metres / panel size); every ship's panel shares it. */
export function instrumentPanelTexture(): THREE.CanvasTexture {
  return panelFace().texture;
}

/** Sets the live instruments and the feathering buttons to `readings` and uploads the face again. */
export function updateInstrumentPanel(readings: InstrumentReadings): void {
  const { base, context, texture } = panelFace();
  context.drawImage(base, 0, 0);
  for (const dial of DIALS) {
    if (!dial.live) continue;
    if (dial.live === 'horizon') drawHorizon(context, dial, readings.bankRadians, readings.pitchRadians);
    else drawNeedles(context, dial, liveNeedles(dial.live, readings));
  }
  FEATHERING_BUTTONS.forEach((button, engine) => {
    const lit = readings.featheringEngine === engine;
    const x = button.x * PIXELS_PER_METRE, y = button.y * PIXELS_PER_METRE, r = button.r * PIXELS_PER_METRE;
    if (lit) {
      context.fillStyle = FEATHERING_COLOURS.glow;
      context.beginPath();
      context.arc(x, y, r * 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = lit ? FEATHERING_COLOURS.lit : FEATHERING_COLOURS.off;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  });
  texture.needsUpdate = true;
}

/** UVs for a ShapeGeometry built from `panelOutline()`: metres scaled into 0..1. */
export function applyPanelUvs(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const uvs = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index++) {
    uvs[index * 2] = position.getX(index) / PANEL_WIDTH;
    uvs[index * 2 + 1] = position.getY(index) / PANEL_HEIGHT;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}
