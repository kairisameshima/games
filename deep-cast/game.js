'use strict';
/* ================= HELPERS ================= */
const $ = s => document.querySelector(s);
const rnd = Math.random;
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 10000) return Math.floor(n).toLocaleString('en-US');
  let v = a, u = -1;
  while (v >= 1000 && u < UNITS.length - 1) { v /= 1000; u++; }
  if (v >= 1000) return n.toExponential(2).replace('e+', 'e');
  return (n < 0 ? '-' : '') + (v < 100 ? v.toFixed(2) : v.toFixed(1)).replace(/\.?0+$/, '') + UNITS[u];
}
const fmtM = m => Math.round(m).toLocaleString('en-US') + 'm';
function md(s) { return s.replace(/\[(\w|\$)\]([\s\S]*?)\[\/\]/g, (m, k, t) => `<span class="k-${k === '$' ? 'money' : k}">${t}</span>`); }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t) * 255).toString(16).padStart(2, '0')).join('');
}
function weightedPick(entries) {
  const total = entries.reduce((a, e) => a + e[1], 0);
  let x = rnd() * total;
  for (const [v, w] of entries) { x -= w; if (x <= 0) return v; }
  return entries[entries.length - 1][0];
}
function compact(arr, keep) {
  let w = 0;
  for (let r = 0; r < arr.length; r++) if (keep(arr[r])) arr[w++] = arr[r];
  arr.length = w;
}

/* ================= WORLD GEOMETRY =================
   The ocean is simulated and drawn in low-res pixels (OW x OH viewport, scaled 3x on screen).
   World y = 0 is the sea surface; each depth zone is ZONES[i].h pixels tall. */
const OW = 224, OH = 230, OX = 300, OY = 15, PXS = 3;
const SKY = 90;
const ZONE_Y = [];
let WORLD_BOTTOM = 0;
for (const z of ZONES) { ZONE_Y.push(WORLD_BOTTOM); WORLD_BOTTOM += z.h; }
const FLOOR_H = 60, LAYER_H = SKY + WORLD_BOTTOM + FLOOR_H;
const CAM_MIN = -SKY, CAM_MAX = WORLD_BOTTOM + FLOOR_H - OH;
const REST_CAM = -78;
const BOAT_X = 92;
const SPACING = 24;
const MAX_FISH = 90;
const DAYS_TO_WIN = 18;
const BASE_BITE = 0.5;

function depthToY(m) {
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    if (m <= z.to || i === ZONES.length - 1) return ZONE_Y[i] + ((Math.max(m, z.from) - z.from) / (z.to - z.from)) * z.h;
  }
  return WORLD_BOTTOM;
}
function yToDepth(y) {
  if (y <= 0) return 0;
  const i = zoneAtY(y), z = ZONES[i];
  return z.from + ((y - ZONE_Y[i]) / z.h) * (z.to - z.from);
}
function zoneAtY(y) {
  for (let i = ZONES.length - 1; i >= 0; i--) if (y >= ZONE_Y[i]) return i;
  return 0;
}

/* ================= STATE ================= */
const SAVE = 'deepcast_v1';
const prefs = Object.assign({ speed: 1, sound: true, music: true }, JSON.parse(localStorage.getItem(SAVE + '_prefs') || '{}'));
const best = Object.assign({ day: 0, cast: 0, runs: 0, wins: 0, dex: {}, legends: {} }, JSON.parse(localStorage.getItem(SAVE + '_best') || '{}'));
const savePrefs = () => localStorage.setItem(SAVE + '_prefs', JSON.stringify(prefs));
const saveBest = () => localStorage.setItem(SAVE + '_best', JSON.stringify(best));

const S = {
  phase: 'title', day: 1, money: 4, haul: 0, shownHaul: 0, quota: 0, castsLeft: 0, castNo: 0,
  hooks: [], crew: [], crewSlots: 5, tackle: { length: 0, strength: 0, slots: 0, soak: 0, casts: 0 },
  bait: [], baitNext: [], event: null, legend: null, landed: [], seen: new Set(),
  offers: [], rerollCost: 2, sel: -1, cast: null, fish: [], bubbles: [], t: 0,
  camY: REST_CAM, chips: 0, mult: 0, log: [], tray: [], fishToday: 0, bosunUsed: false,
  stats: { fish: 0, bestCast: 0, snaps: 0, biggest: null },
};
window.__S = S;

/* ================= AUDIO ================= */
let AC = null, master = null, musicBus = null;
const music = { next: 0, step: 0 };
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = 0.45; master.connect(AC.destination);
  musicBus = AC.createGain(); musicBus.gain.value = 0.13;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
  musicBus.connect(lp); lp.connect(AC.destination);
  music.next = AC.currentTime + 0.1;
}
function osc(f, d, type, v, { slide = 0, delay = 0, bus = null, at = null } = {}) {
  if (!AC) return;
  if (!bus && !prefs.sound) return;
  const t = at ?? AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(bus || master); o.start(t); o.stop(t + d + 0.05);
}
let noiseBuf = null;
function noise(d, v, freq, { q = 1, delay = 0, type = 'bandpass' } = {}) {
  if (!AC || !prefs.sound) return;
  if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = rnd() * 2 - 1; }
  const t = AC.currentTime + delay, s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, rnd() * 0.5); s.stop(t + d + 0.05);
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const PENTA = [0, 3, 5, 7, 10];
const lastSfx = {};
function throttled(key, gap) { if (!AC) return false; const t = AC.currentTime; if (t - (lastSfx[key] || 0) < gap) return false; lastSfx[key] = t; return true; }
const SFX = {
  splash() { noise(0.4, 0.35, 700, { type: 'lowpass' }); osc(320, 0.25, 'sine', 0.12, { slide: 70 }); },
  ping() { osc(1480, 0.8, 'sine', 0.07); osc(1480, 0.8, 'sine', 0.025, { delay: 0.4 }); },
  bite(z) { if (!throttled('bite', 0.05)) return; const m = 74 - z * 3 + PENTA[Math.floor(rnd() * 5)]; osc(mtof(m), 0.2, 'triangle', 0.13, { slide: mtof(m - 12) }); osc(mtof(m + 12), 0.06, 'sine', 0.05); },
  reel() { if (!throttled('reel', 0.06)) return; osc(1700 + rnd() * 300, 0.02, 'square', 0.015); },
  snap() { osc(1300, 0.35, 'sawtooth', 0.12, { slide: 80 }); noise(0.3, 0.35, 2600); },
  chomp() { if (!throttled('chomp', 0.08)) return; osc(150, 0.16, 'square', 0.12, { slide: 55 }); noise(0.12, 0.3, 700); },
  roar() { osc(55, 1.8, 'sawtooth', 0.22, { slide: 36 }); osc(82, 1.5, 'square', 0.06, { slide: 48 }); noise(1.3, 0.2, 200, { type: 'lowpass' }); },
  hold() { [196, 247, 294, 392, 494].forEach((f, i) => osc(f, 0.5, 'square', 0.06, { delay: i * 0.08 })); },
  land() { if (!throttled('land', 0.1)) return; noise(0.25, 0.25, 1100); osc(220, 0.14, 'triangle', 0.12, { slide: 520 }); },
  score(n) { if (!throttled('score', 0.03)) return; const m = 62 + PENTA[n % 5] + 12 * Math.floor(n / 5); osc(mtof(Math.min(m, 102)), 0.13, 'triangle', 0.11); },
  mult() { if (!throttled('mult', 0.04)) return; osc(440, 0.18, 'square', 0.06, { slide: 880 }); osc(660, 0.2, 'triangle', 0.08); },
  xmult() { osc(330, 0.3, 'sawtooth', 0.08, { slide: 1320 }); osc(990, 0.25, 'square', 0.05, { delay: 0.06 }); },
  total(big) { const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784]; notes.forEach((f, i) => osc(f, 0.3, 'square', 0.06, { delay: i * 0.05 })); },
  coin() { if (!throttled('coin', 0.05)) return; osc(1568, 0.07, 'square', 0.04); osc(2093, 0.18, 'square', 0.04, { delay: 0.06 }); },
  shiny() { [988, 1319, 1568, 1976].forEach((f, i) => osc(f, 0.16, 'sine', 0.06, { delay: i * 0.04 })); },
  button() { osc(420, 0.06, 'square', 0.06); noise(0.03, 0.12, 2200); },
  buy() { [523, 659, 784, 1047].forEach((f, i) => osc(f, 0.14, 'triangle', 0.12, { delay: i * 0.05 })); },
  nope() { osc(200, 0.12, 'square', 0.08, { slide: 120 }); },
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => osc(f, 0.35, 'triangle', 0.13, { delay: i * 0.07 })); },
  lose() { [392, 330, 262, 196, 147].forEach((f, i) => osc(f, 0.5, 'sawtooth', 0.07, { delay: i * 0.2 })); },
  fanfare() { [262, 330, 392, 523, 392, 523, 659, 784].forEach((f, i) => osc(f, 0.4, 'square', 0.07, { delay: i * 0.09 })); osc(65, 1.4, 'sawtooth', 0.15, { slide: 130 }); },
};
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
function musicTick() {
  if (!AC || !prefs.music) return;
  if (music.next < AC.currentTime) music.next = AC.currentTime + 0.05;
  const z = S.cast ? zoneAtY(S.cast.bottomY) : 0;
  const drop = S.phase === 'title' ? 0 : z * 2;
  while (music.next < AC.currentTime + 0.3) {
    const t = music.next, st = music.step, bar = Math.floor(st / 8) % 4, s = st % 8;
    const ch = PROG[bar].map(m => m - drop);
    if (s === 0) { osc(mtof(ch[0] - 24), 2.6, 'triangle', 0.5, { bus: musicBus, at: t }); ch.forEach(m => osc(mtof(m), 2.6, 'sine', 0.08, { bus: musicBus, at: t })); }
    if (s === 4) osc(mtof(ch[0] - 12), 1.2, 'triangle', 0.25, { bus: musicBus, at: t });
    if (s % 2 === 0 || z < 2) osc(mtof(ch[[0, 1, 2, 1, 2, 0, 1, 2][s]] + 12), 0.4, 'sine', 0.07, { bus: musicBus, at: t });
    if (s === 6 && z >= 2) osc(mtof(ch[2] + 24), 0.9, 'sine', 0.03, { bus: musicBus, at: t });
    music.next += 0.3 + z * 0.02; music.step++;
  }
}

