'use strict';
/* ================= HELPERS ================= */
const $ = s => document.querySelector(s);
const rnd = Math.random;
const pick = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
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
function md(s) { return s.replace(/\[(\w|\$)\]([\s\S]*?)\[\/\]/g, (m, k, t) => `<span class="k-${k === '$' ? 'money' : k}">${t}</span>`); }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function shade(h, amt) {
  const [r, g, b] = hexRgb(h).map(v => clamp(amt < 0 ? v * (1 + amt) : v + (1 - v) * amt, 0, 1));
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
function weightedPick(entries) {
  const total = entries.reduce((a, e) => a + e[1], 0);
  let x = rnd() * total;
  for (const [v, w] of entries) { x -= w; if (x <= 0) return v; }
  return entries[entries.length - 1][0];
}

/* ================= CONSTANTS ================= */
/* Board geometry. Balls are fired up a launch lane on the left (RX0..BX0), ride the outer
   dome rail over the top, and drop into the field (BX0..BX1). Shot power is randomized, so
   where a ball leaves the rail (and how fast) varies every shot. */
const RX0 = 316, BX0 = 348, BX1 = 956, CUP_TOP = 614, CUP_CATCH = 652, BBOT = 706;
const ARC_CX = (RX0 + BX1) / 2, ARC_CY = 344, ARC_R = (BX1 - RX0) / 2;
const RAIL_R = ARC_R - (BX0 - RX0), RAIL_END = 0.7 * Math.PI;
const RAIL_END_X = ARC_CX + RAIL_R * Math.cos(RAIL_END), RAIL_END_Y = ARC_CY - RAIL_R * Math.sin(RAIL_END);
const LANE_X = (RX0 + BX0) / 2, LAUNCH_Y = CUP_TOP - 8, TOP_Y = 92;
const CX = ARC_CX;
const NCUPS = 9, CUPW = (BX1 - BX0) / NCUPS;
const MAX_BALLS = 420;
const STEP = 1 / 240;
const BALL_R = 7;
const ROUNDS_TO_WIN = 24;
const REWARD = { normal: 6, boss: 10 };
const SAVE = 'pachipachi_reach_v1';
const prefs = Object.assign({ speed: 1, sound: true, music: true }, JSON.parse(localStorage.getItem(SAVE + '_prefs') || '{}'));
const best = Object.assign({ round: 0, ball: 0, roundScore: 0, runs: 0, wins: 0 }, JSON.parse(localStorage.getItem(SAVE + '_best') || '{}'));
const savePrefs = () => localStorage.setItem(SAVE + '_prefs', JSON.stringify(prefs));
const saveBest = () => localStorage.setItem(SAVE + '_best', JSON.stringify(best));

const S = {
  phase: 'title', round: 1, money: 6, score: 0, shownScore: 0, target: 0, ballsLeft: 0, ballsPerRound: 10, startValue: 1,
  relics: [], relicSlots: 5, slots: [], cups: [], balls: [], boss: null, held: null, offers: [], bestBall: 0,
  simTime: 0, launcher: { cool: 0, flash: 0, power: 0 }, upgrades: { balls: 0, value: 0 }, interestCap: 5,
  stats: { balls: 0, caught: 0, bestRound: 0 }, world: { g: 1050, wind: 0, drag: 0, rest: 1 }, rerollCost: 2,
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
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
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
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
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
const PENTA = [0, 2, 4, 7, 9];
const lastSfx = {};
function throttled(key, gap) { if (!AC) return false; const t = AC.currentTime; if (t - (lastSfx[key] || 0) < gap) return false; lastSfx[key] = t; return true; }
const SFX = {
  plink(h) { if (!throttled('plink', 0.022)) return; const n = Math.min(h, 34); const m = 64 + PENTA[n % 5] + 12 * Math.floor(n / 5); osc(mtof(Math.min(m, 108)), 0.09, 'triangle', 0.07); },
  bumper() { if (!throttled('bump', 0.04)) return; osc(180, 0.18, 'sine', 0.22, { slide: 520 }); osc(900, 0.05, 'square', 0.04); },
  mult(m) { if (!throttled('mult', 0.05)) return; const f = 330 * m; osc(f, 0.2, 'square', 0.06, { slide: f * 2 }); osc(f * 1.5, 0.25, 'triangle', 0.1); },
  split() { if (!throttled('split', 0.05)) return; osc(600, 0.12, 'square', 0.05, { slide: 1200 }); osc(900, 0.12, 'square', 0.05, { slide: 1800, delay: 0.04 }); },
  clone() { if (!throttled('clone', 0.06)) return; [880, 1320, 1760].forEach((f, i) => osc(f, 0.15, 'sine', 0.06, { delay: i * 0.03 })); },
  mega() { osc(70, 0.6, 'sawtooth', 0.15, { slide: 220 }); [262, 330, 392, 523].forEach((f, i) => osc(f, 0.4, 'square', 0.05, { delay: i * 0.05 })); },
  bomb() { if (!throttled('bomb', 0.06)) return; osc(90, 0.5, 'sine', 0.45, { slide: 30 }); noise(0.5, 0.35, 400, { type: 'lowpass' }); },
  warp() { if (!throttled('warp', 0.06)) return; osc(1200, 0.25, 'sine', 0.07, { slide: 200 }); },
  pad() { if (!throttled('pad', 0.05)) return; osc(200, 0.15, 'triangle', 0.15, { slide: 900 }); },
  fountain() { [523, 659, 784].forEach((f, i) => osc(f, 0.12, 'triangle', 0.08, { delay: i * 0.04 })); },
  coin() { if (!throttled('coin', 0.05)) return; osc(1568, 0.07, 'square', 0.04); osc(2093, 0.18, 'square', 0.04, { delay: 0.06 }); },
  lucky() { [784, 988, 1175, 1568].forEach((f, i) => osc(f, 0.18, 'square', 0.05, { delay: i * 0.04 })); },
  catch(m) { if (!throttled('catch', 0.03)) return; const base = m >= 5 ? 76 : m >= 2 ? 72 : m >= 1 ? 67 : 60; osc(mtof(base), 0.25, 'triangle', 0.12); osc(mtof(base + 7), 0.2, 'sine', 0.06); },
  jackpot() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => osc(f, 0.35, 'square', 0.06, { delay: i * 0.06 })); noise(0.4, 0.15, 3000); },
  launch() { if (!throttled('launch', 0.03)) return; osc(140, 0.1, 'square', 0.08, { slide: 60 }); noise(0.06, 0.15, 1500); },
  eaten() { if (!throttled('eat', 0.08)) return; osc(300, 0.4, 'sawtooth', 0.06, { slide: 40 }); },
  tick() { if (!throttled('tick', 0.04)) return; osc(2400 + rnd() * 300, 0.03, 'square', 0.02); },
  button() { osc(420, 0.06, 'square', 0.06); noise(0.03, 0.12, 2200); },
  buy() { [523, 659, 784, 1047].forEach((f, i) => osc(f, 0.14, 'triangle', 0.12, { delay: i * 0.05 })); },
  place() { osc(220, 0.08, 'square', 0.08); noise(0.05, 0.2, 1800); },
  nope() { osc(200, 0.12, 'square', 0.08, { slide: 120 }); },
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => osc(f, 0.35, 'triangle', 0.13, { delay: i * 0.07 })); },
  lose() { [392, 330, 262, 196, 147].forEach((f, i) => osc(f, 0.5, 'sawtooth', 0.07, { delay: i * 0.2 })); },
  boom() { osc(90, 0.7, 'sine', 0.4, { slide: 30 }); noise(0.6, 0.25, 300, { type: 'lowpass' }); },
};
const PROG = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]];
function musicTick() {
  if (!AC || !prefs.music) return;
  if (music.next < AC.currentTime) music.next = AC.currentTime + 0.05;
  const hot = S.phase === 'drop';
  while (music.next < AC.currentTime + 0.25) {
    const t = music.next, st = music.step, bar = Math.floor(st / 8) % 4, s = st % 8;
    const ch = PROG[bar].map(m => m - (S.boss && S.phase !== 'title' ? 2 : 0));
    if (s === 0) { osc(mtof(ch[0] - 24), 1.9, 'triangle', 0.5, { bus: musicBus, at: t }); ch.slice(0, 3).forEach(m => osc(mtof(m), 1.9, 'sine', 0.1, { bus: musicBus, at: t })); }
    if (s === 4) osc(mtof(ch[0] - 12), 0.9, 'triangle', 0.3, { bus: musicBus, at: t });
    osc(mtof(ch[[0, 1, 2, 3, 2, 1, 2, 3][s]] + 12), 0.22, 'triangle', 0.07 + (s % 2 ? 0 : 0.04), { bus: musicBus, at: t });
    if (hot && s % 2 === 1) osc(mtof(ch[0] + 24), 0.04, 'square', 0.03, { bus: musicBus, at: t });
    music.next += hot ? 0.2 : 0.25; music.step++;
  }
}

/* ================= BACKGROUND SHADER ================= */
const bgCanvas = $('#bg');
const gl = bgCanvas.getContext('webgl');
const BG = { cur: [hexRgb('#fe5f55'), hexRgb('#009dff'), hexRgb('#16202a')], tgt: null, t: 0, spin: 0, boost: 0 };
BG.tgt = BG.cur.map(c => c.slice());
const BG_THEMES = {
  title: ['#ff9a00', '#8a71e1', '#16122a'],
  normal: ['#2a7bd6', '#174a85', '#0b1d33'],
  shop: ['#4a9a7c', '#2a5c50', '#112521'],
  lose: ['#9a2020', '#3f1010', '#120606'],
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
function drawBg(dt) {
  if (!gl) return;
  BG.boost *= Math.pow(0.97, dt / 16.7);
  BG.t += dt * 0.001 * (0.45 + BG.boost * 0.5);
  BG.spin += dt * 0.001 * (0.6 + BG.boost * 2);
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
function stagePt(e) { const r = stageEl.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; }
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
function bumpEl(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/* ================= PARTICLES & POPS (canvas) =================
   Three stacked canvases: #board (2D: board, parts, cups), #balls (WebGL: balls + trails),
   #fxl (2D: particles, popups, ball labels, held ghost). */
const cv = $('#board'), ctx = cv.getContext('2d');
const fcv = $('#fxl'), fctx = fcv.getContext('2d');
const parts = [], pops = [];
function burst(x, y, n, colors, spd = 4, opts = {}) {
  if (parts.length > 2200) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, v = spd * (0.3 + rnd());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 1), life: 1, decay: 0.02 + rnd() * 0.03, size: (opts.size || 3) + rnd() * 3, col: pick(colors), g: opts.g ?? 0.15, type: opts.type || 'sq' });
  }
}
function confetti(n = 120) {
  const cols = ['#fe5f55', '#009dff', '#f3b958', '#4bc292', '#8a71e1', '#fff'];
  for (let i = 0; i < n; i++) parts.push({ x: 300 + rnd() * 672, y: -20 - rnd() * 200, vx: (rnd() - 0.5) * 3, vy: 2 + rnd() * 4, life: 1, decay: 0.004 + rnd() * 0.004, size: 5 + rnd() * 5, col: pick(cols), g: 0.05, type: 'conf', rot: rnd() * 6, vr: (rnd() - 0.5) * 0.3 });
}
function pop(x, y, text, col = '#fff', size = 18, bg = null) {
  if (pops.length > 90) { if (size < 22) return; pops.shift(); }
  pops.push({ x, y, text, col, size, bg, life: 1, vy: -40 - rnd() * 20 });
}
// in-place compaction: splice() per dead particle was O(n²) with thousands of particles
function compact(arr, keep) {
  let w = 0;
  for (let r = 0; r < arr.length; r++) if (keep(arr[r])) arr[w++] = arr[r];
  arr.length = w;
}
function stepFx(dt) {
  const k = dt / 16.67;
  for (const p of parts) {
    p.vx *= 0.97; p.vy = p.vy * 0.97 + p.g * k; p.x += p.vx * k; p.y += p.vy * k; p.life -= p.decay * k;
    if (p.rot !== undefined) p.rot += p.vr * k;
  }
  compact(parts, p => p.life > 0 && p.y <= 760);
  for (const p of pops) { p.life -= dt / 1000 / 0.9; p.y += p.vy * dt / 1000; p.vy *= 0.94; }
  compact(pops, p => p.life > 0);
}
function drawFx() {
  const g = fctx;
  for (const p of parts) {
    g.globalAlpha = Math.min(1, p.life * 2);
    g.fillStyle = p.col;
    if (p.type === 'conf') { const c = Math.cos(p.rot), s = Math.sin(p.rot); g.setTransform(c, s, -s, c, p.x, p.y); g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.setTransform(1, 0, 0, 1, 0, 0); }
    else g.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.round(p.size), Math.round(p.size));
  }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const p of pops) {
    const age = 1 - p.life, sc = age < 0.15 ? 0.4 + (age / 0.15) * 0.9 : age < 0.3 ? 1.3 - ((age - 0.15) / 0.15) * 0.3 : 1;
    g.globalAlpha = Math.min(1, p.life * 3);
    // quantized sizes keep the number of distinct font strings (and re-parses) small
    const px = Math.max(8, Math.round((p.size * sc) / 2) * 2);
    if (p.w0 === undefined) { setFont(g, `${p.size}px "Jersey 10", monospace`); p.w0 = g.measureText(p.text).width; }
    setFont(g, `${px}px "Jersey 10", monospace`);
    if (p.bg) {
      const w = (p.w0 * px) / p.size + 12, hh = px + 4;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(p.x - w / 2, p.y - hh / 2 + 3, w, hh);
      g.fillStyle = p.bg; g.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
      g.fillStyle = '#fff'; g.fillText(p.text, p.x, p.y + 1);
    } else {
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.col; g.fillText(p.text, p.x, p.y);
    }
  }
  g.globalAlpha = 1;
}

