// RIP SHOP — procedural placeholder art.
// Every export returns an HTML string (inline SVG). No emoji, no external assets.
// Replace with real PNGs per ART-BRIEF.md without touching this file's call sites.

import { SET_BY_ID, RARITIES } from './data.mjs';
import { ASSETS } from './assets.mjs';

function withAsset(path, altText, placeholderSvg) {
  if (!path) return placeholderSvg;
  return `<span class="asset-wrap">
    <img class="asset-img" src="${esc(path)}" alt="${esc(altText)}" loading="lazy" onerror="this.style.display='none'"/>
    <span class="art-fallback">${placeholderSvg}</span>
  </span>`;
}

// ---------- color helpers ----------
function hexToHsl(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function shade(hex, dl, ds = 0) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) hex = '#5b6b74';
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, Math.max(0, Math.min(100, s + ds)), Math.max(3, Math.min(97, l + dl)));
}
function hexToRgba(hex, a) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) hex = '#5b6b74';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
let uidCounter = 0;
function uid(prefix) { uidCounter += 1; return `${prefix}${uidCounter}`; }

// ---------- svg primitives ----------
const attrs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}="${v}"`).join(' ');
const C = (cx, cy, r, fill, extra = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${attrs(extra)}/>`;
const E = (cx, cy, rx, ry, fill, extra = {}) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${attrs(extra)}/>`;
const Pp = (d, fill, extra = {}) => `<path d="${d}" fill="${fill}" ${attrs(extra)}/>`;
const Rr = (x, y, w, h, rx, fill, extra = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${attrs(extra)}/>`;
const Pg = (points, fill, extra = {}) => `<polygon points="${points}" fill="${fill}" ${attrs(extra)}/>`;
const Ln = (d, stroke, w, extra = {}) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${attrs(extra)}/>`;

// ---------- rarity aura ----------
function rarityAura(rank, cx, cy, color) {
  if (rank <= 0) return '';
  const ringId = uid('ring');
  let rays = '';
  if (rank >= 3) {
    const n = 12;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * 58, y1 = cy + Math.sin(a) * 58;
      const x2 = cx + Math.cos(a) * 98, y2 = cy + Math.sin(a) * 98;
      rays += Ln(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`, color, 3, { opacity: 0.55 });
    }
  }
  let particles = '';
  if (rank >= 2) {
    const n = 7;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const x = cx + Math.cos(a) * 72, y = cy + Math.sin(a) * 72 * 0.9;
      particles += C(x, y, rank >= 3 ? 3.2 : 2.4, color, { opacity: 0.8 });
    }
  }
  return `
  <defs><radialGradient id="${ringId}" cx="50%" cy="50%" r="50%">
    <stop offset="55%" stop-color="${color}" stop-opacity="0"/>
    <stop offset="88%" stop-color="${color}" stop-opacity="${rank >= 3 ? 0.4 : 0.22}"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </radialGradient></defs>
  ${C(cx, cy, 92, `url(#${ringId})`)}
  ${rays}
  <circle cx="${cx}" cy="${cy}" r="68" fill="none" stroke="${color}" stroke-width="${rank >= 2 ? 2.4 : 1.4}" opacity="${rank >= 2 ? 0.75 : 0.4}"/>
  ${particles}`;
}

// ---------- archetype bodies (centered roughly on 96,120 within a 192x240 stage) ----------
function humanoid(p, { headR = 30, shoulder = 44, torsoW = 56, bigHead = false, plates = false, cape = false } = {}) {
  const { base, light, dark } = p;
  const headY = bigHead ? 78 : 82;
  let out = '';
  if (cape) out += Pp(`M48 118 Q40 180 58 208 L134 208 Q152 180 144 118 Q120 150 96 150 Q72 150 48 118 Z`, shade(base, -14));
  out += E(96, 206, 50, 12, 'rgba(10,8,20,.4)');
  out += Pp(`M${96 - torsoW / 2} 206 Q${96 - torsoW / 2 - 4} 150 ${96 - shoulder / 2} 128 Q96 112 ${96 + shoulder / 2} 128 Q${96 + torsoW / 2 + 4} 150 ${96 + torsoW / 2} 206 Z`, base);
  out += Pp(`M${96 - torsoW / 2 + 4} 206 Q96 218 ${96 + torsoW / 2 - 4} 206 L${96 + torsoW / 2 - 8} 190 Q96 200 ${96 - torsoW / 2 + 8} 190 Z`, dark);
  if (plates) {
    out += E(96 - shoulder / 2 + 6, 132, 13, 9, light, { opacity: 0.9 });
    out += E(96 + shoulder / 2 - 6, 132, 13, 9, light, { opacity: 0.9 });
  }
  out += C(96, headY, headR, light);
  out += Pg(`${96 - headR * 0.8},${headY - headR * 0.6} ${96 - headR * 1.5},${headY - headR * 1.7} ${96 - headR * 0.25},${headY - headR * 0.5}`, light);
  out += Pg(`${96 + headR * 0.8},${headY - headR * 0.6} ${96 + headR * 1.5},${headY - headR * 1.7} ${96 + headR * 0.25},${headY - headR * 0.5}`, light);
  out += C(96 - headR * 0.4, headY + 2, 4.2, '#1b1430');
  out += C(96 + headR * 0.4, headY + 2, 4.2, '#1b1430');
  out += Ln(`M${96 - headR * 0.3} ${headY + headR * 0.45} Q96 ${headY + headR * 0.65} ${96 + headR * 0.3} ${headY + headR * 0.45}`, dark, 2.6);
  return out;
}
function golem(p) {
  const { base, light, dark } = p;
  let out = E(96, 206, 54, 12, 'rgba(10,8,20,.4)');
  out += Rr(48, 110, 96, 96, 10, base);
  out += Rr(48, 110, 96, 20, 10, light);
  out += Rr(60, 150, 14, 46, 2, shade(base, 18), { opacity: 0.9 });
  out += Rr(80, 146, 14, 50, 2, shade(base, 10), { opacity: 0.9 });
  out += Rr(100, 150, 14, 46, 2, shade(base, 18), { opacity: 0.9 });
  out += C(72, 128, 6, '#1b1430');
  out += C(122, 128, 6, '#1b1430');
  out += Rr(40, 96, 112, 10, 4, dark);
  return out;
}
function chest(p) {
  const { base, light, dark, accent } = p;
  let out = E(96, 206, 52, 12, 'rgba(10,8,20,.4)');
  out += Rr(40, 140, 112, 62, 8, base);
  out += Pp('M40 140 Q96 110 152 140 L152 158 Q96 130 40 158 Z', light);
  out += Rr(84, 150, 24, 14, 3, dark);
  out += C(96, 144, 5, accent);
  for (let i = 0; i < 6; i += 1) out += Rr(48 + i * 16, 168, 10, 14, 2, shade(base, -10), { opacity: 0.85 });
  out += C(66, 124, 5, '#1b1430');
  out += C(126, 124, 5, '#1b1430');
  return out;
}
function drake(p, { grand = false } = {}) {
  const { base, light, dark, accent } = p;
  const wing = grand ? 70 : 42;
  let out = E(96, 206, 54, 12, 'rgba(10,8,20,.4)');
  out += Pp(`M96 150 Q${96 - wing} ${150 - wing * 0.9} ${96 - wing * 1.3} 110 Q${96 - wing * 0.5} 130 96 150 Z`, shade(base, -8), { opacity: 0.95 });
  out += Pp(`M96 150 Q${96 + wing} ${150 - wing * 0.9} ${96 + wing * 1.3} 110 Q${96 + wing * 0.5} 130 96 150 Z`, shade(base, -8), { opacity: 0.95 });
  out += Pp('M64 206 Q58 150 96 140 Q134 150 128 206 Z', base);
  out += Pg('96,76 78,118 114,118', light);
  out += C(96, 84, 20, light);
  out += Pg('80,70 70,50 92,64', dark);
  out += Pg('112,70 122,50 100,64', dark);
  out += C(88, 86, 4.2, accent);
  out += C(104, 86, 4.2, accent);
  if (grand) { out += Pg('70,128 56,150 78,146', dark); out += Pg('122,128 136,150 114,146', dark); }
  return out;
}
function serpentine(p, { grand = false } = {}) {
  const { base, light, dark, accent } = p;
  const wing = grand ? 76 : 50;
  let out = E(96, 210, 58, 10, 'rgba(10,8,20,.4)');
  if (grand || wing) {
    out += Pp(`M100 150 Q${100 - wing} ${150 - wing} ${100 - wing * 1.4} 112 Q${100 - wing * 0.4} 140 100 150 Z`, shade(base, -10), { opacity: 0.92 });
    out += Pp(`M92 150 Q${92 + wing} ${150 - wing} ${92 + wing * 1.4} 112 Q${92 + wing * 0.4} 140 92 150 Z`, shade(base, -10), { opacity: 0.92 });
  }
  out += Pp('M60 206 Q50 180 70 168 Q50 156 68 140 Q60 120 86 110 Q112 100 130 116 Q140 128 128 140 Q148 150 136 168 Q150 184 126 206 Z', base);
  for (let i = 0; i < 4; i += 1) out += E(80 + i * 12, 150 + (i % 2) * 14, 7, 10, light, { opacity: 0.55 });
  out += C(108, 112, 17, light);
  out += Pg('98,98 90,80 108,92', dark);
  out += Pg('120,100 132,84 116,92', dark);
  out += C(102, 112, 3.6, accent);
  out += C(114, 108, 3.6, accent);
  return out;
}
function hooded(p, { halo = false } = {}) {
  const { base, light, dark, accent } = p;
  let out = E(96, 206, 50, 12, 'rgba(10,8,20,.4)');
  out += Pp('M50 206 Q40 140 70 118 Q96 104 122 118 Q152 140 142 206 Z', base);
  out += Pp('M70 118 Q96 140 122 118 Q134 150 128 180 Q96 160 64 180 Q58 150 70 118 Z', dark);
  out += Pp('M68 118 Q96 96 124 118 Q128 96 110 80 Q96 72 82 80 Q64 96 68 118 Z', shade(base, -16));
  out += C(88, 128, 4.4, accent, { opacity: 0.9 });
  out += C(104, 128, 4.4, accent, { opacity: 0.9 });
  if (halo) out += `<circle cx="96" cy="88" r="20" fill="none" stroke="${accent}" stroke-width="2.4" opacity="0.8"/>`;
  return out;
}
function blobCreature(p) {
  const { base, light, dark, accent } = p;
  let out = E(96, 206, 54, 12, 'rgba(10,8,20,.4)');
  out += Pp('M50 198 Q40 140 96 120 Q152 140 142 198 Q96 222 50 198 Z', base);
  out += E(78, 150, 14, 10, light, { opacity: 0.6 });
  out += C(80, 160, 5, '#1b1430');
  out += C(110, 158, 5, '#1b1430');
  for (let i = 0; i < 3; i += 1) out += C(60 + i * 36, 208, 9, accent, { opacity: 0.85 });
  out += Pp('M86 172 Q96 180 106 172', 'none', { stroke: dark, 'stroke-width': 2.6 });
  return out;
}
function quadruped(p) {
  const { base, light, dark } = p;
  let out = E(96, 200, 52, 12, 'rgba(10,8,20,.4)');
  out += Pp('M50 170 Q50 150 76 148 Q84 128 116 134 Q140 140 138 164 Q150 170 142 182 L52 182 Q44 176 50 170 Z', base);
  out += Pg('128,130 142,112 136,138', dark);
  out += C(132, 134, 16, light);
  out += C(124, 132, 3.4, '#1b1430');
  out += Pp('M46 182 L30 196 M60 182 L52 198 M118 182 L122 200 M132 182 L140 198', 'none', { stroke: dark, 'stroke-width': 4 });
  out += Pp('M50 168 Q24 160 14 176', 'none', { stroke: base, 'stroke-width': 5, 'stroke-linecap': 'round' });
  return out;
}
function ghostSheet(p) {
  const { base, light, dark, accent } = p;
  let out = E(96, 208, 52, 10, 'rgba(10,8,20,.4)');
  out += Pp('M58 200 Q50 120 96 100 Q142 120 134 200 Q122 188 112 200 Q102 188 92 200 Q82 188 72 200 Q62 188 58 200 Z', base);
  out += E(96, 126, 30, 26, light, { opacity: 0.5 });
  out += C(84, 128, 4.6, '#1b1430');
  out += C(108, 128, 4.6, '#1b1430');
  out += Pp('M60 150 L134 150 M66 168 L128 168', 'none', { stroke: accent, 'stroke-width': 2, opacity: 0.5, 'stroke-dasharray': '4 5' });
  out += Pp('M86 142 Q96 148 106 142', 'none', { stroke: dark, 'stroke-width': 2.4 });
  return out;
}
function skeletal(p, { crown = false } = {}) {
  const { base, light, dark, accent } = p;
  let out = E(96, 206, 50, 12, 'rgba(10,8,20,.4)');
  out += Pp('M70 206 Q64 150 96 144 Q128 150 122 206 Z', shade(base, -6));
  out += Rr(84, 148, 24, 46, 4, light, { opacity: 0.85 });
  out += Pp('M72 160 L120 160 M72 172 L120 172 M72 184 L120 184', 'none', { stroke: dark, 'stroke-width': 2.4 });
  out += C(96, 108, 24, light);
  out += E(88, 112, 6, 7, '#1b1430');
  out += E(104, 112, 6, 7, '#1b1430');
  out += Pg('90,124 96,132 102,124', dark);
  out += Pp('M82 128 Q96 134 110 128', 'none', { stroke: dark, 'stroke-width': 2.4 });
  if (crown) out += Pg('80,86 86,66 96,80 106,66 112,86', accent);
  return out;
}
function eyeOrb(p) {
  const { base, light, dark, accent } = p;
  let out = E(96, 208, 50, 10, 'rgba(10,8,20,.4)');
  for (let i = 0; i < 3; i += 1) out += `<circle cx="96" cy="128" r="${50 + i * 14}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="${0.5 - i * 0.12}"/>`;
  out += C(96, 128, 46, base);
  out += E(96, 128, 30, 20, light);
  out += C(96, 128, 13, '#1b1430');
  out += C(96, 128, 6, accent);
  out += Pp('M50 128 Q96 108 142 128 Q96 148 50 128 Z', dark, { opacity: 0.35 });
  return out;
}
function wispOrb(p) {
  const { base, light, accent } = p;
  let out = E(96, 210, 46, 10, 'rgba(10,8,20,.4)');
  out += Pp('M96 206 Q70 190 74 160 Q58 150 70 128 Q66 100 96 86 Q126 100 122 128 Q134 150 118 160 Q122 190 96 206 Z', base);
  out += E(96, 130, 24, 30, light, { opacity: 0.65 });
  out += C(96, 126, 9, accent, { opacity: 0.9 });
  out += C(84, 150, 3, accent, { opacity: 0.7 });
  out += C(108, 160, 3, accent, { opacity: 0.6 });
  return out;
}
function armored(p, { grand = false } = {}) {
  const { base, light, dark, accent } = p;
  let out = humanoid(p, { headR: 26, shoulder: grand ? 64 : 50, torsoW: grand ? 62 : 52, plates: true });
  out += Pg(`${96 - (grand ? 50 : 34)},150 ${96 - (grand ? 70 : 50)},${grand ? 190 : 176} ${96 - (grand ? 44 : 30)},${grand ? 196 : 182}`, dark);
  out += Pg(`${96 - (grand ? 50 : 34)},150 ${96 - (grand ? 70 : 50)},${grand ? 190 : 176} ${96 - (grand ? 22 : 18)},${grand ? 168 : 160}`, light, { opacity: 0.8 });
  out += C(96, 110, 4, accent, { opacity: 0.9 });
  if (grand) out += Pg('70,86 96,62 122,86 96,78', accent, { opacity: 0.9 });
  return out;
}