/* ================= BACKGROUND SHADER ================= */
const bgCanvas = $('#bg');
const gl = bgCanvas.getContext('webgl');
const BG = { cur: [hexRgb('#1aa6c8'), hexRgb('#123f6a'), hexRgb('#050c16')], tgt: null, t: 0, spin: 0, boost: 0 };
BG.tgt = BG.cur.map(c => c.slice());
const BG_THEMES = {
  title: ['#1aa6c8', '#1d3f8a', '#050c16'],
  shop: ['#1d8a7a', '#123f4a', '#06141a'],
  lose: ['#9a2020', '#3f1010', '#120606'],
  legend: ['#c8a040', '#3a1a5a', '#08040e'],
};
const glU = {};
if (gl) {
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `precision highp float;
uniform vec2 R;uniform float TT;uniform float SPN;uniform vec3 C1;uniform vec3 C2;uniform vec3 C3;
void main(){
  float ps=length(R)/650.;
  vec2 uv=(floor(gl_FragCoord.xy/ps)*ps-.5*R)/length(R);
  float l=length(uv);
  float speed=SPN*0.2+302.2;
  float ang=atan(uv.y,uv.x)+speed-20.*(0.25*l+0.75);
  vec2 mid=(R/length(R))/2.;
  uv=vec2(l*cos(ang)+mid.x,l*sin(ang)+mid.y)-mid;
  uv*=30.;
  float sp=TT*2.;
  vec2 uv2=vec2(uv.x+uv.y);
  for(int i=0;i<5;i++){
    uv2+=sin(max(uv.x,uv.y))+uv;
    uv+=.5*vec2(cos(5.1123314+.353*uv2.y+sp*.131121),sin(uv2.x-.113*sp));
    uv-=1.*cos(uv.x+uv.y)-1.*sin(uv.x*.711-uv.y);
  }
  float cm=.25*2.+.5*.25+1.2;
  float pr=min(2.,max(0.,length(uv)*.035*cm));
  float c1p=max(0.,1.-cm*abs(1.-pr));
  float c2p=max(0.,1.-cm*abs(pr));
  float c3p=1.-min(1.,c1p+c2p);
  vec3 col=(.3/2.)*C1+(1.-.3/2.)*(C1*c1p+C2*c2p+C3*c3p);
  gl_FragColor=vec4(col,1.);
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const u of ['R', 'TT', 'SPN', 'C1', 'C2', 'C3']) glU[u] = gl.getUniformLocation(prog, u);
}
function setBg(theme) { BG.tgt = (Array.isArray(theme) ? theme : BG_THEMES[theme]).map(hexRgb); }
function zoneTheme(z) { const Z = ZONES[z]; return [mixHex(Z.water[0], '#ffffff', 0.15), Z.water[1], mixHex(Z.water[1], '#000000', 0.6)]; }
function drawBg(dt) {
  if (!gl) return;
  BG.boost *= Math.pow(0.97, dt / 16.7);
  BG.t += dt * 0.001 * (0.35 + BG.boost * 0.5);
  BG.spin += dt * 0.001 * (0.4 + BG.boost * 2);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) BG.cur[i][k] += (BG.tgt[i][k] - BG.cur[i][k]) * 0.03;
  gl.uniform2f(glU.R, bgCanvas.width, bgCanvas.height);
  gl.uniform1f(glU.TT, BG.t); gl.uniform1f(glU.SPN, BG.spin);
  gl.uniform3fv(glU.C1, BG.cur[0]); gl.uniform3fv(glU.C2, BG.cur[1]); gl.uniform3fv(glU.C3, BG.cur[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ================= STAGE ================= */
const stageEl = $('#stage');
let scale = 1;
function fit() {
  const w = innerWidth, h = innerHeight;
  scale = Math.min(w / 1280, h / 720);
  stageEl.style.transform = `translate(${(w - 1280 * scale) / 2}px,${(h - 720 * scale) / 2}px) scale(${scale})`;
  bgCanvas.width = Math.ceil(w / 2); bgCanvas.height = Math.ceil(h / 2);
  if (gl) gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
}
addEventListener('resize', fit);
addEventListener('scroll', () => scrollTo(0, 0));
function elCenter(el) { const r = el.getBoundingClientRect(), s = stageEl.getBoundingClientRect(); return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale }; }
let shakeAmt = 0;
const shakeEl = $('#shake');
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
function stepShake(dt) {
  if (shakeAmt < 0.2) { if (shakeAmt) { shakeEl.style.transform = ''; shakeAmt = 0; } return; }
  shakeEl.style.transform = `translate(${(rnd() - 0.5) * shakeAmt * 2}px,${(rnd() - 0.5) * shakeAmt * 2}px) rotate(${(rnd() - 0.5) * shakeAmt * 0.1}deg)`;
  shakeAmt *= Math.pow(0.88, dt / 16.67);
}
function banner(text, color = '#fff', sub = '') {
  $('#banner').innerHTML = `<div class="bt" style="color:${color}">${[...text].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
}
function bumpEl(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/* ================= FULL-RES FX (particles, pops, catch tray) ================= */
const fcv = $('#fx'), fctx = fcv.getContext('2d');
fctx.imageSmoothingEnabled = false;
const parts = [], pops = [];
const toStage = (x, y) => ({ x: OX + x * PXS, y: OY + (y - S.camY) * PXS });
function burst(x, y, n, colors, spd = 4, opts = {}) {
  if (parts.length > 900) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, v = spd * (0.3 + rnd());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 1), life: 1, decay: 0.02 + rnd() * 0.03, size: (opts.size || 3) + rnd() * 3, col: pick(colors), g: opts.g ?? 0.15 });
  }
}
function pop(x, y, text, col = '#fff', size = 18, bg = null) {
  if (pops.length > 60) { if (size < 22) return; pops.shift(); }
  pops.push({ x, y, text, col, size, bg, life: 1, vy: -40 - rnd() * 20 });
}
function popWorld(x, y, text, col, size, bg) { const p = toStage(x, y); pop(clamp(p.x, OX + 30, OX + 642), clamp(p.y, OY + 14, OY + 676), text, col, size, bg); }
function burstWorld(x, y, n, colors, spd, opts) { const p = toStage(x, y); burst(p.x, p.y, n, colors, spd, opts); }
function stepFx(dt) {
  const k = dt / 16.67;
  for (const p of parts) { p.vx *= 0.97; p.vy = p.vy * 0.97 + p.g * k; p.x += p.vx * k; p.y += p.vy * k; p.life -= p.decay * k; }
  compact(parts, p => p.life > 0 && p.y <= 760);
  for (const p of pops) { p.life -= dt / 1000 / 1.0; p.y += p.vy * dt / 1000; p.vy *= 0.94; }
  compact(pops, p => p.life > 0);
}
function setFont(g, f) { if (g.__font !== f) { g.__font = f; g.font = f; } }
function drawFx() {
  const g = fctx;
  g.clearRect(0, 0, 1280, 720);
  drawTray(g);
  drawDepthHud(g);
  for (const p of parts) {
    g.globalAlpha = Math.min(1, p.life * 2);
    g.fillStyle = p.col;
    g.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.round(p.size), Math.round(p.size));
  }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const p of pops) {
    const age = 1 - p.life, sc = age < 0.15 ? 0.4 + (age / 0.15) * 0.9 : age < 0.3 ? 1.3 - ((age - 0.15) / 0.15) * 0.3 : 1;
    g.globalAlpha = Math.min(1, p.life * 3);
    const px = Math.max(8, Math.round((p.size * sc) / 2) * 2);
    if (p.w0 === undefined) { setFont(g, `${p.size}px "Jersey 10", monospace`); p.w0 = g.measureText(p.text).width; }
    setFont(g, `${px}px "Jersey 10", monospace`);
    if (p.bg) {
      const w = (p.w0 * px) / p.size + 12, hh = px + 4;
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(p.x - w / 2, p.y - hh / 2 + 3, w, hh);
      g.fillStyle = p.bg; g.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
      g.fillStyle = '#fff'; g.fillText(p.text, p.x, p.y + 1);
    } else {
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.col; g.fillText(p.text, p.x, p.y);
    }
  }
  g.globalAlpha = 1;
}

/* ================= EFFECTIVE STATS ================= */
const crewN = k => S.crew.filter(c => c === k).length;
const hasCrew = k => S.crew.includes(k);
const baitOn = k => S.bait.includes(k);
const tval = k => TACKLE[k].levels[S.tackle[k]];
const curseOn = k => !!(S.legend && S.legend.k === k && !S.legend.landed);
const eventOn = k => !!(S.event && S.event.k === k);
function lineStrength() {
  let s = tval('strength') * (1 + 0.4 * crewN('mender'));
  if (eventOn('storm')) s *= 0.75;
  if (curseOn('umibozu')) s *= 0.7;
  return Math.round(s);
}
const soakTime = () => tval('soak') * (curseOn('leviathan') ? 0.5 : 1);
const castsPerDay = () => tval('casts') + crewN('deckhand') - (S.legend && S.legend.k === 'aspidochelone' ? 1 : 0);
const hookSlots = () => tval('slots');
const isLegendDay = d => d % 3 === 0;
const dayZone = d => Math.min(ZONES.length - 1, Math.floor((d - 1) / 3));
/* Calibrated against a scripted shopper: it clears roughly the first 12-15 days, so a player who builds
   synergies can finish. Legend days ask for more because landing the legend pays for the day. */
function quotaFor(d) {
  const q = 140 * Math.pow(1.52, d - 1) * (isLegendDay(d) ? 1.15 : 1);
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(q)) - 1));
  return Math.round(q / mag) * mag;
}
function shinyChance(hookType) {
  let p = 0;
  if (hookType === 'lucky') p = 1 / 3;
  if (hasCrew('luckygull')) p = 1 - (1 - p) * Math.pow(0.9, crewN('luckygull'));
  if (baitOn('golden')) p = 1 - (1 - p) * (7 / 8);
  return p;
}
function schoolSize() {
  let n = 3 + Math.floor(rnd() * 3);
  if (baitOn('chum')) n *= 2;
  if (eventOn('bloom')) n *= 2;
  n *= Math.pow(1.5, crewN('chumlord'));
  return Math.min(12, Math.round(n));
}

/* ================= FISH ================= */
const ZONE_SPECIES = ZONES.map((z, i) => SPECIES_KEYS.filter(k => SPECIES[k].zone === i).map(k => [k, SPECIES[k].rarity]));
function newFish(sp, x, y, dir) {
  const d = SPECIES[sp];
  const big = rnd() < 0.05;
  const s = big ? 1.5 + rnd() * 0.3 : 0.8 + rnd() * 0.45;
  return {
    sp, d, x, y, dir, s, len: Math.max(4, Math.round(d.size * s)), w: d.weight * s * s * s, val: Math.max(1, Math.round(d.value * s * s)),
    speed: d.speed * (0.8 + rnd() * 0.4), ph: rnd() * 6.28, hook: -1, tried: 0, shiny: false, eager: false, ate: 0, ateN: 0, life: 0, dead: false, vx: 0, vy: 0,
  };
}
function speciesAt(y) {
  let z = zoneAtY(y);
  if (eventOn('migration') && z < ZONES.length - 1 && rnd() < 0.5) z++;
  return weightedPick(ZONE_SPECIES[z]);
}
function spawnGroup(y, x, dir) {
  if (S.fish.length >= MAX_FISH) return;
  const sp = speciesAt(y), d = SPECIES[sp];
  const n = d.school ? schoolSize() : 1;
  for (let i = 0; i < n && S.fish.length < MAX_FISH; i++) {
    const f = newFish(sp, x - dir * i * (d.size * 0.9 + 3) + (rnd() - 0.5) * 4, y + (rnd() - 0.5) * (n > 1 ? 14 : 2), dir);
    S.fish.push(f);
  }
}
function spawnEdge(y, eager) {
  const dir = rnd() < 0.5 ? 1 : -1;
  const x = dir > 0 ? -20 : OW + 20;
  const before = S.fish.length;
  spawnGroup(y, x, dir);
  if (eager) for (let i = before; i < S.fish.length; i++) S.fish[i].eager = true;
}
/* Keep the water populated: fish are seeded in rows just outside the camera as it moves,
   and approachers swim in from the edges toward the hooks during the soak. */
const SEED_ROW = 12, RESEED_AFTER = 8;
const rowSeeded = new Float64Array(Math.ceil(LAYER_H / SEED_ROW)).fill(-1e9);
/* Rows are seeded only while just outside the view (so fish never pop in), at most once per RESEED_AFTER
   seconds; `inView` also seeds visible rows (used when a scene starts). */
