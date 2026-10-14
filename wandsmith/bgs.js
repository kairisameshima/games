'use strict';
/* =====================================================================
   WANDSMITH — hand-authored pixel-art backgrounds (BGS)
   Self-contained: tiny pixel-grid/shape toolkit + a small library of
   hand-designed tiles & props, composed into 10 layered scenes.
   Each scene's static layers are rendered once into a cached offscreen
   canvas; per-frame draw() only blits that canvas plus a few cheap
   animated overlays (flicker / drip / neon blink / rain / fog drift).
   Style matches art.js: dark-plum outline (#241a30), 3-5 tone bands,
   light from the upper-left, muted mid-band so fighters stay readable.
   ===================================================================== */
const BGS = (function () {
  const W = 336, H = 168, GROUND = 150, FLOOR_TOP = 138;
  const OUTLINE = '#241a30';

  // ===================================================================
  // colour helpers
  // ===================================================================
  function hx(c) {
    let s = c[0] === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    const v = parseInt(s, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function toHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function mix(a, b, t) {
    const [ar, ag, ab] = hx(a), [br, bg, bb] = hx(b);
    return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  }
  function shade(c, amt) { const [r, g, b] = hx(c); return toHex(r + amt, g + amt, b + amt); }
  function rgba(c, a) { const [r, g, b] = hx(c); return `rgba(${r},${g},${b},${a})`; }

  // ===================================================================
  // tiny pixel-grid toolkit (deliberate hand-placed pixel art, not noise)
  // ===================================================================
  function makeGrid(w, h, fill) {
    const g = [];
    for (let y = 0; y < h; y++) g.push(new Array(w).fill(fill || '.'));
    g.w = w; g.h = h; return g;
  }
  function setPx(g, x, y, ch) { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g[y][x] = ch; }
  function fillRectG(g, x0, y0, w, h, ch) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(g, x, y, ch); }
  function strokeRectG(g, x0, y0, w, h, ch) {
    for (let x = x0; x < x0 + w; x++) { setPx(g, x, y0, ch); setPx(g, x, y0 + h - 1, ch); }
    for (let y = y0; y < y0 + h; y++) { setPx(g, x0, y, ch); setPx(g, x0 + w - 1, y, ch); }
  }
  function lineG(g, x0, y0, x1, y1, ch) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPx(g, x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // disc shaded as if lit from the upper-left; p = {hi,lit,base,shadow,rim}
  function shadedDisc(g, cx, cy, r, p) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const dist = Math.hypot(x, y);
      if (dist > r + 0.4) continue;
      const Ld = (-x * 0.72 - y * 0.72) / (dist || 1);
      let ch;
      if (dist > r - 1.15) ch = p.rim;
      else if (Ld > 0.5) ch = p.hi;
      else if (Ld > 0.0) ch = p.lit;
      else if (Ld > -0.55) ch = p.base;
      else ch = p.shadow;
      setPx(g, cx + x, cy + y, ch);
    }
  }
  function shadedBox(g, x0, y0, w, h, p) {
    fillRectG(g, x0, y0, w, h, p.base);
    for (let x = x0; x < x0 + w; x++) setPx(g, x, y0, p.lit);
    for (let y = y0; y < y0 + h; y++) setPx(g, x0, y, p.lit);
    for (let x = x0; x < x0 + w; x++) setPx(g, x, y0 + h - 1, p.shadow);
    for (let y = y0; y < y0 + h; y++) setPx(g, x0 + w - 1, y, p.shadow);
    if (p.outline) strokeRectG(g, x0 - 1, y0 - 1, w + 2, h + 2, p.outline);
  }
  function rowsOf(g) { return g.map((r) => r.join('')); }

  // ===================================================================
  // canvas blit helpers
  // ===================================================================
  function blit(ctx, ox, oy, rows, pal, alpha) {
    if (alpha != null) { ctx.save(); ctx.globalAlpha = alpha; }
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const col = pal[row[x]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    if (alpha != null) ctx.restore();
  }
  function blitRot(ctx, rows, pal, ox, oy, pivotX, pivotY, angle) {
    ctx.save();
    ctx.translate(ox + pivotX, oy + pivotY);
    ctx.rotate(angle);
    ctx.translate(-pivotX, -pivotY);
    blit(ctx, 0, 0, rows, pal);
    ctx.restore();
  }
  function plot(ctx, ox, oy, pts, color, alpha) {
    if (alpha != null) { ctx.save(); ctx.globalAlpha = alpha; }
    ctx.fillStyle = color;
    for (const p of pts) ctx.fillRect(ox + p[0], oy + p[1], 1, 1);
    if (alpha != null) ctx.restore();
  }
  function tileRect(ctx, x0, y0, w, h, rows, pal) {
    const tw = rows[0].length, th = rows.length;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    const sx = x0 - (((x0 % tw) + tw) % tw);
    const sy = y0 - (((y0 % th) + th) % th);
    for (let y = sy; y < y0 + h; y += th) for (let x = sx; x < x0 + w; x += tw) blit(ctx, x, y, rows, pal);
    ctx.restore();
  }
  function vband(ctx, x, y, w, h, top, bot, steps) {
    steps = steps || 12;
    for (let i = 0; i < steps; i++) {
      const yy = y + Math.floor((h * i) / steps);
      const yh = Math.ceil(h / steps) + 1;
      ctx.fillStyle = mix(top, bot, i / (steps - 1));
      ctx.fillRect(x, yy, w, yh);
    }
  }
  function fillA(ctx, x, y, w, h, color, alpha) { ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.restore(); }
  function glow(ctx, x, y, r, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha == null ? 1 : alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ===================================================================
  // hand-designed tiling textures (recoloured per scene via palette)
  // ===================================================================
  function brickRows() { // 16x8 running-bond brick: . mortar, h lit top, b base, s AO shadow
    function course(offset) {
      const j1 = offset, j2 = (offset + 8) % 16;
      let top = '', mid = '', bot = '';
      for (let x = 0; x < 16; x++) {
        const joint = x === j1 || x === j2;
        top += joint ? '.' : 'h'; mid += joint ? '.' : 'b'; bot += joint ? '.' : 's';
      }
      return [top, mid, bot];
    }
    const m = '.'.repeat(16);
    return [m, ...course(0), m, ...course(4)];
  }
  function plankRows() { // 16x4 horizontal floor planks: l top edge, b base, g grain fleck, s seam
    let base = '';
    for (let x = 0; x < 16; x++) base += (x === 5 || x === 11) ? 'g' : 'b';
    return ['llllllllllllllll', base, base, 'ssssssssssssssss'];
  }
  function plankVRows() { // 4x8 vertical wall siding: l light edge, b base, s shadow edge, k joint
    return ['lbbs', 'lbbs', 'lbbs', 'lbbs', 'lbbs', 'lbbs', 'lbbs', 'kkkk'];
  }
  function panelRows() { // 8x8 ridged metal panel: k seam, l light col, b base col, s shadow col
    const row = 'klbs'.repeat(2);
    return [row, row, row, row, row, row, row, 'kkkkkkkk'];
  }
  function checkerRows() { // 16x16 marble checker: g grout, a light sq, b dark sq
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let row = '';
      for (let x = 0; x < 16; x++) {
        const grout = x === 0 || y === 0;
        const sq = (x < 8 ? 0 : 1) ^ (y < 8 ? 0 : 1);
        row += grout ? 'g' : (sq ? 'b' : 'a');
      }
      rows.push(row);
    }
    return rows;
  }
  function carpetRows() { // 16x16 diamond lattice: c base, d dark line, g gold accent
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let row = '';
      for (let x = 0; x < 16; x++) {
        const d = Math.abs(x - 8) + Math.abs(y - 8);
        row += d === 8 ? 'd' : d === 4 ? 'g' : 'c';
      }
      rows.push(row);
    }
    return rows;
  }
  function damaskRows() { // 16x16 wallpaper lattice (quieter cousin of carpetRows): c base, d line
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let row = '';
      for (let x = 0; x < 16; x++) {
        const d = Math.abs(x - 8) + Math.abs(y - 8);
        row += d === 8 || d === 0 ? 'd' : 'c';
      }
      rows.push(row);
    }
    return rows;
  }
  function cobbleRows() { // 8x8 rounded stones: k outline, l lit, b base, s shadow
    return ['kkkkkkkk', 'klbbbsbk', 'klbbbsbk', 'kssbbbbk', 'kbbklbbk', 'kbblbbsk', 'ksbbbbsk', 'kkkkkkkk'];
  }
  function velvetRows() { // 8x8 tufted velvet quilting: b base, s fold shadow, h button highlight
    const g = makeGrid(8, 8, 'b');
    lineG(g, 0, 0, 7, 7, 's'); lineG(g, 0, 7, 7, 0, 's');
    setPx(g, 0, 0, 'h'); setPx(g, 7, 0, 'h'); setPx(g, 0, 7, 'h'); setPx(g, 7, 7, 'h'); setPx(g, 4, 4, 'h');
    return rowsOf(g);
  }

  // ===================================================================
  // hand-designed props (parametric, deliberate — not random)
  // ===================================================================
  function glassCh(x, y, h, mid) {
    const diag = (x - mid) * 0.5 + y;
    if (diag < h * 0.22) return 'h';
    if (diag > h * 0.85) return 'e';
    return 'g';
  }
  function archWindowRows(w, archH, bodyH, frameT) {
    frameT = frameT || 2;
    const g = makeGrid(w, archH + bodyH, '.');
    const mid = (w - 1) / 2;
    for (let y = 0; y < archH; y++) {
      const half = mid * ((y + 1) / archH);
      for (let x = 0; x < w; x++) {
        const d = Math.abs(x - mid);
        if (d > half) continue;
        setPx(g, x, y, d > half - frameT ? 'k' : glassCh(x, y, archH + bodyH, mid));
      }
    }
    for (let y = archH; y < archH + bodyH; y++) for (let x = 0; x < w; x++) {
      if (x < frameT || x >= w - frameT || y >= archH + bodyH - frameT) setPx(g, x, y, 'k');
      else setPx(g, x, y, glassCh(x, y, archH + bodyH, mid));
    }
    lineG(g, mid, 0, mid, archH + bodyH - 1, 'k');
    for (let y = archH; y < archH + bodyH; y += 6) lineG(g, frameT, y, w - frameT - 1, y, 'k');
    return rowsOf(g);
  }
  function stainedRows(w, h) {
    const cols = ['p', 'q', 'r', 'o'];
    const g = makeGrid(w, h, 'k');
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      setPx(g, x, y, cols[(Math.floor(x / 4) + Math.floor(y / 4)) % cols.length]);
    }
    for (let x = 0; x < w; x += 4) lineG(g, x, 0, x, h - 1, 'k');
    for (let y = 0; y < h; y += 4) lineG(g, 0, y, w - 1, y, 'k');
    strokeRectG(g, 0, 0, w, h, 'k');
    return rowsOf(g);
  }
  function vaultDoorRows(r) {
    const d = r * 2 + 1;
    const g = makeGrid(d, d, '.');
    shadedDisc(g, r, r, r, { hi: 'e', lit: 'd', base: 'c', shadow: 'b', rim: 'k' });
    shadedDisc(g, r, r, Math.round(r * 0.32), { hi: 'e', lit: 'd', base: 'c', shadow: 'b', rim: 'k' });
    const n = 12, br = r - 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      setPx(g, Math.round(r + Math.cos(a) * br), Math.round(r + Math.sin(a) * br), 'k');
    }
    const hr = Math.round(r * 0.32) - 2;
    lineG(g, r - hr, r, r + hr, r, 'k'); lineG(g, r, r - hr, r, r + hr, 'k');
    return rowsOf(g);
  }
  function barrelRows(w, h) {
    const g = makeGrid(w, h, '.');
    fillRectG(g, 1, 1, w - 2, h - 2, 'b');
    for (let y = 1; y < h - 1; y++) { setPx(g, 1, y, 'l'); setPx(g, w - 2, y, 's'); }
    [Math.floor(h * 0.25), Math.floor(h * 0.5), Math.floor(h * 0.75)].forEach((y) => fillRectG(g, 1, y, w - 2, 1, 'k'));
    strokeRectG(g, 0, 0, w, h, 'k');
    return rowsOf(g);
  }
  function crateRows(w, h) {
    const g = makeGrid(w, h, '.');
    fillRectG(g, 0, 0, w, h, 'b');
    strokeRectG(g, 0, 0, w, h, 'k');
    lineG(g, 1, 1, w - 2, h - 2, 'l');
    lineG(g, w - 2, 1, 1, h - 2, 's');
    fillRectG(g, 1, 1, w - 2, 1, 'l');
    fillRectG(g, 1, h - 2, w - 2, 1, 's');
    return rowsOf(g);
  }
  function curtainRows(w, h) {
    const g = makeGrid(w, h, '.');
    for (let x = 0; x < w; x++) {
      const wobble = Math.sin((x / w) * Math.PI * 3);
      const hem = h - 3 + Math.round(2 + Math.sin((x / w) * Math.PI * 4) * 2);
      for (let y = 2; y < hem; y++) setPx(g, x, y, wobble > 0.25 ? 'l' : wobble < -0.35 ? 's' : 'b');
      setPx(g, x, Math.min(hem, h - 1), 'k');
    }
    fillRectG(g, 0, 0, w, 2, 'g');
    return rowsOf(g);
  }
  function chandelierRows(w, h) {
    const g = makeGrid(w, h, '.');
    const cx = Math.floor(w / 2);
    lineG(g, cx, 0, cx, 4, 'k');
    shadedDisc(g, cx, 7, 3, { hi: 'e', lit: 'd', base: 'c', shadow: 'b', rim: 'k' });
    for (let i = 0; i < 5; i++) {
      const ax = 2 + Math.round((i / 4) * (w - 4));
      lineG(g, cx, 8, ax, 12, 'k');
      setPx(g, ax, 13, 'f'); setPx(g, ax, 14, 'f');
    }
    return rowsOf(g);
  }
  function lampRows(w, h) {
    const g = makeGrid(w, h, '.');
    const cx = Math.floor(w / 2);
    lineG(g, cx, 0, cx, 3, 'k');
    strokeRectG(g, cx - 3, 3, 7, 3, 'k');
    shadedBox(g, cx - 2, 6, 5, 6, { lit: 'd', base: 'c', shadow: 'b' });
    fillRectG(g, cx - 1, 7, 3, 4, 'f');
    strokeRectG(g, cx - 3, 12, 7, 2, 'k');
    return rowsOf(g);
  }
  function frameRows(w, h) {
    const g = makeGrid(w, h, '.');
    shadedBox(g, 0, 0, w, h, { lit: 'l', base: 'f', shadow: 's', outline: 'k' });
    fillRectG(g, 2, 2, w - 4, h - 4, 'p');
    return rowsOf(g);
  }
  function pipeRows(w, h) {
    const g = makeGrid(w, h, '.');
    fillRectG(g, 0, 0, w, h, 'c');
    for (let x = 0; x < Math.floor(w * 0.4); x++) for (let y = 0; y < h; y++) setPx(g, x, y, 'l');
    for (let x = Math.floor(w * 0.75); x < w; x++) for (let y = 0; y < h; y++) setPx(g, x, y, 's');
    for (let y = 4; y < h; y += 10) { fillRectG(g, 0, y, w, 1, 'k'); for (let x = 1; x < w; x += 3) setPx(g, x, y, 'r'); }
    strokeRectG(g, 0, 0, w, h, 'k');
    return rowsOf(g);
  }
  function moonRows(r, offset) {
    const d = r * 2 + 1;
    const g = makeGrid(d, d, '.');
    for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
      const dist = Math.hypot(x - r, y - r);
      const dist2 = Math.hypot(x - r - offset, y - r);
      if (dist <= r && dist2 > r * 0.9) setPx(g, x, y, dist > r - 1.4 ? 'h' : 'm');
    }
    return rowsOf(g);
  }
  function shelfRows(w) {
    const h = 5;
    const g = makeGrid(w, h, '.');
    fillRectG(g, 0, 0, w, 1, 'd'); fillRectG(g, 0, 1, w, 1, 'c'); fillRectG(g, 0, 2, w, 1, 's');
    fillRectG(g, 0, 3, 1, h - 3, 'd'); fillRectG(g, w - 1, 3, 1, h - 3, 'd');
    return rowsOf(g);
  }
  function bottleRows(h, capCh) {
    const w = 3;
    const g = makeGrid(w, h, '.');
    fillRectG(g, 0, 2, w, h - 2, 'c');
    setPx(g, 0, 2, 'l'); setPx(g, w - 1, h - 1, 's');
    fillRectG(g, 1, 0, 1, 2, capCh || 'k');
    return rowsOf(g);
  }
  function brokenShelfRows(w) {
    const h = 6;
    const g = makeGrid(w, h, '.');
    for (let x = 0; x < w; x++) {
      if (x < w * 0.55 || x > w * 0.8) {
        const sag = x > w * 0.8 ? Math.floor((x - w * 0.8) / 2) : 0;
        fillRectG(g, x, sag, 1, 1, 'd'); fillRectG(g, x, sag + 1, 1, 1, 's');
      }
    }
    return rowsOf(g);
  }
  function doorRows(w, h) {
    const g = makeGrid(w, h, '.');
    shadedBox(g, 0, 0, w, h, { lit: 'l', base: 'b', shadow: 's', outline: 'k' });
    fillRectG(g, 3, 3, w - 6, h - 6, 'p');
    setPx(g, w - 3, Math.floor(h / 2), 'k');
    return rowsOf(g);
  }
  function registerRows(w, h) {
    const g = makeGrid(w, h, '.');
    shadedBox(g, 0, 2, w, h - 2, { lit: 'l', base: 'b', shadow: 's', outline: 'k' });
    fillRectG(g, 1, 0, w - 2, 3, 'd');
    for (let i = 0; i < 3; i++) setPx(g, 2 + i * 2, 1, 'k');
    return rowsOf(g);
  }
  const HEART_PTS = [[1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [4, 4], [3, 5]];
  const SPADE_PTS = [[3, 0], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [3, 5], [3, 6]];
  function cobwebRows(size) {
    const g = makeGrid(size, size, '.');
    for (let i = 0; i <= 3; i++) lineG(g, 0, 0, Math.round((i / 3) * (size - 1)), size - 1, 'k');
    for (let r = 3; r < size; r += 4) for (let a = 0; a <= 6; a++) {
      const ang = (a / 6) * (Math.PI / 2);
      setPx(g, Math.round(Math.sin(ang) * r), Math.round(Math.cos(ang) * r), 'k');
    }
    return rowsOf(g);
  }
  function drawSkyline(ctx, x0, w, baseline, col, litCol) {
    let x = x0, i = 0;
    while (x < x0 + w) {
      const bw = 6 + (i * 37) % 11, bh = 12 + (i * 53) % 30;
      ctx.fillStyle = col; ctx.fillRect(x, baseline - bh, bw, bh);
      if (i % 3 !== 0) {
        ctx.fillStyle = litCol;
        for (let wy = baseline - bh + 3; wy < baseline - 3; wy += 5) for (let wx = x + 2; wx < x + bw - 2; wx += 4) ctx.fillRect(wx, wy, 1, 2);
      }
      x += bw + 2; i++;
    }
  }
  function drawRain(ctx, t, n, col, x0, w) {
    ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
    const span = FLOOR_TOP - 4;
    for (let i = 0; i < n; i++) {
      const seed = i * 97.13;
      const x = x0 + ((seed * 3 + t * 90) % w);
      const yy = (seed * 53 + t * 240) % span;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 3, yy + 9); ctx.stroke();
    }
    ctx.restore();
  }

  // ===================================================================
  // scene composition helpers
  // ===================================================================
  function sceneFloorSheen(ctx, baseCol) {
    fillA(ctx, 0, GROUND - 2, W, 5, '#ffffff', 0.08);
    fillA(ctx, 0, FLOOR_TOP, W, 3, shade(baseCol, 24), 0.4);
  }

  // ===================================================================
  // the 10 scenes
  // ===================================================================
  const SCENES = {};

  // ---- ALLEY: Mudwick Alley — grimy backstreet, purple night brick ----
  SCENES.alley = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#1a1428', '#312846', 14);
      tileRect(ctx, 0, 8, W, FLOOR_TOP - 8, brickRows(), { '.': '#1f182c', h: '#473a52', b: '#39304a', s: '#281f36' });
      blit(ctx, 300, 10, moonRows(8, 4), { m: '#e7eadd', h: '#fbf6e2' });
      blit(ctx, 246, 16, archWindowRows(14, 5, 12, 2), { k: OUTLINE, h: '#ffe9b0', g: '#caa24a', e: '#8a6a2a' });
      fillA(ctx, 0, 60, W, 22, '#262049', 0.25);
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, cobbleRows(), { k: '#16111f', l: '#473d53', b: '#332940', s: '#221a2e', w: '#5c5570' });
      sceneFloorSheen(ctx, '#332940');
      blit(ctx, 314, 112, crateRows(16, 16), { k: OUTLINE, b: '#4a3a2c', l: '#6a543c', s: '#2e2218' });
      blit(ctx, 298, 104, barrelRows(13, 24), { k: OUTLINE, b: '#443424', l: '#5e4a34', s: '#2a2016' });
      blit(ctx, 8, 0, lampRows(9, 16), { k: OUTLINE, d: '#8a7a60', c: '#5a4a38', b: '#3a2e22', f: '#ffdd88' });
    },
    anim(ctx, t) {
      glow(ctx, 12, 12, 10, '#ffdd88', 0.5 + 0.18 * Math.sin(t * 5));
      glow(ctx, 304, 15, 8, '#eef0e0', 0.45);
      ctx.save(); ctx.globalAlpha = 0.1; ctx.fillStyle = '#c7cdfa';
      const fx = (t * 9) % (W + 70) - 70;
      ctx.fillRect(fx, 118, 70, 14); ctx.fillRect(fx + 150, 122, 90, 10);
      ctx.restore();
    },
  };

  // ---- DOCKS: Foggy Docks — pier warehouse, fog & creaking boards ----
  SCENES.docks = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#1b2a34', '#577886', 16);
      ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#213038';
      for (let x = 14; x < W; x += 44) ctx.fillRect(x, 92, 4, FLOOR_TOP - 92);
      ctx.restore();
      tileRect(ctx, 0, 26, 26, FLOOR_TOP - 26, plankVRows(), { l: '#5a6e76', b: '#44565e', s: '#2e3c42', k: '#20292e' });
      tileRect(ctx, W - 26, 26, 26, FLOOR_TOP - 26, plankVRows(), { l: '#5a6e76', b: '#44565e', s: '#2e3c42', k: '#20292e' });
      blit(ctx, 34, 12, moonRows(8, -3), { m: '#e4eef2', h: '#ffffff' });
      blit(ctx, 2, 108, crateRows(15, 14), { k: OUTLINE, b: '#4a3a2c', l: '#6a543c', s: '#2a2016' });
      blit(ctx, 306, 100, barrelRows(13, 22), { k: OUTLINE, b: '#3e4a44', l: '#56665e', s: '#262e2a' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, plankRows(), { l: '#5c6a60', b: '#465850', g: '#374640', s: '#293530' });
      sceneFloorSheen(ctx, '#465850');
    },
    anim(ctx, t) {
      const fx = (t * 11) % (W + 120) - 60;
      glow(ctx, fx, 72, 34, '#dfefff', 0.14);
      glow(ctx, fx + 120, 92, 26, '#dfefff', 0.12);
      glow(ctx, fx + 230, 80, 30, '#dfefff', 0.13);
      glow(ctx, 38, 16, 5, '#eaf4ff', 0.3);
      if (Math.sin(t * 2.3) > 0.85) fillA(ctx, 0, 0, W, FLOOR_TOP, '#dfeeff', 0.05);
    },
  };

  // ---- CASINO: Lucky Hex Casino — velvet, carpet, neon suits ----
  SCENES.casino = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#1c0a16', '#3a1226', 14);
      tileRect(ctx, 0, 40, W, FLOOR_TOP - 40, velvetRows(), { b: '#380f20', s: '#2a0a18', h: '#4a1a2c' });
      fillA(ctx, 0, 38, W, 2, '#caa24a', 0.8);
      blit(ctx, 168, 6, chandelierRows(56, 16), { k: '#3a2a1a', f: '#ffe9a0', d: '#d8b05a', c: '#b8923e', e: '#fff3c8' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, carpetRows(), { c: '#521828', d: '#380f1c', g: '#caa24a' });
      sceneFloorSheen(ctx, '#521828');
    },
    anim(ctx, t) {
      const c1 = mix('#ff2f7a', '#ffd84a', (Math.sin(t * 2) + 1) / 2);
      const c2 = mix('#2fd8ff', '#8affc8', (Math.sin(t * 2 + 2) + 1) / 2);
      plot(ctx, 8, 18, HEART_PTS, c1); glow(ctx, 12, 24, 10, c1, 0.5);
      plot(ctx, 316, 18, SPADE_PTS, c2); glow(ctx, 320, 24, 10, c2, 0.5);
      glow(ctx, 168, 14, 5, '#ffe9a0', 0.6 + 0.2 * Math.sin(t * 6));
    },
  };

  // ---- SEWERS: damp green-brown brick, pipes, drips ----
  SCENES.sewers = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#19241c', '#30402e', 14);
      tileRect(ctx, 0, 6, W, FLOOR_TOP - 6, brickRows(), { '.': '#182018', h: '#44523c', b: '#36442f', s: '#242e20' });
      blit(ctx, 10, 14, pipeRows(12, 90), { c: '#4a5a46', l: '#647a5c', s: '#303e2c', k: '#1c241a', r: '#222' });
      blit(ctx, 314, 14, pipeRows(12, 90), { c: '#4a5a46', l: '#647a5c', s: '#303e2c', k: '#1c241a', r: '#222' });
      fillA(ctx, 0, 72, W, 8, '#4a5a44', 0.3);
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, cobbleRows(), { k: '#161e16', l: '#424e3a', b: '#2e3a28', s: '#1e2819' });
      sceneFloorSheen(ctx, '#2e3a28');
      fillA(ctx, 130, FLOOR_TOP + 10, 50, 7, '#2a3a36', 0.55);
      glow(ctx, 95, FLOOR_TOP + 16, 9, '#7ec6b8', 0.3);
      glow(ctx, 230, FLOOR_TOP + 20, 7, '#7ec6b8', 0.22);
    },
    anim(ctx, t) {
      fillA(ctx, 0, 0, W, FLOOR_TOP, '#3a7a5a', 0.04 + 0.02 * Math.sin(t * 2));
      [[60, 1.3], [250, 2.1]].forEach(([x, period]) => {
        const ph = (t % period) / period;
        fillA(ctx, x, 18 + ph * 100, 1, 2, '#9adfe0', 1 - ph * 0.3);
      });
      ctx.save(); ctx.globalAlpha = 0.3; ctx.strokeStyle = '#9adfe0'; ctx.lineWidth = 1;
      const rp = (t % 1.6) / 1.6;
      ctx.beginPath(); ctx.ellipse(155, FLOOR_TOP + 13, rp * 16, rp * 5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },
  };

  // ---- VAULT: Gnome Bank Vault — steel, checker marble, big door ----
  SCENES.vault = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#363c44', '#565c66', 12);
      tileRect(ctx, 0, 10, W, FLOOR_TOP - 10, panelRows(), { k: '#2e333a', l: '#6a727c', b: '#555d66', s: '#3c424a' });
      blit(ctx, 140, 18, vaultDoorRows(28), { k: '#3a4048', c: '#8a929c', d: '#a8b0ba', e: '#d4dbe2', b: '#6c747e' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, checkerRows(), { g: '#454c52', a: '#888f96', b: '#5c636a' });
      sceneFloorSheen(ctx, '#5c636a');
    },
    anim(ctx, t) {
      glow(ctx, 168, 46, 20, '#eaf2ff', 0.14 + 0.05 * Math.sin(t * 1.5));
      ctx.save(); ctx.translate(168, 46); ctx.rotate(t * 0.12); ctx.strokeStyle = '#454a50'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke(); ctx.restore();
    },
  };

  // ---- OPERA: Moonlit Opera — velvet curtains, chandelier, stained glass ----
  SCENES.opera = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#280a14', '#4a1222', 14);
      blit(ctx, 148, 6, stainedRows(40, 44), { k: OUTLINE, p: '#7a2a4a', q: '#3a2a6a', r: '#8a5a2a', o: '#2a5a4a' });
      blit(ctx, 2, 0, curtainRows(34, FLOOR_TOP), { b: '#5a1222', l: '#7a1a30', s: '#3c0c18', k: OUTLINE, g: '#caa24a' });
      blit(ctx, W - 36, 0, curtainRows(34, FLOOR_TOP), { b: '#5a1222', l: '#7a1a30', s: '#3c0c18', k: OUTLINE, g: '#caa24a' });
      blit(ctx, 140, 50, chandelierRows(56, 18), { k: '#3a2a1a', f: '#ffe9a0', d: '#d8b05a', c: '#b8923e', e: '#fff3c8' });
      fillA(ctx, 0, FLOOR_TOP - 4, W, 2, '#caa24a', 0.6);
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, carpetRows(), { c: '#4a1420', d: '#300c16', g: '#caa24a' });
      sceneFloorSheen(ctx, '#4a1420');
    },
    anim(ctx, t) {
      glow(ctx, 168, 63, 7, '#ffe9a0', 0.6 + 0.2 * Math.sin(t * 6));
      for (let i = 0; i < 3; i++) {
        const y = 10 + ((t * 14 + i * 28) % 100);
        fillA(ctx, 150 + i * 30, y, 2, 2, '#fff2c8', 0.5);
      }
    },
  };

  // ---- MANSION: Gloom Manor — plum damask, portraits, grand window ----
  SCENES.mansion = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#231526', '#3a2440', 14);
      tileRect(ctx, 0, 6, W, FLOOR_TOP - 6, damaskRows(), { c: '#28192e', d: '#331f3a' });
      blit(ctx, 250, 8, archWindowRows(26, 10, 24, 2), { k: OUTLINE, h: '#cfd3e8', g: '#8a90b8', e: '#4e4e74' });
      [[20, 16], [86, 20]].forEach((p) => blit(ctx, p[0], p[1], frameRows(16, 20), { k: OUTLINE, l: '#6a4a30', f: '#4a321e', s: '#2a1c10', p: '#caa078' }));
      blit(ctx, 4, 4, cobwebRows(18), { k: 'rgba(220,220,235,0.5)' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, plankRows(), { l: '#6a4e36', b: '#54392a', g: '#432c1e', s: '#322016' });
      sceneFloorSheen(ctx, '#54392a');
    },
    anim(ctx, t) {
      glow(ctx, 263, 30, 9, '#e7e9ff', 0.35 + 0.1 * Math.sin(t * 2));
      if (Math.sin(t * 0.7) > 0.96) fillA(ctx, 0, 0, W, FLOOR_TOP, '#eaeaff', 0.18);
    },
  };

  // ---- TOWER: Kingpin Tower — penthouse, city skyline, rain ----
  SCENES.tower = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#120a1e', '#241334', 14);
      tileRect(ctx, 0, 6, W, FLOOR_TOP - 6, panelRows(), { k: '#190e24', l: '#2e1a40', b: '#241334', s: '#160b1e' });
      blit(ctx, 60, 6, archWindowRows(30, 8, 30, 2), { k: '#1a1024', h: '#cfe0ff', g: '#201030', e: '#140a1c' });
      drawSkyline(ctx, 62, 26, 44, '#120a1e', '#ffd27a');
      blit(ctx, 236, 6, archWindowRows(30, 8, 30, 2), { k: '#1a1024', h: '#cfe0ff', g: '#201030', e: '#140a1c' });
      drawSkyline(ctx, 238, 26, 44, '#120a1e', '#ffd27a');
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, checkerRows(), { g: '#160b1e', a: '#2a1838', b: '#1e1028' });
      sceneFloorSheen(ctx, '#1e1028');
    },
    anim(ctx, t) {
      drawRain(ctx, t, 26, '#8aa0cf', 0, W);
      glow(ctx, 76, 141, 13, '#c83a5a', 0.18 + 0.08 * Math.sin(t * 3));
      glow(ctx, 252, 141, 13, '#c83a5a', 0.18 + 0.08 * Math.sin(t * 3 + 1.4));
    },
  };

  // ---- SHOP: cosy intact wand shop ----
  SCENES.shop = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#4a2f20', '#a8764c', 14);
      tileRect(ctx, 0, 6, W, FLOOR_TOP - 6, plankVRows(), { l: '#926a44', b: '#7a5636', s: '#5c4028', k: '#432e1c' });
      blit(ctx, 18, 10, archWindowRows(30, 8, 20, 2), { k: '#3a2616', h: '#2a2050', g: '#3a3270', e: '#201848' });
      blit(ctx, 30, 20, moonRows(6, -2), { m: '#e7eadd', h: '#fbf6e2' });
      const wandCols = ['#ff7a3a', '#7ad7ff', '#ffe066', '#b48cff', '#7dff9a', '#ff5fd2', '#8fe3ff', '#f3c24a'];
      for (let row = 0; row < 3; row++) {
        const sy = 20 + row * 16;
        blit(ctx, 150, sy, shelfRows(150), { d: '#8a5e36', c: '#6a4526', s: '#4a301a' });
        for (let i = 0; i < 9; i++) blit(ctx, 156 + i * 16, sy - 12, bottleRows(12), { c: wandCols[(row * 9 + i) % wandCols.length], l: '#ffffff', s: shade(wandCols[(row * 9 + i) % wandCols.length], -40), k: '#3a2a1a' });
      }
      blit(ctx, 166, 2, lampRows(9, 16), { k: '#3a2616', d: '#caa062', c: '#8a6a3a', b: '#5c4024', f: '#ffdd88' });
      blit(ctx, 262, 106, registerRows(26, 16), { k: OUTLINE, l: '#8a8a94', b: '#6a6a76', s: '#464650', d: '#caa858' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, plankRows(), { l: '#c89a68', b: '#a8794c', g: '#8a5e38', s: '#6a4830' });
      sceneFloorSheen(ctx, '#a8794c');
      blit(ctx, 254, 92, crateRows(14, 14), { k: OUTLINE, b: '#8a5e36', l: '#a8794c', s: '#5c4024' });
    },
    anim(ctx, t) {
      glow(ctx, 170, 28, 10, '#ffdd88', 0.5 + 0.15 * Math.sin(t * 6));
      glow(ctx, 32, 24, 7, '#e7eadd', 0.4);
      for (let row = 0; row < 3; row++) glow(ctx, 160 + ((t * 20 + row * 50) % 144), 20 + row * 16 - 6, 4, '#ffffff', 0.18);
    },
  };

  // ---- SHOP RUINED: same shop, smashed ----
  SCENES.shopRuined = {
    base(ctx) {
      vband(ctx, 0, 0, W, FLOOR_TOP, '#20191c', '#4a3a3e', 14);
      tileRect(ctx, 0, 6, W, FLOOR_TOP - 6, plankVRows(), { l: '#5c4e42', b: '#463a30', s: '#2e261e', k: '#1c1712' });
      blit(ctx, 18, 10, archWindowRows(30, 8, 20, 2), { k: '#2a2018', h: '#2a2050', g: '#201848', e: '#140e2c' });
      ctx.save(); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(22, 14); ctx.lineTo(30, 24); ctx.lineTo(26, 30); ctx.moveTo(30, 24); ctx.lineTo(40, 28); ctx.stroke();
      ctx.restore();
      for (let row = 0; row < 3; row++) {
        const sy = 20 + row * 16;
        blit(ctx, 150, sy, brokenShelfRows(150), { d: '#5a3e24', s: '#3a2814' });
      }
      const shardCols = ['#ff7a3a', '#7ad7ff', '#ffe066', '#b48cff'];
      [[160, 128], [184, 132], [206, 126], [228, 134], [172, 118]].forEach((p, i) => {
        plot(ctx, p[0], p[1], [[0, 0], [1, 0], [0, 1]], shardCols[i % shardCols.length]);
      });
      blitRot(ctx, doorRows(16, 52), { k: OUTLINE, l: '#6a5440', b: '#4a3a2c', s: '#2c2218', p: '#3a2c1e' }, 6, 68, 2, 2, 0.3);
      blit(ctx, 166, 2, lampRows(9, 16), { k: '#2a2018', d: '#6a5a44', c: '#443828', b: '#2c2218', f: '#6a5a3a' });
      blit(ctx, 262, 106, registerRows(26, 16), { k: OUTLINE, l: '#6a6a70', b: '#4a4a52', s: '#2e2e36', d: '#6a5c3a' });
      tileRect(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, plankRows(), { l: '#6a5240', b: '#4e3c2e', g: '#3a2c20', s: '#241a14' });
      sceneFloorSheen(ctx, '#4e3c2e');
      [[60, 142], [100, 148], [220, 144], [270, 150]].forEach((p, i) => plot(ctx, p[0], p[1], splinterDebris(i), '#6a4a30'));
    },
    anim(ctx, t) {
      if (Math.sin(t * 9) > 0.7) glow(ctx, 170, 28, 7, '#ffcc66', 0.3);
      ctx.save(); ctx.globalAlpha = 0.08 + 0.04 * Math.sin(t * 1.3); ctx.fillStyle = '#cfcfd8';
      const dx = (t * 6) % 60;
      ctx.fillRect(dx, 40, 2, 2); ctx.fillRect(dx + 120, 70, 2, 2); ctx.fillRect(dx + 220, 55, 2, 2);
      ctx.restore();
    },
  };
  function splinterDebris(i) {
    const pts = [];
    for (let k = 0; k < 4; k++) pts.push([Math.round(Math.sin(i * 3 + k) * 3), Math.round(Math.cos(i * 2 + k) * 1.2)]);
    return pts;
  }

  // ===================================================================
  // public API
  // ===================================================================
  const CACHE = Object.create(null);
  function cachedCanvas(key, drawFn) {
    let c = CACHE[key];
    if (!c) {
      c = document.createElement('canvas');
      c.width = W; c.height = H;
      drawFn(c.getContext('2d'));
      CACHE[key] = c;
    }
    return c;
  }
  function has(locKey) { return !!SCENES[locKey]; }
  function draw(g, locKey, t) {
    // Generated backgrounds use the same one-time Pix construction/cache.
    // Return before the old scene overlays so their lights cannot obscure it.
    const pixKey = 'bg:' + locKey;
    if (typeof Pix !== 'undefined' && Pix.has(pixKey)) {
      g.drawImage(Pix.get(pixKey)[0], 0, 0);
      return;
    }
    const scene = SCENES[locKey] || SCENES.shop;
    const base = cachedCanvas(locKey, scene.base);
    g.drawImage(base, 0, 0);
    if (scene.anim) scene.anim(g, t || 0);
  }
  return { has, draw };
})();