const ARCHETYPES = {
  humanoid: p => humanoid(p),
  'humanoid-big': p => humanoid(p, { headR: 32, shoulder: 60, torsoW: 60, bigHead: true, cape: true }),
  golem,
  chest,
  drake: p => drake(p),
  'drake-grand': p => drake(p, { grand: true }),
  serpent: p => serpentine(p),
  'serpent-grand': p => serpentine(p, { grand: true }),
  hooded: p => hooded(p),
  'hooded-halo': p => hooded(p, { halo: true }),
  blob: blobCreature,
  quadruped,
  ghost: ghostSheet,
  skeleton: p => skeletal(p),
  'skeleton-crown': p => skeletal(p, { crown: true }),
  eyeOrb,
  wisp: wispOrb,
  armored: p => armored(p),
  'armored-grand': p => armored(p, { grand: true }),
};

// small badge icons layered bottom-right of the stage to individualize reused archetypes
function icon(key, color) {
  const g = inner => `<g transform="translate(130,172)">${inner}</g>`;
  switch (key) {
    case 'ledger': return g(`${Rr(-14, -12, 28, 24, 2, '#eadfc2')}${Ln('M-10 -6 L10 -6', color, 2)}${Ln('M-10 0 L10 0', color, 2)}${Ln('M-10 6 L4 6', color, 2)}`);
    case 'motion': return g(`${Ln('M-18 -8 L4 -8', color, 3)}${Ln('M-16 0 L2 0', color, 3)}${Ln('M-14 8 L0 8', color, 3)}`);
    case 'abacus': return g(`${Rr(-16, -10, 32, 20, 3, shade(color, -20))}${C(-8, 0, 2.6, '#eadfc2')}${C(2, 0, 2.6, '#eadfc2')}${C(10, 0, 2.6, '#eadfc2')}`);
    case 'mop': return g(`${Rr(-3, -16, 5, 28, 2, '#c8a86a')}${E(0, -18, 9, 7, '#e7e0cf')}`);
    case 'witch-hat': return g(`${Pg('-14,8 0,-20 14,8', '#3c2d52')}${Rr(-16, 8, 32, 5, 2, '#20162f')}`);
    case 'paper-stack': return g(`${Rr(-14, -8, 24, 18, 2, '#eadfc2')}${Rr(-10, -14, 24, 18, 2, '#f3ecd8')}`);
    case 'necktie': return g(`${Pg('-4,-14 4,-14 7,0 0,10 -7,0')}${''}`.replace('fill=""', `fill="${color}"`));
    case 'crown': return g(`${Pg('-16,6 -16,-6 -6,2 0,-12 6,2 16,-6 16,6', '#f4c05e')}`);
    case 'wing-small': return g(`${Pp('M-16 6 Q-4 -10 10 2 Q-2 4 -16 6 Z', color, { opacity: 0.8 })}`);
    case 'chest-eye': return g(`${Rr(-14, -10, 28, 20, 3, shade(color, -18))}${C(0, 0, 5, '#f4c05e')}`);
    case 'shield-small': return g(`${Pg('0,-14 12,-6 10,10 0,16 -10,10 -12,-6', '#cfd8da')}`);
    case 'loupe': return g(`${C(-2, -2, 10, 'none', { stroke: color, 'stroke-width': 3 })}${Ln('M6 6 L16 16', color, 3)}`);
    case 'coins': return g(`${C(-8, 6, 9, '#f4c05e')}${C(6, 2, 9, '#e0ab3f')}${C(0, -8, 9, '#f4c05e')}`);
    case 'shield-large': return g(`${Pg('0,-18 16,-8 14,14 0,22 -14,14 -16,-8', '#cfd8da')}${Ln('M0 -14 L0 18', color, 2)}`);
    case 'wing-mid': return g(`${Pp('M-18 8 Q-2 -16 14 0 Q-4 6 -18 8 Z', color, { opacity: 0.85 })}`);
    case 'wing-grand': return g(`${Pp('M-20 10 Q-2 -20 18 -2 Q-4 8 -20 10 Z', color)}${Pg('-6,-18 0,-30 8,-18', '#f4c05e')}`);
    case 'flame': return g(`${Pp('M0 14 Q-10 4 -4 -10 Q0 -4 2 -12 Q10 0 0 14 Z', '#ff8a3d')}`);
    case 'lantern': return g(`${Rr(-8, -10, 16, 20, 3, '#f4c05e')}${Ln('M0 -14 L0 -10', color, 2)}`);
    case 'cable': return g(`${Ln('M-16 -10 Q0 10 16 -6', color, 3)}${C(16, -6, 3, '#6fe3b4')}`);
    case 'candle': return g(`${Rr(-4, -2, 8, 18, 1, '#eadfc2')}${Pp('M0 -8 Q-4 -2 0 2 Q4 -2 0 -8 Z', '#ff8a3d')}`);
    case 'laptop': return g(`${Rr(-14, -8, 28, 16, 2, shade(color, -20))}${Rr(-11, -6, 22, 11, 1, '#6fe3b4', { opacity: 0.6 })}`);
    case 'scanlines': return g(`${Ln('M-16 -8 L16 -8', color, 2, { opacity: 0.6 })}${Ln('M-16 0 L16 0', color, 2, { opacity: 0.6 })}${Ln('M-16 8 L16 8', color, 2, { opacity: 0.6 })}`);
    case 'staff-crown': return g(`${Ln('M0 -16 L0 16', '#cfd8da', 3)}${Pg('-7,-16 0,-26 7,-16', '#f4c05e')}`);
    case 'halo-rings': return g(`<circle cx="0" cy="0" r="14" fill="none" stroke="${color}" stroke-width="2"/><circle cx="0" cy="0" r="20" fill="none" stroke="${color}" stroke-width="1.4" opacity=".6"/>`);
    default: return '';
  }
}