function seedRows(inView = false) {
  const top = Math.max(4, S.camY - 36), bot = Math.min(WORLD_BOTTOM - 4, S.camY + OH + 36);
  for (let y = Math.floor(top / SEED_ROW) * SEED_ROW; y < bot; y += SEED_ROW) {
    const r = Math.floor((y + SKY) / SEED_ROW);
    if (S.t - rowSeeded[r] < RESEED_AFTER) continue;
    if (!inView && y + SEED_ROW > S.camY && y < S.camY + OH) continue;
    rowSeeded[r] = S.t;
    if (rnd() < 0.42) spawnGroup(Math.max(4, y) + rnd() * SEED_ROW, rnd() * OW, rnd() < 0.5 ? 1 : -1);
  }
}
function resetSeeding() { rowSeeded.fill(-1e9); seedRows(true); }
function hookAccepts(h, f) {
  if (h.cut || h.tangled || h.catch.length >= h.cap) return false;
  const H = HOOKS[h.type];
  if (H.maxSize && f.d.size > H.maxSize) return false;
  if (H.minWeight && f.w < H.minWeight) return false;
  if (curseOn('bakunawa') && !f.d.glow) return false;
  return true;
}
function biteChance(h, f) {
  let p = BASE_BITE * (1 + 0.3 * crewN('sonar'));
  const z = f.d.zone;
  if (baitOn('worms') && z <= 1) p *= 1.5;
  if (baitOn('squid') && z >= 2) p *= 1.5;
  if (eventOn('cold')) p *= 0.7;
  if (f.d.glow && hookLit(h)) p *= 2;
  if (f.d.pred && baitOn('spoiled')) p *= 2;
  return Math.min(0.95, p);
}
const hookLit = h => h.type === 'glow' || baitOn('glowsticks');
function hookFish(h, f, hi) {
  f.hook = hi; f.eager = false;
  f.shiny = f.shiny || rnd() < shinyChance(h.type);
  h.catch.push(f);
  SFX.bite(f.d.zone);
  if (f.shiny) SFX.shiny();
  burstWorld(h.x, h.y, 6, ['#ffffff', '#bfefff', f.d.glow || f.d.body], 2.5, { size: 2, g: -0.05 });
  for (let i = 0; i < 4; i++) S.bubbles.push({ x: h.x + (rnd() - 0.5) * 6, y: h.y, vy: -10 - rnd() * 14, life: 1 });
}
function stepFish(dt) {
  const c = S.cast;
  const soaking = c && c.stage === 'soak';
  const hooks = c ? c.hooks : null;
  for (const f of S.fish) {
    f.life += dt;
    f.ph += dt * (4 + f.speed * 0.1);
    if (f.hook >= 0) {
      const h = hooks && hooks[f.hook];
      if (!h) { f.dead = true; continue; }
      const k = h.catch.indexOf(f);
      f.x = h.x + (k - (h.catch.length - 1) / 2) * 5 + Math.sin(f.ph * 2) * 1.2;
      f.y = h.y + 3 + f.len * 0.25;
      if (Math.sin(f.ph * 0.7) > 0.95) f.dir = -f.dir;
      continue;
    }
    if (f.fleeing) { f.x += f.dir * f.speed * 2.2 * dt; f.y += f.vy * dt; f.vy += 30 * dt; if (f.x < -60 || f.x > OW + 60) f.dead = true; continue; }
    // steer toward an eligible free hook when soaking
    let target = null;
    if (soaking) {
      let bd = 1e9;
      for (let i = 0; i < hooks.length; i++) {
        const h = hooks[i];
        if ((f.tried >> i) & 1 || !hookAccepts(h, f)) continue;
        const R = f.d.glow && hookLit(h) ? 90 : f.eager ? 140 : 55;
        const dx = h.x - f.x, dy = h.y - f.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 < bd) { bd = d2; target = i; }
      }
    }
    if (target !== null) {
      const h = hooks[target], dx = h.x - f.x, dy = h.y + 2 - f.y, dist = Math.hypot(dx, dy) || 1;
      const sp = f.speed * (f.eager ? 1.9 : 1.3);
      f.vx = lerp(f.vx, (dx / dist) * sp, Math.min(1, dt * 4)); f.vy = lerp(f.vy, (dy / dist) * sp, Math.min(1, dt * 4));
      f.dir = dx >= 0 ? 1 : -1;
      if (dist < 3 + f.len * 0.3) {
        f.tried |= 1 << target;
        if (rnd() < biteChance(h, f)) { hookFish(h, f, target); if (h.type === 'chum') chumNeighbors(target, f.sp); continue; }
        f.vx = f.dir * f.speed; f.vy = (rnd() - 0.5) * 10;
      }
    } else {
      f.vx = lerp(f.vx, f.dir * f.speed, Math.min(1, dt * 2));
      f.vy = lerp(f.vy, Math.sin(f.ph * 0.3) * 3, Math.min(1, dt * 2));
    }
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.y < 3) f.y = 3;
    if (f.x < -50 || f.x > OW + 50 || f.y < S.camY - 260 || f.y > S.camY + OH + 260) f.dead = true;
  }
  if (c && (c.stage === 'soak' || c.stage === 'reel')) predatorAttacks(dt);
  compact(S.fish, f => !f.dead);
}
function chumNeighbors(i, sp) {
  const hooks = S.cast.hooks;
  for (const j of [i - 1, i + 1]) {
    const h = hooks[j];
    if (!h) continue;
    const f = newFish(sp, h.x, h.y, rnd() < 0.5 ? 1 : -1);
    if (!hookAccepts(h, f) || S.fish.length >= MAX_FISH) continue;
    S.fish.push(f); hookFish(h, f, j);
  }
}
/* Free-swimming predators near a hooked fish may eat it and take its place on the hook. */
function predatorAttacks(dt) {
  const hooks = S.cast.hooks;
  const rate = baitOn('spoiled') ? 1.2 : 0.6;
  for (const p of S.fish) {
    if (p.hook >= 0 || !p.d.pred || p.fleeing) continue;
    for (let i = 0; i < hooks.length; i++) {
      const h = hooks[i];
      if (h.type === 'barbed') continue;
      for (const prey of h.catch) {
        if (prey.w * 1.5 > p.w || prey.legend) continue;
        if (Math.abs(prey.x - p.x) > 16 || Math.abs(prey.y - p.y) > 12) continue;
        if (rnd() > rate * dt * 3) continue;
        h.catch[h.catch.indexOf(prey)] = p;
        prey.dead = true;
        p.hook = i; p.ate += prey.val + prey.ate; p.ateN += 1 + prey.ateN; p.shiny = p.shiny || prey.shiny;
        SFX.chomp(); shake(3);
        burstWorld(h.x, h.y, 14, ['#ff4a4a', '#ffffff', p.d.body], 3);
        popWorld(h.x, h.y - 6, 'CHOMP!', '#ff6a5a', 22);
        logLine(`${p.d.n} ate a ${prey.d.n}!`);
        return;
      }
    }
  }
}

/* ================= LEGENDS ================= */
function legendForDay(d) {
  if (!isLegendDay(d)) return null;
  const L = LEGENDS[Math.min(LEGENDS.length - 1, Math.floor((d - 1) / 3))];
  return { ...L, L, hpLeft: L.hp, landed: false, reachWarned: false };
}
const legendHooksNeeded = L => Math.max(1, L.hooks - crewN('legendhunter'));
function hooksInZone(z) {
  if (!S.cast) return 0;
  let n = 0;
  for (const h of S.cast.hooks) if (!h.cut && !h.tangled && zoneAtY(h.y) === z) n += h.type === 'harpoon' ? 3 : 1;
  return n;
}
function legendReach() { return tval('length') >= ZONES[S.legend.zone].from + 1; }
function castDepthToday() {
  const max = tval('length');
  if (!S.legend || S.legend.landed || !legendReach()) return max;
  const z = ZONES[S.legend.zone];
  return Math.min(max, z.from + (z.to - z.from) * 0.82);
}

/* ================= CAST LIFECYCLE =================
   sink → soak → reel → land → score, then the next cast or the end of the day. */
function startCast() {
  const n = S.hooks.length;
  const targetY = depthToY(castDepthToday());
  const hooks = S.hooks.map((type, i) => ({ type, cap: HOOKS[type].cap, catch: [], x: BOAT_X + 16 + (i % 2 ? 5 : -5), y: 4, cut: false, tangled: false }));
  if (curseOn('isonade') && hooks.length) hooks[0].cut = true;
  if (curseOn('kraken')) shuffle(hooks.map((h, i) => i)).slice(0, 2).forEach(i => (hooks[i].tangled = true));
  S.cast = { stage: 'sink', t: 0, bottomY: 4, startY: 4, targetY, hooks, dur: clamp(0.9 + targetY / 650, 1, 3), legendEnt: null, snapCheck: false, treasureDone: false, n };
  S.castNo++;
  S.tray = []; S.chips = 0; S.mult = 0;
  layoutHooks();
  if (S.castNo === 1) resetSeeding();
  SFX.splash(); SFX.ping();
  burstWorld(BOAT_X + 16, 0, 16, ['#ffffff', '#bfefff', '#7ad8ff'], 3, { up: 2 });
  logLine(`Cast ${S.castNo}: ${fmtM(castDepthToday())}`);
  renderRight();
}
function layoutHooks() {
  const c = S.cast, n = c.hooks.length;
  for (let i = 0; i < n; i++) c.hooks[i].y = Math.max(5 + i * 3, c.bottomY - (n - 1 - i) * SPACING);
}
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function stepCast(dt) {
  const c = S.cast;
  if (!c) return;
  c.t += dt;
  if (c.stage === 'sink') {
    const k = Math.min(1, c.t / c.dur);
    c.bottomY = lerp(c.startY, c.targetY, easeInOut(k));
    layoutHooks();
    if (rnd() < dt * 20) S.bubbles.push({ x: BOAT_X + 16 + (rnd() - 0.5) * 4, y: c.bottomY, vy: -16 - rnd() * 10, life: 1 });
    if (k >= 1) beginSoak();
  } else if (c.stage === 'soak') {
    c.spawnT -= dt;
    if (c.spawnT <= 0) {
      c.spawnT = 0.55;
      for (const h of c.hooks) if (!h.cut && !h.tangled && h.catch.length < h.cap && rnd() < 0.55) spawnEdge(h.y + (rnd() - 0.5) * 16, true);
    }
    stepLegend(dt);
    if (c.t >= c.soakDur) beginReel();
  } else if (c.stage === 'reel') {
    const k = Math.min(1, c.t / c.dur);
    c.bottomY = lerp(c.reelFrom, 4, easeInOut(k));
    layoutHooks();
    SFX.reel();
    if (!c.snapCheck && k > 0.35) { c.snapCheck = true; checkSnap(); }
    for (const h of c.hooks) for (const f of h.catch) if (rnd() < dt * 3) S.bubbles.push({ x: f.x, y: f.y, vy: -14, life: 1 });
    stepLegend(dt);
    if (k >= 1) landCatch();
  } else if (c.stage === 'score') {
    stepScore(dt);
  } else if (c.stage === 'pause') {
    if (c.t >= 0.45) afterCast();
  }
}
function beginSoak() {
  const c = S.cast;
  c.stage = 'soak'; c.t = 0; c.spawnT = 0; c.soakDur = soakTime();
  if (S.legend && !S.legend.landed) {
    if (hooksInZone(S.legend.zone) > 0) {
      const deepest = [...c.hooks.keys()].filter(i => zoneAtY(c.hooks[i].y) === S.legend.zone && !c.hooks[i].cut && !c.hooks[i].tangled).pop();
      const dir = rnd() < 0.5 ? 1 : -1;
      c.legendEnt = { x: dir > 0 ? -S.legend.size * 0.6 : OW + S.legend.size * 0.6, y: c.hooks[deepest ?? c.hooks.length - 1].y + 10, dir, state: 'approach', hook: deepest ?? c.hooks.length - 1, biteAt: c.soakDur * 0.55 };
      SFX.roar(); shake(5);
    } else if (!S.legend.reachWarned) {
      S.legend.reachWarned = true;
      banner('OUT OF REACH', '#ff8a7a', `${S.legend.n} lurks in the ${ZONES[S.legend.zone].n}. ${legendReach() ? 'No free hook hangs in its zone.' : 'Your line is too short.'}`);
    }
  }
  if (hasCrew('treasure')) {
    for (const h of c.hooks) if (!h.cut && !h.tangled && h.catch.length < h.cap && rnd() < 0.08 * crewN('treasure')) h.treasure = 2 + Math.floor(rnd() * 7);
  }
}
function stepLegend(dt) {
  const c = S.cast, e = c.legendEnt;
  if (!e) return;
  e.t = (e.t || 0) + dt;
  const h = c.hooks[e.hook];
  if (e.state === 'approach') {
    const tx = h.x - e.dir * S.legend.size * 0.35;
    e.x = lerp(e.x, tx, Math.min(1, dt * 1.2));
    e.y = lerp(e.y, h.y + 6, Math.min(1, dt * 2));
    if (c.stage === 'soak' && c.t >= e.biteAt) legendBite();
    if (c.stage === 'reel') { e.state = 'flee'; }
  } else if (e.state === 'held') {
    e.x = h.x - e.dir * S.legend.size * 0.35 + Math.sin(e.t * 3) * 3;
    e.y = h.y + 8 + Math.sin(e.t * 2) * 2;
    if (rnd() < dt * 2) shake(2);
  } else if (e.state === 'flee') {
    e.x += e.dir * 90 * dt; e.y += 30 * dt;
    if (e.x < -300 || e.x > OW + 300) c.legendEnt = null;
  }
}
function legendBite() {
  const c = S.cast, e = c.legendEnt, L = S.legend;
  const have = hooksInZone(L.zone), need = legendHooksNeeded(L), str = lineStrength();
  SFX.roar(); shake(12); BG.boost += 4;
  if (have >= need && str >= L.weight) {
    e.state = 'held';
    SFX.hold();
    banner('HOLD!', '#f3c658', `${L.n} is on the line!`);
    logLine(`${L.n} is hooked!`);
  } else {
    e.state = 'flee';
    const why = have < need ? `Needs ${need} hooks in the ${ZONES[L.zone].n} (you have ${have})` : `Needs ${L.weight}kg line strength (you have ${str})`;
    banner('IT BROKE FREE', '#ff6a5a', why);
    logLine(`${L.n} snapped the line. ${why}.`);
    snapAll();
  }
}
function snapAll() {
  const c = S.cast;
  SFX.snap(); shake(10);
  for (const h of c.hooks) {
    if (h.type === 'barbed') continue;
    for (const f of h.catch) { f.hook = -1; f.fleeing = true; f.vy = -10; }
    h.catch = []; h.treasure = 0;
  }
  burstWorld(BOAT_X + 16, c.bottomY - 30, 20, ['#ffffff', '#ff6a5a'], 4);
}
function castTension() {
  let w = 0;
  if (!S.cast) return 0;
  for (const h of S.cast.hooks) for (const f of h.catch) w += f.w;
  return w;
}
/* Overweight lines snap partway up: fish are lost from the bottom hook upward until the rest is light enough. */
function checkSnap() {
  const c = S.cast, str = lineStrength();
  const w0 = castTension();
  let w = w0;
  if (w <= str) return;
  if (hasCrew('bosun') && !S.bosunUsed) { S.bosunUsed = true; popWorld(BOAT_X + 16, c.bottomY - 20, 'BOSUN HOLDS IT!', '#f3c658', 22); logLine('The Bosun saved an overloaded line'); return; }
  SFX.snap(); shake(8); S.stats.snaps++;
  let lost = 0;
  for (let i = c.hooks.length - 1; i >= 0 && w > str; i--) {
    const h = c.hooks[i];
    if (h.type === 'barbed') continue;
    for (const f of h.catch) { w -= f.w; f.hook = -1; f.fleeing = true; f.vy = -6; lost++; }
    h.catch = [];
    burstWorld(h.x, h.y, 10, ['#ffffff', '#ff6a5a'], 3);
  }
  popWorld(BOAT_X + 16, c.bottomY - 10, `SNAP! -${lost} fish`, '#ff6a5a', 26);
  logLine(`Line snapped: ${lost} fish lost (${Math.round(w0)}kg on a ${str}kg line)`);
}
function beginReel() {
  const c = S.cast;
  c.stage = 'reel'; c.t = 0; c.reelFrom = c.bottomY; c.dur = clamp(0.9 + c.bottomY / 600, 1, 2.8);
  // hooks are measured where they soaked; by landing time they are all at the surface
  c.spanZones = new Set(c.hooks.filter(h => !h.cut && !h.tangled).map(h => zoneAtY(h.y))).size;
  if (c.legendEnt && c.legendEnt.state === 'approach') { c.legendEnt.state = 'flee'; logLine(`${S.legend.n} lost interest...`); }
}
function landCatch() {
  const c = S.cast;
  c.stage = 'score'; c.t = 0;
  const items = [];
  c.hooks.forEach((h, hi) => {
    for (const f of h.catch) { items.push({ f, hk: h.type, hi }); f.dead = true; }
    if (h.treasure) items.push({ treasure: h.treasure, hk: h.type, hi });
    h.catch = []; h.treasure = 0;
  });
  if (c.legendEnt && c.legendEnt.state === 'held') {
    const L = S.legend;
    L.hpLeft--;
    if (L.hpLeft <= 0) { items.push({ legend: L }); c.legendEnt = null; }
    else { c.legendEnt.state = 'flee'; banner('IT TORE LOOSE', '#f3c658', `${L.n} is wounded. Hold it ${L.hpLeft} more time${L.hpLeft > 1 ? 's' : ''}.`); logLine(`${L.n} wounded: ${L.hpLeft} more hold${L.hpLeft > 1 ? 's' : ''}`); }
  }
  if (items.length) SFX.land();
  c.score = buildScore(items, c);
  c.stepT = 0.25; c.si = 0;
}