/* ================= BOARD ================= */
let PID = 0, BID = 0;
function newPart(type, lvl = 1) { return { type, lvl, id: ++PID, pulse: 0, last: -99, earned: 0, ang: rnd() * Math.PI * 2 }; }
function buildSlots() {
  const slots = [];
  for (let r = 0; r < 11; r++) {
    const y = 118 + r * 44, odd = r % 2, n = odd ? 10 : 11;
    for (let i = 0; i < n; i++) {
      const x = (odd ? 409 : 382) + i * 54;
      // keep clear of the curved inner rail and its release point
      if (y < ARC_CY + 10 && Math.hypot(x - ARC_CX, y - ARC_CY) > RAIL_R - 26) continue;
      if (Math.hypot(x - RAIL_END_X, y - RAIL_END_Y) < 34) continue;
      slots.push({ id: slots.length, x, y, row: r, part: null, hits: 0 });
    }
  }
  return slots;
}
const GRID = 48, GW = Math.ceil(1280 / GRID), GH = Math.ceil(720 / GRID);
let grid = [];
function rebuildGrid() {
  grid = Array.from({ length: GW * GH }, () => []);
  for (const s of S.slots) {
    if (!s.part) continue;
    const d = PARTS[s.part.type], rad = (d.len || d.r) + 16;
    for (let gx = Math.floor((s.x - rad) / GRID); gx <= Math.floor((s.x + rad) / GRID); gx++)
      for (let gy = Math.floor((s.y - rad) / GRID); gy <= Math.floor((s.y + rad) / GRID); gy++)
        if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) grid[gx + gy * GW].push(s);
  }
}
const DIVIDERS = [];
for (let i = 1; i < NCUPS; i++) DIVIDERS.push(BX0 + i * CUPW);
const hasR = k => S.relics.includes(k);
const relicN = k => S.relics.filter(r => r === k).length;
const bossK = () => (S.boss ? S.boss.k : null);
const xm = m => (bossK() === 'damp' && m > 1 ? 1 + (m - 1) / 2 : m);
function cupMult(i) {
  let m = BASE_CUP_MULTS[i] * CUPS[S.cups[i].type].m(S.cups[i].lvl);
  if (hasR('edgeLord') && (i === 0 || i === NCUPS - 1)) m *= 3;
  if (bossK() === 'miser') m *= 0.5;
  return xm(m);
}

/* ================= BALLS ================= */
function newBall(x, y, vx, vy, value, from = null) {
  const b = { id: ++BID, x, y, vx, vy, r: BALL_R, mass: 1, value, hits: 0, mega: false, used: from ? Object.assign({}, from.used) : {}, cd: {}, age: 0, still: 0, recyc: from ? from.recyc : 0, hydra: from ? from.hydra : false, trail: [], dead: false };
  if (from && from.mega) makeMega(b, 1);
  S.balls.push(b);
  S.stats.balls++;
  return b;
}
function makeMega(b, mult) {
  b.mega = true; b.r = 14; b.mass = 4;
  b.value *= mult;
}
// New balls stop after a minute of sim time so every round is guaranteed to drain; overflow doubles value instead.
const canSpawn = () => S.balls.length < MAX_BALLS && (S.phase === 'title' || S.simTime < 60);
function spawnTop(value, from = null) {
  if (!canSpawn()) {
    if (from) { from.value *= 2; popAt(from, 'OVERFLOW X2', '#ff4fd8', 16); }
    return null;
  }
  return newBall(ARC_CX + (rnd() - 0.5) * 220, TOP_Y, (rnd() - 0.5) * 220, 40 + rnd() * 80, value, from);
}
function popAt(b, text, col, size = 16, bg = null) { pop(b.x + (rnd() - 0.5) * 8, b.y - b.r - 10, text, col, size, bg); }
function countHit(b) {
  b.hits++;
  if (hasR('compound') && b.hits % 10 === 0) b.value *= 1.25;
  if (b.value > S.bestBall) S.bestBall = b.value;
}
function addVal(b, n) { b.value += n; countHit(b); }
function mulVal(b, m) { b.value *= m; countHit(b); }
function fewBalls() { return S.balls.length < 40; }

/* ================= HIT LOGIC ================= */
function onHit(b, s, p) {
  const d = PARTS[p.type], t = S.simTime, L = p.lvl, v = d.v(L);
  p.pulse = 1; s.hits++;
  const used = b.used[p.id] || 0;
  switch (p.type) {
    case 'peg': addVal(b, bossK() === 'rust' ? 0 : v + relicN('inflation') * 2); SFX.plink(b.hits); if (L > 1 && fewBalls()) popAt(b, '+' + v, '#e8eef0', 14); break;
    case 'silver': addVal(b, v); SFX.plink(b.hits + 3); if (fewBalls()) popAt(b, '+' + v, '#bfe3ff'); break;
    case 'gold': {
      addVal(b, v); SFX.plink(b.hits);
      const cap = 8 * L * (hasR('goldRush') ? 2 : 1), gain = hasR('goldRush') ? 2 : 1;
      if (p.earned < cap) { const g = Math.min(gain, cap - p.earned); p.earned += g; S.money += g; popAt(b, '$' + g, '#f3b958', 18); SFX.coin(); }
      break;
    }
    case 'lucky':
      if (rnd() < (hasR('luckySeven') ? 0.5 : 0.2)) { const m = xm(v); mulVal(b, m); popAt(b, `X${+m.toFixed(2)} LUCKY!`, '#fff', 20, '#4bc292'); SFX.lucky(); burst(s.x, s.y, 14, ['#4bc292', '#fff', '#b8ffd8'], 3); }
      else { addVal(b, 2 * L); SFX.plink(b.hits); }
      break;
    case 'spinner': addVal(b, v); SFX.plink(b.hits + 5); break;
    case 'bumper': addVal(b, v); SFX.bumper(); if (fewBalls()) popAt(b, '+' + v, '#7fd0ff', 18); burst(s.x, s.y, 6, ['#009dff', '#fff'], 3); break;
    case 'x2': case 'x3': {
      SFX.bumper();
      if (used < 3) {
        b.used[p.id] = used + 1;
        const m = xm(v + relicN('overclock'));
        mulVal(b, m); SFX.mult(v); popAt(b, 'X' + +m.toFixed(2), '#fff', 20, d.col);
        burst(s.x, s.y, 10, [d.col, '#fff'], 3.5); BG.boost += 0.05;
      }
      break;
    }
    case 'fountain': {
      if (used || t - p.last < 2.5) { addVal(b, 1); break; }
      p.last = t; addVal(b, 1);
      const n = v + (hasR('geyser') ? 2 : 0);
      for (let i = 0; i < n; i++) { const c = spawnTop(S.startValue); if (c) { c.used = Object.assign({}, b.used); c.used[p.id] = 1; } }
      pop(s.x, s.y - 26, `+${n} BALLS`, '#fff', 18, '#1aa3d6'); SFX.fountain(); burst(s.x, s.y, 16, ['#5fd3ff', '#fff'], 4);
      break;
    }
    case 'splitter': {
      if (used) { addVal(b, 1); break; }
      b.used[p.id] = 1; addVal(b, 1);
      const n = v + relicN('mitosis');
      for (let i = 0; i < n; i++) {
        if (!canSpawn()) { b.value *= 2; popAt(b, 'OVERFLOW X2', '#ff4fd8'); continue; }
        const c = newBall(b.x, b.y, -b.vx + (rnd() - 0.5) * 260, b.vy * 0.6 - 60 - rnd() * 60, b.value, b);
        c.hits = b.hits;
      }
      b.vx += (rnd() - 0.5) * 200;
      popAt(b, n > 1 ? `SPLIT ×${n + 1}!` : 'SPLIT!', '#fff', 18, '#2f9a72'); SFX.split(); burst(s.x, s.y, 10, ['#4bc292', '#fff'], 3);
      break;
    }
    case 'cloner': {
      if (used) { addVal(b, 1); break; }
      b.used[p.id] = 1; addVal(b, 1);
      const n = v * (hasR('cloneArmy') ? 2 : 1);
      for (let i = 0; i < n; i++) { const c = spawnTop(b.value, b); if (c) { c.hits = b.hits; burst(c.x, c.y, 10, ['#a98cff', '#fff'], 3); } }
      popAt(b, n > 1 ? `CLONE ×${n}!` : 'CLONE!', '#fff', 18, '#7a5cd6'); SFX.clone(); burst(s.x, s.y, 10, ['#a98cff', '#fff'], 3);
      break;
    }
    case 'bomb': {
      const cdTime = hasR('demolition') ? 1 : 3;
      if (t - p.last < cdTime) { addVal(b, 1); break; }
      p.last = t;
      explode(s.x, s.y, v + (hasR('demolition') ? 100 : 0));
      break;
    }
    case 'mega':
      if (b.mega || used) { addVal(b, 2); break; }
      b.used[p.id] = 1; makeMega(b, xm(v)); popAt(b, `MEGA BALL X${+xm(v).toFixed(2)}!`, '#fff', 24, '#d63cb5'); SFX.mega(); shake(5); BG.boost += 0.5;
      burst(s.x, s.y, 30, ['#ff4fd8', '#fff', '#ffd23a'], 6);
      break;
  }
}
function onSensor(b, s, p) {
  const used = b.used[p.id] || 0, v = PARTS[p.type].v(p.lvl);
  switch (p.type) {
    case 'ring': {
      if (used) return;
      b.used[p.id] = 1; p.pulse = 1; s.hits++;
      const m = xm(v + (hasR('rainbow') ? 1 : 0));
      mulVal(b, m); popAt(b, 'X' + +m.toFixed(2), '#fff', 18, '#e08a00'); SFX.mult(1.5); burst(b.x, b.y, 8, ['#ff9a00', '#fff'], 2.5);
      break;
    }
    case 'warp':
      if (used) return;
      b.used[p.id] = 1; p.pulse = 1; s.hits++; addVal(b, v);
      burst(b.x, b.y, 16, ['#7a5cff', '#fff', '#c9b8ff'], 4);
      b.x = ARC_CX + (rnd() - 0.5) * 220; b.y = TOP_Y; b.vx = (rnd() - 0.5) * 200; b.vy = 60; b.trail = [];
      burst(b.x, b.y, 16, ['#7a5cff', '#fff', '#c9b8ff'], 4); popAt(b, `WARP +${v}`, '#c9b8ff'); SFX.warp();
      break;
    case 'pad':
      if (used >= 2) return;
      if (b.vy < -100) return;
      b.used[p.id] = used + 1; p.pulse = 1; s.hits++; addVal(b, v);
      b.vy = -760 - rnd() * 200; b.vx = b.vx * 0.4 + (rnd() - 0.5) * 260;
      SFX.pad(); burst(s.x, s.y, 10, ['#9aff5a', '#fff'], 3, { up: 3 });
      break;
    case 'prism': {
      if (used) return;
      b.used[p.id] = 1; p.pulse = 1; s.hits++;
      const m = xm(v + (hasR('rainbow') ? 0.5 : 0));
      mulVal(b, m);
      for (let i = 0; i < 2; i++) {
        if (!canSpawn()) { b.value *= 2; continue; }
        const c = newBall(b.x, b.y, b.vx + (i ? 1 : -1) * (160 + rnd() * 120), b.vy * 0.8, b.value, b);
        c.hits = b.hits;
      }
      popAt(b, `PRISM X${+m.toFixed(2)} ×3`, '#fff', 20, '#2ab8c8'); SFX.split(); SFX.mult(2);
      burst(b.x, b.y, 20, ['#7ff0ff', '#ff9aff', '#fff6a0', '#fff'], 4);
      break;
    }
  }
}
function explode(x, y, add) {
  const R = 130;
  let n = 0;
  for (const o of S.balls) {
    const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy);
    if (d > R || d === 0) continue;
    const f = (1 - d / R) * 900 / o.mass;
    o.vx += (dx / d) * f; o.vy += (dy / d) * f - 150;
    addVal(o, add); n++;
  }
  pop(x, y - 24, `BOOM +${add}${n > 1 ? ' ×' + n : ''}`, '#fff', 22, '#c8203a');
  burst(x, y, 40, ['#ff4a1c', '#ffd23a', '#fff6c8', '#e5304a'], 7);
  SFX.bomb(); shake(6); BG.boost += 0.4;
}

