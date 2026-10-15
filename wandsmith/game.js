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
  if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
  const a = Math.abs(n);
  if (a < 10000) return Math.floor(n).toLocaleString('en-US');
  let v = a, u = -1;
  while (v >= 1000 && u < UNITS.length - 1) { v /= 1000; u++; }
  if (v >= 1000) return n.toExponential(2).replace('e+', 'e');
  return (n < 0 ? '-' : '') + (v < 100 ? v.toFixed(2) : v.toFixed(1)).replace(/\.?0+$/, '') + UNITS[u];
}
function md(s) { return s.replace(/\[(\w|\$)\]([\s\S]*?)\[\/\]/g, (m, k, t) => `<span class="k-${k === '$' ? 'money' : k}">${t}</span>`); }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function weightedPick(entries) {
  const total = entries.reduce((a, e) => a + e[1], 0);
  let x = rnd() * total;
  for (const [v, w] of entries) { x -= w; if (x <= 0) return v; }
  return entries[entries.length - 1][0];
}
function compact(arr, keep) { let w = 0; for (let r = 0; r < arr.length; r++) if (keep(arr[r])) arr[w++] = arr[r]; arr.length = w; }

/* ================= CONSTANTS ================= */
// battle canvas: Art's native size, drawn into the 672x336 stage area; K scales layout tuned at 224px wide
const BW = Art.W, BH = Art.H, BX = 300, BY = 15, BS = 672 / BW, K = BW / 224;
const GROUND = Art.GROUND ?? 96, PLAYER_X = Math.round(34 * K);
const TURNS = 4, BAG_SIZE = 4, MAX_LVL = 5, MAX_HEARTS = 3;
const START_GOLD = 6, WIN_GOLD = 5, BOSS_GOLD = 10;
/* What survived the smashing: one gem and two sparks wired into a twig. */
const startWand = () => [newPart('power'), newPart('spark'), newPart('spark'), null];
const GROUP_GAP = 0.34, TRAVEL = 0.3, PAYLOAD_TRAVEL = 0.22;
const SAVE = 'wandsmith_v1';
const prefs = Object.assign({ speed: 1, sound: true, music: true, shake: true, particles: true, introSeen: false }, JSON.parse(localStorage.getItem(SAVE + '_prefs') || '{}'));
const best = Object.assign({ rung: 0, turn: 0, runs: 0, wins: 0, bosses: {} }, JSON.parse(localStorage.getItem(SAVE + '_best') || '{}'));
const savePrefs = () => localStorage.setItem(SAVE + '_prefs', JSON.stringify(prefs));
const saveBest = () => localStorage.setItem(SAVE + '_best', JSON.stringify(best));
const SPEEDS = [[0.5, '½x'], [1, '1x'], [2, '2x'], [4, '4x']];

const S = {
  phase: 'title', rung: 0, fightIdx: 0, hearts: MAX_HEARTS, gold: 4, frame: 'twig', extraSlots: 0,
  wand: [], bag: [], charms: [], charmSlots: 5, offers: [], rerollCost: 2, sel: null, slotPrice: 5,
  fight: null, anim: null, cashout: null, log: [], stats: { fights: 0, bestTurn: 0 }, endless: false,
};
window.__S = S;

const RUN_SAVE = SAVE + '_run';
const RUN_FIELDS = ['phase', 'rung', 'fightIdx', 'hearts', 'gold', 'frame', 'extraSlots', 'wand', 'bag', 'charms', 'charmSlots', 'offers', 'rerollCost', 'slotPrice', 'fight', 'cashout', 'log', 'stats', 'endless', 'bossSeen'];
const SAVED_PHASES = ['ready', 'fight', 'shop', 'cashout'];
function encodeRunValue(key, value) {
  return typeof value === 'number' && !Number.isFinite(value) ? { $number: String(value) } : value;
}
function decodeRunValue(key, value) {
  return value && typeof value === 'object' && typeof value.$number === 'string' ? Number(value.$number) : value;
}
function readSavedRun() {
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_SAVE) || 'null', decodeRunValue);
    if (!saved || saved.version !== 1 || !saved.state || !SAVED_PHASES.includes(saved.state.phase) || !Array.isArray(saved.state.wand) || !FRAMES[saved.state.frame]) return null;
    return saved.state;
  } catch (error) {
    console.warn('Could not read the saved Wandsmith run.', error);
    return null;
  }
}
function saveRun() {
  if (!SAVED_PHASES.includes(S.phase) && S.phase !== 'over') return;
  try {
    if (S.phase === 'over' || S.hearts <= 0) localStorage.removeItem(RUN_SAVE);
    else {
      const state = Object.fromEntries(RUN_FIELDS.map(field => [field, S[field]]));
      // Combat is already resolved before its animation. Preserve that result, not a fresh roll.
      state.anim = S.anim ? { ...S.anim, fired: [...S.anim.fired] } : null;
      localStorage.setItem(RUN_SAVE, JSON.stringify({ version: 1, state }, encodeRunValue));
    }
    setText('runSaveStatus', 'Run saved locally');
  } catch (error) {
    console.warn('Could not save the Wandsmith run.', error);
    setText('runSaveStatus', 'Run could not be saved');
  }
}
function restoreRun() {
  const saved = readSavedRun();
  if (!saved) return false;
  Object.assign(S, saved, { sel: null });
  if (S.anim) S.anim.fired = new Set(S.anim.fired);
  hideModal(); clearOv(); hideTip();
  if (S.phase === 'ready' && !S.fight) { startFight(); return true; }
  setBg(S.phase === 'shop' ? 'shop' : rungInfo().loc);
  renderAll();
  if (S.phase === 'cashout') showCashout(S.cashout.rows, S.cashout.won);
  else if (S.phase === 'fight' && !S.anim) {
    if (S.fight.turn >= S.fight.turns) loseFight();
    else beginTurn();
  }
  return true;
}
addEventListener('pagehide', saveRun);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRun(); });

/* ================= AUDIO ================= */
let AC = null, master = null, musicBus = null;
const music = { next: 0, step: 0 };
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = 0.45; master.connect(AC.destination);
  musicBus = AC.createGain(); musicBus.gain.value = 0.12;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
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
const CAST_PITCH = { spark: 84, missile: 76, frost: 88, chain: 91, fireball: 60, orb: 79, starfall: 93, coin: 96, trigger: 81, twintrigger: 86, bomb: 52 };
const SFX = {
  cast(k, depth) {
    if (!throttled('cast', 0.03)) return;
    const m = (CAST_PITCH[k] || 80) + depth * 2;
    if (k === 'fireball' || k === 'bomb') { noise(0.25, 0.25, 500, { type: 'lowpass' }); osc(mtof(m), 0.25, 'sawtooth', 0.05, { slide: mtof(m - 12) }); return; }
    osc(mtof(m), 0.12, 'square', 0.035, { slide: mtof(m + 7) }); osc(mtof(m + 12), 0.08, 'sine', 0.04);
  },
  hit(n) { if (!throttled('hit', 0.035)) return; const m = 64 + PENTA[n % 5] + 12 * Math.floor((n % 15) / 5); osc(mtof(m), 0.1, 'triangle', 0.1); noise(0.05, 0.12, 2400); },
  boom() { if (!throttled('boom', 0.08)) return; osc(90, 0.5, 'sine', 0.4, { slide: 30 }); noise(0.45, 0.3, 400, { type: 'lowpass' }); },
  crit() { if (!throttled('crit', 0.08)) return; [1319, 1760, 2093].forEach((f, i) => osc(f, 0.12, 'square', 0.04, { delay: i * 0.03 })); },
  ko() { if (!throttled('ko', 0.1)) return; osc(600, 0.35, 'square', 0.06, { slide: 120 }); [784, 988].forEach((f, i) => osc(f, 0.2, 'triangle', 0.08, { delay: 0.15 + i * 0.06 })); },
  coin() { if (!throttled('coin', 0.05)) return; osc(1568, 0.07, 'square', 0.04); osc(2093, 0.18, 'square', 0.04, { delay: 0.06 }); },
  blocked() { if (!throttled('blk', 0.08)) return; osc(220, 0.08, 'square', 0.06); noise(0.06, 0.15, 900); },
  enemyAtk() { osc(160, 0.15, 'sawtooth', 0.07, { slide: 80 }); noise(0.1, 0.2, 600); },
  hurt() { osc(300, 0.4, 'sawtooth', 0.12, { slide: 70 }); noise(0.3, 0.25, 500); },
  button() { osc(420, 0.06, 'square', 0.06); noise(0.03, 0.12, 2200); },
  buy() { [523, 659, 784, 1047].forEach((f, i) => osc(f, 0.14, 'triangle', 0.12, { delay: i * 0.05 })); },
  level() { [659, 784, 988, 1319].forEach((f, i) => osc(f, 0.16, 'square', 0.06, { delay: i * 0.05 })); },
  nope() { osc(200, 0.12, 'square', 0.08, { slide: 120 }); },
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => osc(f, 0.35, 'triangle', 0.13, { delay: i * 0.07 })); },
  lose() { [392, 330, 262, 196, 147].forEach((f, i) => osc(f, 0.5, 'sawtooth', 0.07, { delay: i * 0.2 })); },
  phase() { osc(70, 1.2, 'sawtooth', 0.2, { slide: 140 }); [262, 311, 392].forEach((f, i) => osc(f, 0.5, 'square', 0.06, { delay: i * 0.1 })); },
  talk() { if (!throttled('talk', 0.05)) return; osc(500 + rnd() * 300, 0.04, 'square', 0.025); },
};
/* Mafia lounge loop: walking bass under minor-seventh stabs; tempo rises during fights. */
const PROG = [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 61, 64, 67]];
function musicTick() {
  if (!AC || !prefs.music || S.phase === 'cine') return;
  if (music.next < AC.currentTime) music.next = AC.currentTime + 0.05;
  const hot = S.phase === 'fight';
  while (music.next < AC.currentTime + 0.25) {
    const t = music.next, st = music.step, bar = Math.floor(st / 8) % 4, s = st % 8;
    const ch = PROG[bar];
    if (s % 2 === 0) osc(mtof(ch[[0, 2, 1, 3][s / 2]] - 24), 0.3, 'triangle', 0.45, { bus: musicBus, at: t });
    if (s === 1 || s === 5) ch.slice(1).forEach(m => osc(mtof(m), 0.14, 'square', 0.035, { bus: musicBus, at: t }));
    if (hot && s % 2 === 1) osc(mtof(ch[(st >> 1) % 4] + 12), 0.08, 'triangle', 0.05, { bus: musicBus, at: t });
    noise(0.03, s % 2 ? 0.02 : 0.035, 7000);
    music.next += (s % 2 ? 0.1 : 0.16) * (hot ? 0.8 : 1); music.step++;
  }
}