/* ================= SCORING =================
   Each landed fish adds Chips; combos and crew add Mult; the cast is worth Chips x Mult. */
function buildScore(items, c) {
  const steps = [];
  const counts = {}, zones = new Set();
  let glowN = 0, chainN = 0;
  const newSpecies = new Set();
  for (const it of items) {
    if (it.treasure) { steps.push({ k: 'money', amt: it.treasure, label: `Treasure +$${it.treasure}`, item: it }); continue; }
    if (it.legend) continue;
    const f = it.f;
    if (eventOn('poachers') && ++S.poached % 4 === 0) { steps.push({ k: 'stolen', item: it }); continue; }
    let v = f.val + f.ate * Math.pow(2, crewN('sharkwhisperer'));
    if (it.hk === 'circle') v *= 1.5;
    if (f.shiny) v *= 5;
    if (f.d.glow) v *= Math.pow(2, crewN('lampkeeper'));
    if (f.w > 10) v += 60 * crewN('harpooner');
    steps.push({ k: 'fish', chips: Math.round(v), item: it, gold: it.hk === 'gold' });
    counts[f.sp] = (counts[f.sp] || 0) + (it.hk === 'mirror' ? 2 : 1);
    zones.add(f.d.zone);
    if (f.d.glow) glowN++;
    chainN += f.ateN;
    if (!S.seen.has(f.sp)) newSpecies.add(f.sp);
  }
  const legendItem = items.find(it => it.legend);
  if (legendItem) {
    const L = legendItem.legend;
    steps.push({ k: 'legend', chips: L.value * Math.pow(2, crewN('legendhunter')), item: legendItem });
  }
  for (const [sp, n] of Object.entries(counts)) {
    if (n >= 3) steps.push({ k: 'mult', add: n + 3 * crewN('oldsalt'), label: `School of ${SPECIES[sp].n}` });
    else if (n === 2) steps.push({ k: 'mult', add: 2, label: `Pair of ${SPECIES[sp].n}` });
  }
  if (zones.size) { const dz = Math.max(...zones); steps.push({ k: 'mult', add: ZONES[dz].bonus, label: `Depth: ${ZONES[dz].n}` }); }
  if (zones.size >= 3) steps.push({ k: 'mult', add: 4 * zones.size, label: `Rainbow: ${zones.size} zones` });
  if (chainN) steps.push({ k: 'mult', add: 4 * chainN, label: `Food chain x${chainN}` });
  if (glowN) steps.push({ k: 'mult', add: glowN, label: 'Bioluminescence' });
  const hasCatch = steps.some(s => s.k === 'fish' || s.k === 'legend');
  if (hasCatch) {
    const species = Object.keys(counts).length;
    if (hasCrew('cook') && species) steps.push({ k: 'mult', add: species * crewN('cook'), label: 'Ship Cook', crew: 'cook' });
    if (hasCrew('cartographer')) steps.push({ k: 'mult', add: 2 * c.spanZones * crewN('cartographer'), label: 'Cartographer', crew: 'cartographer' });
    if (hasCrew('biologist') && newSpecies.size) steps.push({ k: 'mult', add: 8 * newSpecies.size * crewN('biologist'), label: 'Biologist', crew: 'biologist' });
    if (legendItem) steps.push({ k: 'xmult', m: 3, label: 'LEGENDARY' });
    const deepZ = zoneAtY(c.reelFrom || c.bottomY);
    for (let i = 0; i < crewN('nightowl'); i++) if (deepZ >= 2) steps.push({ k: 'xmult', m: 1.5, label: 'Night Owl', crew: 'nightowl' });
    for (let i = 0; i < crewN('ghostcaptain'); i++) if (deepZ >= 4) steps.push({ k: 'xmult', m: 3, label: 'Ghost Captain', crew: 'ghostcaptain' });
    for (let i = 0; i < crewN('storyteller'); i++) if (S.landed.length) steps.push({ k: 'xmult', m: 1 + S.landed.length, label: 'Storyteller', crew: 'storyteller' });
    for (let i = 0; i < crewN('firstmate'); i++) steps.push({ k: 'xmult', m: 1.5, label: 'First Mate', crew: 'firstmate' });
    steps.push({ k: 'total' });
  }
  newSpecies.forEach(sp => S.seen.add(sp));
  layoutTray(steps);
  return { steps, chips: 0, mult: 1 };
}
/* Landed fish are laid out as cards above the water, revealed one by one as they score. */
function layoutTray(steps) {
  const cards = steps.filter(s => s.k === 'fish' || s.k === 'stolen' || s.k === 'money' || s.k === 'legend');
  const n = cards.length;
  const perRow = n > 16 ? 10 : 8, cw = 640 / perRow;
  const iconW = n > 16 ? 52 : 64;
  cards.forEach((s, i) => {
    const r = Math.floor(i / perRow), col = i % perRow, rowN = Math.min(perRow, n - r * perRow);
    s.tx = OX + 336 + (col - (rowN - 1) / 2) * cw;
    s.ty = OY + 70 + r * 66;
    s.iw = iconW;
  });
  S.tray = cards;
}
function stepScore(dt) {
  const c = S.cast, sc = c.score;
  c.stepT -= dt;
  while (c.stepT <= 0) {
    if (c.si >= sc.steps.length) { finishScore(); return; }
    const s = sc.steps[c.si++];
    c.stepT += runStep(s, sc);
  }
}
function crewFlash(k) {
  const i = S.crew.indexOf(k);
  const el = i >= 0 && document.querySelector(`.crew[data-i="${i}"]`);
  if (el) { el.classList.remove('fire'); void el.offsetWidth; el.classList.add('fire'); }
}
function runStep(s, sc) {
  const n = sc.steps.indexOf(s);
  if (s.k === 'fish') {
    const f = s.item.f;
    s.shown = true;
    sc.chips += s.chips; S.chips = sc.chips; S.mult = sc.mult;
    S.fishToday++; S.stats.fish++;
    best.dex[f.sp] = (best.dex[f.sp] || 0) + 1;
    if (!S.stats.biggest || s.chips > S.stats.biggest.chips) S.stats.biggest = { sp: f.sp, chips: s.chips };
    pop(s.tx, s.ty + 30, `+${fmt(s.chips)}`, f.shiny ? '#ffe27a' : '#5fc2ff', f.shiny ? 24 : 20);
    if (s.gold) { S.money += 1; pop(s.tx, s.ty - 26, '+$1', '#f3c658', 18); SFX.coin(); }
    if (f.shiny) burst(s.tx, s.ty, 12, ['#ffe27a', '#ffffff', '#ff9aff'], 3);
    SFX.score(n);
    return 0.2;
  }
  if (s.k === 'stolen') { s.shown = true; pop(s.tx, s.ty + 30, 'STOLEN', '#ff6a5a', 20); SFX.nope(); return 0.2; }
  if (s.k === 'money') { s.shown = true; S.money += s.amt; pop(s.tx, s.ty + 30, `+$${s.amt}`, '#f3c658', 22); SFX.coin(); return 0.25; }
  if (s.k === 'legend') {
    const L = s.item.legend;
    s.shown = true;
    sc.chips += s.chips; S.chips = sc.chips;
    L.landed = true; S.landed.push(L.k);
    best.legends[L.k] = (best.legends[L.k] || 0) + 1; saveBest();
    SFX.fanfare(); shake(16); BG.boost += 6; setBg('legend');
    banner(L.n.toUpperCase(), '#f3c658', 'LEGEND LANDED');
    burst(s.tx, s.ty, 60, ['#f3c658', '#ffffff', L.col, L.glow || '#ffe27a'], 7);
    pop(s.tx, s.ty + 40, `+${fmt(s.chips)}`, '#f3c658', 30);
    logLine(`LANDED ${L.n}!`);
    return 1.4;
  }
  if (s.k === 'mult') {
    sc.mult += s.add; S.mult = sc.mult;
    pop(OX + 336, OY + 350, `+${s.add} Mult · ${s.label}`, '#fff', 20, '#d8443a');
    if (s.crew) crewFlash(s.crew);
    SFX.mult();
    return 0.38;
  }
  if (s.k === 'xmult') {
    sc.mult *= s.m; S.mult = sc.mult;
    pop(OX + 336, OY + 350, `X${s.m} Mult · ${s.label}`, '#fff', 24, '#b0203a');
    if (s.crew) crewFlash(s.crew);
    SFX.xmult(); shake(3);
    return 0.45;
  }
  if (s.k === 'total') {
    const total = Math.round(sc.chips * sc.mult);
    sc.total = total;
    S.haul += total;
    const big = total >= S.quota * 0.5;
    pop(OX + 336, OY + 420, `${fmt(total)}`, big ? '#f3c658' : '#ffffff', big ? 54 : 40);
    SFX.total(big); if (big) { shake(8); BG.boost += 2; }
    if (total > S.stats.bestCast) S.stats.bestCast = total;
    if (total > best.cast) best.cast = total;
    logLine(`= ${fmt(sc.chips)} × ${fmtMult(sc.mult)} = ${fmt(total)}`);
    return 0.8;
  }
  return 0.1;
}
const fmtMult = m => (m >= 1000 ? fmt(m) : (Math.round(m * 10) / 10).toString());
function finishScore() {
  const c = S.cast;
  if (!c.score.steps.some(s => s.k === 'total')) logLine('Nothing landed.');
  saveBest();
  S.castsLeft--;
  c.stage = 'pause'; c.t = 0;
  for (const h of c.hooks) h.catch = [];
}
function afterCast() {
  S.tray = [];
  if (S.haul >= S.quota) return endDay(true);
  if (S.castsLeft <= 0) return endDay(false);
  startCast();
}