/* ================= PHYSICS ================= */
function collideCircle(b, px, py, pr, e) {
  const dx = b.x - px, dy = b.y - py, rr = b.r + pr, d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return null;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  b.x = px + nx * rr; b.y = py + ny * rr;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vx += (rnd() - 0.5) * 24; }
  return { nx, ny, vn };
}
function collideSeg(b, ax, ay, bx, by, e, wvx = 0, wvy = 0) {
  const abx = bx - ax, aby = by - ay, L2 = abx * abx + aby * aby;
  let t = ((b.x - ax) * abx + (b.y - ay) * aby) / L2; t = clamp(t, 0, 1);
  const cx = ax + abx * t, cy = ay + aby * t;
  const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r || d2 === 0) return null;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  b.x = cx + nx * b.r; b.y = cy + ny * b.r;
  const rvx = b.vx - wvx, rvy = b.vy - wvy, vn = rvx * nx + rvy * ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  return { cx, cy };
}
function physStep(h) {
  const W = S.world, t = (S.simTime += h);
  for (const s of S.slots) if (s.part && s.part.type === 'spinner') s.part.ang += 3.2 * h;
  const holeOn = bossK() === 'void';
  for (const b of S.balls) {
    if (b.dead) continue;
    b.age += h;
    b.vy += W.g * h;
    const inField = b.x > BX0 && b.y > 160;
    if (W.wind && inField) b.vx += W.wind * Math.sin(t * 0.8) * h;
    if (W.drag && inField) { b.vx *= 1 - W.drag * h; b.vy *= 1 - W.drag * h; }
    if (S.magnetX !== null && hasR('magnet') && b.y > 420) b.vx += Math.sign(S.magnetX - b.x) * 160 * h;
    if (holeOn) {
      const dx = CX - b.x, dy = 340 - b.y, d = Math.hypot(dx, dy);
      if (d < 20) { b.dead = true; burst(b.x, b.y, 10, ['#b49aff', '#3a2a6a', '#fff'], 3); SFX.eaten(); if (fewBalls()) pop(b.x, b.y - 16, 'EATEN', '#b49aff'); continue; }
      if (d < 120) { const f = 900 * (1 - d / 120); b.vx += (dx / d) * f * h; b.vy += (dy / d) * f * h; }
    }
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > 1600 * 1600) { const k = 1600 / Math.sqrt(sp2); b.vx *= k; b.vy *= k; }
    b.x += b.vx * h; b.y += b.vy * h;
    // walls
    if (railCollide(b)) continue;
    // parts
    const gx = Math.floor(b.x / GRID), gy = Math.floor(b.y / GRID);
    if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) {
      for (const s of grid[gx + gy * GW]) {
        const p = s.part; if (!p) continue;
        const d = PARTS[p.type];
        if (d.kind === 'sensor') {
          const dx = b.x - s.x, dy = b.y - s.y;
          if (dx * dx + dy * dy < (d.r + b.r * 0.5) ** 2) onSensor(b, s, p);
        } else if (d.kind === 'spinner') {
          const c = Math.cos(p.ang) * d.len, sn = Math.sin(p.ang) * d.len;
          const hit = collideSeg(b, s.x - c, s.y - sn, s.x + c, s.y + sn, 0.7);
          if (hit) {
            const rx = hit.cx - s.x, ry = hit.cy - s.y;
            b.vx += -3.2 * ry * 1.6; b.vy += 3.2 * rx * 1.6;
            if (S.simTime - (b.cd[p.id] || -9) > 0.12) { b.cd[p.id] = S.simTime; onHit(b, s, p); }
          }
          collideCircle(b, s.x, s.y, d.r, 0.5);
        } else {
          const e = (d.kick ? 0.9 : 0.5) * W.rest;
          const hit = collideCircle(b, s.x, s.y, d.r, e);
          if (hit) {
            if (d.kick) { const vn = b.vx * hit.nx + b.vy * hit.ny; if (vn < d.kick) { b.vx += hit.nx * (d.kick - vn); b.vy += hit.ny * (d.kick - vn); } }
            if (S.simTime - (b.cd[p.id] || -9) > 0.1) { b.cd[p.id] = S.simTime; onHit(b, s, p); }
          }
        }
        if (b.dead) break;
      }
    }
    // cup dividers
    if (b.y + b.r > CUP_TOP) {
      for (const x of DIVIDERS) {
        if (Math.abs(b.x - x) > b.r + 4) continue;
        collideSeg(b, x, CUP_TOP + 6, x, BBOT, 0.3);
        collideCircle(b, x, CUP_TOP + 4, 4, 0.4);
      }
    }
    if (b.y > CUP_CATCH) catchBall(b, clamp(Math.floor((b.x - BX0) / CUPW), 0, NCUPS - 1));
    // stuck / timeout
    if (b.vx * b.vx + b.vy * b.vy < 30 * 30) {
      b.still += h;
      if (b.x < BX0 && b.still > 0.4) { b.x = LANE_X; b.y = LAUNCH_Y; b.vx = 0; b.vy = -shotPower(); b.still = 0; b.trail = []; S.launcher.flash = 1; }
      else if (b.still > 0.8) { b.vx = (rnd() - 0.5) * 300; b.vy = -120; b.still = 0; }
    } else b.still = 0;
    if (b.age > 30 && !b.dead) { pop(b.x, b.y, 'TIMEOUT', '#9fb0b3'); catchBall(b, clamp(Math.floor((b.x - BX0) / CUPW), 0, NCUPS - 1)); }
  }
  if (S.balls.some(b => b.dead)) S.balls = S.balls.filter(b => !b.dead);
}
function wallHit(b) { if (hasR('ricochet') && S.simTime - (b.cd.wall || -9) > 0.15) { b.cd.wall = S.simTime; addVal(b, 5); } }
function catchBall(b, i) {
  if (b.dead) return;
  const cup = S.cups[i], C = CUPS[cup.type];
  let m = cupMult(i);
  if (hasR('wizard') && b.hits >= 25) m *= 3;
  const pts = b.value * m;
  addScore(pts, BX0 + (i + 0.5) * CUPW, b);
  cup.flash = 1; cup.count++;
  S.stats.caught++;
  S.caughtRound++;
  SFX.catch(m);
  if (hasR('piggyBank') && S.caughtRound % 10 === 0 && S.gooseEarned < 10) { S.gooseEarned++; S.money++; pop(b.x, CUP_TOP - 30, '$1', '#f3b958', 18); SFX.coin(); }
  if (cup.type === 'piggy' && cup.earned < 6 * cup.lvl) { cup.earned++; S.money++; pop(b.x, CUP_TOP - 46, '$1', '#f3b958', 18); SFX.coin(); }
  if (cup.type === 'recycler' && b.recyc < 2) {
    const rm = xm(1 + cup.lvl);
    b.recyc++; mulVal(b, rm);
    relaunch(b); pop(BX0 + (i + 0.5) * CUPW, CUP_TOP - 46, `RECYCLE X${+rm.toFixed(2)}`, '#fff', 16, '#2f9a72'); return;
  }
  if (cup.type === 'hydra' && !b.hydra) {
    b.hydra = true; relaunch(b);
    for (let k = 0; k < cup.lvl; k++) { const c = spawnTop(b.value, b); if (c) c.hydra = true; }
    pop(BX0 + (i + 0.5) * CUPW, CUP_TOP - 46, `HYDRA ×${cup.lvl + 1}`, '#fff', 16, '#8a3ad6'); return;
  }
  b.dead = true;
}
function relaunch(b) { b.x = LANE_X; b.y = LAUNCH_Y; b.vx = 0; b.vy = -shotPower(); b.trail = []; b.age = 0; S.launcher.flash = 1; SFX.launch(); burst(b.x, b.y, 10, ['#fff', '#4bc292'], 3, { up: 3 }); }
// Randomized shot strength (normal around the sweet spot): weak shots peel off the rail on the left,
// mid shots drop in across the top, strong shots ride the dome over to the right wall.
function shotPower() { const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); return clamp(1130 + 50 * z, 980, 1350) * Math.sqrt(S.world.g / 1050); }
/* Lane, dome rail and field walls. Returns true when a weak shot fell back down the lane and was refired. */
function railCollide(b) {
  if (b.y < ARC_CY) {
    const dx = b.x - ARC_CX, dy = b.y - ARC_CY, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    if (d > ARC_R - b.r) {
      b.x = ARC_CX + nx * (ARC_R - b.r); b.y = ARC_CY + ny * (ARC_R - b.r);
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) { b.vx -= 1.12 * vn * nx; b.vy -= 1.12 * vn * ny; }
    } else if (Math.atan2(-dy, dx) >= RAIL_END && Math.abs(d - RAIL_R) < b.r) {
      const side = d >= RAIL_R ? 1 : -1, want = RAIL_R + side * b.r;
      b.x = ARC_CX + nx * want; b.y = ARC_CY + ny * want;
      const vn = (b.vx * nx + b.vy * ny) * side;
      if (vn < 0) { b.vx -= 1.3 * vn * nx * side; b.vy -= 1.3 * vn * ny * side; }
    }
    collideCircle(b, RAIL_END_X, RAIL_END_Y, 3, 0.5);
    return false;
  }
  if (b.x < BX0) {
    if (b.x - b.r < RX0) { b.x = RX0 + b.r; b.vx = Math.abs(b.vx) * 0.3; }
    if (b.x + b.r > BX0) { b.x = BX0 - b.r; b.vx = -Math.abs(b.vx) * 0.3; }
    if (b.vy > 0 && b.y > ARC_CY + 30) {
      b.y = LAUNCH_Y; b.x = LANE_X; b.vx = 0; b.vy = -shotPower(); b.trail = [];
      S.launcher.flash = 1; SFX.launch(); if (fewBalls()) pop(LANE_X + 20, LAUNCH_Y - 30, 'REFIRE', '#9fb0b3', 14);
      return true;
    }
    return false;
  }
  if (b.x - b.r < BX0) { b.x = BX0 + b.r; b.vx = Math.abs(b.vx) * 0.6; wallHit(b); }
  else if (b.x + b.r > BX1) { b.x = BX1 - b.r; b.vx = -Math.abs(b.vx) * 0.6; wallHit(b); }
  return false;
}
let lastJackpot = 0;
function addScore(pts, x, b) {
  if (S.phase === 'title') { pop(x, CUP_TOP - 20, fmt(pts), tierCol(pts), 20); return; }
  S.score += pts;
  const rel = pts / Math.max(1, S.target);
  const size = clamp(16 + Math.log10(rel * 100 + 1) * 6, 16, 40);
  if (pops.length < 30 || rel >= 0.05) pop(x + (rnd() - 0.5) * 16, CUP_TOP - 18, fmt(pts), tierCol(pts / Math.max(1, S.target) * 1000), size);
  burst(x, CUP_TOP + 20, Math.min(20, 4 + Math.floor(rel * 40)), [tierCol(pts), '#fff'], 2 + Math.min(5, rel * 10), { up: 2 });
  if (rel > 0.02) shake(clamp(Math.log10(rel * 100) * 2.5, 0.5, 10));
  if (rel >= 0.4 && S.simTime - lastJackpot > 2.5) {
    lastJackpot = S.simTime;
    banner(rel >= 1 ? 'MEGA JACKPOT!' : 'JACKPOT!', rel >= 1 ? '#ff4fd8' : '#f3b958', fmt(pts));
    SFX.jackpot(); BG.boost += 2; confetti(40);
  }
}
const TIERS = [[0, '#ffffff'], [10, '#bfe3ff'], [50, '#7fd0ff'], [200, '#4bc292'], [1e3, '#f3d23a'], [5e3, '#ff9a00'], [2e4, '#fe5f55'], [1e5, '#ff4fd8'], [1e6, '#b49aff'], [1e8, 'rainbow']];
function tierCol(v) {
  let c = '#fff';
  for (const [th, col] of TIERS) if (v >= th) c = col;
  return c === 'rainbow' ? `hsl(${(performance.now() / 4) % 360},90%,65%)` : c;
}