/* ================= BACKGROUND SHADER ================= */
const bgCanvas = $('#bg');
const gl = bgCanvas.getContext('webgl');
const BG = { cur: [hexRgb('#ff5fd2'), hexRgb('#6a3aa8'), hexRgb('#140c22')], tgt: null, t: 0, spin: 0, boost: 0 };
BG.tgt = BG.cur.map(c => c.slice());
const BG_THEMES = {
  title: ['#ff5fd2', '#6a3aa8', '#140c22'], shop: ['#ffb84a', '#8a3a6a', '#1a0c18'], lose: ['#9a2020', '#3f1010', '#120606'],
  alley: ['#7a6aa8', '#3a2a5a', '#120c1e'], docks: ['#3a8ac8', '#1a3a6a', '#081420'], casino: ['#ff3f6a', '#8a1a3a', '#1a0610'],
  sewers: ['#5a9a4a', '#2a4a2a', '#0a140a'], vault: ['#ffcf4a', '#8a6a1a', '#1a1408'], opera: ['#b48cff', '#4a2a8a', '#100822'],
  mansion: ['#6a6aa8', '#2a2a4a', '#08080e'], tower: ['#ff3f5a', '#5a0a2a', '#0e0208'],
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
function setBg(theme) { BG.tgt = (Array.isArray(theme) ? theme : BG_THEMES[theme] || BG_THEMES.title).map(hexRgb); }
function drawBg(dt) {
  if (!gl) return;
  BG.boost *= Math.pow(0.97, dt / 16.7);
  BG.t += dt * 0.001 * (0.4 + BG.boost * 0.5);
  BG.spin += dt * 0.001 * (0.5 + BG.boost * 2);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) BG.cur[i][k] += (BG.tgt[i][k] - BG.cur[i][k]) * 0.03;
  gl.uniform2f(glU.R, bgCanvas.width, bgCanvas.height);
  gl.uniform1f(glU.TT, BG.t); gl.uniform1f(glU.SPN, BG.spin);
  gl.uniform3fv(glU.C1, BG.cur[0]); gl.uniform3fv(glU.C2, BG.cur[1]); gl.uniform3fv(glU.C3, BG.cur[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ================= STAGE ================= */
const stageEl = $('#stage');
const shakeEl = $('#shake');
const mobileUIEl = $('#mobileUI');
const battleViewportEl = $('#battleViewport');
const MOBILE_BATTLE_PADDING = 12;
const MOBILE_BATTLE_MAX_WIDTH = 736;
const BATTLE_FRAME = { left: 297, top: 12, width: 678, height: 342 };
let scale = 1;
// Below 900px #left/#wandPanel/#right/#modal/#ov/#tip move out of the uniformly-scaled stage into
// #mobileUI (plain document flow). Battle/fx canvases and cinematics stay put, so BX/BY/BS/toStage
// and the rest of the stage-space math never need to change.
const mq = matchMedia('(max-width:899.98px)');
const MOBILE_REFLOW_IDS = ['left', 'wandPanel', 'right', 'modal', 'ov', 'tip'];
function applyLayout() {
  const target = mq.matches ? mobileUIEl : shakeEl;
  for (const id of MOBILE_REFLOW_IDS) { const el = document.getElementById(id); if (el && el.parentNode !== target) target.appendChild(el); }
  const cinemaRoot = document.querySelector('.cinema-root');
  if (cinemaRoot) (mq.matches ? document.body : stageEl).appendChild(cinemaRoot);
  fit();
}
mq.addEventListener('change', applyLayout);
function fit() {
  const w = innerWidth, h = innerHeight, mob = mq.matches;
  // Crop only the battle frame on phones, keeping the canvas and its effects in stage coordinates.
  scale = mob
    ? Math.min(Math.min(w - MOBILE_BATTLE_PADDING * 2, MOBILE_BATTLE_MAX_WIDTH) / BATTLE_FRAME.width, (h - MOBILE_BATTLE_PADDING * 2) / BATTLE_FRAME.height)
    : Math.min(w / 1280, h / 720);
  const tx = mob ? (w - BATTLE_FRAME.width * scale) / 2 - BATTLE_FRAME.left * scale : (w - 1280 * scale) / 2;
  const ty = mob ? MOBILE_BATTLE_PADDING - BATTLE_FRAME.top * scale : (h - 720 * scale) / 2;
  stageEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  battleViewportEl.style.height = mob ? Math.ceil(BATTLE_FRAME.height * scale + MOBILE_BATTLE_PADDING * 2) + 'px' : '';
  bgCanvas.width = Math.ceil(w / 2); bgCanvas.height = Math.ceil(h / 2);
  if (gl) gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
}
addEventListener('resize', fit);
addEventListener('scroll', () => { if (!mq.matches) scrollTo(0, 0); });
function elCenter(el) {
  const r = el.getBoundingClientRect();
  if (mq.matches) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; // reparented: plain viewport px, matches #tip's fixed positioning
  const s = stageEl.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale };
}
let shakeAmt = 0;
function shake(a) { if (prefs.shake) shakeAmt = Math.max(shakeAmt, a); }
function stepShake(dt) {
  if (shakeAmt < 0.2) { if (shakeAmt) { shakeEl.style.transform = ''; shakeAmt = 0; } return; }
  shakeEl.style.transform = `translate(${(rnd() - 0.5) * shakeAmt * 2}px,${(rnd() - 0.5) * shakeAmt * 2}px) rotate(${(rnd() - 0.5) * shakeAmt * 0.1}deg)`;
  shakeAmt *= Math.pow(0.88, dt / 16.67);
}
function banner(text, color = '#fff', sub = '') {
  $('#banner').innerHTML = `<div class="bt" style="color:${color}">${[...text].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
}
function bumpEl(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/* ================= FULL-RES FX (particles, pops, projectile labels) ================= */
const fcv = $('#fx'), fctx = fcv.getContext('2d');
const parts = [], pops = [];
const toStage = (x, y) => ({ x: BX + x * BS, y: BY + y * BS });
function burst(x, y, n, colors, spd = 4, opts = {}) {
  if (!prefs.particles) return;
  if (parts.length > 900) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, v = spd * (0.3 + rnd());
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 1), life: 1, decay: 0.02 + rnd() * 0.03, size: (opts.size || 3) + rnd() * 3, col: pick(colors), g: opts.g ?? 0.15 });
  }
}
function confetti(n = 120) {
  if (!prefs.particles) return;
  const cols = ['#ff5fd2', '#3f9bff', '#ffcf4a', '#5fd39a', '#b48cff', '#fff'];
  for (let i = 0; i < n; i++) parts.push({ x: 300 + rnd() * 672, y: -20 - rnd() * 200, vx: (rnd() - 0.5) * 3, vy: 2 + rnd() * 4, life: 1, decay: 0.004 + rnd() * 0.004, size: 5 + rnd() * 5, col: pick(cols), g: 0.05 });
}
function pop(x, y, text, col = '#fff', size = 18, bg = null) {
  if (pops.length > 70) { if (size < 22) return; pops.shift(); }
  pops.push({ x, y, text, col, size, bg, life: 1, vy: -40 - rnd() * 20 });
}
function popBattle(x, y, text, col, size, bg) { const p = toStage(x, y); pop(clamp(p.x, BX + 30, BX + 642), clamp(p.y, BY + 14, BY + 320), text, col, size, bg); }
function stepFx(dt) {
  const k = dt / 16.67;
  for (const p of parts) { p.vx *= 0.97; p.vy = p.vy * 0.97 + p.g * k; p.x += p.vx * k; p.y += p.vy * k; p.life -= p.decay * k; }
  compact(parts, p => p.life > 0 && p.y <= 760);
  for (const p of pops) { p.life -= dt / 1000 / 1.0; p.y += p.vy * dt / 1000; p.vy *= 0.94; }
  compact(pops, p => p.life > 0);
}
function setFont(g, f) { if (g.__font !== f) { g.__font = f; g.font = f; } }
function drawText(g, text, x, y, size, col, stroke = 4) {
  setFont(g, `${size}px "Jersey 10", monospace`);
  g.lineWidth = stroke; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, x, y);
  g.fillStyle = col; g.fillText(text, x, y);
}
function drawFx() {
  const g = fctx;
  g.clearRect(0, 0, 1280, 720);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  drawBattleLabels(g);
  for (const p of parts) {
    g.globalAlpha = Math.min(1, p.life * 2);
    g.fillStyle = p.col;
    g.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.round(p.size), Math.round(p.size));
  }
  g.globalAlpha = 1;
  for (const p of pops) {
    const age = 1 - p.life, sc = age < 0.15 ? 0.4 + (age / 0.15) * 0.9 : age < 0.3 ? 1.3 - ((age - 0.15) / 0.15) * 0.3 : 1;
    g.globalAlpha = Math.min(1, p.life * 3);
    const px = Math.max(8, Math.round((p.size * sc) / 2) * 2);
    if (p.w0 === undefined) { setFont(g, `${p.size}px "Jersey 10", monospace`); p.w0 = g.measureText(p.text).width; }
    if (p.bg) {
      setFont(g, `${px}px "Jersey 10", monospace`);
      const w = (p.w0 * px) / p.size + 12, hh = px + 4;
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(p.x - w / 2, p.y - hh / 2 + 3, w, hh);
      g.fillStyle = p.bg; g.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
      g.fillStyle = '#fff'; g.fillText(p.text, p.x, p.y + 1);
    } else drawText(g, p.text, p.x, p.y, px, p.col);
  }
  g.globalAlpha = 1;
}

/* ================= WAND MODEL =================
   S.wand holds one entry per slot ({k, lvl} or null). Parts are read left to right each turn:
   modifiers stack onto the next projectile, a trigger projectile casts the following group on
   every hit (nesting), and an Echo rune re-casts the previous group. */
const newPart = (k, lvl = 1) => ({ k, lvl, id: Math.random().toString(36).slice(2) });
const charmN = k => (charmsSilenced() ? 0 : S.charms.filter(c => c === k).length);
const charmOn = k => charmN(k) > 0;
const bossRule = () => (S.fight && S.fight.rule) || null;
const charmsSilenced = () => bossRule() === 'velvet';
function slotCount() { return Math.min(MAX_SLOTS, FRAMES[S.frame].slots + S.extraSlots + S.charms.filter(c => c === 'tape').length); }
function maxHearts() { return Math.max(1, MAX_HEARTS - S.charms.filter(c => c === 'glass').length); }
function syncWandSize() {
  const n = slotCount();
  if (n !== S.wand.length) S.sel = null;   // a pending swap selection may point at a slot that no longer exists
  while (S.wand.length < n) S.wand.push(null);
  while (S.wand.length > n) { const p = S.wand.pop(); if (p) stash(p); }
}
/* Parts that cannot fit anywhere are sold automatically so nothing is lost silently. */
function stash(p) {
  if (S.bag.length < BAG_SIZE) { S.bag.push(p); return true; }
  S.gold += sellValue(p);
  logLine(`No room: sold ${PARTS[p.k].n} for $${sellValue(p)}`);
  return false;
}
/* Which slots fire this turn: boss rules can switch slots off. */
function slotState(i) {
  const f = S.fight;
  if (!f) return null;
  if (f.rule === 'lou' && i < 3) return 'AUDIT';
  if (f.stolen && f.stolen.includes(i)) return 'STOLEN';
  // before the first turn, show which part Pip is about to take
  if (f.rule === 'pip' && f.turn === 0 && !f.stolen.length && i === pipTarget()) return 'STOLEN';
  return null;
}
function pipTarget() { for (let i = S.wand.length - 1; i >= 0; i--) if (S.wand[i]) return i; return -1; }
function activeEntries() {
  const out = [];
  S.wand.forEach((p, i) => { if (p && !slotState(i)) out.push({ ...p, slot: i }); });
  return out;
}
function parseGroup(list, i, nested) {
  const mods = [];
  while (i < list.length) {
    const e = list[i], P = PARTS[e.k];
    if (P.kind === 'mod') { mods.push(e); i++; continue; }
    if (P.kind === 'special') {
      if (mods.length || nested) return [{ fizzle: mods.length ? mods : [e], reason: nested ? 'echo cannot be triggered' : 'no projectile after it' }, mods.length ? i : i + 1];
      return [{ echo: e }, i + 1];
    }
    const g = { mods, proj: e, payload: null };
    i++;
    const trig = groupTrig(g);
    if (trig > 0 && i < list.length) { const [pl, ni] = parseGroup(list, i, true); g.payload = pl && !pl.fizzle ? pl : null; if (pl && pl.fizzle) g.payloadFizzle = pl; i = ni; }
    return [g, i];
  }
  return [mods.length ? { fizzle: mods, reason: 'no projectile after it' } : null, i];
}
function groupTrig(g) {
  let t = PARTS[g.proj.k].trigger || 0;
  for (const m of g.mods) if (PARTS[m.k].trig) t += PARTS[m.k].trig + (m.lvl - 1);
  if (t > 0) t += charmN('rubber');
  return t;
}
function parseWand(list) {
  const groups = [];
  let i = 0;
  while (i < list.length) { const [g, ni] = parseGroup(list, i, false); if (g) groups.push(g); i = ni; }
  return groups;
}

function appendWandGroup(model, group, parent = null) {
  const entries = group.fizzle || (group.echo ? [group.echo] : [...group.mods, group.proj]);
  const node = { id: model.groups.length, group, slots: entries.map(entry => entry.slot), parent, payload: null, target: null };
  model.groups.push(node);
  if (group.proj) {
    for (const modifier of group.mods) model.links.push({ from: modifier.slot, to: group.proj.slot });
    if (parent) for (const slot of node.slots) model.links.push({ from: parent.group.proj.slot, to: slot });
    if (group.payload || group.payloadFizzle) node.payload = appendWandGroup(model, group.payload || group.payloadFizzle, group.payload ? node : null);
  }
  return node;
}
function wandRelationships() {
  const model = { groups: [], links: [] };
  let previous = null;
  for (const group of parseWand(activeEntries())) {
    const node = appendWandGroup(model, group);
    if (group.echo && previous) {
      node.target = previous;
      const slots = wandPayloadSlots(previous);
      for (const slot of slots) model.links.push({ from: group.echo.slot, to: slot });
    } else if (group.proj) previous = node;
  }
  return model;
}
function wandPayloadSlots(node) {
  return node.payload && !node.payload.group.fizzle ? [...node.slots, ...wandPayloadSlots(node.payload)] : node.slots;
}
function relatedWandSlots(model, slots, reverse = false) {
  const related = new Set(slots), pending = [...slots];
  while (pending.length) {
    const slot = pending.pop();
    for (const link of model.links) {
      const source = reverse ? link.to : link.from, target = reverse ? link.from : link.to;
      if (source === slot && !related.has(target)) { related.add(target); pending.push(target); }
    }
  }
  for (const slot of slots) related.delete(slot);
  return related;
}
function wandGroupLabel(node) {
  if (node.group.fizzle) return `G${node.id + 1} · fizzle`;
  if (node.group.echo) return `G${node.id + 1}${node.target ? ` ↻ G${node.target.id + 1}` : ' · fizzle'}`;
  return `G${node.id + 1}${node.parent ? ` ↳ G${node.parent.id + 1}` : ' · cast'}`;
}
function groupedSlotsHtml(model) {
  const membership = Array(S.wand.length).fill(null);
  for (const node of model.groups) for (let slot = Math.min(...node.slots); slot <= Math.max(...node.slots); slot++) membership[slot] = node;
  let html = '', slot = 0;
  while (slot < S.wand.length) {
    const node = membership[slot], start = slot;
    do { slot++; } while (slot < S.wand.length && node && membership[slot] === node);
    const cards = S.wand.slice(start, slot).map((part, index) => slotHtml(part, 'wand', start + index)).join('');
    html += node ? `<div class="wandGroup ${node.group.fizzle ? 'fizzle' : ''}" data-group="${node.id}" style="--group-size:${slot - start}"><span class="groupLabel" tabindex="0" title="${wandGroupLabel(node)}" aria-label="${wandGroupLabel(node)}">${wandGroupLabel(node)}</span><div class="groupCards">${cards}</div></div>` : `<div class="wandLoose" style="--group-size:1">${cards}</div>`;
  }
  return html;
}
function clearWandRelationships() {
  $('#wandPanel').classList.remove('relating');
  $('#wandPanel').querySelectorAll('.rel-focus,.rel-in,.rel-out').forEach(element => element.classList.remove('rel-focus', 'rel-in', 'rel-out'));
  setText('relationshipText', 'Tap or hover a card or group to trace its relationships');
}
function highlightWandRelationships(model, node, slot = null) {
  clearWandRelationships();
  const subjects = slot !== null ? [slot] : [node.group.proj ? node.group.proj.slot : node.slots[0]];
  const incoming = relatedWandSlots(model, subjects, true), outgoing = relatedWandSlots(model, subjects);
  $('#wandPanel').classList.add('relating');
  for (const card of $('#slots').querySelectorAll('.slot')) {
    const index = +card.dataset.i;
    const role = subjects.includes(index) ? 'rel-focus' : outgoing.has(index) ? 'rel-out' : incoming.has(index) ? 'rel-in' : null;
    if (role) card.classList.add(role);
  }
  for (const group of model.groups) {
    const role = group === node ? 'rel-focus' : group.slots.some(index => outgoing.has(index)) ? 'rel-out' : group.slots.some(index => incoming.has(index)) ? 'rel-in' : null;
    if (role) $('#wandPanel').querySelectorAll(`[data-group="${group.id}"]`).forEach(element => element.classList.add(role));
  }
  const subject = slot !== null ? PARTS[S.wand[slot].k].n : `G${node.id + 1}`;
  const sources = [...incoming].sort((left, right) => left - right).map(index => `slot ${index + 1}`).join(', ');
  const targets = [...new Set(model.groups.filter(group => group.slots.some(index => outgoing.has(index))).map(group => `G${group.id + 1}`))].join(', ');
  setText('relationshipText', `${subject}${sources ? ` ← ${sources}` : ''}${targets ? ` → ${targets}` : ''}${!sources && !targets ? ' · no card links' : ''}${node.group.fizzle ? ' · fizzles' : ''}`);
}
function bindWandRelationships(model) {
  for (const element of $('#slots').querySelectorAll('.wandGroup')) {
    const node = model.groups[+element.dataset.group];
    element.addEventListener('mouseenter', () => highlightWandRelationships(model, node));
    element.addEventListener('mouseleave', clearWandRelationships);
    element.querySelector('.groupLabel').addEventListener('focus', () => highlightWandRelationships(model, node));
    element.querySelector('.groupLabel').addEventListener('blur', clearWandRelationships);
    for (const card of element.querySelectorAll('.slot.full:not(.off)')) {
      const slot = +card.dataset.i;
      card.addEventListener('mouseenter', () => highlightWandRelationships(model, node, slot));
      card.addEventListener('mouseleave', event => { if (event.relatedTarget && element.contains(event.relatedTarget)) highlightWandRelationships(model, node); });
      card.addEventListener('focus', () => highlightWandRelationships(model, node, slot));
      card.addEventListener('blur', clearWandRelationships);
    }
  }
}
/* Per-projectile numbers for one group. Target-dependent multipliers (freeze, grudge, boss rules) are applied on hit. */
function groupStats(g, depth, turnIdx) {
  const P = PARTS[g.proj.k], L = g.proj.lvl;
  let add = 0, mul = 1, count = 1, crit = 0;
  for (const m of g.mods) {
    const M = PARTS[m.k], l = m.lvl;
    // levels compound: flat damage doubles per level, multipliers are raised to the level
    if (M.add) add += M.add * Math.pow(2, l - 1);
    if (M.mul) mul *= m.k === 'prism' ? M.mul : Math.pow(M.mul, l);
    if (M.count) count *= M.count + (l - 1) + charmN('splitter2');
    if (M.crit) crit += M.crit * l;
  }
  const sparks = S.wand.filter(p => p && p.k === 'spark').length;
  add += 2 * sparks * charmN('sparky');
  mul *= Math.pow(3, charmN('glass'));
  if (S.frame === 'crystal') mul *= 2;
  if (depth > 0 && S.frame === 'bone') mul *= 1.5;
  if (depth > 0) mul *= Math.pow(Math.pow(2, depth), charmN('nesting'));
  if (P.hit === 'aoe') mul *= Math.pow(3, charmN('pyro'));
  mul *= Math.pow(1.5, turnIdx * charmN('snowball'));
  const distinct = new Set(S.wand.filter(Boolean).map(p => p.k)).size;
  mul *= Math.pow(1.2, distinct * charmN('patchwork'));
  crit += 0.2 * charmN('cat');
  if (P.hit === 'rain') count *= 5;
  return { dmg: (P.dmg * Math.pow(2, L - 1) + add) * mul, count, crit: Math.min(1, crit), trig: groupTrig(g), hit: P.hit, part: g.proj.k, slot: g.proj.slot };
}

/* ================= TURN RESOLUTION =================
   One wand fire is resolved instantly into a timed list of events (used for animation, the
   preview estimate and the balance bot alike). Counts can be astronomically large, so hits are
   handled in aggregate: a group of n identical projectiles is allocated across enemies at once. */
function bruteThreshold(f) { return f.maxHp * 0.01; }
function foeRule(f) { return f.phaseRule || f.rule || null; }
function effDamage(f, perHit, foes) {
  let d = perHit;
  if (f.frozen) d *= 2;
  if (f.boss) d *= Math.pow(2, charmN('grudge'));
  const r = foeRule(f);
  if (r === 'twins' && foes.some(o => o !== f && o.twin && o.hp > 0)) d *= 0.5;
  if (r === 'bruno' && d < bruteThreshold(f)) d = 0;
  return d;
}
function damageFoe(f, amount, rec) {
  if (amount <= 0) return;
  f.hp -= amount; rec.dmg += amount;
  while (f.hp <= 0 && f.phases && f.phase < f.phases.length - 1) {
    f.phase++; f.hp = f.maxHp; f.phaseRule = f.phases[f.phase]; rec.phase = f.phase; f.ward = f.phaseRule === 'grimsby' ? 30 : 0;
  }
  if (f.hp <= 0) { f.hp = 0; rec.kill = true; }
}
function resolveTurn(foes, turnIdx, opts = {}) {
  const list = opts.list || activeEntries();
  const groups = parseWand(list);
  const events = [], jobs = [];
  const ctx = { hits: 0, total: 0, gold: 0, kills: 0 };
  for (const f of foes) f.ward = foeRule(f) === 'grimsby' ? 30 : 0;
  const fires = turnIdx === 0 && !opts.estimate && charmOn('overclock') ? 2 : 1;
  let t = 0, prev = null;
  for (let r = 0; r < fires; r++) {
    groups.forEach((g, gi) => {
      if (g.fizzle) return;
      if (g.echo) { if (prev) for (let k = 0; k < g.echo.lvl; k++) { jobs.push({ g: prev, mult: 1, depth: 0, t, src: null, echo: true }); t += GROUP_GAP * 0.6; } return; }
      const reps = gi === 0 && charmOn('mirror') ? 2 : 1;
      for (let k = 0; k < reps; k++) { jobs.push({ g, mult: 1, depth: 0, t, src: null }); t += GROUP_GAP; }
      prev = g;
    });
  }
  while (jobs.length) {
    let bi = 0;
    for (let i = 1; i < jobs.length; i++) if (jobs[i].t < jobs[bi].t) bi = i;
    const job = jobs.splice(bi, 1)[0];
    const ev = castGroup(job, foes, turnIdx, ctx);
    events.push(ev);
    if (ev.payloadJob) jobs.push(ev.payloadJob);
  }
  return { events, total: ctx.total, gold: ctx.gold, kills: ctx.kills, hits: ctx.hits, duration: events.reduce((a, e) => Math.max(a, e.t + e.travel), 0) };
}
function castGroup(job, foes, turnIdx, ctx) {
  const st = groupStats(job.g, job.depth, turnIdx);
  const n = st.count * job.mult;
  const ev = { t: job.t, travel: job.depth ? PAYLOAD_TRAVEL : TRAVEL, part: st.part, slot: st.slot, depth: job.depth, src: job.src, count: n, perHit: st.dmg, recs: [], total: 0, crit: false, blocked: 0, echo: !!job.echo };
  const alive = foes.filter(f => f.hp > 0);
  if (!alive.length || n <= 0) return ev;
  // crits: roll individually for small volleys, use the expected share for huge ones
  let critShare;
  if (n <= 30) { let c = 0; for (let i = 0; i < n; i++) if (rnd() < st.crit) c++; critShare = c / n; }
  else critShare = st.crit;
  ev.crit = critShare > 0;
  let perHit = st.dmg * (1 + 3 * critShare);
  const recFor = f => { let r = ev.recs.find(x => x.f === f); if (!r) { r = { f, i: foes.indexOf(f), hits: 0, dmg: 0 }; ev.recs.push(r); } return r; };
  const hitWith = (f, hits) => {
    if (hits <= 0 || f.hp <= 0) return 0;
    if (f.ward > 0) { const b = Math.min(f.ward, hits); f.ward -= b; hits -= b; ev.blocked += b; }
    if (hits <= 0) return 0;
    const combo = 1 + 0.02 * charmN('combo') * (ctx.hits + hits / 2);
    ctx.hits += hits;
    const rec = recFor(f);
    rec.hits += hits;
    const d = effDamage(f, perHit * combo, foes);
    damageFoe(f, d * hits, rec);
    return hits;
  };
  let landed = 0;
  if (st.hit === 'aoe') for (const f of alive) landed += hitWith(f, n);
  else if (st.hit === 'chain') for (const f of alive.slice(0, 3)) landed += hitWith(f, n);
  else if (st.hit === 'rain') {
    // spread the stars evenly; the remainder lands on random enemies so the hit count is exact
    const base = Math.floor(n / alive.length);
    let extra = Math.round(n - base * alive.length);
    for (const f of shuffle(alive.slice())) { landed += hitWith(f, base + (extra > 0 ? 1 : 0)); extra--; }
  } else {
    // single target (bounce = 2 hits each): projectiles retarget the next enemy once the front one drops
    let remaining = st.hit === 'bounce' ? n * 2 : n;
    if (charmOn('overkill')) {
      for (const f of alive) {
        if (remaining <= 0) break;
        if (f.hp <= 0) continue;
        const d = effDamage(f, perHit, foes);
        const need = d > 0 ? f.hp / d : Infinity;
        const use = Math.min(remaining, need);
        landed += hitWith(f, use); remaining -= use;
      }
    } else {
      for (const f of alive) {
        if (remaining <= 0) break;
        while (f.hp > 0 && remaining > 0) {
          const d = effDamage(f, perHit, foes);
          const need = d > 0 ? Math.ceil(f.hp / d) : remaining;
          const use = Math.min(remaining, Math.max(1, need));
          landed += hitWith(f, use); remaining -= use;
          if (d <= 0) break;
        }
      }
    }
  }
  // freezing marks every target hit for the next group; this group consumes any freeze on its targets
  for (const r of ev.recs) { if (st.part === 'frost') r.f.frozen = true; else if (r.f.frozen && r.hits > 0) r.f.frozen = false; }
  for (const r of ev.recs) { ev.total += r.dmg; if (r.kill) ctx.kills++; }
  ctx.total += ev.total;
  if (PARTS[st.part].gold) ctx.gold += landed / 5;
  for (const r of ev.recs) { r.hpAfter = r.f.hp; r.phaseAfter = r.f.phase || 0; }
  if (job.g.payload && st.trig > 0 && landed > 0) {
    const tgt = ev.recs[0] ? ev.recs[0].f : alive[0];
    ev.payloadJob = { g: job.g.payload, mult: landed * st.trig, depth: job.depth + 1, t: job.t + ev.travel, src: { foe: foes.indexOf(tgt) } };
  }
  return ev;
}
/* Preview: one regular turn against a single training dummy that never dies. During a boss fight
   setup the boss's slot rules apply, so rearranging in the ready phase shows the real effect. */
function estimateTurn() {
  const f = S.fight && S.fight.foes.find(o => o.hp > 0);
  // the dummy carries the upcoming enemy's rule and health so thresholds, wards and Grudge show up
  const dummy = [{ hp: Infinity, maxHp: f ? f.maxHp : Infinity, key: 'dummy', boss: f ? f.boss : false, rule: f ? f.rule : null, phaseRule: f ? f.phaseRule : null }];
  return resolveTurn(dummy, 0, { estimate: true, list: activeEntries() });
}

/* ================= FIGHTS ================= */
const fightNumber = () => S.rung * 3 + S.fightIdx;
/* Enemy health budget per fight. Calibrated with a greedy scripted shopper that buys whatever most
   raises its damage estimate: it wins about 1 run in 6, so deliberate synergy building is needed. */
function hpBudget(n) { return 24 * Math.pow(1.56, n); }
/* Boss health relative to the budget, offsetting how much each boss rule blunts a typical wand. */
const BOSS_HP = { pip: 0.4, twins: 0.5, fin: 0.9, bruno: 1.0, lou: 0.5, velvet: 0.4, grimsby: 0.3, don: 0.6 };
const endlessMul = () => (S.endless ? Math.pow(3, S.rung - RUNGS.length + 1) : 1);
function fightHp() { return hpBudget(fightNumber()) * endlessMul() * (S.fightIdx === 2 ? BOSS_HP[rungInfo().boss] * (rungInfo().boss === 'twins' ? 2 : rungInfo().boss === 'don' ? 3 : 1) : 1); }
function rungInfo() { return RUNGS[S.rung % RUNGS.length]; }
function makeFoes() {
  const R = rungInfo(), H = hpBudget(fightNumber()) * endlessMul();
  const foes = [];
  if (S.fightIdx === 2) {
    const B = R.boss;
    if (B === 'twins') {
      for (const k of BOSSES.twins.parts) foes.push({ key: k, name: k === 'hex' ? 'Hex' : 'Vex', hp: H * BOSS_HP.twins, maxHp: H * BOSS_HP.twins, boss: true, twin: true, rule: 'twins' });
    } else if (B === 'don') {
      foes.push({ key: 'don', name: BOSSES.don.n, hp: H * BOSS_HP.don, maxHp: H * BOSS_HP.don, boss: true, rule: 'don', phases: DON_PHASES, phase: 0, phaseRule: DON_PHASES[0] });
    } else foes.push({ key: B, name: BOSSES[B].n, hp: H * BOSS_HP[B], maxHp: H * BOSS_HP[B], boss: true, rule: B });
  } else {
    const count = clamp(1 + Math.floor(rnd() * Math.min(3, 1 + S.rung * 0.6 + S.fightIdx)), 1, 4);
    const keys = Array.from({ length: count }, () => pick(R.goons));
    const totalMul = keys.reduce((a, k) => a + ENEMIES[k].hpMul, 0);
    for (const k of keys) { const hp = (H * ENEMIES[k].hpMul) / totalMul; foes.push({ key: k, name: ENEMIES[k].n, hp, maxHp: hp }); }
  }
  layoutFoes(foes);
  return foes;
}
function layoutFoes(foes) {
  const n = foes.length;
  foes.forEach((f, i) => {
    const sz = Art.enemySize(f.key);
    f.x = Math.round(K * (f.boss ? (n === 1 ? 168 : 146 + i * 46) : 118 + i * (n > 3 ? 27 : 34)));
    f.w = sz.w; f.h = sz.h;
  });
}
function fightRule() {
  if (S.fightIdx !== 2) return null;
  const B = rungInfo().boss;
  return B;
}
function ruleText(rule, foe) {
  if (!rule) return '';
  if (rule === 'bruno' && foe) return `Thick Skin: ignores every hit under ${fmt(bruteThreshold(foe))} damage`;
  if (rule === 'don' && foe) return `Kingpin phase ${foe.phase + 1}/3 · ${ruleText(foe.phaseRule, foe)}`;
  return BOSSES[rule].rule;
}
function startFight() {
  S.phase = 'ready';
  S.cashout = null;
  S.sel = null;
  const foes = makeFoes();
  const rule = fightRule();
  S.fight = { foes, turn: 0, turns: TURNS, rule, stolen: [], gold: 0, turnDmg: 0, shownDmg: 0 };
  S.fight.turns = TURNS + charmN('wind');   // after S.fight exists so Velvet's silence applies
  setBg(rungInfo().loc);
  renderAll();
  if (S.fight.rule) banner(BOSSES[S.fight.rule].n.toUpperCase(), BOSSES[S.fight.rule].col, ruleText(S.fight.rule, foes[0]));
  else banner(`FIGHT ${S.fightIdx + 1}`, '#fff', rungInfo().n);
}
async function goToFight() {
  if (S.fightIdx === 2 && !S.bossSeen) {
    S.bossSeen = true;
    S.phase = 'ready'; S.fight = null;
    saveRun();
    await playCine('boss:' + rungInfo().boss);
  }
  startFight();
}
function fightBtn() {
  if (S.phase !== 'ready') return;
  audioInit();
  S.phase = 'fight';
  renderAll();
  if (mq.matches) battleViewportEl.scrollIntoView({ block: 'start', behavior: 'auto' });
  beginTurn();
}
function beginTurn() {
  const f = S.fight;
  if (f.rule === 'pip' && f.turn === 0) {
    for (let i = S.wand.length - 1; i >= 0; i--) if (S.wand[i] && !f.stolen.includes(i)) { f.stolen.push(i); logLine(`Pip stole your ${PARTS[S.wand[i].k].n}!`); break; }
  }
  const before = f.foes.map(o => ({ hp: o.hp, phase: o.phase || 0 }));
  const res = resolveTurn(f.foes, f.turn);
  f.gold += res.gold;
  f.turnDmg = 0; f.shownDmg = 0;
  // the resolver already applied damage; rewind the display so it plays back over time
  S.anim = { t: 0, res, idx: 0, disp: before, fired: new Set(), done: false, endAt: res.duration + 0.35 };
  logLine(`Turn ${f.turn + 1}: ${res.events.length ? fmt(res.total) + ' damage' : 'the wand fizzles'}`);
  renderWand();
}
function stepAnim(dt) {
  const A = S.anim, f = S.fight;
  if (!A || A.done) return;
  A.t += dt;
  const evs = A.res.events;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (!A.fired.has('c' + i) && A.t >= e.t) { A.fired.add('c' + i); onCast(e); }
    if (!A.fired.has('h' + i) && A.t >= e.t + e.travel) { A.fired.add('h' + i); onImpact(e, A); }
  }
  if (A.t >= A.endAt) { A.done = true; endTurn(); }
}
function castOrigin(e) {
  if (e.src && e.src.foe !== undefined) { const o = S.fight.foes[e.src.foe]; return { x: o.x, y: GROUND - o.h * 0.5 }; }
  return Art.wandTip(PLAYER_X, GROUND, S.t, 'cast');
}
function onCast(e) {
  S.playerCast = 0.25;
  SFX.cast(e.part, e.depth);
  if (e.slot !== undefined) flashSlot(e.slot);
}
function onImpact(e, A) {
  const f = S.fight;
  let hitIdx = 0;
  for (const r of e.recs) {
    const d = A.disp[r.i];
    d.hp = r.hpAfter;
    if (r.phase !== undefined && r.phase > d.phase) { d.phase = r.phase; SFX.phase(); shake(10); banner(`PHASE ${r.phase + 1}`, '#ff5f6a', ruleText(f.foes[r.i].phases[r.phase], f.foes[r.i])); }
    const foe = f.foes[r.i];
    foe.hitT = 0.18;
    const x = foe.x, y = GROUND - foe.h * 0.6;
    f.turnDmg += r.dmg;
    if (r.dmg > 0) {
      const big = r.dmg >= foe.maxHp * 0.25;
      popBattle(x + (rnd() - 0.5) * 10, y - 6 - hitIdx * 7, (e.crit ? 'CRIT ' : '') + fmt(r.dmg), e.crit ? '#ffe066' : big ? '#ff9a1f' : '#fff', clamp(16 + Math.log10(r.dmg + 1) * 2.4, 16, 38));
      burst(BX + x * BS, BY + y * BS, Math.min(14, 3 + Math.floor(Math.log10(r.hits + 1) * 3)), [PARTS[e.part].col, '#fff'], 3);
      shake(clamp(Math.log10(r.dmg / Math.max(1, foe.maxHp) * 100 + 1) * 2.5, 0, 9));
    } else if (r.hits > 0) popBattle(x, y - 6, 'NO EFFECT', '#9a8ab8', 16);
    if (r.kill) { SFX.ko(); popBattle(x, y - 18, 'K.O.!', '#ff5fd2', 26); burst(BX + x * BS, BY + y * BS, 24, ['#ff5fd2', '#ffe066', '#fff'], 5); }
    hitIdx++;
  }
  if (e.blocked) { SFX.blocked(); const o = f.foes.find(x => x.ward !== undefined && foeRule(x) === 'grimsby') || f.foes[0]; popBattle(o.x, GROUND - o.h - 4, `WARD ${fmt(e.blocked)}`, '#b48cff', 16); }
  if (e.recs.length) {
    if (e.part === 'fireball' || e.part === 'bomb') SFX.boom(); else SFX.hit(Math.floor(Math.log2(e.count + 1)));
    if (e.crit) SFX.crit();
  }
  S.impacts.push({ part: e.part, recs: e.recs.map(r => r.i), t: 0 });
  BG.boost += Math.min(1, Math.log10(e.total + 1) * 0.05);
}
function endTurn() {
  const f = S.fight;
  S.anim = null;
  f.turn++;
  if (f.turnDmg > S.stats.bestTurn) S.stats.bestTurn = f.turnDmg;
  if (f.turnDmg > best.turn) best.turn = f.turnDmg;
  const alive = f.foes.filter(o => o.hp > 0);
  if (!alive.length) return winFight();
  // enemies strike back (visual) and boss rules tick
  for (const o of alive) o.atkT = 0.35;
  SFX.enemyAtk();
  S.playerHurt = 0.3;
  if (alive.some(o => foeRule(o) === 'fin')) for (const o of alive) if (foeRule(o) === 'fin') { o.hp *= 1.25; o.maxHp *= 1.25; popBattle(o.x, GROUND - o.h - 6, '+25% INTEREST', '#ffcf4a', 18); }
  if (f.turn >= f.turns) return setTimeout(() => loseFight(), 500 / prefs.speed);
  setTimeout(() => { if (S.phase === 'fight' && S.fight === f) beginTurn(); }, 450 / prefs.speed);
  renderAll();
}
function fightReward() {
  const f = S.fight;
  const rows = [];
  rows.push([f.rule ? `${BOSSES[f.rule].n} defeated` : `Fight ${S.fightIdx + 1} won`, f.rule ? BOSS_GOLD : WIN_GOLD]);
  const left = f.turns - f.turn;
  if (left > 0 && charmOn('piggy')) rows.push([`Piggy Bank (${left} turns left)`, left * charmN('piggy')]);
  if (charmOn('glove')) rows.push([`Thief's Glove (${f.foes.length} K.O.)`, f.foes.length * charmN('glove')]);
  const coins = Math.min(5, Math.floor(f.gold));
  if (coins) rows.push(['Coin Toss winnings', coins]);
  const cap = charmOn('ledger') ? 10 : 5;
  const interest = Math.min(cap, Math.floor(Math.max(0, S.gold) / 5));
  if (interest) rows.push([`Interest ($1 per $5, max $${cap})`, interest]);
  return rows;
}
async function winFight() {
  const f = S.fight;
  S.phase = 'cashout';
  S.stats.fights++;
  S.cashout = { rows: fightReward(), won: true };
  if (f.rule) { best.bosses[f.rule] = (best.bosses[f.rule] || 0) + 1; saveBest(); }
  SFX.win(); confetti(80); shake(6); BG.boost += 3;
  banner(pick(['SMASHED!', 'K.O.!', 'REVENGE!', 'PAYBACK!']), '#ffcf4a', `${fmt(f.foes.reduce((a, o) => a + o.maxHp, 0))} health cleared`);
  renderAll();
  await sleep(1200 / Math.sqrt(prefs.speed));
  if (S.fight !== f || S.phase !== 'cashout') return;
  if (f.rule) await playCine('bossDefeat:' + rungInfo().boss);
  if (S.fight === f && S.phase === 'cashout') showCashout(S.cashout.rows, true);
}
async function loseFight() {
  const f = S.fight;
  if (!f || S.phase !== 'fight') return;
  S.hearts--;
  SFX.hurt(); shake(14);
  S.playerHurt = 1;
  banner('BEATEN UP', '#ff5f6a', S.hearts > 0 ? `You lose a heart. ${S.hearts} left.` : 'No hearts left...');
  logLine(`Lost the fight: ${fmt(f.foes.reduce((a, o) => a + o.hp, 0))} health left standing`);
  S.phase = 'cashout';
  const cap = charmOn('ledger') ? 10 : 5;
  const interest = Math.min(cap, Math.floor(Math.max(0, S.gold) / 5));
  S.cashout = { rows: interest ? [[`Interest ($1 per $5, max $${cap})`, interest]] : [], won: false };
  renderAll();
  await sleep(1500);
  if (S.fight !== f || S.phase !== 'cashout') return;
  if (S.hearts <= 0) return gameOver();
  showCashout(S.cashout.rows, false);
}
function showCashout(rows, won) {
  S.cashout = { rows, won };
  saveRun();
  const total = rows.reduce((a, r) => a + r[1], 0);
  const boss = S.fight && S.fight.rule;
  $('#ov').innerHTML = `<div class="cash panel"><h2 class="t" style="text-align:center;font-size:34px">${won ? 'LOOT' : 'LICK YOUR WOUNDS'}</h2>
    ${rows.map((r, i) => `<div class="cl" style="animation-delay:${i * 0.12}s"><span>${r[0]}</span><span class="amt">$${r[1]}</span></div>`).join('') || '<div class="cl"><span>Nothing this time</span><span class="amt">$0</span></div>'}
    ${!won && boss ? '<div class="cl"><span>The boss is still standing. Regroup and try again.</span><span></span></div>' : ''}
    <div style="margin-top:12px"><button class="b-gold" id="cashBtn">${total ? `Collect $${total}` : 'Continue'}</button></div></div>`;
  $('#cashBtn').addEventListener('click', () => {
    if (S.phase !== 'cashout' || !S.cashout) return;
    S.cashout = null;
    S.gold += total; if (total) SFX.coin();
    clearOv();
    afterFight(won);
  });
}
async function afterFight(won) {
  // stolen parts come back
  if (S.fight) S.fight.stolen = [];
  const wasBoss = S.fightIdx === 2;
  if (won) {
    if (wasBoss) {
      S.hearts = Math.min(maxHearts(), S.hearts + 1);
      S.rung++; S.fightIdx = 0; S.bossSeen = false;
      if (S.rung > best.rung) { best.rung = S.rung; saveBest(); }
      if (S.rung === RUNGS.length && !S.endless) return victory();
    } else S.fightIdx++;
  } else if (!wasBoss) S.fightIdx++;
  S.fight = null;
  goShop();
}
async function victory() {
  S.phase = 'over'; saveRun();
  best.wins++; saveBest();
  await playCine('ending');
  S.phase = 'over';
  setBg('shop');
  confetti(200); SFX.win();
  showModal(`<div class="box panel">
    <h1 class="c-gold">REVENGE COMPLETE</h1>
    <h2>Don Grimoire is finished. The shop is yours again.</h2>
    ${statsHtml()}
    <div class="row"><button class="b-blue" id="endlessBtn">Endless</button><button class="b-orange" id="newRunBtn">New Run</button><button class="b-gray" id="menuBtn">Main Menu</button></div></div>`);
  $('#endlessBtn').addEventListener('click', () => { hideModal(); S.endless = true; goShop(); });
  $('#newRunBtn').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#menuBtn').addEventListener('click', () => { SFX.button(); showTitle(); });
}
async function gameOver() {
  S.phase = 'over'; saveRun();
  saveBest();
  await playCine('gameover');
  S.phase = 'over';
  setBg('lose'); SFX.lose();
  showModal(`<div class="box panel">
    <h1 class="c-red">KNOCKED OUT</h1>
    <h2>${rungInfo().n} · fight ${S.fightIdx + 1}</h2>
    ${statsHtml()}
    <div class="row"><button class="b-orange" id="newRunBtn">New Run</button><button class="b-gray" id="menuBtn">Main Menu</button></div></div>`);
  $('#newRunBtn').addEventListener('click', () => { SFX.button(); newRun(); });
  $('#menuBtn').addEventListener('click', () => { SFX.button(); showTitle(); });
  renderAll();
}
function statsHtml() {
  const w = S.wand.filter(Boolean).map(p => PARTS[p.k].n + (p.lvl > 1 ? ' Lv' + p.lvl : '')).join(', ') || '-';
  return `<div class="stgrid">
    <span>Rungs climbed</span><b>${S.rung}</b>
    <span>Fights won</span><b>${S.stats.fights}</b>
    <span>Biggest turn</span><b>${fmt(S.stats.bestTurn)}</b>
    <span>Wand</span><b style="font-size:16px;max-width:300px">${w}</b>
    <span>All-time biggest turn</span><b>${fmt(best.turn)}</b>
  </div>`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= RUN ================= */
async function newRun() {
  hideModal(); clearOv(); hideTip();
  Object.assign(S, {
    phase: 'ready', rung: 0, fightIdx: 0, hearts: MAX_HEARTS, gold: START_GOLD, frame: 'twig', extraSlots: 0,
    wand: startWand(), bag: [], charms: [], offers: [], rerollCost: 2, sel: null,
    slotPrice: 5, fight: null, anim: null, cashout: null, log: [], stats: { fights: 0, bestTurn: 0 }, endless: false, bossSeen: false,
  });
  best.runs++; saveBest();
  syncWandSize();
  saveRun();
  if (!prefs.introSeen) { prefs.introSeen = true; savePrefs(); await playCine('intro'); }
  startFight();
}

/* ================= SHOP ================= */
function rarityRoll() { const x = rnd(); return x < 0.6 ? 1 : x < 0.9 ? 2 : 3; }
function randomOffer() {
  const kind = weightedPick([['part', 68], ['charm', 24], ['frame', S.frame === 'staff' ? 0 : 8]]);
  if (kind === 'frame') {
    const opts = FRAME_KEYS.filter(k => k !== S.frame && FRAMES[k].price > 0);
    const k = pick(opts);
    return { kind, key: k, price: FRAMES[k].price };
  }
  const r = rarityRoll();
  const pool = (kind === 'part' ? PART_KEYS.filter(k => PARTS[k].rarity === r) : CHARM_KEYS.filter(k => CHARMS[k].rarity === r));
  const k = pick(pool);
  return { kind, key: k, price: (kind === 'part' ? PARTS : CHARMS)[k].price };
}
function genOffers() { S.offers = [randomOffer(), randomOffer(), randomOffer(), randomOffer()]; if (!S.offers.some(o => o.kind === 'part')) S.offers[0] = { kind: 'part', key: 'spark', price: PARTS.spark.price }; }
function goShop() {
  S.phase = 'shop';
  S.rerollCost = 2; S.sel = null;
  genOffers();
  setBg('shop');
  renderAll();
}
const offerDef = o => (o.kind === 'part' ? PARTS : o.kind === 'charm' ? CHARMS : FRAMES)[o.key];
function ownedParts() { return [...S.wand, ...S.bag].filter(Boolean); }
function buyOffer(i) {
  const o = S.offers[i];
  if (!o || o.sold) return;
  if (S.gold < o.price) { SFX.nope(); flashHint('Not enough gold'); return; }
  if (o.kind === 'part') {
    const same = ownedParts().filter(p => p.k === o.key && p.lvl < MAX_LVL).sort((a, b) => b.lvl - a.lvl)[0];
    if (same) {
      same.lvl++;
      S.gold -= o.price; o.sold = true;
      SFX.level(); banner('LEVEL UP', '#ffcf4a', `${PARTS[o.key].n} is now level ${same.lvl}`);
    } else {
      const empty = S.wand.indexOf(null);
      if (empty < 0 && S.bag.length >= BAG_SIZE) { SFX.nope(); flashHint('Wand and scrap bag are full: sell a part first'); return; }
      S.gold -= o.price; o.sold = true;
      if (empty >= 0) S.wand[empty] = newPart(o.key); else S.bag.push(newPart(o.key));
      SFX.buy();
    }
  } else if (o.kind === 'charm') {
    if (S.charms.length >= S.charmSlots) { SFX.nope(); flashHint('Charm slots full: sell a charm first'); return; }
    S.gold -= o.price; o.sold = true;
    S.charms.push(o.key);
    if (o.key === 'glass') S.hearts = Math.min(S.hearts, maxHearts());
    syncWandSize();
    SFX.buy();
  } else {
    S.gold -= o.price; o.sold = true;
    const old = S.frame;
    S.frame = o.key;
    syncWandSize();
    SFX.level(); banner('NEW WAND BODY', '#ffcf4a', `${FRAMES[old].n} → ${FRAMES[o.key].n}`);
  }
  renderAll();
}
function buySlot() {
  if (slotCount() >= MAX_SLOTS) { SFX.nope(); return; }
  if (S.gold < S.slotPrice) { SFX.nope(); return; }
  S.gold -= S.slotPrice; S.extraSlots++; S.slotPrice = Math.round(S.slotPrice * 1.5);
  syncWandSize();
  SFX.buy();
  renderAll();
}
const HEAL_PRICE = 6;
function buyHeal() {
  if (S.hearts >= maxHearts() || S.gold < HEAL_PRICE) { SFX.nope(); return; }
  S.gold -= HEAL_PRICE; S.hearts++;
  SFX.level();
  renderAll();
}
function reroll() {
  if (S.gold < S.rerollCost) { SFX.nope(); return; }
  S.gold -= S.rerollCost; S.rerollCost++;
  genOffers(); SFX.button();
  renderAll();
}
const sellValue = p => (charmOn('scrapper') ? PARTS[p.k].price * p.lvl : Math.max(1, Math.floor((PARTS[p.k].price * p.lvl) / 2)));
function sellPart(where, i) {
  const arr = where === 'wand' ? S.wand : S.bag;
  const p = arr[i];
  if (!p) return;
  if (where === 'wand' && S.wand.filter(Boolean).length <= 1) { SFX.nope(); flashHint('Keep at least one part in the wand'); return; }
  S.gold += sellValue(p);
  if (where === 'wand') S.wand[i] = null; else S.bag.splice(i, 1);
  S.sel = null;
  SFX.coin(); hideTip();
  renderAll();
}
function sellCharm(i) {
  const k = S.charms[i];
  S.gold += charmOn('scrapper') && k !== 'scrapper' ? CHARMS[k].price : Math.floor(CHARMS[k].price / 2);
  S.charms.splice(i, 1);
  syncWandSize();
  S.hearts = Math.min(S.hearts, maxHearts());
  SFX.coin(); hideTip();
  renderAll();
}
const canEdit = () => S.phase === 'shop' || S.phase === 'ready';
/* Click one slot (wand or bag), then another, to swap them. */
function clickSlot(where, i) {
  if (!canEdit()) return;
  const sel = S.sel;
  if (!sel) {
    const has = where === 'wand' ? S.wand[i] : S.bag[i];
    if (!has) return;
    S.sel = { where, i }; SFX.button(); renderWand(); return;
  }
  if (sel.where === where && sel.i === i) { S.sel = null; renderWand(); return; }
  const get = (w, k) => (w === 'wand' ? S.wand[k] : S.bag[k]) || null;
  const a = get(sel.where, sel.i), b = get(where, i);
  if (where === 'bag' && i >= S.bag.length) { // moving into an empty bag slot appends
    if (sel.where === 'bag') { S.sel = null; renderWand(); return; }
    S.bag.push(a); S.wand[sel.i] = null;
  } else if (sel.where === 'bag' && where === 'bag') { S.bag[sel.i] = b; S.bag[i] = a; }
  else if (sel.where === 'bag') { S.wand[i] = a; if (b) S.bag[sel.i] = b; else S.bag.splice(sel.i, 1); }
  else if (where === 'bag') { S.bag[i] = a; S.wand[sel.i] = b; }
  else { S.wand[sel.i] = b; S.wand[i] = a; }
  S.sel = null;
  SFX.buy();
  renderAll();
}
let hintTimer = null;
function flashHint(text) { const el = $('#wandHint'); if (!el) return; el.textContent = text; el.style.color = '#ffd27a'; clearTimeout(hintTimer); hintTimer = setTimeout(() => { el.style.color = ''; el.textContent = defaultHint(); }, 1800); }
const defaultHint = () => (canEdit() ? 'Tap two slots to swap parts · bag holds spares' : 'Wand locked during the fight');
function nextFight() { if (S.phase !== 'shop') return; SFX.button(); goToFight(); }

/* ================= CINEMATICS ================= */
async function playCine(key) {
  if (typeof Cinema === 'undefined') return;
  const prev = S.phase;
  S.phase = 'cine';
  document.body.dataset.cine = '1';
  hideTip();
  try { await Cinema.play(key); } finally { S.phase = prev === 'cine' ? 'title' : prev; delete document.body.dataset.cine; }
}
if (typeof Cinema !== 'undefined') Cinema.sfx = name => {
  const map = { talk: SFX.talk, door: () => { noise(0.2, 0.4, 300, { type: 'lowpass' }); osc(110, 0.15, 'square', 0.1); }, smash: () => { noise(0.35, 0.4, 2500); osc(180, 0.2, 'square', 0.08, { slide: 60 }); }, boom: SFX.boom, coin: SFX.coin, step: () => noise(0.05, 0.15, 400), sting: SFX.phase, cheer: SFX.win };
  if (map[name]) map[name]();
};

/* ================= BATTLE RENDER ================= */
const bcv = $('#battle'), bg = bcv.getContext('2d');
bcv.width = BW; bcv.height = BH;
bg.imageSmoothingEnabled = false;
S.impacts = [];
S.t = 0; S.playerCast = 0; S.playerHurt = 0;
function renderBattle(dt) {
  const t = S.t, g = bg;
  const loc = S.phase === 'title' ? 'shop' : rungInfo().loc;
  Art.drawBackground(g, loc, t);
  if (S.phase === 'title') return;
  const pstate = S.playerHurt > 0 ? 'hurt' : S.playerCast > 0 ? 'cast' : S.phase === 'cashout' && S.fight && S.fight.foes.every(o => o.hp <= 0) ? 'win' : 'idle';
  Art.drawPlayer(g, PLAYER_X, GROUND, t, pstate);
  const f = S.fight;
  if (f) {
    const disp = S.anim ? S.anim.disp : null;
    f.foes.forEach((o, i) => {
      const hp = disp ? disp[i].hp : o.hp;
      const dead = hp <= 0;
      let x = o.x;
      if (o.atkT > 0) x -= Math.sin((1 - o.atkT / 0.35) * Math.PI) * 10 * K;
      const st = dead ? 'dead' : o.hitT > 0 ? 'hit' : o.atkT > 0 ? 'attack' : 'idle';
      Art.drawEnemy(g, o.key, Math.round(x), GROUND, t + i * 0.37, st);
      if (!dead) {
        const barSpace = Math.min(i > 0 ? o.x - f.foes[i - 1].x - 4 : Infinity, i + 1 < f.foes.length ? f.foes[i + 1].x - o.x - 4 : Infinity);
        const w = Math.round(Math.max(14 * K, Math.min(34 * K, o.w, barSpace))), bh = Math.max(2, Math.round(2 * K)), bx = Math.round(o.x - w / 2), by = GROUND - o.h - Math.round(6 * K);
        g.fillStyle = '#120d1e'; g.fillRect(bx - 1, by - 1, w + 2, bh + 2);
        g.fillStyle = '#3a2a4a'; g.fillRect(bx, by, w, bh);
        g.fillStyle = o.boss ? '#ff5fd2' : '#ff5f6a'; g.fillRect(bx, by, Math.max(1, Math.round((w * hp) / o.maxHp)), bh);
        if (o.frozen) { g.fillStyle = '#8fe3ff'; g.fillRect(bx + w + 2, by - 1, 3, 3); }
      }
    });
  }
  // projectiles in flight
  if (S.anim) {
    const A = S.anim;
    for (const e of A.res.events) {
      const k = (A.t - e.t) / e.travel;
      if (k < 0 || k > 1) continue;
      const o = castOrigin(e);
      const targets = e.recs.length ? e.recs.map(r => f.foes[r.i]) : f.foes.filter(x => x.hp > 0).slice(0, 1);
      const shown = Math.min(5, Math.max(1, Math.ceil(e.count)));
      targets.slice(0, 3).forEach((tg, ti) => {
        const tx = tg ? tg.x : BW - 20 * K, ty = tg ? GROUND - tg.h * 0.55 : GROUND - 20 * K;
        for (let s = 0; s < shown; s++) {
          const spread = (s - (shown - 1) / 2) * 5 * K;
          const x = lerp(o.x, tx, k), y = lerp(o.y, ty, k) - Math.sin(k * Math.PI) * (12 * K + spread + ti * 4 * K);
          const ang = Math.atan2(ty - o.y, tx - o.x);
          Art.drawProjectile(g, e.part, Math.round(x), Math.round(y + spread * 0.3), ang, t, clamp(1 + Math.log10(e.count) * 0.25, 1, 2.5));
        }
      });
    }
  }
  for (const im of S.impacts) {
    for (const i of im.recs) { const o = f && f.foes[i]; if (o) Art.drawImpact(g, im.part, o.x, Math.round(GROUND - o.h * 0.55), im.t / 0.35); }
  }
}
/* Counts on projectiles in flight are drawn crisp on the full-res layer. */
function drawBattleLabels(g) {
  if (!S.anim || !S.fight) return;
  const A = S.anim, f = S.fight;
  for (const e of A.res.events) {
    const k = (A.t - e.t) / e.travel;
    if (k < 0 || k > 1 || e.count < 2) continue;
    const o = castOrigin(e);
    const tg = e.recs.length ? f.foes[e.recs[0].i] : f.foes.find(x => x.hp > 0);
    const tx = tg ? tg.x : BW - 20 * K, ty = tg ? GROUND - tg.h * 0.55 : GROUND - 20 * K;
    const x = lerp(o.x, tx, k), y = lerp(o.y, ty, k) - Math.sin(k * Math.PI) * 12 * K;
    const p = toStage(x, y - 9 * K);
    drawText(g, '×' + fmt(e.count), p.x, p.y, 18, PARTS[e.part].col);
  }
}
function stepBattle(dt) {
  S.t += dt;
  S.playerCast = Math.max(0, S.playerCast - dt);
  S.playerHurt = Math.max(0, S.playerHurt - dt);
  if (S.fight) for (const o of S.fight.foes) { o.hitT = Math.max(0, (o.hitT || 0) - dt); o.atkT = Math.max(0, (o.atkT || 0) - dt); }
  for (const im of S.impacts) im.t += dt;
  compact(S.impacts, im => im.t < 0.35);
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
function setStyle(el, key, prop, v) { if (cache[key] === v) return; cache[key] = v; if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v; }
function updateLeft() {
  const R = rungInfo(), f = S.fight;
  setText('rungName', `${S.endless ? 'Endless ' : ''}Rung ${S.rung + 1}${S.endless ? '' : '/' + RUNGS.length}`);
  setText('fightName', `${R.n} · ${S.fightIdx === 2 ? 'BOSS' : `Fight ${S.fightIdx + 1}/3`}`);
  const rule = f && f.rule ? ruleText(f.rule, f.foes[0]) : '';
  setText('ruleLine', rule);
  setStyle($('#rungBox'), 'rcol', '--rcol', f && f.rule ? BOSSES[f.rule].col : S.phase === 'shop' ? '#8a3a6a' : '#6a3aa8');
  const disp = S.anim ? S.anim.disp : f ? f.foes : [];
  const hp = disp.reduce((a, o) => a + Math.max(0, o.hp), 0), maxHp = f ? f.foes.reduce((a, o) => a + o.maxHp, 0) : 0;
  setText('foeHp', f ? fmt(Math.ceil(hp)) : '-');
  setStyle($('#barFill'), 'barW', 'width', (maxHp ? clamp(hp / maxHp, 0, 1) * 100 : 0).toFixed(1) + '%');
  if (f) {
    f.shownDmg += (f.turnDmg - f.shownDmg) * 0.2;
    if (Math.abs(f.turnDmg - f.shownDmg) < Math.max(1, f.turnDmg * 0.001)) f.shownDmg = f.turnDmg;
  }
  if (setText('turnDmg', f ? fmt(f.shownDmg) : '0')) bumpEl($('#dmgBox'));
  setText('turnNum', f ? `${Math.min(f.turn + (S.phase === 'fight' ? 1 : 0), f.turns)}/${f.turns}` : '-');
  setText('hearts', '♥'.repeat(Math.max(0, S.hearts)) + '♡'.repeat(Math.max(0, maxHearts() - S.hearts)));
  if (setText('money', '$' + S.gold)) bumpEl($('#money'));
}
function renderCharms() {
  setText('charmCount', `${S.charms.length}/${S.charmSlots}`);
  let html = '';
  for (let i = 0; i < S.charmSlots; i++) {
    const k = S.charms[i];
    html += k ? `<div class="charm full ${charmsSilenced() ? 'muted' : ''}" data-i="${i}" tabindex="0" aria-label="${CHARMS[k].n}" style="--cc:${CHARMS[k].col}"><canvas width="16" height="16" data-charm="${k}"></canvas><button class="b-red sell" data-sell="${i}">$${charmOn('scrapper') && k !== 'scrapper' ? CHARMS[k].price : Math.floor(CHARMS[k].price / 2)}</button></div>` : '<div class="charm"></div>';
  }
  const el = $('#charms'); el.innerHTML = html;
  paintIcons(el);
  el.querySelectorAll('.charm.full').forEach(r => {
    const k = S.charms[+r.dataset.i];
    const showCharmTip = () => { const c = elCenter(r); showTipAt(tipHTML(CHARMS[k].n, CHARMS[k].d, RARITY[CHARMS[k].rarity][0] + ' charm', RARITY[CHARMS[k].rarity][1], charmsSilenced() ? 'Silenced by Velvet' : S.phase === 'shop' ? 'Tap $ to sell' : ''), Math.min(c.x, 1140), c.y + 32, true); };
    r.addEventListener('mouseenter', showCharmTip);
    r.addEventListener('focus', showCharmTip);
    r.addEventListener('mouseleave', hideTip);
    r.addEventListener('blur', hideTip);
  });
  el.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); if (S.phase === 'shop') sellCharm(+b.dataset.sell); }));
}
/* Icon canvases take the icon's native pixel size; CSS sets the display size. */
const ICON_SOURCES = { part: k => Art.partIcon(k), charm: k => Art.charmIcon(k), frame: k => Art.frameIcon(k) };
function paintIcons(root) {
  for (const [kind, src] of Object.entries(ICON_SOURCES)) {
    root.querySelectorAll(`canvas[data-${kind}]`).forEach(c => {
      const img = src(c.dataset[kind]);
      if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; }
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    });
  }
}
const KIND_LABEL = { proj: 'SPELL', mod: 'MOD', special: 'RUNE' };
function slotHtml(p, where, i) {
  const sel = S.sel && S.sel.where === where && S.sel.i === i;
  const off = where === 'wand' ? slotState(i) : null;
  if (!p) return `<div class="slot ${sel ? 'sel' : ''} ${off ? 'off' : ''}" data-w="${where}" data-i="${i}" tabindex="0" role="button" aria-label="Empty ${where} slot ${i + 1}" ${off ? `data-off="${off}"` : ''}>${where === 'wand' ? `<span class="ix">${i + 1}</span>` : ''}</div>`;
  const P = PARTS[p.k];
  return `<div class="slot full ${P.kind} ${sel ? 'sel' : ''} ${off ? 'off' : ''}" data-w="${where}" data-i="${i}" tabindex="0" role="button" aria-label="${P.n}, ${where} slot ${i + 1}${off ? ', ' + off : ''}" style="--pc:${P.col}" ${off ? `data-off="${off}"` : ''}>
    ${where === 'wand' ? `<span class="ix">${i + 1}</span>` : ''}${p.lvl > 1 ? `<span class="lv">Lv${p.lvl}</span>` : ''}
    <canvas width="16" height="16" data-part="${p.k}"></canvas><span class="kd">${KIND_LABEL[P.kind]}</span>
    <button class="b-red sell" data-sellp="${where}:${i}">$${sellValue(p)}</button></div>`;
}
function partTip(p) {
  const P = PARTS[p.k];
  const LEVEL_NOTE = { proj: 'damage X2 per level', mod: P.crit ? '+25% crit chance per level' : P.mul && p.k !== 'prism' ? `X${P.mul} again per level` : P.add ? 'bonus doubles per level' : 'one more per level', special: 'one more repeat per level' };
  const lvlNote = p.lvl > 1 ? `Level ${p.lvl}: ${LEVEL_NOTE[P.kind]}` : `Buy another to level it up (${LEVEL_NOTE[P.kind]})`;
  return tipHTML(P.n + (p.lvl > 1 ? ` Lv${p.lvl}` : ''), P.d, `${RARITY[P.rarity][0]} ${KIND_LABEL[P.kind].toLowerCase()}`, RARITY[P.rarity][1], lvlNote);
}
function renderWand() {
  syncWandSize();
  setText('frameName', FRAMES[S.frame].n);
  setText('slotCount', `${S.wand.filter(Boolean).length}/${S.wand.length} slots`);
  const fic = $('#frameIcon'), src = Art.frameIcon(S.frame), fi = fic.getContext('2d');
  if (fic.width !== src.width) { fic.width = src.width; fic.height = src.height; }
  fi.imageSmoothingEnabled = false; fi.clearRect(0, 0, fic.width, fic.height); fi.drawImage(src, 0, 0);
  const relationships = wandRelationships();
  $('#slots').innerHTML = groupedSlotsHtml(relationships);
  clearWandRelationships();
  $('#bag').innerHTML = Array.from({ length: BAG_SIZE }, (_, i) => slotHtml(S.bag[i] || null, 'bag', i)).join('');
  setText('wandHint', defaultHint());
  for (const root of [$('#slots'), $('#bag')]) {
    paintIcons(root);
    root.querySelectorAll('.slot').forEach(el => {
      const where = el.dataset.w, i = +el.dataset.i;
      el.addEventListener('click', () => clickSlot(where, i));
      el.addEventListener('keydown', event => { if (event.target === el && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); clickSlot(where, i); } });
      const p = where === 'wand' ? S.wand[i] : S.bag[i];
      if (p) {
        const showPartTip = () => { const c = elCenter(el); showTipAt(partTip(p), c.x, c.y - 40); };
        el.addEventListener('mouseenter', showPartTip);
        el.addEventListener('focus', showPartTip);
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('blur', hideTip);
      }
    });
    root.querySelectorAll('[data-sellp]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const [w, i] = b.dataset.sellp.split(':'); if (S.phase === 'shop') sellPart(w, +i); }));
  }
  renderTree(relationships);
  bindWandRelationships(relationships);
  saveRun();
}
function flashSlot(i) {
  const el = document.querySelector(`#slots .slot[data-i="${i}"]`);
  if (!el) return;
  el.classList.add('firing');
  setTimeout(() => el.classList.remove('firing'), 180);
}
const HIT_LABEL = { single: '1 target', aoe: 'all enemies', chain: 'chains ×3', bounce: 'bounces ×2', rain: 'rains' };
function wandTreeLine(node) {
  const group = node.group;
  const names = entries => entries.map(entry => PARTS[entry.k].n + (entry.lvl > 1 ? ` Lv${entry.lvl}` : '')).join(' + ');
  if (group.fizzle) return `<div data-group="${node.id}" class="dim">G${node.id + 1} · ${names(group.fizzle)} fizzles (${group.reason})</div>`;
  if (group.echo) return `<div data-group="${node.id}">G${node.id + 1} · <b class="c-blue">${names([group.echo])}</b> · ${node.target ? `repeats G${node.target.id + 1} ×${group.echo.lvl}` : 'fizzles (no previous group)'}</div>`;
  let depth = 0, parent = node.parent;
  while (parent) { depth++; parent = parent.parent; }
  const stats = groupStats(group, depth, 0);
  const prefix = node.parent ? `↳ G${node.id + 1} on hit of G${node.parent.id + 1}: ` : `G${node.id + 1} · `;
  const modifiers = group.mods.length ? names(group.mods) + ' → ' : '';
  return `<div data-group="${node.id}">${prefix}${modifiers}<b style="color:${PARTS[group.proj.k].col}">${names([group.proj])}</b> ×${fmt(stats.count)} · ${fmt(stats.dmg)} dmg · ${HIT_LABEL[stats.hit]}${stats.trig ? ` · <span class="c-pink">casts next ×${stats.trig}/hit</span>` : ''}${stats.crit ? ` · ${Math.round(stats.crit * 100)}% crit` : ''}${stats.trig && !group.payload && !group.payloadFizzle ? ' · no payload' : ''}</div>`;
}
function renderTree(relationships) {
  $('#tree').innerHTML = relationships.groups.map(wandTreeLine).join('') || '<div class="dim">Empty wand: put a projectile in a slot</div>';
  const estimate = estimateTurn();
  setText('estimate', `≈ ${fmt(estimate.total)} damage / turn`);
}
function logLine(text) {
  S.log.unshift(text);
  if (S.log.length > 14) S.log.length = 14;
  const el = $('#fightLog');
  if (el) { const d = document.createElement('div'); d.textContent = text; el.prepend(d); while (el.children.length > 14) el.lastChild.remove(); }
}
function renderRight() {
  const body = $('#rightBody');
  document.body.dataset.phase = S.phase;
  if (S.phase === 'ready' || S.phase === 'fight' || S.phase === 'cashout' || S.phase === 'over') {
    const f = S.fight;
    const foes = f ? f.foes.map(o => `<div>${o.name}${o.boss ? ' <span class="c-pink">BOSS</span>' : ''} · ${fmt(o.maxHp)} hp</div>`).join('') : '';
    body.innerHTML = `<div class="fightBox">
      ${S.phase === 'ready' ? `<button class="b-pink bigBtn pulse" id="fightBtn">FIGHT!</button><div class="feed">${f.turns} turns to win · the wand fires every turn<br><span class="lbl">Tap FIGHT (or press Space) to start · you can still rearrange parts</span></div>` : `<div class="phaseLbl t c-gold">${S.phase === 'fight' ? 'CASTING' : 'DONE'}</div>`}
      <div class="feed">${foes}</div>
      <div class="log" id="fightLog">${S.log.map(l => `<div>${l}</div>`).join('')}</div></div>`;
    const fb = $('#fightBtn'); if (fb) fb.addEventListener('click', fightBtn);
    return;
  }
  if (S.phase !== 'shop') { body.innerHTML = ''; return; }
  const nextBoss = S.fightIdx === 2;
  body.innerHTML = `
    <div class="shopHead"><div class="shopSign t">BLACK MARKET</div><div class="lbl" style="text-align:right">Next: ${nextBoss ? `<span class="c-pink">${BOSSES[rungInfo().boss].n}</span>` : `fight ${S.fightIdx + 1}`}<br>${fmt(fightHp())} hp</div></div>
    <div class="offers">${S.offers.map((o, i) => {
      const d = offerDef(o);
      const rc = o.kind === 'frame' ? '#ffcf4a' : RARITY[d.rarity][1];
      const owned = o.kind === 'part' ? ownedParts().find(p => p.k === o.key && p.lvl < MAX_LVL) : null;
      const icon = o.kind === 'frame' ? `<canvas class="wide" width="40" height="12" data-frame="${o.key}"></canvas>` : `<canvas width="16" height="16" data-${o.kind}="${o.key}"></canvas>`;
      const subNote = o.kind === 'frame' ? ' Replaces your wand body. Parts are kept.' : '';
      return `<div class="offer ${o.sold ? 'sold' : ''} ${S.gold < o.price ? 'poor' : ''}" data-o="${i}" tabindex="0" aria-label="${d.n}" style="--rc:${rc};animation-delay:${i * 0.06}s"><div class="okind">${o.kind === 'part' ? KIND_LABEL[d.kind] : o.kind.toUpperCase()}</div>${owned ? `<div class="olv">Lv${owned.lvl}→${owned.lvl + 1}</div>` : ''}${icon}<div class="oname">${d.n}</div><div class="odesc">${md(d.d)}${subNote}</div><div class="oprice">${o.sold ? 'SOLD' : '$' + o.price}</div></div>`;
    }).join('')}</div>
    <div class="upRow">
      <button class="b-blue" id="slotBtn" ${slotCount() >= MAX_SLOTS || S.gold < S.slotPrice ? 'disabled' : ''}>+1 Wand slot<br>${slotCount() >= MAX_SLOTS ? 'MAX' : '$' + S.slotPrice}</button>
      <button class="b-red" id="healBtn" ${S.hearts >= maxHearts() || S.gold < HEAL_PRICE ? 'disabled' : ''}>Bandage ♥<br>$${HEAL_PRICE}</button>
    </div>
    <div class="hint">Buying a part you own levels it up. Tap parts and charms to sell.</div>
    <div class="shopBtns"><button class="b-green" id="rerollBtn" ${S.gold < S.rerollCost ? 'disabled' : ''}>Reroll<br>$${S.rerollCost}</button><button class="b-pink pulse" id="nextBtn">Next<br>${nextBoss ? 'Boss' : 'Fight'}</button></div>`;
  paintIcons(body);
  body.querySelectorAll('.offer').forEach(el => {
    const o = S.offers[+el.dataset.o], d = offerDef(o);
    el.addEventListener('click', () => { hideTip(); buyOffer(+el.dataset.o); });
    const showOfferTip = () => {
      const c = elCenter(el);
      const badge = o.kind === 'frame' ? 'Wand body' : `${RARITY[d.rarity][0]} ${o.kind === 'part' ? KIND_LABEL[d.kind].toLowerCase() : 'charm'}`;
      showTipAt(tipHTML(d.n, d.d, badge, o.kind === 'frame' ? '#d99a22' : RARITY[d.rarity][1], o.kind === 'frame' ? 'Replaces your wand body. Parts are kept.' : ''), Math.min(c.x, 1100), c.y - 80);
    };
    el.addEventListener('mouseenter', showOfferTip);
    el.addEventListener('focus', showOfferTip);
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('blur', hideTip);
  });
  $('#slotBtn').addEventListener('click', buySlot);
  $('#healBtn').addEventListener('click', buyHeal);
  $('#rerollBtn').addEventListener('click', reroll);
  $('#nextBtn').addEventListener('click', nextFight);
}
function renderAll() { renderCharms(); renderWand(); renderRight(); updateLeft(); }
function renderSpeed() {
  $('#speedBtns').innerHTML = SPEEDS.map(([v, l]) => `<button class="b-blue ${prefs.speed === v ? 'on' : ''}" data-sp="${v}">${l}</button>`).join('');
  $('#speedBtns').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { prefs.speed = +b.dataset.sp; savePrefs(); renderSpeed(); SFX.button(); }));
}

