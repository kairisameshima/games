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

interface Dial { x: number; y: number; r: number; label: string; kind?: DialKind; needle?: number }

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
  { x: 0.57, y: 0.1, r: 0.04, label: 'DIRECTIONAL GYRO', needle: 0.31 },
  { x: 0.67, y: 0.1, r: 0.045, label: 'GYRO HORIZON', kind: 'horizon' },
  { x: 0.45, y: 0.22, r: 0.04, label: 'ALTIMETER', needle: 0.5 },
  { x: 0.545, y: 0.22, r: 0.04, label: 'AIR SPEED', needle: 0.42 },
  { x: 0.64, y: 0.22, r: 0.04, label: 'TURN & BANK', needle: 0.5 },
  { x: 0.735, y: 0.22, r: 0.04, label: 'RATE OF CLIMB', needle: 0.25 },
  { x: 0.81, y: 0.1, r: 0.036, label: 'MANIFOLD 1-2', kind: 'twin', needle: 0.62 },
  { x: 0.81, y: 0.2, r: 0.036, label: 'TACH 1-2', kind: 'twin', needle: 0.55 },
  // Engine group.
  { x: 0.9, y: 0.1, r: 0.036, label: 'MANIFOLD 3-4', kind: 'twin', needle: 0.62 },
  { x: 0.9, y: 0.2, r: 0.036, label: 'TACH 3-4', kind: 'twin', needle: 0.55 },
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

/** Feathering buttons and small warning lamps. */
const BUTTONS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.46, y: 0.32, r: 0.013, color: '#a5231b' }, { x: 0.5, y: 0.32, r: 0.013, color: '#a5231b' },
  { x: 0.64, y: 0.32, r: 0.013, color: '#a5231b' }, { x: 0.68, y: 0.32, r: 0.013, color: '#a5231b' },
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
    context.save();
    context.beginPath();
    context.arc(x, y, r * 0.92, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = '#20314a';
    context.fillRect(x - r, y - r, r * 2, r);
    context.fillStyle = '#2b2219';
    context.fillRect(x - r, y, r * 2, r);
    context.strokeStyle = '#e8e2cc';
    context.lineWidth = r * 0.05;
    context.beginPath();
    context.moveTo(x - r, y);
    context.lineTo(x + r, y);
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
    return;
  }

  context.strokeStyle = '#e9e3cf';
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const ticks = dial.kind === 'quantity' ? 8 : 30;
  for (let tick = 0; tick <= ticks; tick++) {
    const angle = start + (tick / ticks) * sweep;
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
  const needles = dial.kind === 'twin' ? [dial.needle ?? 0.5, (dial.needle ?? 0.5) + 0.03] : [dial.needle ?? 0.5];
  needles.forEach((value, index) => {
    const angle = start + value * sweep;
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

let sharedTexture: THREE.CanvasTexture | null = null;

/** Panel face texture, mapped 1:1 onto `panelOutline()` (UV = metres / panel size). */
export function instrumentPanelTexture(): THREE.CanvasTexture {
  if (sharedTexture) return sharedTexture;
  const width = Math.round(PANEL_WIDTH * PIXELS_PER_METRE);
  const height = Math.round(PANEL_HEIGHT * PIXELS_PER_METRE);
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  sharedTexture = texture;
  return texture;
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