const CARD_VISUALS = {
  clerk: { tpl: 'humanoid', icon: 'ledger' },
  runner: { tpl: 'humanoid', icon: 'motion' },
  accountant: { tpl: 'humanoid', icon: 'abacus' },
  janitor: { tpl: 'humanoid', icon: 'mop' },
  manager: { tpl: 'humanoid', icon: 'witch-hat' },
  printer: { tpl: 'golem', icon: 'paper-stack' },
  director: { tpl: 'humanoid-big', icon: 'necktie' },
  founder: { tpl: 'humanoid-big', icon: 'crown' },
  hatchling: { tpl: 'drake', icon: 'wing-small' },
  mimic: { tpl: 'chest', icon: 'chest-eye' },
  squire: { tpl: 'armored', icon: 'shield-small' },
  appraiser: { tpl: 'hooded', icon: 'loupe' },
  hoarder: { tpl: 'blob', icon: 'coins' },
  knight: { tpl: 'armored-grand', icon: 'shield-large' },
  wyrm: { tpl: 'serpent', icon: 'wing-mid' },
  dragon: { tpl: 'serpent-grand', icon: 'wing-grand' },
  wisp: { tpl: 'wisp', icon: 'flame' },
  skeleton: { tpl: 'skeleton', icon: 'lantern' },
  rat: { tpl: 'quadruped', icon: 'cable' },
  medium: { tpl: 'hooded', icon: 'candle' },
  hacker: { tpl: 'hooded', icon: 'laptop' },
  ghost: { tpl: 'ghost', icon: 'scanlines' },
  lich: { tpl: 'skeleton-crown', icon: 'staff-crown' },
  oracle: { tpl: 'eyeOrb', icon: 'halo-rings' },
};