/* ================= TOOLTIP ================= */
const tipEl = $('#tip');
function tipHTML(title, desc, badge = '', badgeCol = '#5a5070', sub = '') {
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
const HOWTO = `<div class="howto">
  Your wand fires <b>every turn</b>, reading its slots <b>left to right</b>. Beat every enemy within the turn limit.<br><br>
  <b>Spells</b> are projectiles. <b>Mods</b> (gems, lenses, splitters) power up the <b>next</b> spell.<br>
  <b>Triggers</b> cast the <b>next group</b> on every hit, so a split trigger feeding another split trigger multiplies fast.<br>
  <b>Echo runes</b> cast the previous group again. <b>Charms</b> bend the rules.<br><br>
  Buy a part you already own to <b>level it up</b>. The cast tree under the wand shows exactly what will happen.<br>
  Lose a fight and you lose a <b>heart</b>. Bosses must be beaten to climb.</div>`;
function showHowTo(back) {
  SFX.button();
  showModal(`<div class="box panel"><h2>How to fight</h2>${HOWTO}<div class="row"><button class="b-orange" id="closeM">Got it</button></div></div>`);
  $('#closeM').addEventListener('click', () => { SFX.button(); back ? back() : hideModal(); });
}
function showInfo() {
  SFX.button();
  const charms = S.charms.map(k => `<div><b>${CHARMS[k].n}</b><br><span class="lbl">${md(CHARMS[k].d)}</span></div>`).join('') || '<div class="lbl">No charms yet</div>';
  showModal(`<div class="box panel"><h2>Run Info</h2>
    <div class="stgrid"><span>Wand body</span><b>${FRAMES[S.frame].n}</b><span>Slots</span><b>${slotCount()}</b><span>Hearts</span><b>${S.hearts}/${maxHearts()}</b><span>Biggest turn</span><b>${fmt(S.stats.bestTurn)}</b></div>
    <h2 style="margin-top:10px">Charms</h2><div class="infoGrid">${charms}</div>
    <div class="row"><button class="b-blue" id="howBtn">How to play</button><button class="b-orange" id="closeM">Back</button></div></div>`);
  $('#howBtn').addEventListener('click', () => showHowTo(showInfo));
  $('#closeM').addEventListener('click', () => { SFX.button(); hideModal(); });
}
function showOptions() {
  SFX.button();
  const seg = (name, vals, cur) => `<span class="seg">${vals.map(v => `<button class="b-blue ${v[0] === cur ? 'on' : ''}" data-${name}="${v[0]}">${v[1]}</button>`).join('')}</span>`;
  const busy = S.phase === 'fight';
  const opt = (k, label) => `<div class="opt"><span>${label}</span>${seg(k, [[1, 'On'], [0, 'Off']], prefs[k] ? 1 : 0)}</div>`;
  showModal(`<div class="box panel"><h2>Options</h2>
    ${opt('sound', 'Sound')}${opt('music', 'Music')}${opt('shake', 'Screen shake')}${opt('particles', 'Particles')}
    <div class="row"><button class="b-purple" id="introBtn">Replay intro</button><button class="b-red" id="optNew" ${busy ? 'disabled' : ''}>New Run</button><button class="b-gray" id="optMenu" ${busy ? 'disabled' : ''}>Main Menu</button><button class="b-orange" id="closeM">Back</button></div></div>`);
  for (const k of ['sound', 'music', 'shake', 'particles']) modalEl.querySelectorAll(`[data-${k}]`).forEach(b => b.addEventListener('click', () => { prefs[k] = b.getAttribute(`data-${k}`) === '1'; savePrefs(); showOptions(); }));
  $('#introBtn').disabled = busy;
  $('#introBtn').addEventListener('click', async () => { hideModal(); await playCine('intro'); if (S.phase === 'title') showTitle(); });
  $('#optNew').addEventListener('click', () => { SFX.button(); prefs.introSeen = true; newRun(); });
  $('#optMenu').addEventListener('click', () => { SFX.button(); showTitle(); });
  $('#closeM').addEventListener('click', () => { SFX.button(); S.phase === 'title' ? showTitle() : hideModal(); });
}
function showTitle() {
  saveRun();
  const resumable = readSavedRun();
  clearOv(); hideTip();
  S.phase = 'title'; S.fight = null; S.anim = null;
  setBg('title');
  document.body.dataset.phase = 'title';
  showModal(`<div class="title">
    <div class="logo">${[...'WANDSMITH'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</div>
    <div class="subt">revenge on the wizard mafia · one cobbled wand at a time</div>
    ${resumable ? '<button class="b-pink big pulse" id="continueGo">CONTINUE RUN</button>' : ''}
    <button class="${resumable ? 'b-orange' : 'b-pink big pulse'}" id="playGo">${resumable ? 'NEW RUN' : 'PLAY'}</button>
    <div class="row2"><button class="b-purple" id="introGo">Watch intro</button><button class="b-blue" id="howGo">How to play</button><button class="b-gray" id="optGo">Options</button></div>
    <div class="bestline">Highest rung: <span class="c-gold">${best.rung}</span> · Biggest turn: <span class="c-gold">${fmt(best.turn)}</span> · Runs: ${best.runs} · Wins: ${best.wins}</div>
  </div>`, true);
  $('#playGo').addEventListener('click', () => { audioInit(); SFX.buy(); BG.boost += 3; newRun(); });
  const continueButton = $('#continueGo');
  if (continueButton) continueButton.addEventListener('click', () => { audioInit(); SFX.button(); restoreRun(); });
  $('#introGo').addEventListener('click', async () => { audioInit(); hideModal(); await playCine('intro'); showTitle(); });
  $('#howGo').addEventListener('click', () => { audioInit(); showHowTo(showTitle); });
  $('#optGo').addEventListener('click', () => { audioInit(); showOptions(); });
}
$('#infoBtn').addEventListener('click', () => { if (S.phase !== 'title') showInfo(); });
$('#optBtn').addEventListener('click', showOptions);
addEventListener('keydown', e => {
  if (S.phase === 'cine') return;
  if (e.code === 'Space' && !modalEl.classList.contains('show')) { e.preventDefault(); if (S.phase === 'ready') fightBtn(); }
  if (e.key === 'Escape') { if (S.sel) { S.sel = null; renderWand(); } else if (modalEl.classList.contains('show') && S.phase !== 'title') hideModal(); }
});
document.fonts.ready.then(() => { for (const k in cache) delete cache[k]; });

/* ================= MAIN LOOP ================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min(50, now - last); last = now;
  const sdt = (dt / 1000) * (S.phase === 'fight' ? prefs.speed : 1);
  stepBattle(sdt);
  if (S.phase === 'fight') stepAnim(sdt);
  if (S.phase !== 'cine') { renderBattle(sdt); stepFx(dt); drawFx(); }
  drawBg(dt);
  stepShake(dt);
  if (S.phase !== 'title' && S.phase !== 'cine') updateLeft();
  musicTick();
  requestAnimationFrame(frame);
}
applyLayout();
renderSpeed();
if (!restoreRun()) showTitle();
requestAnimationFrame(frame);