/* ================= DAY FLOW ================= */
function newRun() {
  hideModal(); clearOv();
  Object.assign(S, {
    day: 1, money: 4, hooks: ['plain', 'plain', 'plain'], crew: [], tackle: { length: 0, strength: 0, slots: 0, soak: 0, casts: 0 },
    bait: [], baitNext: [], landed: [], seen: new Set(), rerollCost: 2, sel: -1, log: [], fish: [], bubbles: [], won: false,
    stats: { fish: 0, bestCast: 0, snaps: 0, biggest: null },
  });
  best.runs++; saveBest();
  startDay();
}
function startDay() {
  S.phase = 'ready';
  S.quota = quotaFor(S.day);
  S.haul = 0; S.shownHaul = 0; S.castNo = 0; S.chips = 0; S.mult = 0; S.tray = []; S.fishToday = 0; S.poached = 0; S.bosunUsed = false;
  S.bait = S.baitNext; S.baitNext = [];
  S.legend = legendForDay(S.day);
  S.event = !S.legend && S.day >= 4 && rnd() < 0.34 ? pick(EVENTS) : null;
  S.castsLeft = castsPerDay();
  S.cast = null;
  S.log = [];
  setBg(S.legend ? 'legend' : zoneTheme(dayZone(S.day)));
  if (S.legend) showLegendCard();
  renderAll();
}
function setSail() {
  if (S.phase !== 'ready') return;
  audioInit(); clearOv(); hideTip();
  S.phase = 'cast';
  SFX.button();
  startCast();
}
function endDay(made) {
  S.cast = null;
  if (!made) return gameOver(false);
  S.phase = 'cashout';
  if (S.day > best.day) best.day = S.day;
  saveBest();
  showCashout();
}
function showCashout() {
  const rows = [];
  rows.push([`Day ${S.day} quota met`, isLegendDay(S.day) ? 10 : 6]);
  if (S.castsLeft > 0) rows.push([`Unused casts (${S.castsLeft} × $1)`, S.castsLeft]);
  if (S.legend && S.legend.landed) rows.push([`${S.legend.n} bounty`, 10]);
  const interest = Math.min(5, Math.floor(Math.max(0, S.money) / 5));
  if (interest) rows.push(['Interest ($1 per $5, max $5)', interest]);
  const mong = Math.floor(S.fishToday / 8) * crewN('fishmonger');
  if (mong) rows.push([`Fishmonger (${S.fishToday} fish)`, mong]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  $('#ov').innerHTML = `<div class="cash panel"><h2 class="t" style="text-align:center;font-size:36px">DOCKED</h2>
    ${rows.map((r, i) => `<div class="cl" style="animation-delay:${i * 0.12}s"><span>${r[0]}</span><span class="amt">$${r[1]}</span></div>`).join('')}
    <div style="margin-top:12px"><button class="b-gold" id="cashBtn">Cash out $${total}</button></div></div>`;
  SFX.win();
  $('#cashBtn').addEventListener('click', () => {
    S.money += total; SFX.coin(); clearOv();
    if (S.day === DAYS_TO_WIN && !S.won) { S.won = true; best.wins++; saveBest(); return gameOver(true); }
    goShop();
  });
  renderAll();
}
function gameOver(won) {
  S.phase = 'over';
  setBg(won ? 'legend' : 'lose');
  if (!won) SFX.lose();
  else SFX.win();
  const dex = Object.keys(best.dex).length;
  showModal(`<div class="box panel">
    <h1 class="${won ? 'c-gold' : 'c-red'}">${won ? 'MASTER ANGLER' : 'LOST AT SEA'}</h1>
    ${won ? `<h2>All ${DAYS_TO_WIN} days survived. Keep fishing in Endless?</h2>` : `<h2>Day ${S.day}: ${fmt(S.haul)} / ${fmt(S.quota)}</h2>`}
    <div class="stgrid">
      <span>Fish landed</span><b>${fmt(S.stats.fish)}</b>
      <span>Best cast</span><b>${fmt(S.stats.bestCast)}</b>
      <span>Line snaps</span><b>${S.stats.snaps}</b>
      <span>Legends landed</span><b>${S.landed.map(k => LEGENDS.find(L => L.k === k).n).join(', ') || '-'}</b>
      <span>Most valuable fish</span><b>${S.stats.biggest ? SPECIES[S.stats.biggest.sp].n + ' (' + fmt(S.stats.biggest.chips) + ')' : '-'}</b>
      <span>Fishdex</span><b>${dex} / ${SPECIES_KEYS.length}</b>
    </div>
    <div class="row">${won ? '<button class="b-blue" id="endlessBtn">Endless</button>' : ''}<button class="b-orange" id="newRunBtn">New Run</button><button class="b-gray" id="menuBtn">Main Menu</button></div>
  </div>`);
  if (won) $('#endlessBtn').addEventListener('click', () => { hideModal(); goShop(); });
  $('#newRunBtn').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#menuBtn').addEventListener('click', () => { SFX.button(); showTitle(); });
  renderAll();
}
function showLegendCard() {
  const L = S.legend;
  const reach = legendReach();
  const need = legendHooksNeeded(L), str = lineStrength();
  $('#ov').innerHTML = `<div class="legendCard panel">
    <div class="lbl">LEGEND DAY · ${ZONES[L.zone].n.toUpperCase()}</div>
    <div class="ln t">${L.n.toUpperCase()}</div>
    <canvas data-legend="${L.k}" width="120" height="72"></canvas>
    <div class="lore">${L.lore}</div>
    <div class="req">
      <span class="${reach ? 'c-green' : 'c-red'}">Line reaches the ${ZONES[L.zone].n}: ${reach ? 'yes' : `no (needs ${fmtM(ZONES[L.zone].from + 1)})`}</span><br>
      <span class="${S.hooks.length >= need ? 'c-green' : 'c-red'}">${need} hooks hanging in its zone</span> ·
      <span class="${str >= L.weight ? 'c-green' : 'c-red'}">${L.weight}kg line (you have ${str}kg)</span><br>
      <span class="c-orange">Curse until landed: ${L.curse}</span>${L.hp > 1 ? `<br><span class="c-gold">Must be held ${L.hp} times</span>` : ''}
    </div>
    <button class="b-cyan pulse" id="huntBtn">SET SAIL</button>
  </div>`;
  paintLegendIcons($('#ov'));
  $('#huntBtn').addEventListener('click', setSail);
  SFX.roar();
}

/* ================= SHOP ================= */
function rarityRoll() { const x = rnd(); return x < 0.6 ? 1 : x < 0.9 ? 2 : 3; }
function randomOffer() {
  const kind = weightedPick([['hook', 45], ['crew', 35], ['bait', 20]]);
  if (kind === 'bait') { const k = pick(BAIT_KEYS); return { kind, key: k, price: BAIT[k].price }; }
  const r = rarityRoll();
  const pool = kind === 'hook' ? HOOK_KEYS.filter(k => HOOKS[k].rarity === r) : CREW_KEYS.filter(k => CREW[k].rarity === r);
  const k = pick(pool.length ? pool : kind === 'hook' ? HOOK_KEYS : CREW_KEYS);
  return { kind, key: k, price: (kind === 'hook' ? HOOKS : CREW)[k].price };
}
function genOffers() { S.offers = [randomOffer(), randomOffer(), randomOffer(), randomOffer()]; }
function goShop() {
  S.phase = 'shop';
  S.rerollCost = 2; S.sel = -1;
  genOffers();
  setBg('shop');
  renderAll();
}
const offerDef = o => (o.kind === 'hook' ? HOOKS : o.kind === 'crew' ? CREW : BAIT)[o.key];
function buyOffer(i) {
  const o = S.offers[i];
  if (!o || o.sold) return;
  if (S.money < o.price) { SFX.nope(); flashHint('Not enough money'); return; }
  if (o.kind === 'hook' && S.hooks.length >= hookSlots()) { SFX.nope(); flashHint('Rig full: sell a hook or buy Hook Slots'); return; }
  if (o.kind === 'crew' && S.crew.length >= S.crewSlots) { SFX.nope(); flashHint('Crew full: sell a crew member'); return; }
  if (o.kind === 'bait' && S.baitNext.length >= 2) { SFX.nope(); flashHint('Bait box holds 2 for the next day'); return; }
  S.money -= o.price; o.sold = true;
  if (o.kind === 'hook') S.hooks.push(o.key);
  else if (o.kind === 'crew') S.crew.push(o.key);
  else S.baitNext.push(o.key);
  SFX.buy();
  renderAll();
}
const tacklePrice = k => (S.tackle[k] < TACKLE[k].prices.length ? TACKLE[k].prices[S.tackle[k]] : null);
function buyTackle(k) {
  const p = tacklePrice(k);
  if (p === null || S.money < p) { SFX.nope(); return; }
  S.money -= p; S.tackle[k]++;
  SFX.buy();
  if (k === 'length') banner('LONGER LINE', '#3fd0ff', `Now reaches ${fmtM(tval('length'))}: ${ZONES[zoneAtY(depthToY(tval('length')))].n}`);
  renderAll();
}
function reroll() {
  if (S.money < S.rerollCost) { SFX.nope(); return; }
  S.money -= S.rerollCost; S.rerollCost++;
  genOffers(); SFX.button();
  renderAll();
}
const hookSellValue = k => Math.max(1, Math.floor(HOOKS[k].price / 2));
function sellHook(i) {
  if (S.hooks.length <= 1) { SFX.nope(); flashHint('Keep at least one hook'); return; }
  S.money += hookSellValue(S.hooks[i]);
  S.hooks.splice(i, 1); S.sel = -1;
  SFX.coin(); hideTip();
  renderAll();
}
function sellCrew(i) {
  S.money += Math.floor(CREW[S.crew[i]].price / 2);
  S.crew.splice(i, 1);
  SFX.coin(); hideTip();
  renderAll();
}
function clickHook(i) {
  if (S.phase !== 'shop') return;
  if (S.sel < 0) { S.sel = i; SFX.button(); }
  else if (S.sel === i) S.sel = -1;
  else { [S.hooks[S.sel], S.hooks[i]] = [S.hooks[i], S.hooks[S.sel]]; S.sel = -1; SFX.buy(); }
  renderRig();
}
function nextDay() {
  if (S.phase !== 'shop') return;
  S.day++;
  SFX.button();
  startDay();
}
let hintTimer = null;
function flashHint(text) { const el = $('#hint'); if (!el) return; el.textContent = text; el.style.color = '#ffd27a'; clearTimeout(hintTimer); hintTimer = setTimeout(() => { el.style.color = ''; el.textContent = defaultHint(); }, 1800); }
const defaultHint = () => 'Click two hooks to swap them. Top hook hangs highest.';

/* ================= WORLD LAYERS (prebuilt) =================
   Water colour and darkness are 1px-wide vertical strips stretched across the viewport;
   decorations (sky, light shafts, rock walls, trench, ruins, floor) are one tall static image. */
const oc = $('#ocean'), og = oc.getContext('2d');
og.imageSmoothingEnabled = false;
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const waterCv = makeCanvas(1, LAYER_H), darkCv = makeCanvas(1, LAYER_H), decoCv = makeCanvas(OW, LAYER_H);
const darkCanvas = makeCanvas(OW, OH), dg = darkCanvas.getContext('2d');
const lightStamp = makeCanvas(64, 64);
function zoneDarkAt(y) {
  if (y < 0) return 0;
  const i = zoneAtY(y), t = (y - ZONE_Y[i]) / ZONES[i].h;
  const next = i < ZONES.length - 1 ? ZONES[i + 1].dark : ZONES[i].dark;
  return lerp(ZONES[i].dark, next, clamp((t - 0.6) / 0.4, 0, 1));
}
function buildLayers() {
  const wg = waterCv.getContext('2d'), kg = darkCv.getContext('2d');
  for (let r = 0; r < LAYER_H; r++) {
    const y = r - SKY;
    let col;
    if (y < 0) col = mixHex('#5fb8ff', '#d8f2ff', clamp((y + SKY) / SKY, 0, 1));
    else if (y >= WORLD_BOTTOM) col = '#05020a';
    else {
      const i = zoneAtY(y), z = ZONES[i], t = (y - ZONE_Y[i]) / z.h;
      col = mixHex(z.water[0], z.water[1], Math.floor(t * 8) / 8);
      if (t > 0.85 && i < ZONES.length - 1) col = mixHex(col, ZONES[i + 1].water[0], (t - 0.85) / 0.15 * 0.6);
    }
    wg.fillStyle = col; wg.fillRect(0, r, 1, 1);
    const dark = y >= WORLD_BOTTOM ? 0.96 : zoneDarkAt(y);
    kg.fillStyle = `rgba(2,4,12,${dark.toFixed(3)})`; kg.fillRect(0, r, 1, 1);
  }
  const g = decoCv.getContext('2d');
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y + SKY, 1, 1); };
  // sun and clouds
  g.fillStyle = '#fff6c8'; g.fillRect(170, 12, 14, 14); g.fillStyle = '#fffbe8'; g.fillRect(172, 14, 10, 10);
  for (const [cx, cy, w] of [[30, 20, 34], [120, 34, 26], [196, 48, 22], [70, 56, 18]]) {
    g.fillStyle = '#ffffff';
    g.fillRect(cx, cy, w, 5); g.fillRect(cx + 4, cy - 3, w - 10, 3); g.fillRect(cx + 8, cy - 5, w * 0.35, 2);
    g.fillStyle = '#dceeff'; g.fillRect(cx + 2, cy + 5, w - 4, 1);
  }
  // sunlit light shafts
  g.globalAlpha = 0.07; g.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const x0 = 10 + i * 40;
    for (let y = 0; y < 200; y++) g.fillRect(Math.round(x0 + y * 0.35), y + SKY, 7 - Math.floor(y / 40), 1);
  }
  g.globalAlpha = 1;
  // rock walls from twilight down, widening into the hadal trench
  for (let y = ZONE_Y[1]; y < WORLD_BOTTOM; y++) {
    const z = zoneAtY(y);
    const base = z <= 1 ? 4 : z === 2 ? 10 : z === 3 ? 16 : z === 4 ? 30 : 22;
    const ramp = clamp((y - ZONE_Y[1]) / 80, 0, 1);
    const wl = Math.round(ramp * (base + 5 * Math.sin(y * 0.07) + 3 * Math.sin(y * 0.23 + 1)));
    const wr = Math.round(ramp * (base + 5 * Math.sin(y * 0.05 + 2) + 3 * Math.sin(y * 0.19)));
    const rock = z >= 5 ? '#1a0a26' : z >= 4 ? '#0a0e18' : '#0c1a2a';
    const edge = z >= 5 ? '#3a1a5a' : z >= 4 ? '#1a2234' : '#16304a';
    if (wl > 0) { g.fillStyle = rock; g.fillRect(0, y + SKY, wl, 1); px(wl, y, edge); }
    if (wr > 0) { g.fillStyle = rock; g.fillRect(OW - wr, y + SKY, wr, 1); px(OW - wr - 1, y, edge); }
  }
  // kelp in the shallows
  for (const kx of [14, 36, 196, 212]) for (let y = 120; y < 230; y++) px(kx + Math.round(Math.sin(y * 0.15 + kx) * 2), y, y % 7 === 0 ? '#3a8a4a' : '#2a6a3a');
  // ruins and runes in The Below
  const by = ZONE_Y[5];
  for (let i = 0; i < 14; i++) {
    const x = i % 2 ? 26 + (i % 4) * 4 : OW - 34 - (i % 3) * 4, y = by + 20 + i * 14;
    g.fillStyle = '#2a1440'; g.fillRect(x, y + SKY, 6, 10);
    g.fillStyle = '#6a3aa0'; g.fillRect(x + 2, y + 2 + SKY, 2, 1); g.fillRect(x + 1, y + 5 + SKY, 4, 1);
  }
  // sea floor
  for (let x = 0; x < OW; x++) {
    const h = 10 + Math.round(4 * Math.sin(x * 0.11) + 3 * Math.sin(x * 0.37 + 1));
    g.fillStyle = '#120a1a'; g.fillRect(x, WORLD_BOTTOM - h + SKY, 1, h + FLOOR_H);
    px(x, WORLD_BOTTOM - h, '#2a1a3a');
  }
  for (const bx of [40, 120, 170]) { g.fillStyle = '#c8c0b0'; g.fillRect(bx, WORLD_BOTTOM - 12 + SKY, 10, 1); g.fillRect(bx + 2, WORLD_BOTTOM - 14 + SKY, 1, 3); g.fillRect(bx + 5, WORLD_BOTTOM - 14 + SKY, 1, 3); g.fillRect(bx + 8, WORLD_BOTTOM - 14 + SKY, 1, 3); }
  const lg = lightStamp.getContext('2d'), grd = lg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.45, 'rgba(0,0,0,.8)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  lg.fillStyle = grd; lg.fillRect(0, 0, 64, 64);
}
buildLayers();
const snow = Array.from({ length: 70 }, () => ({ x: rnd() * OW, y: rnd() * OH, s: rnd() < 0.2 ? 2 : 1, v: 2 + rnd() * 4 }));
let lastCamY = REST_CAM;