/* ================= LAUNCHER & ROUND FLOW ================= */
const isBossRound = r => r % 3 === 0;
function roundTarget(r) {
  // log-quadratic: early rounds grow gently, late rounds explode to match multi-ball chaos
  const k = r - 1;
  // 0.85: the dome board has fewer pegs and swingier entries than the open plinko board
  let t = 0.85 * Math.pow(10, 2 + 0.0342 * k + 0.0107 * k * k);
  if (isBossRound(r) && r > 9) t *= 1.15;
  const mag = Math.pow(10, Math.floor(Math.log10(t)) - 1);
  return Math.round(t / mag) * mag;
}
function fire() {
  const L = S.launcher;
  S.ballsLeft--; S.launched++;
  const p = shotPower();
  const b = newBall(LANE_X, LAUNCH_Y, 0, -p, S.startValue + (hasR('heavy') ? 5 : 0));
  if (hasR('megaEvery') && S.launched % 6 === 0) { makeMega(b, xm(5)); popAt(b, 'MEGA!', '#fff', 20, '#d63cb5'); SFX.mega(); }
  L.flash = 1; L.power = p / Math.sqrt(S.world.g / 1050); SFX.launch();
  burst(LANE_X, LAUNCH_Y + 8, 8, ['#fff', '#ffd23a'], 3, { up: 3 });
}
function stepLauncher(h) {
  const L = S.launcher;
  L.flash = Math.max(0, L.flash - h * 4);
  const want = S.phase === 'drop' ? S.ballsLeft > 0 : S.phase === 'title' && S.balls.length < 80;
  if (!want) return;
  L.cool -= h;
  if (L.cool <= 0) {
    if (S.phase === 'title') { S.ballsLeft = 99; fire(); S.ballsLeft = 99; }
    else fire();
    L.cool = S.phase === 'title' ? 0.2 : 0.3;
  }
}
function newRun() {
  hideModal(); clearOv();
  Object.assign(S, {
    round: 1, money: 6, relics: [], ballsPerRound: 10, startValue: 1, interestCap: 5, bestBall: 0, balls: [], held: null,
    upgrades: { balls: 0, value: 0 }, stats: { balls: 0, caught: 0, bestRound: 0 }, won: false, rerollBase: 2, heatData: false,
  });
  S.slots = buildSlots(); S.slots.forEach(s => (s.part = newPart('peg')));
  S.cups = BASE_CUP_MULTS.map(() => ({ type: 'cup', lvl: 1, flash: 0, count: 0, earned: 0 }));
  rebuildGrid();
  best.runs++; saveBest();
  startRound();
}
function startRound() {
  S.phase = 'ready'; S.score = 0; S.shownScore = 0; S.target = roundTarget(S.round);
  S.boss = isBossRound(S.round) ? pick(BOSSES.filter(b => S.round > 3 || !b.harsh)) : null;
  S.ballsLeft = S.ballsPerRound + relicN('extraBalls') * 3 - (bossK() === 'drought' ? 4 : 0);
  S.gooseEarned = 0; S.caughtRound = 0; S.launched = 0; S.balls = []; S.simTime = 0;
  S.cups.forEach(c => { c.earned = 0; });
  S.slots.forEach(s => { if (s.part) { s.part.earned = 0; s.part.last = -99; } });
  const k = bossK();
  S.world = { g: 1050 * (hasR('floaty') ? 0.7 : 1) * (k === 'anvil' ? 1.6 : 1), wind: k === 'gale' ? 320 : 0, drag: k === 'mud' ? 1.2 : 0, rest: k === 'mud' ? 0.6 : 1 };
  let bestI = 0; for (let i = 0; i < NCUPS; i++) if (cupMult(i) > cupMult(bestI)) bestI = i;
  S.magnetX = BX0 + (bestI + 0.5) * CUPW;
  S.launcher.cool = 0.4;
  setBg(S.boss ? [S.boss.col, shade(S.boss.col, -0.55), '#0b0b10'] : 'normal');
  if (S.boss) { banner(S.boss.n.toUpperCase(), '#fff', `${S.boss.a} ${S.boss.d}`); SFX.boom(); shake(6); }
  else banner(`ROUND ${S.round}`, '#fff', `Score ${fmt(S.target)} to advance`);
  renderRight(); renderRelics();
}
function drop() {
  if (S.phase !== 'ready') return;
  audioInit(); SFX.button();
  S.phase = 'drop'; S.launcher.cool = 0.15;
  // heatmap data covers exactly one drop: cleared here, shown afterwards until the next drop
  S.slots.forEach(s => (s.hits = 0)); S.cups.forEach(c => (c.count = 0)); S.heatData = true;
  renderRight();
}
let endTimer = 0;
function checkRoundEnd(dt) {
  if (S.phase !== 'drop') return;
  if (S.ballsLeft > 0 || S.balls.length > 0) { endTimer = 0; return; }
  endTimer += dt;
  if (endTimer > 0.9 && Math.abs(S.shownScore - S.score) < Math.max(1, S.score * 0.001)) { endTimer = 0; finishRound(); }
}
function finishRound() {
  S.shownScore = S.score;
  S.stats.bestRound = Math.max(S.stats.bestRound, S.score);
  if (S.score > best.roundScore) best.roundScore = S.score;
  if (S.bestBall > best.ball) best.ball = S.bestBall;
  if (S.score >= S.target) {
    if (S.round > best.round) best.round = S.round;
    saveBest();
    S.phase = 'cashout';
    SFX.win(); confetti(140); shake(6); BG.boost += 3;
    const over = S.score / S.target;
    banner(over >= 10 ? 'ANNIHILATED!' : over >= 3 ? 'DEMOLISHED!' : over >= 1.5 ? 'CRUSHED IT!' : 'CLEARED!', '#f3b958', `${over.toFixed(1)}x the target`);
    renderRight();
    setTimeout(showCashout, 1300 / Math.sqrt(prefs.speed));
  } else {
    saveBest();
    S.phase = 'over';
    SFX.lose(); shake(14); setBg('lose');
    banner('GAME OVER', '#fe5f55', `${fmt(S.score)} / ${fmt(S.target)}`);
    renderRight();
    setTimeout(() => showGameOver(false), 1600);
  }
}
function showCashout() {
  const lines = [{ t: S.boss ? `Beat ${S.boss.n}` : `Round ${S.round}`, v: S.boss ? REWARD.boss : REWARD.normal }];
  const interest = Math.min(Math.floor(Math.max(0, S.money) / 5), S.interestCap + relicN('bank') * 5);
  if (interest > 0) lines.push({ t: `Interest <span class="lbl">($1 per $5, max $${S.interestCap + relicN('bank') * 5})</span>`, v: interest });
  const over = S.score / S.target;
  const ok = over >= 2 ? Math.min(5, Math.floor(Math.log2(over))) : 0;
  if (ok > 0) lines.push({ t: `Overkill <span class="lbl">(${over.toFixed(1)}x target)</span>`, v: ok });
  const total = lines.reduce((a, l) => a + l.v, 0);
  $('#ov').innerHTML = `<div class="cash panel"><button id="cashBtn" class="b-orange" disabled>Cash Out: $${total}</button><div id="cashLines"></div></div>`;
  const box = $('#cashLines');
  lines.forEach((l, i) => setTimeout(() => {
    const row = document.createElement('div'); row.className = 'cl';
    row.innerHTML = `<span>${l.t}</span><span class="amt">$${l.v}</span>`; box.appendChild(row); SFX.coin();
    if (i === lines.length - 1) { const btn = $('#cashBtn'); btn.disabled = false; btn.classList.add('pulse'); bumpEl(btn); }
  }, 350 + i * 260));
  $('#cashBtn').addEventListener('click', () => {
    S.money += total; SFX.buy();
    const c = elCenter($('#cashBtn'));
    burst(c.x, c.y, 30, ['#f3b958', '#fff6c8'], 6);
    clearOv();
    if (S.round >= ROUNDS_TO_WIN && !S.won) { S.won = true; best.wins++; saveBest(); showGameOver(true); return; }
    showRewardPick();
  }, { once: true });
}
function showRewardPick() {
  const picks = [];
  while (picks.length < 3) { const o = randomOffer(); if (!picks.some(p => p.key === o.key)) picks.push(o); }
  $('#ov').innerHTML = `<div class="reward panel"><div class="rtitle t">FREE PICK</div><div class="lbl">Take one and place it on the board. Drop it on a matching part to level it up.</div>
    <div class="rcards">${picks.map((o, i) => { const d = o.kind === 'cup' ? CUPS[o.key] : PARTS[o.key]; return `<div class="rcard" data-i="${i}" style="--rc:${RAR[d.rarity][1]};animation-delay:${i * 0.08}s"><div class="okind">${o.kind === 'cup' ? 'CUP' : 'PART'} · ${RAR[d.rarity][0]}</div>${offerIcon(o)}<div class="oname">${d.n}</div><div class="rdesc">${md(d.d(1))}</div></div>`; }).join('')}</div>
    <button class="b-gray" id="skipPick">Skip: take $4 instead</button></div>`;
  paintIcons($('#ov'));
  SFX.fountain();
  $('#ov').querySelectorAll('.rcard').forEach(el => el.addEventListener('click', () => {
    const o = picks[+el.dataset.i];
    SFX.buy(); clearOv(); goShop();
    S.held = { kind: o.kind, type: o.key, lvl: 1, part: o.kind === 'part' ? newPart(o.key) : null, from: { reward: true } };
    renderRight();
  }));
  $('#skipPick').addEventListener('click', () => { S.money += 4; SFX.coin(); clearOv(); goShop(); });
}
function clearOv() { $('#ov').innerHTML = ''; }

/* ================= SHOP ================= */
function rarityRoll() { const x = rnd(); return x < 0.6 ? 1 : x < 0.9 ? 2 : 3; }
function randomOffer() {
  const cup = rnd() < 0.28;
  const keys = (cup ? CUP_KEYS : PART_KEYS).filter(k => (cup ? CUPS : PARTS)[k].rarity > 0);
  const r = rarityRoll();
  let pool = keys.filter(k => (cup ? CUPS : PARTS)[k].rarity === r);
  if (!pool.length) pool = keys;
  const key = pick(pool);
  return { kind: cup ? 'cup' : 'part', key, price: (cup ? CUPS : PARTS)[key].price, sold: false };
}
function randomRelicOffer() {
  const pool = RELIC_KEYS.filter(k => !S.relics.includes(k) || k === 'extraBalls' || k === 'inflation');
  const key = pick(pool);
  return { kind: 'relic', key, price: RELICS[key].price, sold: false };
}
function genOffers() { S.offers = [randomOffer(), randomOffer(), randomOffer(), randomRelicOffer()]; }
const upgradePrice = k => (k === 'balls' ? 5 + S.upgrades.balls * 3 : 4 + S.upgrades.value * 3);
function goShop() {
  S.phase = 'shop'; S.rerollCost = S.rerollBase; S.held = null; S.balls = [];
  setBg('shop');
  genOffers();
  renderRight(); renderRelics();
}
function buyOffer(i) {
  const o = S.offers[i];
  if (!o || o.sold || S.phase !== 'shop') return;
  if (S.held) { SFX.nope(); flashHint('Place the item you are holding first'); return; }
  if (S.money < o.price) { SFX.nope(); flashHint('Not enough money'); return; }
  if (o.kind === 'relic' && S.relics.length >= S.relicSlots) { SFX.nope(); flashHint('Relic slots full: sell one first'); return; }
  S.money -= o.price; o.sold = true; SFX.buy();
  if (o.kind === 'relic') { S.relics.push(o.key); if (o.key === 'bank') { /* interest cap read live */ } banner(RELICS[o.key].n, '#b49aff', md(RELICS[o.key].d)); renderRelics(); }
  else S.held = { kind: o.kind, type: o.key, lvl: 1, from: { shop: i }, part: o.kind === 'part' ? newPart(o.key) : null };
  renderRight();
}
function buyUpgrade(k) {
  const p = upgradePrice(k);
  if (S.money < p || S.phase !== 'shop') { SFX.nope(); return; }
  S.money -= p; S.upgrades[k]++; SFX.buy();
  if (k === 'balls') { S.ballsPerRound += 2; flashHint('+2 balls per round'); }
  else { S.startValue += 2; flashHint('Balls start with +2 value'); }
  renderRight();
}
function reroll() {
  if (S.held) { SFX.nope(); flashHint('Place the item you are holding first'); return; }
  if (S.money < S.rerollCost || S.phase !== 'shop') { SFX.nope(); return; }
  S.money -= S.rerollCost; S.rerollCost++;
  genOffers(); SFX.button(); renderRight();
}
function sellValueOf(held) { const d = held.kind === 'cup' ? CUPS[held.type] : PARTS[held.type]; return Math.floor((d.price * held.lvl) / 2); }
function sellHeld() {
  if (!S.held || S.held.from.shop !== undefined) return;
  const v = sellValueOf(S.held);
  S.money += v; SFX.coin(); flashHint(v ? `Sold for $${v}` : 'Discarded');
  S.held = null; renderRight();
}
function cancelHeld() {
  const h = S.held; if (!h) return;
  if (h.from.shop !== undefined) { S.money += S.offers[h.from.shop].price; S.offers[h.from.shop].sold = false; }
  else if (h.from.slot !== undefined) { const s = S.slots[h.from.slot]; if (s.part) { flashHint('Its old spot is taken: place it elsewhere or sell it'); return; } s.part = h.part; rebuildGrid(); }
  else if (h.from.cup !== undefined) { const c = S.cups[h.from.cup]; if (c.type !== 'cup') { flashHint('Its old cup is taken: place it elsewhere or sell it'); return; } c.type = h.type; c.lvl = h.lvl; }
  else { flashHint('Place it on the board, or sell it'); return; }
  S.held = null; SFX.place(); renderRight();
}
function sellRelic(i) {
  if (S.phase !== 'shop') return;
  const k = S.relics[i]; if (!k) return;
  S.relics.splice(i, 1); S.money += Math.floor(RELICS[k].price / 2); SFX.coin(); renderRelics(); renderRight();
}
function nextRound() {
  if (S.phase !== 'shop' || S.held) return;
  SFX.button(); S.round++; hideTip(); startRound();
}
let hintTimer = null;
function flashHint(text) { const el = $('#hint'); if (!el) return; el.textContent = text; el.style.color = '#ffd27a'; clearTimeout(hintTimer); hintTimer = setTimeout(() => { el.style.color = ''; el.textContent = defaultHint(); }, 1600); }
function defaultHint() { return S.held ? 'Click a glowing slot to place · right-click or Esc to undo' : 'Click a part on the board to move it'; }

/* ================= PLACEMENT INPUT ================= */
let mouse = { x: -999, y: -999, in: false };
function slotAt(x, y) { let bestS = null, bd = 22 * 22; for (const s of S.slots) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; bestS = s; } } return bestS; }
function cupAt(x, y) { if (y < CUP_TOP - 6 || y > BBOT || x < BX0 || x > BX1) return -1; return clamp(Math.floor((x - BX0) / CUPW), 0, NCUPS - 1); }
cv.addEventListener('pointermove', e => {
  const p = stagePt(e); mouse = { x: p.x, y: p.y, in: true };
  updateHoverTip();
});
cv.addEventListener('pointerleave', () => { mouse.in = false; hideTip(); });
cv.addEventListener('contextmenu', e => { e.preventDefault(); cancelHeld(); });
cv.addEventListener('pointerdown', e => {
  audioInit();
  if (e.button !== 0) return;
  if (S.phase !== 'shop') { if (S.phase === 'ready') drop(); return; }
  const p = stagePt(e);
  const s = slotAt(p.x, p.y), ci = cupAt(p.x, p.y);
  const h = S.held;
  if (h) {
    if (h.kind === 'part' && s) {
      const old = s.part;
      if (old && old.type === h.type && old.lvl + h.lvl <= MAX_LVL) {
        old.lvl = Math.min(MAX_LVL, old.lvl + h.lvl); old.pulse = 1; S.held = null;
        pop(s.x, s.y - 28, `LEVEL ${old.lvl}!`, '#fff', 22, PARTS[old.type].col); SFX.lucky(); shake(3);
        burst(s.x, s.y, 26, [PARTS[h.type].col, '#fff', '#ffd23a'], 5);
      } else {
        s.part = h.part; s.part.pulse = 1;
        S.held = old ? { kind: 'part', type: old.type, lvl: old.lvl, part: old, from: { slot: s.id } } : null;
        SFX.place(); burst(s.x, s.y, 12, [PARTS[h.type].col, '#fff'], 3);
      }
      rebuildGrid();
    } else if (h.kind === 'cup' && ci >= 0) {
      const c = S.cups[ci], x = BX0 + (ci + 0.5) * CUPW;
      if (c.type === h.type && c.lvl + h.lvl <= MAX_LVL) {
        c.lvl = Math.min(MAX_LVL, c.lvl + h.lvl); c.flash = 1; S.held = null;
        pop(x, CUP_TOP - 20, `LEVEL ${c.lvl}!`, '#fff', 22, CUPS[c.type].col); SFX.lucky(); shake(3);
        burst(x, CUP_TOP + 30, 26, [CUPS[h.type].col, '#fff', '#ffd23a'], 5);
      } else {
        const old = { type: c.type, lvl: c.lvl };
        c.type = h.type; c.lvl = h.lvl; c.flash = 1;
        S.held = old.type !== 'cup' ? { kind: 'cup', type: old.type, lvl: old.lvl, from: { cup: ci } } : null;
        SFX.place(); burst(x, CUP_TOP + 30, 14, [CUPS[h.type].col, '#fff'], 3);
      }
    } else { SFX.nope(); return; }
  } else {
    if (s && s.part) { S.held = { kind: 'part', type: s.part.type, lvl: s.part.lvl, part: s.part, from: { slot: s.id } }; s.part = null; rebuildGrid(); SFX.place(); }
    else if (ci >= 0 && S.cups[ci].type !== 'cup') { const c = S.cups[ci]; S.held = { kind: 'cup', type: c.type, lvl: c.lvl, from: { cup: ci } }; c.type = 'cup'; c.lvl = 1; SFX.place(); }
    else return;
  }
  hideTip();
  renderRight();
});
addEventListener('keydown', e => {
  audioInit();
  if (e.key === 'Escape') { if (S.held) cancelHeld(); else if (modalEl.classList.contains('show') && S.phase !== 'title' && S.phase !== 'over') hideModal(); }
  if ((e.key === ' ' || e.key === 'Enter') && S.phase === 'ready' && !modalEl.classList.contains('show')) { e.preventDefault(); drop(); }
  if ((e.key === 'h' || e.key === 'H') && !modalEl.classList.contains('show')) toggleHeat();
});