function stageDefs(base, dark, bgId) {
  return `<defs><linearGradient id="${bgId}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${shade(base, 30, -10)}"/>
    <stop offset="60%" stop-color="${shade(base, -4)}"/>
    <stop offset="100%" stop-color="${shade(dark, -14)}"/>
  </linearGradient></defs>`;
}

export function cardArt(card) {
  const set = SET_BY_ID && SET_BY_ID[card.set];
  const rarity = (RARITIES && RARITIES[card.rarity]) || { color: '#cfd8da', rank: 0 };
  const cfg = CARD_VISUALS[card.id] || { tpl: 'humanoid', icon: '' };
  const baseColor = (set && set.color) || '#5b6b74';
  const palette = { base: baseColor, light: shade(baseColor, 26), dark: shade(baseColor, -22), accent: rarity.color };
  const draw = ARCHETYPES[cfg.tpl] || ARCHETYPES.humanoid;
  const bgId = uid('bg');
  const rank = rarity.rank || 0;
  const placeholder = `<svg class="card-art-svg" viewBox="0 0 192 240" role="img" aria-label="${esc(card.name)} silhouette" preserveAspectRatio="xMidYMid slice">
    ${stageDefs(palette.base, palette.dark, bgId)}
    <rect x="0" y="0" width="192" height="240" fill="url(#${bgId})"/>
    ${rarityAura(rank, 96, 120, rarity.color)}
    ${draw(palette)}
    ${icon(cfg.icon, palette.accent)}
    <rect x="2" y="2" width="188" height="236" rx="10" fill="none" stroke="${hexToRgba(rarity.color, rank > 0 ? 0.65 : 0.25)}" stroke-width="${rank >= 3 ? 3 : 2}"/>
  </svg>`;
  return withAsset(ASSETS.cards && ASSETS.cards[card.id], card.name, placeholder);
}