/* ================= CAMERA ================= */
function cameraTarget() {
  const c = S.cast;
  if (S.phase === 'title') {
    const span = CAM_MAX - REST_CAM, k = (Math.sin(S.t * 0.045 - Math.PI / 2) + 1) / 2;
    return REST_CAM + span * k;
  }
  if (!c || c.stage === 'score' || c.stage === 'pause') return REST_CAM;
  const top = c.hooks[0].y, bot = c.bottomY;
  return clamp((top + bot) / 2 - OH * 0.5, CAM_MIN, CAM_MAX);
}
function stepCamera(dt) {
  const tgt = cameraTarget();
  const k = S.phase === 'title' ? 1 : Math.min(1, dt * 4);
  S.camY = lerp(S.camY, tgt, k);
}

/* ================= RENDER: OCEAN ================= */
function render(dt) {
  const t = S.t, cam = Math.round(S.camY);
  const g = og;
  g.globalCompositeOperation = 'source-over';
  g.drawImage(waterCv, 0, cam + SKY, 1, OH, 0, 0, OW, OH);
  g.drawImage(decoCv, 0, cam + SKY, OW, OH, 0, 0, OW, OH);
  // marine snow drifts with a parallax offset
  const dy = (cam - lastCamY) * 0.8; lastCamY = cam;
  g.fillStyle = cam > 120 ? 'rgba(200,225,255,.55)' : 'rgba(255,255,255,.35)';
  for (const p of snow) {
    p.y -= dy; p.y += p.v * dt; p.x += Math.sin(t + p.y * 0.05) * 0.05;
    if (p.y > OH) p.y -= OH; if (p.y < 0) p.y += OH;
    if (p.y + cam > 2) g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
  }
  // surface waves
  const sy = -cam;
  if (sy > -4 && sy < OH + 4) {
    g.fillStyle = '#bfefff';
    for (let x = 0; x < OW; x++) { const w = Math.round(Math.sin(x * 0.18 + t * 2.4) * 1.2); g.fillRect(x, sy + w, 1, 1); }
    g.fillStyle = 'rgba(255,255,255,.25)';
    for (let x = 0; x < OW; x += 3) g.fillRect(x, sy + 2 + Math.round(Math.sin(x * 0.3 + t * 3)), 2, 1);
  }
  // legend silhouette or entity
  const c = S.cast;
  const le = c && c.legendEnt;
  if (S.phase === 'title') drawTitleLegends(g, t, cam);
  // fish
  for (const f of S.fish) {
    const y = Math.round(f.y - cam);
    if (y < -40 || y > OH + 40) continue;
    Sprites.drawFish(g, f.sp, Math.round(f.x), y, f.len, f.dir, t + f.ph * 0.1, f.shiny);
  }
  if (le) Sprites.drawLegend(g, S.legend.k, Math.round(le.x), Math.round(le.y - cam), le.dir, t, 1);
  // line, snoods, hooks
  const tip = Sprites.boatRodTip(BOAT_X, sy, t);
  const hooks = c ? c.hooks : idleHooks();
  const lx = BOAT_X + 16;
  if (hooks.length) {
    const bottom = Math.round((c ? c.bottomY : idleBottom()) - cam);
    g.fillStyle = 'rgba(230,245,255,.8)';
    const top = Math.max(0, Math.round(tip.y));
    for (let y = top; y < Math.min(OH, bottom); y++) g.fillRect(Math.round(lerp(tip.x, lx, clamp((y - tip.y) / Math.max(1, sy + 3 - tip.y), 0, 1))), y, 1, 1);
    for (const h of hooks) {
      const hy = Math.round(h.y - cam);
      if (hy < -10 || hy > OH + 10) continue;
      g.fillStyle = 'rgba(230,245,255,.6)';
      const x0 = Math.min(lx, h.x), x1 = Math.max(lx, h.x);
      g.fillRect(x0, hy - 2, x1 - x0 + 1, 1);
      if (h.cut) { g.fillStyle = '#ff4a4a'; g.fillRect(h.x - 1, hy, 3, 1); continue; }
      Sprites.drawHook(g, h.type, h.x, hy - 1, t);
      if (h.tangled) { g.fillStyle = '#8a2a3a'; for (let k = 0; k < 5; k++) g.fillRect(h.x - 3 + k * 1.5, hy + Math.round(Math.sin(t * 6 + k) * 2), 1, 1); }
      if (h.treasure) Sprites.drawTreasure(g, h.x, hy + 6);
    }
  }
  // bubbles
  g.fillStyle = 'rgba(220,245,255,.75)';
  for (const b of S.bubbles) { const y = Math.round(b.y - cam); if (y >= 0 && y < OH) g.fillRect(Math.round(b.x), y, 1, 1); }
  // boat
  if (sy > -30 && sy < OH + 30) Sprites.drawBoat(g, BOAT_X, sy, t);
  // darkness with lights cut out
  dg.globalCompositeOperation = 'source-over';
  dg.clearRect(0, 0, OW, OH);
  dg.drawImage(darkCv, 0, cam + SKY, 1, OH, 0, 0, OW, OH);
  dg.globalCompositeOperation = 'destination-out';
  const light = (x, y, r) => { if (y < -r || y > OH + r) return; dg.drawImage(lightStamp, Math.round(x - r), Math.round(y - r), r * 2, r * 2); };
  if (c) {
    light(lx, c.bottomY - cam, 22);
    for (const h of c.hooks) if (hookLit(h) && !h.cut) light(h.x, h.y - cam, 34);
  }
  for (const f of S.fish) if (f.d.glow) light(f.x, f.y - cam, f.len * 0.6 + 6);
  if (le && S.legend.glow) light(le.x, le.y - cam, S.legend.size * 0.4);
  if (S.phase === 'title' && titleLegend) light(titleLegend.x, titleLegend.y - cam, 50);
  g.drawImage(darkCanvas, 0, 0);
  // bioluminescence on top of the dark
  g.globalCompositeOperation = 'lighter';
  for (const f of S.fish) {
    if (!f.d.glow) continue;
    const y = Math.round(f.y - cam);
    if (y < -30 || y > OH + 30) continue;
    Sprites.drawFishGlow(g, f.sp, Math.round(f.x), y, f.len, f.dir, t + f.ph * 0.1);
  }
  if (c) for (const h of c.hooks) if (hookLit(h) && !h.cut) Sprites.drawHookGlow(g, h.type, h.x, Math.round(h.y - cam) - 1, t);
  if (le) Sprites.drawLegendGlow(g, S.legend.k, Math.round(le.x), Math.round(le.y - cam), le.dir, t, 1);
  if (S.phase === 'title' && titleLegend) Sprites.drawLegendGlow(g, titleLegend.k, Math.round(titleLegend.x), Math.round(titleLegend.y - cam), titleLegend.dir, t, 1);
  g.globalCompositeOperation = 'source-over';
}
/* Between casts the rig hangs just under the boat so it can be inspected. */
function idleBottom() { return 10 + (S.hooks.length - 1) * 9; }
function idleHooks() {
  if (S.phase === 'title') return [];
  return S.hooks.map((type, i) => ({ type, x: BOAT_X + 16 + (i % 2 ? 4 : -4), y: 10 + i * 9, catch: [] }));
}
/* Title screen: the camera drifts through every zone; a legend patrols the deep for flavour. */
let titleLegend = null;
function drawTitleLegends(g, t, cam) {
  if (!titleLegend) return;
  Sprites.drawLegend(g, titleLegend.k, Math.round(titleLegend.x), Math.round(titleLegend.y - cam), titleLegend.dir, t, 1);
}
function stepTitle(dt) {
  seedRows();
  if (rnd() < dt * 1.5) spawnEdge(S.camY + rnd() * OH, false);
  const zi = zoneAtY(S.camY + OH / 2), L = LEGENDS[zi];
  if (!titleLegend || titleLegend.k !== L.k) titleLegend = { k: L.k, x: -L.size, dir: 1, y: ZONE_Y[zi] + ZONES[zi].h * 0.55 };
  titleLegend.x += titleLegend.dir * 14 * dt;
  if (titleLegend.x > OW + L.size) titleLegend.dir = -1;
  if (titleLegend.x < -L.size && titleLegend.dir < 0) titleLegend.dir = 1;
}