/* ================= TOOLTIP ================= */
const tipEl = $('#tip');
function tipHTML(title, desc, badge = '', badgeCol = '#5b6b6e', sub = '') {
  return `<div class="tt">${title}</div><div>${md(desc)}</div>${badge ? `<span class="badge" style="background:${badgeCol}">${badge}</span>` : ''}${sub ? `<div class="sub">${sub}</div>` : ''}`;
}
const RAR = { 0: ['Basic', '#5b6b6e'], 1: ['Common', '#009dff'], 2: ['Uncommon', '#4bc292'], 3: ['Rare', '#fe5f55'] };
function showTipAt(html, x, y, below = false) {
  tipEl.innerHTML = html; tipEl.classList.add('show');
  const h = tipEl.offsetHeight;
  tipEl.style.left = clamp(x, 140, 1140) + 'px';
  tipEl.style.top = clamp(below ? y : y - h, 4, 716 - h) + 'px';
}
function hideTip() { tipEl.classList.remove('show'); }
function updateHoverTip() {
  if (!mouse.in || S.phase === 'title' || (S.phase === 'drop' && S.balls.length > 3)) { hideTip(); return; }
  const s = slotAt(mouse.x, mouse.y);
  const lastDrop = S.heatData && S.phase !== 'drop' ? ` · hit ${s && s.hits} times last drop` : '';
  if (s && s.part) { const d = PARTS[s.part.type], L = s.part.lvl; showTipAt(tipHTML(`${d.n}${L > 1 ? ' · Lv' + L : ''}`, d.d(L), RAR[d.rarity][0], RAR[d.rarity][1], (S.phase === 'shop' ? (S.held && S.held.type === s.part.type && L + S.held.lvl <= MAX_LVL ? 'Click to MERGE (level up)' : 'Click to pick up / swap') : '') + lastDrop), s.x, s.y - 30); return; }
  const ci = cupAt(mouse.x, mouse.y);
  if (ci >= 0) { const cup = S.cups[ci], c = CUPS[cup.type]; showTipAt(tipHTML(`${c.n}${cup.lvl > 1 ? ' · Lv' + cup.lvl : ''} · x${+cupMult(ci).toFixed(2)}`, c.d(cup.lvl), RAR[c.rarity][0], RAR[c.rarity][1], `Caught ${cup.count} this round`), BX0 + (ci + 0.5) * CUPW, CUP_TOP - 10); return; }
  hideTip();
}

/* ================= RENDER: BOARD ================= */
function drawPart(g, type, x, y, p, t, sc = 1) {
  const d = PARTS[type];
  const pulse = p ? p.pulse : 0;
  const r = d.r * sc * (1 + pulse * 0.35);
  // plain translate instead of save/restore: restore would also reset the font and break setFont's cache
  g.translate(x, y);
  const disc = (rad, col) => { g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  const label = (txt, size, col = '#fff') => { const sp = labelSprite(txt, Math.round(size), col); g.drawImage(sp, -sp.width / 2, -sp.height / 2 + 0.75 * sc); };
  switch (type) {
    case 'peg': case 'silver': case 'gold': case 'lucky':
      disc(r + 1.5 * sc, 'rgba(0,0,0,.45)'); disc(r, pulse > 0.2 ? '#fff' : d.col);
      g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(-r * 0.5, -r * 0.55, Math.max(2, r * 0.4), Math.max(2, r * 0.4));
      if (type === 'gold') label('$', 11 * sc, '#7a4a00');
      if (type === 'lucky') label('7', 11 * sc, '#0d4a32');
      if (type === 'silver') { g.fillStyle = '#fff'; g.fillRect(r * 0.3, -r * 0.9, 2 * sc, 2 * sc); }
      break;
    case 'bumper': case 'x2': case 'x3':
      if (pulse > 0) { g.beginPath(); g.arc(0, 0, r + 10 * pulse * sc, 0, Math.PI * 2); g.strokeStyle = `rgba(255,255,255,${pulse})`; g.lineWidth = 3 * sc; g.stroke(); }
      disc(r + 3 * sc, '#0d1214'); disc(r, pulse > 0.4 ? '#fff' : d.col); disc(r * 0.66, shade(d.col, -0.25));
      g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2 * sc; g.stroke();
      label(type === 'bumper' ? '+' + d.v(p ? p.lvl : 1) : 'X' + d.v(p ? p.lvl : 1), (type === 'bumper' ? 12 : 15) * sc);
      break;
    case 'ring': case 'warp': case 'prism': {
      const spin = t * (type === 'warp' ? -3 : 1.5);
      g.rotate(spin);
      g.lineWidth = 3 * sc;
      if (type === 'prism') {
        for (let i = 0; i < 3; i++) { g.strokeStyle = ['#ff7aff', '#7ff0ff', '#fff27a'][i]; g.beginPath(); g.arc(0, 0, r - i * 3 * sc, i * 2.1, i * 2.1 + 3.4); g.stroke(); }
        g.rotate(-spin); g.fillStyle = 'rgba(127,240,255,.18)'; g.beginPath(); g.moveTo(0, -r * 0.6); g.lineTo(r * 0.55, r * 0.4); g.lineTo(-r * 0.55, r * 0.4); g.closePath(); g.fill(); g.strokeStyle = '#7ff0ff'; g.lineWidth = 2 * sc; g.stroke();
        break;
      }
      g.setLineDash([5 * sc, 4 * sc]); g.strokeStyle = d.col; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = type === 'warp' ? 'rgba(122,92,255,.25)' : 'rgba(255,154,0,.15)'; g.beginPath(); g.arc(0, 0, r - 2 * sc, 0, Math.PI * 2); g.fill();
      if (type === 'warp') { g.strokeStyle = '#c9b8ff'; g.lineWidth = 2 * sc; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, r * (0.25 + i * 0.22), i, i + 2.4); g.stroke(); } }
      g.rotate(-spin);
      if (type === 'ring') label('X' + (d.v(p ? p.lvl : 1) + (hasR('rainbow') ? 1 : 0)), 13 * sc, '#ffd08a');
      break;
    }
    case 'pad':
      g.fillStyle = 'rgba(154,255,90,.15)'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = d.col; g.lineWidth = 3 * sc;
      for (let i = 0; i < 2; i++) { const yy = (4 - i * 8 - ((t * 20) % 8)) * sc; g.globalAlpha = 0.5 + i * 0.5; g.beginPath(); g.moveTo(-7 * sc, yy + 4 * sc); g.lineTo(0, yy - 3 * sc); g.lineTo(7 * sc, yy + 4 * sc); g.stroke(); }
      g.globalAlpha = 1;
      break;
    case 'spinner': {
      const a = p ? p.ang : t * 3;
      g.rotate(a); g.fillStyle = '#0d1214'; g.fillRect(-d.len * sc - 2, -5 * sc, (d.len * 2 * sc) + 4, 10 * sc);
      g.fillStyle = pulse > 0.3 ? '#fff' : d.col; g.fillRect(-d.len * sc, -3.5 * sc, d.len * 2 * sc, 7 * sc);
      g.rotate(-a); disc(5 * sc, '#0d1214'); disc(3 * sc, '#fff');
      break;
    }
    case 'splitter': case 'cloner': case 'fountain': case 'mega': case 'bomb': {
      let col = d.col;
      if (type === 'bomb' && p && S.simTime - p.last < (hasR('demolition') ? 1 : 3) && p.last > 0) col = '#5b6b6e';
      if (type === 'mega') { g.globalAlpha = 0.35 + 0.2 * Math.sin(t * 5); disc(r + 6 * sc, d.col); g.globalAlpha = 1; }
      disc(r + 2.5 * sc, '#0d1214'); disc(r, pulse > 0.4 ? '#fff' : col);
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2 * sc;
      if (type === 'splitter') { g.beginPath(); g.moveTo(0, -r * 0.55); g.lineTo(0, 0); g.lineTo(-r * 0.5, r * 0.5); g.moveTo(0, 0); g.lineTo(r * 0.5, r * 0.5); g.stroke(); }
      if (type === 'cloner') { g.beginPath(); g.arc(-r * 0.22, 0, r * 0.35, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(r * 0.22, 0, r * 0.35, 0, Math.PI * 2); g.stroke(); }
      if (type === 'fountain') { g.beginPath(); g.moveTo(0, r * 0.55); g.lineTo(0, -r * 0.5); g.moveTo(-r * 0.4, -r * 0.1); g.lineTo(0, -r * 0.55); g.lineTo(r * 0.4, -r * 0.1); g.stroke(); }
      if (type === 'mega') label('M', 16 * sc);
      if (type === 'bomb') { g.strokeStyle = '#ffd23a'; g.beginPath(); g.moveTo(r * 0.5, -r * 0.6); g.quadraticCurveTo(r, -r * 1.3, r * 1.2, -r * 1.1); g.stroke(); if (col !== '#5b6b6e' && Math.sin(t * 20) > 0) { g.fillStyle = '#ffd23a'; g.fillRect(r * 1.1, -r * 1.3, 3 * sc, 3 * sc); } }
      break;
    }
  }
  if (p && p.lvl > 1) {
    const n = p.lvl, w = 4 * sc, gap = 2 * sc, tot = n * w + (n - 1) * gap, yy = -(d.len ? 10 : d.r) * sc - 8 * sc;
    for (let i = 0; i < n; i++) { g.fillStyle = '#0d1214'; g.fillRect(-tot / 2 + i * (w + gap) - 1, yy - 1, w + 2, w + 2); g.fillStyle = '#ffd23a'; g.fillRect(-tot / 2 + i * (w + gap), yy, w, w); }
  }
  g.translate(-x, -y);
}
function drawCup(g, i, x0, w, cup, t) {
  const m = cupMult(i), C = CUPS[cup.type];
  const col = m >= 10 ? '#ff4fd8' : m >= 5 ? '#f3b958' : m >= 2 ? '#4bc292' : m >= 1 ? '#2a7bd6' : '#3a4d50';
  const f = cup.flash;
  g.fillStyle = shade(col, -0.55); g.fillRect(x0 + 3, CUP_TOP + 8, w - 6, BBOT - CUP_TOP - 12);
  g.fillStyle = col; g.globalAlpha = 0.35 + f * 0.6; g.fillRect(x0 + 3, CUP_TOP + 8, w - 6, BBOT - CUP_TOP - 12); g.globalAlpha = 1;
  if (cup.type !== 'cup') { g.strokeStyle = C.col; g.lineWidth = 3; g.strokeRect(x0 + 5, CUP_TOP + 10, w - 10, BBOT - CUP_TOP - 16); }
  setFont(g, `${m >= 10 ? 26 : 24}px "Jersey 10", monospace`); g.textAlign = 'center'; g.textBaseline = 'middle';
  const lbl = 'x' + (+m.toFixed(2));
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillText(lbl, x0 + w / 2, CUP_TOP + 50); g.fillStyle = f > 0.3 ? '#fff' : '#f2f4f4'; g.fillText(lbl, x0 + w / 2, CUP_TOP + 48 - f * 4);
  if (cup.type !== 'cup') { setFont(g, '13px "Jersey 10", monospace'); g.fillStyle = C.col; g.fillText(C.n.split(' ')[0].toUpperCase() + (cup.lvl > 1 ? ' ' + cup.lvl : ''), x0 + w / 2, CUP_TOP + 74); }
}
/* Ball heat: 0 = cold blue (worth little), 1 = red (one ball alone is worth ~2x the round target),
   above 1 it burns toward white. Log scale so it keeps meaning as numbers explode. */
const HEAT_STOPS = [[0, [70, 120, 255]], [0.25, [60, 210, 255]], [0.5, [255, 238, 110]], [0.75, [255, 150, 30]], [1, [255, 55, 40]]];
function ballHeat(v) { return clamp(Math.log10(Math.max(v, 1)) / Math.log10(Math.max((S.target || 500) * 2, 10)), 0, 1.4); }
function heatRGB(h) {
  if (h >= 1) { const k = Math.min(1, (h - 1) / 0.4); return [255, 55 + 200 * k, 40 + 215 * k]; }
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i], [p0, c0] = HEAT_STOPS[i - 1];
    if (h <= p1) { const k = (h - p0) / (p1 - p0); return c0.map((c, j) => c + (c1[j] - c) * k); }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}
/* ================= SPRITES (balls + trails) =================
   Balls and trail dots are stamped from one pre-rendered atlas. Accelerated canvases batch drawImage
   calls from a single source, while per-frame arcs and stroked polylines are new paths every frame
   that must be tessellated and uploaded (the dominant cost in the 200-ball Firefox profile). */