export function packArt(set) {
  const base = (set && set.color) || '#5b6b74';
  const light = shade(base, 24);
  const dark = shade(base, -26);
  const gId = uid('pack');
  const sheenId = uid('sheen');
  const mascot = set && set.id === 'vault' ? drake({ base: light, light: shade(light, 18), dark, accent: '#fff' })
    : set && set.id === 'crypt' ? wispOrb({ base: light, light: shade(light, 18), dark, accent: '#fff' })
    : humanoid({ base: light, light: shade(light, 18), dark, accent: '#fff' });
  const placeholder = `<svg class="pack-art-svg" viewBox="0 0 162 240" role="img" aria-label="${esc(set ? set.name : 'pack')} wrapper" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="${gId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="55%" stop-color="${base}"/>
        <stop offset="100%" stop-color="${dark}"/>
      </linearGradient>
      <linearGradient id="${sheenId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="30%" stop-color="#fff" stop-opacity="0"/>
        <stop offset="48%" stop-color="#fff" stop-opacity=".35"/>
        <stop offset="60%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="M14 26 L148 26 Q156 26 156 36 L150 220 Q148 236 132 236 L30 236 Q14 236 12 220 L6 36 Q6 26 14 26 Z" fill="url(#${gId})"/>
    <path d="M14 26 L148 26 Q156 26 156 36 L150 220 Q148 236 132 236 L30 236 Q14 236 12 220 L6 36 Q6 26 14 26 Z" fill="url(#${sheenId})"/>
    <path d="M10 42 L152 42" stroke="${dark}" stroke-width="3" stroke-dasharray="4 5" opacity=".6"/>
    <g transform="translate(81,150) scale(0.46)" transform-origin="96 120">${mascot}</g>
    <circle cx="81" cy="70" r="26" fill="${dark}" opacity=".55"/>
    <circle cx="81" cy="70" r="26" fill="none" stroke="${light}" stroke-width="2" opacity=".8"/>
    <path d="M14 26 Q81 14 148 26" fill="none" stroke="${light}" stroke-width="3" opacity=".7"/>
  </svg>`;
  return withAsset(ASSETS.packs && ASSETS.packs[set && set.id], set ? set.name : 'pack', placeholder);
}