/* ================= FX CANVAS: tray + depth HUD ================= */
function drawTray(g) {
  if (!S.tray.length) return;
  for (const s of S.tray) {
    if (!s.shown) continue;
    const icon = s.k === 'legend' ? Sprites.legendIcon(s.item.legend.k) : s.k === 'money' ? null : Sprites.icon(s.item.f.sp);
    const w = s.k === 'legend' ? 150 : s.iw, h = s.k === 'legend' ? 90 : Math.round(s.iw * 0.625);
    g.fillStyle = 'rgba(3,10,20,.55)';
    g.fillRect(s.tx - w / 2 - 3, s.ty - h / 2 - 3, w + 6, h + 6);
    if (icon) g.drawImage(icon, Math.round(s.tx - w / 2), Math.round(s.ty - h / 2), w, h);
    else { setFont(g, '26px "Jersey 10", monospace'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3c658'; g.fillText('$', s.tx, s.ty); }
    if (s.k === 'stolen') { g.strokeStyle = '#ff4a4a'; g.lineWidth = 3; g.beginPath(); g.moveTo(s.tx - w / 2, s.ty - h / 2); g.lineTo(s.tx + w / 2, s.ty + h / 2); g.stroke(); }
    if (s.k === 'fish' && s.item.f.shiny) { g.strokeStyle = '#ffe27a'; g.lineWidth = 2; g.strokeRect(s.tx - w / 2 - 3, s.ty - h / 2 - 3, w + 6, h + 6); }
  }
}
function drawDepthHud(g) {
  const c = S.cast;
  if (S.phase !== 'title' && (!c || c.stage === 'score' || c.stage === 'pause')) return;
  const cam = S.camY;
  setFont(g, '16px "Jersey 10", monospace');
  g.textAlign = 'right'; g.textBaseline = 'middle';
  // zone boundary labels
  for (let i = 0; i < ZONES.length; i++) {
    const y = OY + (ZONE_Y[i] - cam) * PXS;
    if (y < OY + 8 || y > OY + 680) continue;
    g.fillStyle = 'rgba(160,220,255,.35)'; g.fillRect(OX + 4, y, 664, 1);
    g.fillStyle = 'rgba(200,235,255,.8)'; g.fillText(`${ZONES[i].n} · ${fmtM(ZONES[i].from)}`, OX + 664, y + 10);
  }
  if (S.cast) {
    const by = OY + (S.cast.bottomY - cam) * PXS;
    if (by > OY && by < OY + 690) {
      g.textAlign = 'left'; g.fillStyle = '#bfefff';
      g.fillText(fmtM(yToDepth(S.cast.bottomY)), OX + (BOAT_X + 26) * PXS, by + 8);
    }
  }
}
function paintLegendIcons(root) {
  root.querySelectorAll('canvas[data-legend]').forEach(c => {
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(Sprites.legendIcon(c.dataset.legend), 0, 0, c.width, c.height);
  });
}
function paintIcons(root) {
  root.querySelectorAll('canvas[data-fish]').forEach(c => {
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(Sprites.icon(c.dataset.fish), 0, 0, c.width, c.height);
  });
  root.querySelectorAll('canvas[data-hook]').forEach(c => {
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    Sprites.drawHook(g, c.dataset.hook, Math.floor(c.width / 2), 3, 0);
  });
  paintLegendIcons(root);
}

/* ================= DOM PANELS ================= */
const cache = {};
function setText(id, v) {
  v = String(v);
  if (cache[id] === v) return false;
  cache[id] = v;
  const el = document.getElementById(id), node = el.firstChild;
  if (node && node.nodeType === 3 && !node.nextSibling && v) node.data = v; else el.textContent = v;
  return true;
}
function setStyle(el, key, prop, v) {
  if (cache[key] === v) return;
  cache[key] = v;
  if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v;
}
function updateLeft() {
  setText('dayName', `Day ${S.day}${S.day <= DAYS_TO_WIN ? '/' + DAYS_TO_WIN : ''}`);
  const z = S.legend ? S.legend.zone : dayZone(S.day);
  setText('zoneLine', S.legend ? `${S.legend.landed ? 'Landed' : 'Legend'}: ${S.legend.n}` : `${S.day % 3 === 1 ? 'New waters' : 'Fishing'} · next legend day ${Math.ceil(S.day / 3) * 3}`);
  const ev = S.legend && !S.legend.landed ? `Curse · ${S.legend.curse}` : S.event ? `${S.event.a} ${S.event.n}: ${S.event.d}` : '';
  setText('eventLine', ev);
  setStyle($('#dayBox'), 'dcol', '--dcol', S.legend ? '#7a3a8a' : S.phase === 'shop' ? '#1a6a6a' : mixHex(ZONES[z].water[0], '#000000', 0.25));
  setText('quota', fmt(S.quota));
  setText('haul', fmt(S.shownHaul));
  const pct = S.quota ? S.shownHaul / S.quota : 0;
  setStyle($('#barFill'), 'barW', 'width', (clamp(pct, 0, 1) * 100).toFixed(1) + '%');
  if (cache.barFull !== (pct >= 1)) { cache.barFull = pct >= 1; $('#barFill').classList.toggle('full', cache.barFull); }
  setText('pct', S.quota && S.phase !== 'shop' ? (pct >= 1 ? `${pct.toFixed(1)}x quota!` : `${Math.floor(pct * 100)}%`) : '');
  if (setText('chips', fmt(S.chips))) bumpEl($('#chipsBox'));
  if (setText('mult', fmtMult(S.mult))) bumpEl($('#multBox'));
  setText('casts', S.phase === 'cast' || S.phase === 'ready' ? String(S.castsLeft) : String(castsPerDay()));
  setText('depth', S.cast ? fmtM(yToDepth(S.cast.bottomY)) : fmtM(tval('length')));
  const ten = Math.round(castTension()), str = lineStrength();
  setText('tensionTxt', `${ten} / ${str}kg`);
  setStyle($('#tensionFill'), 'tenW', 'width', (clamp(ten / str, 0, 1) * 100).toFixed(1) + '%');
  if (cache.over !== ten > str) { cache.over = ten > str; $('#tensionFill').classList.toggle('over', cache.over); }
  if (setText('money', (S.money < 0 ? '-$' : '$') + Math.abs(S.money))) bumpEl($('#money'));
}
function renderCrew() {
  setText('crewCount', `${S.crew.length}/${S.crewSlots}`);
  let html = '';
  for (let i = 0; i < S.crewSlots; i++) {
    const k = S.crew[i];
    html += k ? `<div class="crew full" data-i="${i}">${CREW[k].a}<button class="b-red sell" data-sell="${i}">$${Math.floor(CREW[k].price / 2)}</button></div>` : '<div class="crew"></div>';
  }
  const el = $('#crew'); el.innerHTML = html;
  el.querySelectorAll('.crew.full').forEach(r => {
    const k = S.crew[+r.dataset.i];
    r.addEventListener('mouseenter', () => { const c = elCenter(r); showTipAt(tipHTML(CREW[k].n, CREW[k].d, RARITY[CREW[k].rarity][0] + ' crew', RARITY[CREW[k].rarity][1], S.phase === 'shop' ? 'Hover and click $ to sell' : ''), Math.min(c.x, 1140), c.y + 34, true); });
    r.addEventListener('mouseleave', hideTip);
  });
  el.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); sellCrew(+b.dataset.sell); }));
}
function renderRig() {
  const slots = hookSlots();
  setText('rigCount', `${S.hooks.length}/${slots}`);
  let html = '';
  for (let i = 0; i < 10; i++) {
    const k = S.hooks[i];
    if (k) html += `<div class="hk full ${S.sel === i ? 'sel' : ''}" data-i="${i}" style="--hc:${HOOKS[k].col}"><span class="ord">${i + 1}</span><canvas width="10" height="12" data-hook="${k}"></canvas><button class="b-red sell" data-sellh="${i}">$${hookSellValue(k)}</button></div>`;
    else html += `<div class="hk ${i >= slots ? 'locked' : ''}"></div>`;
  }
  const el = $('#rig'); el.innerHTML = html;
  paintIcons(el);
  el.querySelectorAll('.hk.full').forEach(r => {
    const i = +r.dataset.i, k = S.hooks[i];
    r.addEventListener('click', () => clickHook(i));
    r.addEventListener('mouseenter', () => { const c = elCenter(r); showTipAt(tipHTML(HOOKS[k].n, HOOKS[k].d, `Hook ${i + 1} of ${S.hooks.length}`, RARITY[HOOKS[k].rarity][1], S.phase === 'shop' ? 'Click two hooks to swap · hover $ to sell' : ''), Math.min(c.x, 1140), c.y + 30, true); });
    r.addEventListener('mouseleave', hideTip);
  });
  el.querySelectorAll('[data-sellh]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); sellHook(+b.dataset.sellh); }));
}
function logLine(text) {
  S.log.unshift(text);
  if (S.log.length > 14) S.log.length = 14;
  const el = $('#castLog');
  if (el) { const d = document.createElement('div'); d.textContent = text; el.prepend(d); while (el.children.length > 14) el.lastChild.remove(); }
}
function baitHtml(list, label) {
  return list.length ? `<div class="baitRow">${label} ${list.map(k => `<span title="${BAIT[k].n}">${BAIT[k].a} ${BAIT[k].n}</span>`).join('')}</div>` : '';
}
function renderRight() {
  const body = $('#rightBody');
  document.body.dataset.phase = S.phase;
  if (S.phase === 'ready') {
    body.innerHTML = `<div class="castBox">
      <button class="b-cyan bigCast pulse" id="sailBtn">SET SAIL</button>
      <div class="feed">${castsPerDay()} casts · line ${fmtM(tval('length'))} · ${S.hooks.length} hooks<br><span class="lbl">Space to start · everything after is automatic</span></div>
      ${baitHtml(S.bait, 'Bait today:')}
      <div class="feed">${S.legend ? `<span class="c-gold">LEGEND</span> ${S.legend.n}<br>${S.legend.curse}` : S.event ? `${S.event.a} ${S.event.n}<br>${S.event.d}` : 'Calm seas'}</div></div>`;
    $('#sailBtn').addEventListener('click', setSail);
    return;
  }
  if (S.phase === 'cast' || S.phase === 'cashout' || S.phase === 'over') {
    body.innerHTML = `<div class="castBox"><div class="phaseLbl t c-cyan">${S.phase === 'cast' ? `CAST ${S.castNo}` : 'DOCKED'}</div>
      ${baitHtml(S.bait, 'Bait:')}
      <div class="log" id="castLog">${S.log.map(l => `<div>${l}</div>`).join('')}</div></div>`;
    return;
  }
  if (S.phase !== 'shop') { body.innerHTML = ''; return; }
  const tk = Object.keys(TACKLE).map(k => {
    const p = tacklePrice(k), T = TACKLE[k];
    const cur = T.levels[S.tackle[k]], nxt = T.levels[S.tackle[k] + 1];
    const curS = k === 'length' ? fmtM(cur) : cur + T.unit;
    const nxtS = nxt === undefined ? '' : k === 'length' ? fmtM(nxt) : nxt + T.unit;
    return `<button data-tk="${k}" class="${p === null ? 'max' : ''}" ${p === null || S.money < p ? 'disabled' : ''}>${T.n}<br><span class="tv">${curS}${p === null ? ' MAX' : ' → ' + nxtS}</span>${p === null ? '' : ` <span class="tp">$${p}</span>`}</button>`;
  }).join('');
  body.innerHTML = `
    <div class="shopHead"><div class="shopSign t">TACKLE SHOP</div><div class="lbl" style="text-align:right">Day ${S.day + 1} quota<br><span class="c-red" style="font-size:18px">${fmt(quotaFor(S.day + 1))}</span></div></div>
    <div class="offers">${S.offers.map((o, i) => {
      const d = offerDef(o);
      const rc = o.kind === 'bait' ? '#c86a4a' : RARITY[d.rarity][1];
      const icon = o.kind === 'hook' ? `<canvas width="10" height="12" data-hook="${o.key}"></canvas>` : `<div class="oicon">${d.a}</div>`;
      return `<div class="offer ${o.sold ? 'sold' : ''} ${S.money < o.price ? 'poor' : ''}" data-o="${i}" style="--rc:${rc};animation-delay:${i * 0.06}s"><div class="okind">${o.kind.toUpperCase()}</div>${icon}<div class="oname">${d.n}</div><div class="oprice">${o.sold ? 'SOLD' : '$' + o.price}</div></div>`;
    }).join('')}</div>
    <div class="tackle">${tk}</div>
    ${baitHtml(S.baitNext, 'Bait for tomorrow:')}
    <div class="hint" id="hint">${defaultHint()}</div>
    <div class="shopBtns"><button class="b-green" id="rerollBtn">Reroll<br>$${S.rerollCost}</button><button class="b-red pulse" id="nextBtn">Next<br>Day</button></div>`;
  paintIcons(body);
  body.querySelectorAll('.offer').forEach(el => {
    const o = S.offers[+el.dataset.o], d = offerDef(o);
    el.addEventListener('click', () => { hideTip(); buyOffer(+el.dataset.o); });
    el.addEventListener('mouseenter', () => {
      const c = elCenter(el);
      const badge = o.kind === 'bait' ? 'Bait · lasts 1 day' : `${RARITY[d.rarity][0]} ${o.kind}`;
      showTipAt(tipHTML(d.n, d.d, badge, o.kind === 'bait' ? '#c86a4a' : RARITY[d.rarity][1]), Math.min(c.x, 1100), c.y - 80);
    });
    el.addEventListener('mouseleave', hideTip);
  });
  body.querySelectorAll('[data-tk]').forEach(b => {
    b.addEventListener('click', () => buyTackle(b.dataset.tk));
    b.addEventListener('mouseenter', () => { const c = elCenter(b); showTipAt(tipHTML(TACKLE[b.dataset.tk].n, TACKLE[b.dataset.tk].d), Math.min(c.x, 1100), c.y - 70); });
    b.addEventListener('mouseleave', hideTip);
  });
  $('#rerollBtn').addEventListener('click', reroll);
  $('#rerollBtn').disabled = S.money < S.rerollCost;
  $('#nextBtn').addEventListener('click', nextDay);
}
function renderAll() { renderCrew(); renderRig(); renderRight(); updateLeft(); }
function renderSpeed() {
  $('#speedBtns').innerHTML = [1, 2, 4].map(v => `<button class="b-blue ${prefs.speed === v ? 'on' : ''}" data-sp="${v}">${v}x</button>`).join('');
  $('#speedBtns').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { prefs.speed = +b.dataset.sp; savePrefs(); renderSpeed(); SFX.button(); }));
}