const TRAIL_LEN = 16;
const HEAT_STEPS = 28, HEAT_MAX = 1.4, CELL = 64, DOT_R = 16;
const TRAIL_ALPHAS = [0.1, 0.17, 0.26, 0.38];
const ROW_BALL = 0, ROW_GLOW = 1, ROW_MEGA = 2, ROW_DOT = 3;
const atlas = document.createElement('canvas');
let atlasReady = false;
const heatStep = v => Math.min(HEAT_STEPS - 1, Math.round((ballHeat(v) / HEAT_MAX) * (HEAT_STEPS - 1)));
function buildAtlas() {
  atlas.width = HEAT_STEPS * CELL; atlas.height = CELL * (ROW_DOT + TRAIL_ALPHAS.length);
  const g = atlas.getContext('2d');
  for (let i = 0; i < HEAT_STEPS; i++) {
    const [r, gg, b] = heatRGB((i / (HEAT_STEPS - 1)) * HEAT_MAX), col = `rgb(${r | 0},${gg | 0},${b | 0})`;
    const cx = i * CELL + CELL / 2;
    for (const row of [ROW_BALL, ROW_GLOW, ROW_MEGA]) {
      const cy = row * CELL + CELL / 2, rad = row === ROW_MEGA ? 14 : BALL_R;
      if (row !== ROW_BALL) { g.globalAlpha = 0.25; g.fillStyle = col; g.beginPath(); g.arc(cx, cy, rad * (row === ROW_MEGA ? 2 : 1.7), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      g.fillStyle = '#0d1214'; g.beginPath(); g.arc(cx, cy + 1.5, rad + 1.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(Math.round(cx - rad * 0.5), Math.round(cy - rad * 0.55), Math.max(2, rad * 0.4), Math.max(2, rad * 0.4));
      if (row === ROW_MEGA) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, rad + 4, 0, Math.PI * 2); g.stroke(); }
    }
    TRAIL_ALPHAS.forEach((a, k) => { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(cx, (ROW_DOT + k) * CELL + CELL / 2, DOT_R, 0, Math.PI * 2); g.fill(); });
    g.globalAlpha = 1;
  }
  atlasReady = true;
}
// only used by the 2D fallback when WebGL2 is unavailable; kept short since every dot is a canvas command
const MAX_TRAIL_DOTS = 10;
function drawBall(g, b) {
  if (!atlasReady) buildAtlas();
  const sx = heatStep(b.value) * CELL, tr = b.trail, n = tr.length;
  // every other sample, newest first, no gap filling
  for (let i = n - 1, dots = 0; i >= 0 && dots < MAX_TRAIL_DOTS; i -= 2, dots++) {
    const f = (i + 1) / n, rr = b.r * (0.35 + 0.65 * f), sy = (ROW_DOT + Math.min(TRAIL_ALPHAS.length - 1, (f * TRAIL_ALPHAS.length) | 0)) * CELL;
    g.drawImage(atlas, sx + CELL / 2 - DOT_R, sy + CELL / 2 - DOT_R, DOT_R * 2, DOT_R * 2, tr[i][0] - rr, tr[i][1] - rr, rr * 2, rr * 2);
  }
  const row = b.mega ? ROW_MEGA : b.value >= 200 ? ROW_GLOW : ROW_BALL;
  g.drawImage(atlas, sx, row * CELL, CELL, CELL, b.x - CELL / 2, b.y - CELL / 2, CELL, CELL);
}
function drawBallLabel(g, b) {
  if (!((b.mega && S.balls.length < 120) || (S.balls.length < 60 && b.value >= 20))) return;
  setFont(g, `${b.mega ? 16 : 13}px "Jersey 10", monospace`); g.textAlign = 'center'; g.textBaseline = 'middle';
  const tx = fmt(b.value);
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(tx, b.x, b.y - b.r - 9); g.fillStyle = '#fff'; g.fillText(tx, b.x, b.y - b.r - 9);
}

/* ================= WEBGL BALL LAYER =================
   Every trail dot and ball is one instance of a single quad, shaded procedurally (disc, shadow,
   glow, highlight, mega ring), so the whole ball layer is one instanced draw call per frame.
   Falls back to the 2D sprite path when WebGL2 is unavailable. */
const ballCv = $('#balls');
function makeBallGL() {
  const gl = ballCv.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const vs = `#version 300 es
in vec2 aCorner;
in vec4 aPosSizeR;   // x, y, quad half-size, ball radius (px)
in vec4 aColA;       // r, g, b (0..1), alpha
in float aKind;      // 0 trail dot, 1 ball, 2 glowing ball, 3 mega ball
out vec2 vLocal; out float vR; out vec4 vColA; out float vKind;
uniform vec2 uRes;
void main() {
  vLocal = aCorner * aPosSizeR.z;
  vec2 p = aPosSizeR.xy + vLocal;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vR = aPosSizeR.w; vColA = aColA; vKind = aKind;
}`;
  const fs = `#version 300 es
precision mediump float;
in vec2 vLocal; in float vR; in vec4 vColA; in float vKind;
out vec4 o;
vec4 over(vec4 dst, vec3 col, float a) { return vec4(col * a, a) + dst * (1.0 - a); }
float disc(vec2 p, float r) { return clamp(r - length(p) + 0.5, 0.0, 1.0); }
void main() {
  vec3 col = vColA.rgb;
  if (vKind < 0.5) { float a = vColA.a * disc(vLocal, vR); o = vec4(col * a, a); return; }
  vec4 c = vec4(0.0);
  if (vKind > 1.5) c = over(c, col, 0.25 * disc(vLocal, vR * (vKind > 2.5 ? 2.0 : 1.7)));
  c = over(c, vec3(0.051, 0.071, 0.078), disc(vLocal - vec2(0.0, 1.5), vR + 1.5));
  c = over(c, col, disc(vLocal, vR));
  vec2 hl = vec2(-0.5, -0.55) * vR; float hs = max(2.0, vR * 0.4);
  if (vLocal.x >= hl.x && vLocal.x < hl.x + hs && vLocal.y >= hl.y && vLocal.y < hl.y + hs) c = over(c, vec3(1.0), 0.85);
  if (vKind > 2.5) c = over(c, vec3(1.0), clamp(1.5 - abs(length(vLocal) - (vR + 4.0)), 0.0, 1.0));
  o = c;
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(prog, 'aCorner');
  gl.enableVertexAttribArray(aCorner); gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  const FLOATS = 9, inst = gl.createBuffer();
  let cap = 0, data = new Float32Array(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  for (const [name, size, off] of [['aPosSizeR', 4, 0], ['aColA', 4, 4], ['aKind', 1, 8]]) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off * 4); gl.vertexAttribDivisor(loc, 1);
  }
  gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), ballCv.width, ballCv.height);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, ballCv.width, ballCv.height);
  // heat colors are looked up per bucket; ballHeat already log-scales against the round target
  const heatCols = [];
  for (let i = 0; i < HEAT_STEPS; i++) heatCols.push(heatRGB((i / (HEAT_STEPS - 1)) * HEAT_MAX).map(v => v / 255));
  const TRAIL_A = [0.1, 0.17, 0.26, 0.38], MAX_DOTS = 24;
  return {
    draw(balls) {
      const need = balls.length * (MAX_DOTS + 1) * FLOATS;
      if (need > cap) { cap = Math.max(need, cap * 2, 4096); data = new Float32Array(cap); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW); }
      let o = 0;
      const put = (x, y, size, r, c, a, kind) => { data[o++] = x; data[o++] = y; data[o++] = size; data[o++] = r; data[o++] = c[0]; data[o++] = c[1]; data[o++] = c[2]; data[o++] = a; data[o++] = kind; };
      // trails first so every ball sits on top of every trail
      for (const b of balls) {
        const c = heatCols[heatStep(b.value)], tr = b.trail, n = tr.length;
        for (let i = 0, dots = 0; i < n && dots < MAX_DOTS; i++) {
          const f = (i + 1) / n, rr = b.r * (0.35 + 0.65 * f), a = TRAIL_A[Math.min(3, (f * 4) | 0)];
          const x = tr[i][0], y = tr[i][1], nx = i + 1 < n ? tr[i + 1][0] : b.x, ny = i + 1 < n ? tr[i + 1][1] : b.y;
          const extra = Math.min(3, Math.floor(Math.hypot(nx - x, ny - y) / (rr * 1.4)));
          for (let e = 0; e <= extra && dots < MAX_DOTS; e++, dots++) { const k = e / (extra + 1); put(x + (nx - x) * k, y + (ny - y) * k, rr + 1, rr, c, a, 0); }
        }
      }
      for (const b of balls) {
        const c = heatCols[heatStep(b.value)], kind = b.mega ? 3 : b.value >= 200 ? 2 : 1;
        put(b.x, b.y, b.r * (kind === 3 ? 2 : kind === 2 ? 1.7 : 1) + 6, b.r, c, 1, kind);
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!o) return;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, o);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o / FLOATS);
    },
    clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
  };
}
let BallGL = null;
try { BallGL = makeBallGL(); } catch (e) { console.warn('WebGL ball layer unavailable, using 2D sprites', e); }
if (!BallGL) ballCv.style.display = 'none';
// fonts load asynchronously: redraw text that was baked into cached layers once they arrive
document.fonts.ready.then(() => { labelCache.clear(); staticSig = null; });
// Setting ctx.font re-parses the font string every time (274 samples in the profile); only set on change.
// The last font is remembered per context; callers that save()/restore() must call resetFont().
function setFont(g, f) { if (g.__font !== f) { g.__font = f; g.font = f; } }
const resetFont = g => { g.__font = ''; };
// Part labels (X2, +12, ...) are pre-rendered once per text/size/color and stamped as images.
const labelCache = new Map();
function labelSprite(txt, size, col) {
  const key = `${txt}|${size}|${col}`;
  let c = labelCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const g = c.getContext('2d'), font = `${size}px "Jersey 10", monospace`;
  g.font = font;
  c.width = Math.ceil(g.measureText(txt).width) + 4; c.height = size + 6;
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillText(txt, c.width / 2, c.height / 2 + 1.5);
  g.fillStyle = col; g.fillText(txt, c.width / 2, c.height / 2);
  // fonts load asynchronously: don't cache a fallback-font rendering
  if (document.fonts.check(font)) labelCache.set(key, c);
  return c;
}

/* ================= STATIC BOARD LAYER =================
   Backdrop, rails, dividers, resting parts and cups are drawn once into an offscreen canvas and
   stamped each frame. Animated parts, flashing parts and flashing cups are drawn live on top. */
const LIVE_PARTS = new Set(['ring', 'warp', 'prism', 'pad', 'spinner', 'mega', 'bomb']);
const staticCv = document.createElement('canvas');
staticCv.width = 1280; staticCv.height = 720;
let staticSig = null;
function boardSignature() {
  let s = `${S.phase === 'shop' ? 1 : 0}|${bossK()}|${S.relics.join(',')}|`;
  for (const sl of S.slots) s += sl.part ? sl.part.type + sl.part.lvl + ',' : '_,';
  for (const c of S.cups) s += c.type + c.lvl + ',';
  return s;
}
function drawStatic() {
  const g = staticCv.getContext('2d');
  g.clearRect(0, 0, 1280, 720);
  g.fillStyle = 'rgba(255,255,255,.035)';
  for (let y = 40; y < CUP_TOP; y += 22) for (let x = BX0 + 10; x < BX1; x += 22) g.fillRect(x, y, 2, 2);
  // dark surround outside the dome, then the launch lane
  g.fillStyle = '#0a1012';
  g.beginPath(); g.rect(300, 14, 672, 692);
  g.moveTo(BX1, ARC_CY); g.arc(ARC_CX, ARC_CY, ARC_R, 0, Math.PI, true); g.lineTo(RX0, BBOT); g.lineTo(BX1, BBOT); g.closePath();
  g.fill('evenodd');
  g.fillStyle = '#121c1f'; g.fillRect(RX0, ARC_CY, BX0 - RX0, BBOT - ARC_CY);
  g.lineCap = 'round';
  for (const [w, col] of [[7, 'rgba(0,0,0,.6)'], [4, '#9fb0b3'], [1.5, '#ffffff']]) {
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.moveTo(RX0, BBOT); g.lineTo(RX0, ARC_CY); g.arc(ARC_CX, ARC_CY, ARC_R, Math.PI, 0); g.lineTo(BX1, BBOT); g.stroke();
    g.beginPath(); g.moveTo(BX0, BBOT); g.lineTo(BX0, ARC_CY); g.arc(ARC_CX, ARC_CY, RAIL_R, Math.PI, Math.PI * 2 - RAIL_END); g.stroke();
  }
  g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(RAIL_END_X, RAIL_END_Y, 4, 0, Math.PI * 2); g.fill();
  for (const s of S.slots) {
    if (s.part) { if (!LIVE_PARTS.has(s.part.type)) drawPart(g, s.part.type, s.x, s.y, { ...s.part, pulse: 0 }, 0); }
    else if (S.phase === 'shop') { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(s.x - 2, s.y - 2, 4, 4); }
  }
  for (let i = 0; i < NCUPS; i++) if (S.cups[i]) drawCup(g, i, BX0 + i * CUPW, CUPW, { ...S.cups[i], flash: 0 }, 0);
  g.fillStyle = '#cfd8da';
  for (const x of DIVIDERS) { g.fillRect(x - 2, CUP_TOP + 6, 4, BBOT - CUP_TOP); g.beginPath(); g.arc(x, CUP_TOP + 4, 4, 0, Math.PI * 2); g.fill(); }
}
function ensureStatic() {
  // the board cannot change mid-drop, so skip the signature walk while balls are flying
  if (S.phase === 'drop' && staticSig !== null) return;
  const sig = boardSignature();
  if (sig !== staticSig) { staticSig = sig; drawStatic(); }
}
/* ================= HEATMAP (post-drop overlay) ================= */
const heatVisible = () => S.heatOn && S.heatData && S.phase !== 'drop' && S.phase !== 'title';
function heatBtnHtml() { return S.heatData ? `<button class="b-gray heatBtn ${S.heatOn ? 'on' : ''}" id="heatBtn">Heatmap: ${S.heatOn ? 'ON' : 'OFF'} <span class="lbl">(H)</span></button>` : ''; }
function bindHeatBtn() { const hb = $('#heatBtn'); if (hb) hb.addEventListener('click', toggleHeat); }
function toggleHeat() {
  if (!S.heatData || S.phase === 'drop' || S.phase === 'title') return;
  S.heatOn = !S.heatOn; SFX.button(); renderRight();
}
let legendGrad = null, meterGrad = null;
function drawHeatmap() {
  let max = 1, cupMax = 1, dead = 0, total = 0;
  for (const s of S.slots) if (s.part) { max = Math.max(max, s.hits); total += s.hits; if (!s.hits) dead++; }
  for (const c of S.cups) cupMax = Math.max(cupMax, c.count);
  const rgb = k => { const [r, g, b] = heatRGB(k); return `rgb(${r | 0},${g | 0},${b | 0})`; };
  ctx.fillStyle = 'rgba(4,7,9,.74)'; ctx.fillRect(300, 14, 672, 692);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of S.slots) {
    if (!s.part) continue;
    if (!s.hits) {
      ctx.strokeStyle = 'rgba(159,176,179,.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    const k = Math.log(1 + s.hits) / Math.log(1 + max), col = rgb(k);
    ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 9 + 15 * k, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(s.x, s.y, 4 + 6 * k, 0, Math.PI * 2); ctx.fill();
    if (s.part.type !== 'peg') { ctx.strokeStyle = PARTS[s.part.type].col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 7 + 7 * k, 0, Math.PI * 2); ctx.stroke(); }
    setFont(ctx, '13px "Jersey 10", monospace'); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    const ty = s.y - 13 - 5 * k; ctx.strokeText(fmt(s.hits), s.x, ty); ctx.fillStyle = '#fff'; ctx.fillText(fmt(s.hits), s.x, ty);
  }
  // catches per cup as bars
  for (let i = 0; i < NCUPS; i++) {
    const c = S.cups[i], x0 = BX0 + i * CUPW, hh = (BBOT - CUP_TOP - 16) * (c.count / cupMax);
    if (c.count) { ctx.fillStyle = rgb(Math.log(1 + c.count) / Math.log(1 + cupMax)); ctx.fillRect(x0 + 10, BBOT - 6 - hh, CUPW - 20, hh); }
    setFont(ctx, '18px "Jersey 10", monospace'); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(c.count, x0 + CUPW / 2, CUP_TOP - 8); ctx.fillStyle = c.count ? '#fff' : '#7f9396'; ctx.fillText(c.count, x0 + CUPW / 2, CUP_TOP - 8);
  }
  // legend
  const lx = ARC_CX - 110, ly = 52;
  ctx.fillStyle = 'rgba(10,16,18,.9)'; ctx.beginPath(); ctx.roundRect(lx - 10, ly - 18, 240, 66, 8); ctx.fill();
  setFont(ctx, '17px "Jersey 10", monospace'); ctx.fillStyle = '#fff'; ctx.fillText('HITS LAST DROP', ARC_CX, ly - 4);
  if (!legendGrad) { legendGrad = ctx.createLinearGradient(lx, 0, lx + 220, 0); HEAT_STOPS.forEach(([p, c]) => legendGrad.addColorStop(p, `rgb(${c.join(',')})`)); }
  ctx.fillStyle = legendGrad; ctx.fillRect(lx, ly + 8, 220, 8);
  setFont(ctx, '13px "Jersey 10", monospace'); ctx.fillStyle = '#cfd8da';
  ctx.textAlign = 'left'; ctx.fillText('1', lx, ly + 26); ctx.textAlign = 'right'; ctx.fillText(fmt(max), lx + 220, ly + 26);
  ctx.textAlign = 'center'; ctx.fillText(`${fmt(total)} hits · ${dead} never hit`, ARC_CX, ly + 26);
}
function render(rt) {
  const t = rt / 1000;
  ctx.clearRect(0, 0, 1280, 720);
  ctx.save(); resetFont(ctx);
  ctx.beginPath(); ctx.roundRect(300, 14, 672, 692, 14); ctx.clip();
  ensureStatic();
  ctx.drawImage(staticCv, 0, 0);
  // black hole
  if (bossK() === 'void' && S.phase !== 'title') {
    for (let i = 5; i >= 0; i--) { ctx.globalAlpha = 0.12; ctx.fillStyle = '#7a5cff'; ctx.beginPath(); ctx.arc(CX, 340, 26 + i * 22 + Math.sin(t * 3 + i) * 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(CX, 340, 26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b49aff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(CX, 340, 28, t * 4, t * 4 + 4); ctx.stroke();
  }
  // wind indicator
  if (S.world.wind && S.phase !== 'title') {
    const w = Math.sin(S.simTime * 0.8);
    ctx.globalAlpha = 0.15; ctx.strokeStyle = '#bfe3ff'; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) { const y = 80 + i * 38, x = BX0 + (((t * 300 * Math.sign(w || 1)) + i * 97) % (BX1 - BX0) + (BX1 - BX0)) % (BX1 - BX0); ctx.beginPath(); ctx.moveTo(BX0 + x, y); ctx.lineTo(BX0 + x + 40 * w, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // live parts: animated types always, resting types only while their hit-flash is fading
  const placing = S.phase === 'shop' && S.held;
  for (const s of S.slots) {
    const p = s.part;
    if (p && (p.pulse > 0 || LIVE_PARTS.has(p.type))) { p.pulse = Math.max(0, p.pulse - 0.06); drawPart(ctx, p.type, s.x, s.y, p, t); }
    if (placing && S.held.kind === 'part') {
      const hov = mouse.in && (mouse.x - s.x) ** 2 + (mouse.y - s.y) ** 2 < 22 * 22;
      const merge = p && p.type === S.held.type && p.lvl + S.held.lvl <= MAX_LVL;
      ctx.strokeStyle = hov ? '#fff' : merge ? `rgba(255,210,58,${0.7 + Math.sin(t * 8) * 0.3})` : 'rgba(255,210,58,.3)'; ctx.lineWidth = hov || merge ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, hov ? 22 : merge ? 22 + Math.sin(t * 6) * 3 : 15 + Math.sin(t * 4 + s.id) * 2, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (let i = 0; i < NCUPS; i++) {
    const c = S.cups[i]; if (!c) continue;
    if (c.flash > 0) { c.flash = Math.max(0, c.flash - 0.04); drawCup(ctx, i, BX0 + i * CUPW, CUPW, c, t); }
    if (placing && S.held.kind === 'cup') { const hov = mouse.in && cupAt(mouse.x, mouse.y) === i; ctx.strokeStyle = hov ? '#fff' : `rgba(255,210,58,${0.4 + Math.sin(t * 5) * 0.2})`; ctx.lineWidth = 3; ctx.strokeRect(BX0 + i * CUPW + 4, CUP_TOP + 9, CUPW - 8, BBOT - CUP_TOP - 14); }
  }
  if (heatVisible()) drawHeatmap();
  // balls: one instanced WebGL draw on their own layer, or 2D sprites as a fallback
  if (BallGL) BallGL.draw(S.balls); else for (const b of S.balls) drawBall(ctx, b);
  // launcher
  const L = S.launcher;
  // plunger + spring at the bottom of the lane
  const head = LAUNCH_Y + 10 - L.flash * 14;
  ctx.strokeStyle = '#9fb0b3'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 8; i++) { const y = head + 6 + ((BBOT - 6 - head - 6) * i) / 8; ctx.lineTo(LANE_X + (i % 2 ? 9 : -9), y); }
  ctx.stroke();
  ctx.fillStyle = L.flash > 0.3 ? '#fff' : '#fe5f55'; ctx.fillRect(LANE_X - 12, head, 24, 6);
  // shot power meter in the left margin
  const pr = clamp((L.power - 980) / 370, 0, 1), mh = 260, my = BBOT - mh;
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(303, my, 9, mh);
  if (!meterGrad) { meterGrad = ctx.createLinearGradient(0, BBOT, 0, my); meterGrad.addColorStop(0, '#4bc292'); meterGrad.addColorStop(0.6, '#ffd23a'); meterGrad.addColorStop(1, '#fe5f55'); }
  ctx.fillStyle = meterGrad; ctx.fillRect(303, BBOT - mh * pr, 9, mh * pr);
  ctx.fillStyle = '#fff'; ctx.fillRect(301, BBOT - mh * pr - 1, 13, 3);
  ctx.restore(); resetFont(ctx);
  // top layer: particles, popups, ball value labels, held ghost
  fctx.clearRect(0, 0, 1280, 720);
  fctx.save(); resetFont(fctx);
  fctx.beginPath(); fctx.roundRect(300, 14, 672, 692, 14); fctx.clip();
  for (const b of S.balls) drawBallLabel(fctx, b);
  drawFx();
  fctx.restore(); resetFont(fctx);
  // held ghost (outside the board clip so it follows the mouse anywhere)
  if (S.held && mouse.in) {
    fctx.globalAlpha = 0.8;
    if (S.held.kind === 'part') drawPart(fctx, S.held.type, mouse.x, mouse.y, S.held.part, t);
    else { fctx.fillStyle = CUPS[S.held.type].col; fctx.fillRect(mouse.x - 34, mouse.y - 20, 68, 40); setFont(fctx, '18px "Jersey 10"'); fctx.textAlign = 'center'; fctx.textBaseline = 'middle'; fctx.fillStyle = '#fff'; fctx.fillText(CUPS[S.held.type].n + (S.held.lvl > 1 ? ' ' + S.held.lvl : ''), mouse.x, mouse.y + 1); }
    fctx.globalAlpha = 1;
  }
}

/* ================= DOM PANELS ================= */
const cache = {};
/* Text changes edit the existing text node instead of replacing it: replacing nodes every frame
   fed Firefox's accessibility tree thousands of node-removed events in the profile. */
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
  setText('roundName', S.phase === 'title' ? '' : `Round ${S.round}${S.round <= ROUNDS_TO_WIN ? '/' + ROUNDS_TO_WIN : ''}`);
  const bl = S.boss ? `${S.boss.a} ${S.boss.n}: ${S.boss.d}` : '';
  setText('bossLine', bl);
  setStyle($('#roundBox'), 'rcol', '--rcol', S.boss ? S.boss.col : S.phase === 'shop' ? '#c23b30' : '#2a7bd6');
  setText('target', fmt(S.target));
  if (setText('score', fmt(S.shownScore)) && S.phase === 'drop') SFX.tick();
  const pct = S.target ? S.shownScore / S.target : 0;
  setStyle($('#barFill'), 'barW', 'width', (clamp(pct, 0, 1) * 100).toFixed(1) + '%');
  if (cache.barFull !== (pct >= 1)) { cache.barFull = pct >= 1; $('#barFill').classList.toggle('full', cache.barFull); }
  setText('pct', S.target && S.phase !== 'shop' ? (pct >= 1 ? `${pct >= 1000 ? fmt(pct) : pct.toFixed(1)}x target!` : `${Math.floor(pct * 100)}%`) : '');
  setText('ballsLeft', String(S.phase === 'ready' || S.phase === 'drop' ? S.ballsLeft : S.ballsPerRound + relicN('extraBalls') * 3));
  setText('inPlay', String(S.balls.length));
  setText('bestBall', fmt(S.bestBall));
  if (setText('money', (S.money < 0 ? '-$' : '$') + Math.abs(S.money))) bumpEl($('#money'));
  const ip = $('#chaosNum');
  if (ip && ip.dataset.n !== String(S.balls.length)) {
    const n = S.balls.length;
    ip.dataset.n = n; ip.firstChild ? (ip.firstChild.data = n) : (ip.textContent = n);
    ip.style.color = tierCol(n * 20); ip.style.transform = `scale(${(1 + Math.min(0.6, n / 300)).toFixed(2)})`;
  }
}
function renderRelics() {
  setText('relicCount', `${S.relics.length}/${S.relicSlots}`);
  let html = '';
  for (let i = 0; i < S.relicSlots; i++) {
    const k = S.relics[i];
    html += k ? `<div class="relic full" data-i="${i}">${RELICS[k].a}<button class="b-red sell" data-sell="${i}">$${Math.floor(RELICS[k].price / 2)}</button></div>` : '<div class="relic"></div>';
  }
  const el = $('#relics'); el.innerHTML = html;
  el.querySelectorAll('.relic.full').forEach(r => {
    const k = S.relics[+r.dataset.i];
    r.addEventListener('mouseenter', () => { const c = elCenter(r); showTipAt(tipHTML(RELICS[k].n, RELICS[k].d, 'Relic', '#8a71e1', S.phase === 'shop' ? 'Hover and click $ to sell' : ''), Math.min(c.x, 1140), c.y + 38, true); });
    r.addEventListener('mouseleave', hideTip);
  });
  el.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); hideTip(); sellRelic(+b.dataset.sell); }));
}
function offerIcon(o) {
  if (o.kind === 'relic') return `<div class="oicon">${RELICS[o.key].a}</div>`;
  return `<canvas width="70" height="70" data-icon="${o.kind}:${o.key}"></canvas>`;
}
function paintIcons(root) {
  root.querySelectorAll('canvas[data-icon]').forEach(c => {
    const [kind, key] = c.dataset.icon.split(':'), g = c.getContext('2d');
    if (kind === 'part') drawPart(g, key, 35, 35, null, performance.now() / 1000, 1.7);
    else {
      const C = CUPS[key];
      g.fillStyle = shade(C.col, -0.5); g.fillRect(10, 18, 50, 42); g.fillStyle = C.col; g.fillRect(14, 22, 42, 34);
      g.fillStyle = '#0d1214'; g.fillRect(6, 14, 6, 48); g.fillRect(58, 14, 6, 48);
      g.font = '22px "Jersey 10", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.fillText(C.m(1) > 1 ? 'x' + C.m(1) : key === 'recycler' ? '↺' : key === 'hydra' ? '×2' : '$', 35, 40);
    }
  });
}
function renderRight() {
  const body = $('#rightBody');
  document.body.dataset.phase = S.phase;
  if (S.phase === 'ready' || S.phase === 'drop' || S.phase === 'cashout' || S.phase === 'over') {
    const ready = S.phase === 'ready';
    body.innerHTML = `<div class="dropBox">
      ${ready ? `<button class="b-blue bigDrop pulse" id="dropBtn">DROP!</button><div class="feed">${S.ballsLeft} balls · random launcher<br><span class="lbl">Space / click the board</span></div>` : `<div class="chaosLbl">BALLS IN PLAY</div><div class="chaos t" id="chaosNum">0</div>`}
      <div class="feed">${S.boss ? `<span class="c-red">BOSS</span> ${S.boss.a} ${S.boss.n}<br>${S.boss.d}` : `Next boss: round ${Math.ceil(S.round / 3) * 3}`}</div>
      <div class="feed lbl">Balls start at <span class="c-blue">${S.startValue}</span> value</div>
    ${S.phase !== 'drop' ? heatBtnHtml() : ''}</div>`;
    const db = $('#dropBtn'); if (db) db.addEventListener('click', drop);
    bindHeatBtn();
    return;
  }
  if (S.phase !== 'shop') { body.innerHTML = ''; return; }
  const h = S.held;
  let holdHtml = '';
  if (h) {
    const d = h.kind === 'cup' ? CUPS[h.type] : PARTS[h.type];
    const fromShop = h.from.shop !== undefined;
    holdHtml = `<div class="holdBox">Holding <b style="color:${d.col}">${d.n}${h.lvl > 1 ? ' Lv' + h.lvl : ''}</b><br>${fromShop ? 'Place it, or drop it on a matching part to level up' : 'Move it, or:'}<br>
      ${fromShop ? `<button class="b-gray" id="cancelBtn">Refund $${S.offers[h.from.shop].price}</button>` : `<button class="b-red" id="sellBtn">${sellValueOf(h) ? 'Sell $' + sellValueOf(h) : 'Discard'}</button>${h.from.reward ? '' : ' <button class="b-gray" id="cancelBtn">Put back</button>'}`}</div>`;
  }
  body.innerHTML = `
    <div class="shopHead"><div class="shopSign t">SHOP</div>${heatBtnHtml() || '<div class="lbl" style="text-align:right">Buy, then place<br>on the board</div>'}</div>
    <div class="offers">${S.offers.map((o, i) => {
      const d = o.kind === 'relic' ? RELICS[o.key] : o.kind === 'cup' ? CUPS[o.key] : PARTS[o.key];
      const rc = o.kind === 'relic' ? '#8a71e1' : RAR[d.rarity][1];
      return `<div class="offer ${o.sold ? 'sold' : ''} ${S.money < o.price ? 'poor' : ''}" data-o="${i}" style="--rc:${rc};animation-delay:${i * 0.06}s"><div class="okind">${o.kind === 'relic' ? 'RELIC' : o.kind === 'cup' ? 'CUP' : 'PART'}</div>${offerIcon(o)}<div class="oname">${d.n}</div><div class="oprice">${o.sold ? 'SOLD' : '$' + o.price}</div></div>`;
    }).join('')}</div>
    <div class="upRow">
      <button class="b-blue" id="upBalls">+2 Balls<br>$${upgradePrice('balls')}</button>
      <button class="b-purple" id="upValue">+2 Ball value<br>$${upgradePrice('value')}</button>
    </div>
    ${holdHtml}
    <div class="hint" id="hint" ${S.held ? 'style="display:none"' : ''}>${defaultHint()}</div>
    <div class="shopBtns"><button class="b-green" id="rerollBtn">Reroll<br>$${S.rerollCost}</button><button class="b-red ${S.held ? '' : 'pulse'}" id="nextBtn" ${S.held ? 'disabled' : ''}>Next<br>Round</button></div>`;
  paintIcons(body);
  body.querySelectorAll('.offer').forEach(el => {
    const o = S.offers[+el.dataset.o];
    const d = o.kind === 'relic' ? RELICS[o.key] : o.kind === 'cup' ? CUPS[o.key] : PARTS[o.key];
    el.addEventListener('click', () => { hideTip(); buyOffer(+el.dataset.o); });
    el.addEventListener('mouseenter', () => { const c = elCenter(el); showTipAt(tipHTML(d.n, typeof d.d === 'function' ? d.d(1) : d.d, o.kind === 'relic' ? 'Relic' : RAR[d.rarity][0], o.kind === 'relic' ? '#8a71e1' : RAR[d.rarity][1], o.kind === 'relic' ? '' : 'Drop on a matching part to level it up'), Math.min(c.x, 1100), c.y - 80); });
    el.addEventListener('mouseleave', hideTip);
  });
  $('#upBalls').addEventListener('click', () => buyUpgrade('balls'));
  $('#upValue').addEventListener('click', () => buyUpgrade('value'));
  $('#upBalls').disabled = S.money < upgradePrice('balls');
  $('#upValue').disabled = S.money < upgradePrice('value');
  $('#rerollBtn').addEventListener('click', reroll);
  $('#rerollBtn').disabled = S.money < S.rerollCost || !!S.held;
  $('#nextBtn').addEventListener('click', nextRound);
  bindHeatBtn();
  const sb = $('#sellBtn'); if (sb) sb.addEventListener('click', sellHeld);
  const cb = $('#cancelBtn'); if (cb) cb.addEventListener('click', cancelHeld);
}
function renderSpeed() {
  $('#speedBtns').innerHTML = [1, 2, 4].map(v => `<button class="b-blue ${prefs.speed === v ? 'on' : ''}" data-sp="${v}">${v}x</button>`).join('');
  $('#speedBtns').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { prefs.speed = +b.dataset.sp; savePrefs(); renderSpeed(); SFX.button(); }));
}

/* ================= MODALS ================= */
const modalEl = $('#modal');
function showModal(html, clear = false) { modalEl.innerHTML = html; modalEl.className = 'show' + (clear ? ' clear' : ''); }
function hideModal() { modalEl.className = ''; modalEl.innerHTML = ''; }
function showGameOver(won) {
  const counts = {};
  for (const s of S.slots) if (s.part && s.part.type !== 'peg') counts[s.part.type] = (counts[s.part.type] || 0) + s.part.lvl;
  const build = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${PARTS[k].n} ×${n}`).join(', ') || 'Just pegs';
  showModal(`<div class="box panel">
    <h1 class="${won ? 'c-gold' : 'c-red'}">${won ? 'YOU WIN!' : 'GAME OVER'}</h1>
    ${won ? `<h2>Round ${ROUNDS_TO_WIN} cleared. Keep going in Endless?</h2>` : `<h2>Round ${S.round}: ${fmt(S.score)} / ${fmt(S.target)}</h2>`}
    <div class="stgrid">
      <span>Best ball</span><b>${fmt(S.bestBall)}</b>
      <span>Best round score</span><b>${fmt(S.stats.bestRound)}</b>
      <span>Balls dropped</span><b>${fmt(S.stats.balls)}</b>
      <span>Relics</span><b>${S.relics.map(k => RELICS[k].a).join(' ') || '-'}</b>
      <span>Build</span><b style="font-size:17px">${build}</b>
      <span>All-time best ball</span><b>${fmt(best.ball)}</b>
    </div>
    <div class="row">${won ? '<button class="b-blue" id="endlessBtn">Endless</button>' : ''}<button class="b-orange" id="newRunBtn">New Run</button><button class="b-gray" id="menuBtn">Main Menu</button></div>
  </div>`);
  if (won) { confetti(200); SFX.win(); $('#endlessBtn').addEventListener('click', () => { hideModal(); goShop(); }); }
  $('#newRunBtn').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#menuBtn').addEventListener('click', () => { SFX.button(); showTitle(); });
}
function showInfo() {
  SFX.button();
  const counts = {};
  for (const s of S.slots) if (s.part) counts[s.part.type] = (counts[s.part.type] || 0) + s.part.lvl;
  const parts = Object.entries(counts).map(([k, n]) => `<div><span style="color:${PARTS[k].col}">●</span> ${PARTS[k].n} <span class="lbl">(${n} levels)</span></div>`).join('');
  const relics = S.relics.map(k => `<div>${RELICS[k].a} <b>${RELICS[k].n}</b><br><span class="lbl">${md(RELICS[k].d)}</span></div>`).join('') || '<div class="lbl">No relics yet</div>';
  showModal(`<div class="box panel"><h2>Run Info</h2>
    <div class="infoGrid">${parts}</div>
    <h2 style="margin-top:14px">Relics</h2><div class="infoGrid">${relics}</div>
    <div class="stgrid" style="margin-top:12px"><span>Balls per round</span><b>${S.ballsPerRound + relicN('extraBalls') * 3}</b><span>Starting ball value</span><b>${S.startValue}</b><span>Best ball</span><b>${fmt(S.bestBall)}</b></div>
    <div class="row"><button class="b-orange" id="closeM">Back</button></div></div>`);
  $('#closeM').addEventListener('click', () => { SFX.button(); hideModal(); });
}
function showOptions() {
  SFX.button();
  const seg = (name, vals, cur) => `<span class="seg">${vals.map(v => `<button class="b-blue ${v[0] === cur ? 'on' : ''}" data-${name}="${v[0]}">${v[1]}</button>`).join('')}</span>`;
  const midDrop = S.phase === 'drop';
  showModal(`<div class="box panel"><h2>Options</h2>
    <div class="opt"><span>Sound</span>${seg('sound', [[1, 'On'], [0, 'Off']], prefs.sound ? 1 : 0)}</div>
    <div class="opt"><span>Music</span>${seg('music', [[1, 'On'], [0, 'Off']], prefs.music ? 1 : 0)}</div>
    <div class="row"><button class="b-red" id="optNew" ${midDrop ? 'disabled' : ''}>New Run</button><button class="b-gray" id="optMenu" ${midDrop ? 'disabled' : ''}>Main Menu</button><button class="b-orange" id="closeM">Back</button></div></div>`);
  modalEl.querySelectorAll('[data-sound]').forEach(b => b.addEventListener('click', () => { prefs.sound = b.dataset.sound === '1'; savePrefs(); showOptions(); }));
  modalEl.querySelectorAll('[data-music]').forEach(b => b.addEventListener('click', () => { prefs.music = b.dataset.music === '1'; savePrefs(); showOptions(); }));
  $('#optNew').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#optMenu').addEventListener('click', () => { SFX.button(); showTitle(); });
  $('#closeM').addEventListener('click', () => { SFX.button(); hideModal(); });
}
function showTitle() {
  clearOv(); hideTip();
  S.phase = 'title'; S.boss = null; S.relics = []; S.held = null; S.balls = []; S.target = 0; S.simTime = 0;
  S.world = { g: 1050, wind: 0, drag: 0, rest: 1 };
  S.slots = buildSlots();
  const showcase = ['bumper', 'x2', 'splitter', 'ring', 'cloner', 'bumper', 'spinner', 'lucky', 'gold', 'x3', 'prism', 'pad', 'bomb', 'warp', 'fountain', 'mega'];
  S.slots.forEach(s => (s.part = newPart('peg')));
  shuffle(S.slots.filter(s => s.row > 0 && s.row < 10)).slice(0, 22).forEach((s, i) => (s.part = newPart(showcase[i % showcase.length])));
  S.cups = BASE_CUP_MULTS.map((m, i) => ({ type: i === 4 ? 'megajack' : i === 2 || i === 6 ? 'jackpot' : 'cup', lvl: 1, flash: 0, count: 0, earned: 0 }));
  rebuildGrid();
  setBg('title');
  document.body.dataset.phase = 'title';
  showModal(`<div class="title">
    <div class="logo">${[...'PACHI PACHI'].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div>
    <div class="subt">REACH EDITION · every shot rides the rail · build the board · watch the number go up</div>
    <button class="b-blue big pulse" id="playGo">PLAY</button>
    <div class="bestline">Best round: <span class="c-gold">${best.round}</span> · Best ball: <span class="c-gold">${fmt(best.ball)}</span> · Runs: ${best.runs} · Wins: ${best.wins}</div>
  </div>`, true);
  $('#playGo').addEventListener('click', () => { audioInit(); SFX.buy(); BG.boost += 3; newRun(); });
}
$('#infoBtn').addEventListener('click', () => { if (S.phase !== 'title') showInfo(); });
$('#optBtn').addEventListener('click', showOptions);