export function boxArt(set) {
  const base = (set && set.color) || '#5b6b74';
  const light = shade(base, 22);
  const dark = shade(base, -28);
  const gId = uid('box');
  const placeholder = `<svg class="box-art-svg" viewBox="0 0 240 160" role="img" aria-label="${esc(set ? set.name : 'booster box')} box" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="100%" stop-color="${base}"/>
    </linearGradient></defs>
    <polygon points="20,40 170,24 220,44 220,128 170,144 20,128" fill="url(#${gId})"/>
    <polygon points="170,24 220,44 220,128 170,144" fill="${dark}"/>
    <polygon points="20,40 170,24 170,42 20,58" fill="${light}" opacity=".7"/>
    <rect x="46" y="62" width="100" height="56" rx="6" fill="${dark}" opacity=".5"/>
    <rect x="52" y="68" width="88" height="44" rx="4" fill="${shade(base, 8)}"/>
    <g transform="translate(96,70) scale(0.34)">${humanoid({ base: light, light: shade(light, 16), dark, accent: '#fff' })}</g>
    <rect x="20" y="40" width="150" height="88" fill="none" stroke="${light}" stroke-width="2" opacity=".35"/>
    <ellipse cx="120" cy="150" rx="90" ry="8" fill="rgba(5,6,16,.4)"/>
  </svg>`;
  return withAsset(ASSETS.boxes && ASSETS.boxes[set && set.id], set ? set.name : 'booster box', placeholder);
}