/* ================= TOOLTIP ================= */
const tipEl = $('#tip');
function tipHTML(title, desc, badge = '', badgeCol = '#4a5e6e', sub = '') {
  return `<div class="tt">${title}</div><div>${md(desc)}</div>${badge ? `<span class="badge" style="background:${badgeCol}">${badge}</span>` : ''}${sub ? `<div class="sub">${sub}</div>` : ''}`;
}
function showTipAt(html, x, y, below = false) {
  tipEl.innerHTML = html;
  tipEl.classList.add('show');
  const h = tipEl.offsetHeight;
  tipEl.style.left = clamp(x, 140, 1140) + 'px';
  tipEl.style.top = clamp(below ? y : y - h, 6, 714 - h) + 'px';
}
function hideTip() { tipEl.classList.remove('show'); }

/* ================= MODALS ================= */
const modalEl = $('#modal');
function showModal(html, clear = false) { modalEl.innerHTML = html; modalEl.className = 'show' + (clear ? ' clear' : ''); }
function hideModal() { modalEl.className = ''; modalEl.innerHTML = ''; }
function clearOv() { $('#ov').innerHTML = ''; }
function dexHtml() {
  let html = '';
  ZONES.forEach((z, zi) => {
    html += `<div class="zoneHdr">${z.n} <span class="lbl">${fmtM(z.from)}–${fmtM(z.to)}</span></div><div class="dex">`;
    for (const k of SPECIES_KEYS.filter(k => SPECIES[k].zone === zi)) {
      const n = best.dex[k] || 0;
      html += `<div class="de ${n ? '' : 'unk'}"><canvas width="64" height="40" data-fish="${k}"></canvas>${n ? SPECIES[k].n : '???'}${n ? `<br><span class="lbl">×${fmt(n)}</span>` : ''}</div>`;
    }
    html += '</div>';
  });
  html += `<div class="zoneHdr">Legends</div><div class="dex legends">${LEGENDS.map(L => {
    const n = best.legends[L.k] || 0;
    return `<div class="de ${n ? '' : 'unk'}"><canvas width="120" height="72" data-legend="${L.k}"></canvas>${n ? L.n : '???'}${n ? `<br><span class="lbl">×${n}</span>` : ''}</div>`;
  }).join('')}</div>`;
  return html;
}
function showDex() {
  SFX.button();
  showModal(`<div class="box panel"><h2>Fishdex · ${Object.keys(best.dex).length}/${SPECIES_KEYS.length} species · ${Object.keys(best.legends).length}/${LEGENDS.length} legends</h2>${dexHtml()}
    <div class="row"><button class="b-orange" id="closeM">Back</button></div></div>`);
  paintIcons(modalEl);
  $('#closeM').addEventListener('click', () => { SFX.button(); S.phase === 'title' ? showTitle() : hideModal(); });
}
function showInfo() {
  SFX.button();
  const crew = S.crew.map(k => `<div>${CREW[k].a} <b>${CREW[k].n}</b><br><span class="lbl">${md(CREW[k].d)}</span></div>`).join('') || '<div class="lbl">No crew yet</div>';
  const rig = S.hooks.map((k, i) => `<div><span style="color:${HOOKS[k].col}">${i + 1}.</span> ${HOOKS[k].n}<br><span class="lbl">${md(HOOKS[k].d)}</span></div>`).join('');
  showModal(`<div class="box panel"><h2>Run Info</h2>
    <div class="stgrid"><span>Line length</span><b>${fmtM(tval('length'))}</b><span>Line strength</span><b>${lineStrength()}kg</b><span>Soak time</span><b>${soakTime()}s</b><span>Casts per day</span><b>${castsPerDay()}</b><span>Legends landed</span><b>${S.landed.length}</b></div>
    <h2 style="margin-top:10px">Rig (top to bottom)</h2><div class="infoGrid">${rig}</div>
    <h2 style="margin-top:12px">Crew</h2><div class="infoGrid">${crew}</div>
    <div class="row"><button class="b-blue" id="dexBtn">Fishdex</button><button class="b-orange" id="closeM">Back</button></div></div>`);
  $('#dexBtn').addEventListener('click', showDex);
  $('#closeM').addEventListener('click', () => { SFX.button(); hideModal(); });
}
function showOptions() {
  SFX.button();
  const seg = (name, vals, cur) => `<span class="seg">${vals.map(v => `<button class="b-blue ${v[0] === cur ? 'on' : ''}" data-${name}="${v[0]}">${v[1]}</button>`).join('')}</span>`;
  const busy = S.phase === 'cast';
  showModal(`<div class="box panel"><h2>Options</h2>
    <div class="opt"><span>Sound</span>${seg('sound', [[1, 'On'], [0, 'Off']], prefs.sound ? 1 : 0)}</div>
    <div class="opt"><span>Music</span>${seg('music', [[1, 'On'], [0, 'Off']], prefs.music ? 1 : 0)}</div>
    <div class="row"><button class="b-red" id="optNew" ${busy ? 'disabled' : ''}>New Run</button><button class="b-gray" id="optMenu" ${busy ? 'disabled' : ''}>Main Menu</button><button class="b-orange" id="closeM">Back</button></div></div>`);
  modalEl.querySelectorAll('[data-sound]').forEach(b => b.addEventListener('click', () => { prefs.sound = b.dataset.sound === '1'; savePrefs(); showOptions(); }));
  modalEl.querySelectorAll('[data-music]').forEach(b => b.addEventListener('click', () => { prefs.music = b.dataset.music === '1'; savePrefs(); showOptions(); }));
  $('#optNew').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#optMenu').addEventListener('click', () => { SFX.button(); showTitle(); });
  $('#closeM').addEventListener('click', () => { SFX.button(); S.phase === 'title' ? showTitle() : hideModal(); });
}
function showTitle() {
  clearOv(); hideTip();
  S.phase = 'title'; S.cast = null; S.legend = null; S.event = null; S.fish = []; S.tray = []; S.crew = []; S.hooks = [];
  S.camY = REST_CAM; resetSeeding();
  setBg('title');
  document.body.dataset.phase = 'title';
  const dex = Object.keys(best.dex).length, leg = Object.keys(best.legends).length;
  showModal(`<div class="title">
    <div class="logo">${[...'DEEP CAST'].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div>
    <div class="subt">add hooks · drop deeper · haul up the legends of the deep</div>
    <button class="b-cyan big pulse" id="playGo">PLAY</button>
    <div class="row2"><button class="b-blue" id="dexGo">Fishdex ${dex}/${SPECIES_KEYS.length}</button><button class="b-gray" id="optGo">Options</button></div>
    <div class="bestline">Best day: <span class="c-gold">${best.day}</span> · Best cast: <span class="c-gold">${fmt(best.cast)}</span> · Legends: ${leg}/${LEGENDS.length} · Runs: ${best.runs} · Wins: ${best.wins}</div>
  </div>`, true);
  $('#playGo').addEventListener('click', () => { audioInit(); SFX.buy(); BG.boost += 3; newRun(); });
  $('#dexGo').addEventListener('click', () => { audioInit(); showDex(); });
  $('#optGo').addEventListener('click', () => { audioInit(); showOptions(); });
}
$('#infoBtn').addEventListener('click', () => { if (S.phase !== 'title') showInfo(); });
$('#optBtn').addEventListener('click', showOptions);
addEventListener('keydown', e => {
  if (e.code === 'Space' && !modalEl.classList.contains('show')) { e.preventDefault(); if (S.phase === 'ready') setSail(); }
  if (e.key === 'Escape') { if (S.sel >= 0) { S.sel = -1; renderRig(); } else if (modalEl.classList.contains('show') && S.phase !== 'title') hideModal(); }
});
document.fonts.ready.then(() => { cache.dayName = null; });

/* ================= MAIN LOOP ================= */
const SIM_STEP = 1 / 60;
/* The camera is stepped with the simulation because fish are seeded and culled around it. */
function simulate(dt) {
  S.t += dt;
  stepCamera(dt);
  if (S.phase === 'title') stepTitle(dt);
  else seedRows();
  stepCast(dt);
  stepFish(dt);
  for (const b of S.bubbles) { b.y += b.vy * dt; b.x += Math.sin(b.y * 0.3) * 0.2; b.life -= dt * 0.6; }
  compact(S.bubbles, b => b.life > 0 && b.y > 0);
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(50, now - last); last = now;
  const sim = (dt / 1000) * (S.phase === 'cast' ? prefs.speed : 1);
  const steps = Math.max(1, Math.round(sim / SIM_STEP));
  for (let i = 0; i < steps; i++) simulate(sim / steps);
  if (S.shownHaul !== S.haul) {
    const diff = S.haul - S.shownHaul;
    S.shownHaul += diff * Math.min(1, dt / 140);
    if (Math.abs(S.haul - S.shownHaul) < Math.max(1, S.haul * 0.0005)) S.shownHaul = S.haul;
  }
  render(dt / 1000);
  stepFx(dt);
  drawFx();
  drawBg(dt);
  stepShake(dt);
  if (S.phase !== 'title') updateLeft();
  musicTick();
  requestAnimationFrame(frame);
}
fit();
renderSpeed();
showTitle();
requestAnimationFrame(frame);