/* ================= MAIN LOOP ================= */
let last = performance.now();
function frame(t) {
  const dt = Math.min(50, t - last); last = t;
  const running = S.phase === 'drop' || S.phase === 'title' || S.phase === 'cashout' || S.phase === 'over';
  if (running) {
    const simDt = (dt / 1000) * (S.phase === 'drop' ? prefs.speed : 1);
    const steps = Math.min(48, Math.round(simDt / STEP));
    for (let i = 0; i < steps; i++) { stepLauncher(STEP); physStep(STEP); }
    for (const b of S.balls) { b.trail.push([b.x, b.y]); if (b.trail.length > TRAIL_LEN) b.trail.shift(); }
  }
  if (S.shownScore !== S.score) {
    const diff = S.score - S.shownScore;
    S.shownScore += diff * Math.min(1, dt / 120);
    if (Math.abs(S.score - S.shownScore) < Math.max(1, S.score * 0.0005)) S.shownScore = S.score;
  }
  checkRoundEnd(dt / 1000);
  stepFx(dt);
  render(t);
  drawBg(dt);
  stepShake(dt);
  if (S.phase !== 'title') updateLeft();
  musicTick();
  requestAnimationFrame(frame);
}
fit();
renderSpeed();
document.fonts.load('20px "Jersey 10"').finally(() => {});
showTitle();
requestAnimationFrame(frame);
