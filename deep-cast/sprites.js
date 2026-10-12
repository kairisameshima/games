'use strict';
/* =====================================================================
   DEEP CAST — procedural pixel sprites.
   Pure canvas pixel art, no images. Everything is cached into offscreen
   canvases keyed by (species/legend key, rounded length, frame, shiny);
   draw calls are cheap drawImage blits.
   ===================================================================== */
const Sprites = (function () {

  /* ---------------- color helpers ---------------- */
  function hx(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgb(r, g, b) { r = Math.max(0, Math.min(255, r | 0)); g = Math.max(0, Math.min(255, g | 0)); b = Math.max(0, Math.min(255, b | 0)); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }
  function mix(a, b, t) { const A = hx(a), B = hx(b); return rgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function dark(c, t) { return mix(c, '#000000', t); }
  function light(c, t) { return mix(c, '#ffffff', t); }
  const GOLD1 = '#ffd84a', GOLD2 = '#fff6c8', GOLD3 = '#9a6a0a';

  /* ---------------- canvas / pixel primitives (integer, no AA) ---------------- */
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    return { c, g };
  }
  function R(g, x, y, w, h, col) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    g.fillStyle = col; g.fillRect(x, y, w, h);
  }
  function ellip(g, cx, cy, rx, ry, col) {
    ry = Math.max(1, Math.round(ry)); rx = Math.max(0.5, rx);
    for (let dy = -ry; dy <= ry; dy++) {
      const f = 1 - (dy * dy) / (ry * ry); if (f < 0) continue;
      const dx = rx * Math.sqrt(f);
      R(g, cx - dx, cy + dy, dx * 2, 1, col);
    }
  }
  function ellipO(g, cx, cy, rx, ry, col, outline) {
    ellip(g, cx, cy, rx + 1, ry + 1, outline);
    ellip(g, cx, cy, rx, ry, col);
  }
  function domeTop(g, cx, cy, rx, ry, col) {
    ry = Math.max(1, Math.round(ry));
    for (let dy = -ry; dy <= 0; dy++) {
      const f = 1 - (dy * dy) / (ry * ry); if (f < 0) continue;
      const dx = rx * Math.sqrt(f);
      R(g, cx - dx, cy + dy, dx * 2, 1, col);
    }
  }
  function domeTopO(g, cx, cy, rx, ry, col, outline) {
    domeTop(g, cx, cy, rx + 1, ry + 1, outline);
    domeTop(g, cx, cy, rx, ry, col);
  }
  function bellyShade(g, cx, cy, rx, ry, col) {
    ry = Math.max(1, Math.round(ry));
    for (let dy = 0; dy <= ry; dy++) {
      const f = 1 - (dy * dy) / (ry * ry); if (f < 0) continue;
      const dx = rx * Math.sqrt(f);
      R(g, cx - dx, cy + dy, dx * 2, 1, col);
    }
  }
  function triH(g, x0, x1, yc, h0, h1, col) { // horizontal taper from x0 (half-height h0) to x1 (half-height h1)
    const n = Math.max(1, Math.round(Math.abs(x1 - x0))); const dir = x1 >= x0 ? 1 : -1;
    for (let i = 0; i <= n; i++) { const t = i / n; const h = h0 + (h1 - h0) * t; R(g, x0 + dir * i, yc - h / 2, 1, h, col); }
  }
  function triV(g, xc, y0, y1, w0, w1, col) { // vertical taper from y0 (half-width w0) to y1 (half-width w1)
    const n = Math.max(1, Math.round(Math.abs(y1 - y0))); const dir = y1 >= y0 ? 1 : -1;
    for (let i = 0; i <= n; i++) { const t = i / n; const w = w0 + (w1 - w0) * t; R(g, xc - w / 2, y0 + dir * i, w, 1, col); }
  }
  function rhombusWing(g, xFront, xBack, yc, peakH, col) {
    const xm = (xFront + xBack) / 2;
    triH(g, xFront, xm, yc, 1, peakH, col);
    triH(g, xBack, xm, yc, 1, peakH, col);
  }
  function wavy(g, x0, y0, x1, y1, amp, freq, phase, thick, col, growFromStart) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t;
      const env = growFromStart === false ? (1 - t) : t;
      const off = Math.sin(t * Math.PI * 2 * freq + phase) * amp * env;
      R(g, bx + off, by, thick, thick, col);
    }
  }
  function eyeDot(g, x, y, dir, r) {
    r = r || 1;
    R(g, x - r, y - r, r * 2 + 1, r * 2 + 1, '#f0f4f8');
    const pr = Math.max(1, Math.round(r * 0.5));
    R(g, x + (dir >= 0 ? pr : -pr) - Math.floor(pr / 2), y - Math.floor(pr / 2), pr, pr, '#0a0a0c');
  }
  function glowBlob(g, x, y, r, col) {
    if (r <= 0) return;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col); grad.addColorStop(0.5, col); grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function lineSeg(g, x0, y0, x1, y1, col) {
    const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) { const t = i / n; R(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1, 1, col); }
  }

  /* ---------------- species color / pattern ---------------- */
  function luminance(hex) { const c = hx(hex); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  function colorsFor(spec, shiny) {
    let body = spec.body, belly = spec.belly, fin = spec.fin;
    if (shiny) { body = mix(body, GOLD1, 0.6); belly = mix(belly, GOLD2, 0.65); fin = mix(fin, GOLD3, 0.5); }
    const outline = luminance(body) < 0.22 ? light(body, 0.4) : dark(body, 0.55);
    return { body, belly, fin, outline };
  }
  function pattern_stripes(g, cx, cy, rx, ry, col) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const dy = Math.round((i - (n - 1) / 2) * (ry * 0.9));
      const f = 1 - (dy * dy) / (ry * ry); if (f < 0) continue;
      const dx = rx * Math.sqrt(Math.max(0, f)) * 0.9;
      R(g, cx - dx, cy + dy, dx * 2, 1, col);
    }
  }
  function pattern_bands(g, cx, cy, rx, ry, col) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      const x = cx - rx + t * rx * 2;
      const dxr = (x - cx);
      const f = 1 - (dxr * dxr) / (rx * rx); const hh = ry * Math.sqrt(Math.max(0, f));
      R(g, x, cy - hh, Math.max(1, rx * 0.16), hh * 2, col);
    }
  }
  function pattern_spots(g, cx, cy, rx, ry, col, n) {
    n = n || 5;
    const pts = [[-0.5, -0.3], [0.1, -0.5], [0.5, -0.1], [-0.2, 0.3], [0.3, 0.4], [-0.6, 0.1]];
    for (let i = 0; i < Math.min(n, pts.length); i++) {
      const p = pts[i];
      R(g, cx + p[0] * rx, cy + p[1] * ry, 1, 1, col);
    }
  }
  function applyPattern(g, pattern, cx, cy, rx, ry, col) {
    if (pattern === 'stripes') pattern_stripes(g, cx, cy, rx, ry, col);
    else if (pattern === 'bands') pattern_bands(g, cx, cy, rx, ry, col);
    else if (pattern === 'spots') pattern_spots(g, cx, cy, rx, ry, col);
  }

  /* ---------------- generic torpedo-bodied fish builder ---------------- */
  function basicFish(g, cx, cy, len, ryRatio, col, pattern, wig, opt) {
    opt = opt || {};
    const ry = Math.max(1.3, len * ryRatio);
    const bodyRx = len * (opt.bodyRxRatio || 0.3);
    const noseX = cx + len * 0.5;
    const snout = opt.snout || 0;
    const bodyCx = noseX - bodyRx - snout;
    const tailTipX = cx - len * 0.5 * (opt.tailLenRatio != null ? opt.tailLenRatio : 1);
    ellipO(g, bodyCx, cy, bodyRx, ry, col.body, col.outline);
    bellyShade(g, bodyCx, cy, bodyRx * 0.78, ry * 0.55, col.belly);
    if (pattern) applyPattern(g, pattern, bodyCx, cy, bodyRx, ry, pattern === 'bands' ? light(col.belly, 0.45) : col.fin);
    if (snout > 0) triH(g, bodyCx + bodyRx, noseX, cy, ry * 1.3, opt.snoutTipH != null ? opt.snoutTipH : 1, col.body);
    const tailBaseX = bodyCx - bodyRx;
    triH(g, tailBaseX, tailTipX, cy + wig, ry * 1.15, 0.6, col.fin);
    if (!opt.noDorsal) {
      const dX = bodyCx + bodyRx * (opt.dorsalPos != null ? opt.dorsalPos : -0.1);
      triV(g, dX, cy - ry + 1, cy - ry - Math.max(2, len * (opt.dorsalH || 0.22)), Math.max(1.5, ry * 0.9), 1, col.fin);
    }
    if (!opt.noPect) {
      const pX = bodyCx + bodyRx * 0.25;
      triV(g, pX, cy + ry * 0.7, cy + ry * 0.7 + len * 0.16, Math.max(1.5, ry * 0.6), 1, col.fin);
    }
    if (!opt.noEye) eyeDot(g, noseX - snout - Math.max(1, ry * 0.3), cy - ry * 0.15, 1, Math.max(1, Math.min(2, len * 0.045)));
    return { bodyCx, bodyRx, ry, noseX, tailBaseX, tailTipX };
  }

  /* ---------------- per-shape builders ---------------- */
  function wigFor(len, frame, mul) { const m = Math.max(1, len * (mul || 0.035)); return frame === 0 ? -m : m; }

  function drawSword(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.03);
    const r = basicFish(g, cx, cy, len, 0.12, col, pattern, wig, { bodyRxRatio: .24, snout: len * 0.14, snoutTipH: 0.8, tailLenRatio: 1.0, dorsalH: .14 });
    triH(g, r.noseX, r.noseX + len * 0.26, cy, 1.6, 0.6, dark(col.body, 0.3));
  }
  function drawViper(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.03);
    const r = basicFish(g, cx, cy, len, 0.16, col, pattern, wig, { bodyRxRatio: .28, snout: len * 0.06, tailLenRatio: .85, dorsalH: .1 });
    triV(g, r.noseX - 1, cy + 1, cy + 1 + len * 0.12, 1.4, 0, '#eef2f5');
    triV(g, r.noseX - 2, cy - 1, cy - 1 - len * 0.1, 1.2, 0, '#eef2f5');
  }
  function drawAngler(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.02);
    const r = basicFish(g, cx, cy, len, 0.3, col, pattern, wig, { bodyRxRatio: .32, tailLenRatio: .55, dorsalH: .1, noPect: true });
    triH(g, r.bodyCx, r.noseX + len * 0.04, cy + r.ry * 0.45, 1, r.ry * 1.1, dark(col.body, 0.15));
    for (let i = 0; i < 3; i++) R(g, r.noseX - 3 - i * 2, cy + r.ry * 0.15, 1, 2, '#f2f2ee');
    R(g, r.noseX - len * 0.1, cy - r.ry * 1.2, 1, Math.max(2, len * 0.22), col.fin);
    R(g, r.noseX - len * 0.14, cy - r.ry * 1.45 - len * 0.1, 2, 2, col.fin);
  }
  function drawGulper(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.05);
    const headRy = len * 0.26, headRx = len * 0.3;
    const noseX = cx + len * 0.3, headCx = noseX - headRx;
    ellipO(g, headCx, cy, headRx, headRy, col.body, col.outline);
    bellyShade(g, headCx, cy, headRx * 0.75, headRy * 0.5, col.belly);
    const mouthCol = light(col.belly, 0.35);
    triH(g, headCx - headRx * 0.3, noseX, cy + headRy * 0.2, headRy * 0.2, headRy * 1.05, mouthCol);
    triH(g, headCx - headRx * 0.3, noseX, cy - headRy * 0.05, headRy * 0.1, headRy * 0.4, col.outline);
    for (let i = 0; i < 3; i++) R(g, noseX - 2 - i * 2, cy + headRy * 0.15, 1, 1, '#eceae0');
    eyeDot(g, headCx - headRx * 0.1, cy - headRy * 0.55, 1, Math.max(1, len * 0.04));
    const tailCol = light(col.fin, 0.3);
    wavy(g, headCx - headRx, cy, cx - len * 0.55, cy + wig, len * 0.04, 1.4, frame === 0 ? 0 : Math.PI, 1, tailCol, true);
  }
  function drawPuffer(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.02);
    const r = basicFish(g, cx, cy, len, 0.42, col, pattern, wig, { bodyRxRatio: .4, tailLenRatio: .3, noDorsal: true, noPect: true });
    const n = 10;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const sx = r.bodyCx + Math.cos(ang) * r.bodyRx, sy = cy + Math.sin(ang) * r.ry;
      R(g, sx + Math.cos(ang) * 1.6, sy + Math.sin(ang) * 1.6, 1, 1, col.fin);
    }
  }
  function drawBarreleye(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.03);
    const r = basicFish(g, cx, cy, len, 0.22, col, pattern, wig, { bodyRxRatio: .28, tailLenRatio: .7, noDorsal: true, noEye: true });
    const domeCx = r.bodyCx + r.bodyRx * 0.5, domeCy = cy - r.ry * 1.3, domeR = len * 0.24;
    ellip(g, domeCx, domeCy, domeR + 1, domeR * 0.82 + 1, light(col.body, 0.8));
    g.save(); g.globalAlpha = 0.5;
    ellip(g, domeCx, domeCy, domeR, domeR * 0.82, light(col.body, 0.65));
    g.restore();
    R(g, domeCx - domeR * 0.35, domeCy, 2, 2, col.fin);
    R(g, domeCx + domeR * 0.1, domeCy, 2, 2, col.fin);
  }
  function drawSnail(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.025);
    g.save(); g.globalAlpha = 0.88;
    basicFish(g, cx, cy, len, 0.3, col, pattern, wig, { bodyRxRatio: .22, tailLenRatio: 1.5, noDorsal: true, noPect: true });
    g.restore();
  }
  function drawLong(g, cx, cy, len, col, pattern, frame, isOarfish) {
    const n = Math.max(10, Math.round(len / 1.6));
    const amp = len * 0.05;
    const headRy = len * 0.075, midRy = len * 0.04, tailRy = len * 0.012;
    const phase = frame === 0 ? 0 : Math.PI;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = cx - len * 0.5 + u * len;
      const wave = Math.sin(u * Math.PI * 2.2 + phase) * amp * (1 - u * 0.3);
      const y = cy + wave;
      let ry;
      if (u < 0.08) ry = tailRy + (midRy - tailRy) * (u / 0.08);
      else if (u > 0.85) ry = midRy * (1 - (u - 0.85) / 0.15) + headRy * ((u - 0.85) / 0.15);
      else ry = midRy;
      pts.push({ x, y, ry });
    }
    for (const p of pts) R(g, p.x - 1, p.y - p.ry - 1, 3, p.ry * 2 + 2, col.outline);
    for (const p of pts) R(g, p.x - 1, p.y - p.ry, 2, Math.max(1, p.ry * 2), col.body);
    for (const p of pts) R(g, p.x - 1, p.y + p.ry * 0.15, 2, Math.max(1, p.ry * 0.85), col.belly);
    if (isOarfish) for (let i = 0; i < pts.length; i += 2) R(g, pts[i].x, pts[i].y - pts[i].ry - 3, 1, 3, col.fin);
    if (pattern === 'spots') for (let i = 2; i < pts.length - 2; i += 4) R(g, pts[i].x, pts[i].y, 1, 1, col.fin);
    const head = pts[pts.length - 1];
    eyeDot(g, head.x - 2, head.y - 1, 1, 1);
  }
  function drawSquid(g, cx, cy, len, col, pattern, frame) {
    const mantleRx = len * 0.22, mantleRy = len * 0.17, mantleCx = cx - len * 0.12;
    ellipO(g, mantleCx, cy, mantleRx, mantleRy, col.body, col.outline);
    bellyShade(g, mantleCx, cy, mantleRx * 0.7, mantleRy * 0.5, col.belly);
    if (pattern) applyPattern(g, pattern, mantleCx, cy, mantleRx, mantleRy, col.fin);
    triH(g, mantleCx - mantleRx, cx - len * 0.5, cy, mantleRy * 0.8, 1, col.fin);
    triV(g, mantleCx, cy - mantleRy, cy - mantleRy - len * 0.08, mantleRy * 0.9, 1, col.fin);
    triV(g, mantleCx, cy + mantleRy, cy + mantleRy + len * 0.08, mantleRy * 0.9, 1, col.fin);
    const headX = mantleCx + mantleRx + len * 0.07;
    ellipO(g, headX, cy, len * 0.1, len * 0.1, col.body, col.outline);
    eyeDot(g, headX + len * 0.02, cy - len * 0.02, 1, 1);
    const nTent = 6, phase = frame === 0 ? 0 : Math.PI;
    for (let i = 0; i < nTent; i++) {
      const spread = (i - (nTent - 1) / 2) * len * 0.045;
      const x0 = headX + len * 0.08, y0 = cy + spread * 0.6;
      const x1 = cx + len * 0.55, y1 = cy + spread * 1.6;
      wavy(g, x0, y0, x1, y1, len * 0.05, 2, phase + i, 1, i % 2 === 0 ? col.fin : col.body, true);
    }
  }
  function drawJelly(g, cx, cy, len, col, pattern, frame) {
    const bellRx = len * 0.32, bellRy = len * 0.22, bellCy = cy - len * 0.22;
    domeTopO(g, cx, bellCy, bellRx, bellRy, col.body, col.outline);
    R(g, cx - bellRx * 0.9, bellCy + 1, bellRx * 1.8, Math.max(1, len * 0.04), col.fin);
    if (pattern === 'spots') pattern_spots(g, cx, bellCy, bellRx, bellRy, col.fin, 4);
    const n = 5, phase = frame === 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const fx = cx + (i - (n - 1) / 2) * bellRx * 0.5;
      wavy(g, fx, bellCy + bellRy * 0.3, fx, cy + len * 0.55, len * 0.04, 1.5, phase + i * 1.3, 1, i % 2 === 0 ? col.fin : col.belly, true);
    }
  }
  function drawShark(g, cx, cy, len, col, pattern, frame) {
    const wig = wigFor(len, frame, 0.03);
    const r = basicFish(g, cx, cy, len, 0.19, col, pattern, wig, { bodyRxRatio: .3, snout: len * 0.05, snoutTipH: 0.8, tailLenRatio: .5, dorsalH: .3, dorsalPos: 0.05 });
    triH(g, r.tailBaseX, r.tailTipX, cy + wig - len * 0.08, len * 0.16, 0.5, col.fin);
  }
  function drawRay(g, cx, cy, len, col, pattern, frame) {
    const xFront = cx + len * 0.32, xBack = cx - len * 0.05;
    rhombusWing(g, xFront + 1, xBack - 1, cy, len * 0.5 + 2, col.outline);
    rhombusWing(g, xFront, xBack, cy, len * 0.46, col.body);
    bellyShade(g, cx + len * 0.05, cy, len * 0.2, len * 0.12, col.belly);
    if (pattern) applyPattern(g, pattern, cx + len * 0.05, cy, len * 0.22, len * 0.18, col.fin);
    const wig = frame === 0 ? -len * 0.04 : len * 0.04;
    wavy(g, xBack, cy, cx - len * 0.55, cy + wig, len * 0.03, 1.5, frame === 0 ? 0 : Math.PI, 1, col.fin, true);
    eyeDot(g, xFront - len * 0.06, cy - len * 0.03, 1, 1);
  }
  function drawOctopus(g, cx, cy, len, col, pattern, frame) {
    const headRx = len * 0.3, headRy = len * 0.26, headCy = cy - len * 0.1;
    ellipO(g, cx, headCy, headRx, headRy, col.body, col.outline);
    bellyShade(g, cx, headCy, headRx * 0.7, headRy * 0.5, col.belly);
    triV(g, cx + headRx * 0.5, headCy - headRy, headCy - headRy - len * 0.12, len * 0.1, 1, col.fin);
    triV(g, cx - headRx * 0.5, headCy - headRy, headCy - headRy - len * 0.12, len * 0.1, 1, col.fin);
    eyeDot(g, cx + headRx * 0.4, headCy - headRy * 0.1, 1, 1);
    const n = 6, phase = frame === 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const fx = cx + (i - (n - 1) / 2) * headRx * 0.35;
      wavy(g, fx, headCy + headRy * 0.7, fx + (i - (n - 1) / 2) * 2, cy + len * 0.5, len * 0.04, 1.2, phase + i, 1, i % 2 === 0 ? col.body : col.belly, true);
    }
  }
  function drawEyeCreature(g, cx, cy, len, col, pattern, frame) {
    const r = len * 0.34;
    ellipO(g, cx, cy, r, r, col.body, col.outline);
    ellip(g, cx, cy, r * 0.62, r * 0.62, col.belly);
    ellip(g, cx, cy, r * 0.3, r * 0.3, col.fin);
    R(g, cx - r * 0.08, cy - r * 0.08, Math.max(1, r * 0.2), Math.max(1, r * 0.2), '#050505');
    R(g, cx - r * 0.35, cy - r * 0.35, 1, 1, '#ffffff');
    const n = 4, phase = frame === 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const fy = cy + (i - (n - 1) / 2) * r * 0.5;
      wavy(g, cx - r * 0.8, fy, cx - len * 0.55, fy, len * 0.05, 1.3, phase + i, 1, i % 2 === 0 ? col.fin : col.belly, true);
    }
  }
  function drawShrimp(g, cx, cy, len, col, pattern, frame) {
    const n = 4; const segW = len * 0.16, segH = len * 0.22;
    const wig = frame === 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = cx - len * 0.3 + u * len * 0.55;
      const y = cy - Math.sin(u * Math.PI) * len * 0.08;
      const s = 1 - u * 0.25;
      ellipO(g, x, y, segW * 0.5 * s, segH * 0.5 * s, col.body, col.outline);
      R(g, x - 1, y + segH * 0.4 * s, 1, Math.max(1, len * 0.08), col.fin);
    }
    const hx2 = cx - len * 0.3 + len * 0.55 + segW * 0.4;
    ellipO(g, hx2, cy - len * 0.03, segW * 0.4, segH * 0.4, col.body, col.outline);
    eyeDot(g, hx2 + 2, cy - len * 0.06, 1, 1);
    R(g, hx2 + 3, cy - len * 0.1 + wig, Math.max(1, len * 0.18), 1, col.fin);
    const tx = cx - len * 0.3;
    triH(g, tx, tx - len * 0.12, cy, segH * 0.5, 1, col.fin);
  }

  const SHAPE_DRAW = {
    fish: (g, cx, cy, len, col, pattern, frame) => basicFish(g, cx, cy, len, 0.22, col, pattern, wigFor(len, frame), {}),
    round: (g, cx, cy, len, col, pattern, frame) => basicFish(g, cx, cy, len, 0.38, col, pattern, wigFor(len, frame, 0.025), { bodyRxRatio: .36, tailLenRatio: .55 }),
    flat: (g, cx, cy, len, col, pattern, frame) => { const r = basicFish(g, cx, cy, len, 0.46, col, pattern, wigFor(len, frame, 0.025), { bodyRxRatio: .22, tailLenRatio: .4, noDorsal: true }); triV(g, r.bodyCx, cy - r.ry + 1, cy - r.ry - len * 0.12, 2, 1, col.fin); },
    pike: (g, cx, cy, len, col, pattern, frame) => basicFish(g, cx, cy, len, 0.13, col, pattern, wigFor(len, frame, 0.04), { bodyRxRatio: .26, snout: len * 0.22, snoutTipH: 0.7, tailLenRatio: .95, dorsalH: .14 }),
    sword: (g, cx, cy, len, col, pattern, frame) => drawSword(g, cx, cy, len, col, pattern, frame),
    long: (g, cx, cy, len, col, pattern, frame, key) => drawLong(g, cx, cy, len, col, pattern, frame, key === 'oarfish'),
    puffer: (g, cx, cy, len, col, pattern, frame) => drawPuffer(g, cx, cy, len, col, pattern, frame),
    angler: (g, cx, cy, len, col, pattern, frame) => drawAngler(g, cx, cy, len, col, pattern, frame),
    viper: (g, cx, cy, len, col, pattern, frame) => drawViper(g, cx, cy, len, col, pattern, frame),
    gulper: (g, cx, cy, len, col, pattern, frame) => drawGulper(g, cx, cy, len, col, pattern, frame),
    squid: (g, cx, cy, len, col, pattern, frame) => drawSquid(g, cx, cy, len, col, pattern, frame),
    jelly: (g, cx, cy, len, col, pattern, frame) => drawJelly(g, cx, cy, len, col, pattern, frame),
    shark: (g, cx, cy, len, col, pattern, frame) => drawShark(g, cx, cy, len, col, pattern, frame),
    ray: (g, cx, cy, len, col, pattern, frame) => drawRay(g, cx, cy, len, col, pattern, frame),
    octopus: (g, cx, cy, len, col, pattern, frame) => drawOctopus(g, cx, cy, len, col, pattern, frame),
    barreleye: (g, cx, cy, len, col, pattern, frame) => drawBarreleye(g, cx, cy, len, col, pattern, frame),
    swallower: (g, cx, cy, len, col, pattern, frame) => basicFish(g, cx, cy, len, 0.46, col, pattern, wigFor(len, frame, 0.02), { bodyRxRatio: .4, tailLenRatio: .4, dorsalPos: -0.3 }),
    snail: (g, cx, cy, len, col, pattern, frame) => drawSnail(g, cx, cy, len, col, pattern, frame),
    shrimp: (g, cx, cy, len, col, pattern, frame) => drawShrimp(g, cx, cy, len, col, pattern, frame),
    eye: (g, cx, cy, len, col, pattern, frame) => drawEyeCreature(g, cx, cy, len, col, pattern, frame),
  };

  /* ---------------- fish sprite cache ---------------- */
  const fishCache = new Map();
  function getFishCanvas(key, len, frame, shiny) {
    const id = key + '|' + len + '|' + frame + '|' + (shiny ? 1 : 0);
    let e = fishCache.get(id);
    if (e) return e;
    const spec = SPECIES[key];
    const W = Math.ceil(len * 2.4) + 14, H = Math.ceil(len * 2.4) + 14;
    const { c, g } = mkCanvas(W, H);
    const col = colorsFor(spec, shiny);
    const cx = W / 2, cy = H / 2;
    const fn = SHAPE_DRAW[spec.shape] || SHAPE_DRAW.fish;
    fn(g, cx, cy, len, col, spec.pattern, frame, key);
    if (shiny && frame === 0) { R(g, cx - len * 0.25, cy - len * 0.42, 1, 1, '#ffffff'); R(g, cx - len * 0.2, cy - len * 0.38, 1, 1, '#fff8da'); }
    e = { c, w: W, h: H };
    fishCache.set(id, e);
    return e;
  }

  /* ---------------- glow points per shape ---------------- */
  const GLOW_BY_SHAPE = {
    fish: [[0.44, -0.08, 0.15], [0.15, 0.15, 0.09], [-0.05, 0.16, 0.09], [-0.22, 0.14, 0.08]],
    round: [[0.4, -0.1, 0.15], [0.1, 0.2, 0.1], [-0.15, 0.2, 0.1]],
    flat: [[0.3, -0.05, 0.1], [0, 0.2, 0.08], [-0.25, 0.2, 0.08]],
    pike: [[0.46, -0.04, 0.1], [0.1, 0.1, 0.07], [-0.2, 0.1, 0.07]],
    sword: [[0.4, -0.04, 0.08], [-0.2, 0.08, 0.06]],
    viper: [[0.42, -0.02, 0.12], [0.1, 0.12, 0.08], [-0.15, 0.12, 0.08]],
    angler: [[0.3, -0.75, 0.24]],
    gulper: [[0.1, -0.05, 0.14], [-0.3, 0.05, 0.08], [-0.7, 0.05, 0.07]],
    puffer: [[0.3, 0, 0.1], [-0.2, 0.2, 0.08]],
    swallower: [[0.3, -0.1, 0.14], [0, 0.25, 0.12], [-0.25, 0.2, 0.1]],
    snail: [[0.3, -0.05, 0.13], [-0.1, 0.12, 0.1], [-0.45, 0.05, 0.07]],
    shark: [[0.4, -0.1, 0.1], [0, 0.15, 0.08]],
    ray: [[0.28, -0.02, 0.1], [-0.15, 0, 0.07], [-0.4, 0, 0.05]],
    squid: [[0.28, -0.05, 0.14], [0.5, -0.15, 0.08], [0.5, 0, 0.08], [0.5, 0.15, 0.08]],
    jelly: [[0, -0.15, 0.14], [-0.25, 0.55, 0.07], [0, 0.6, 0.07], [0.25, 0.55, 0.07]],
    octopus: [[0.3, -0.2, 0.1]],
    barreleye: [[0.3, -0.52, 0.13], [0.42, -0.52, 0.13]],
    long: [[0.42, -0.02, 0.1], [0.1, 0, 0.08], [-0.15, 0, 0.08], [-0.35, 0, 0.07]],
    shrimp: [[0.2, 0, 0.08]],
    eye: [[0, 0, 0.32]],
  };
  const glowCache = new Map();
  function getGlowCanvas(key, len, frame) {
    const id = key + '|' + len + '|' + frame;
    if (glowCache.has(id)) return glowCache.get(id);
    const spec = SPECIES[key];
    if (!spec.glow) { glowCache.set(id, null); return null; }
    const W = Math.ceil(len * 2.4) + 14, H = Math.ceil(len * 2.4) + 14;
    const { c, g } = mkCanvas(W, H);
    const cx = W / 2, cy = H / 2;
    const pts = GLOW_BY_SHAPE[spec.shape] || GLOW_BY_SHAPE.fish;
    const pulse = frame === 0 ? 1 : 1.2;
    for (const p of pts) glowBlob(g, cx + p[0] * len, cy + p[1] * len, Math.max(1.2, p[2] * len * pulse), spec.glow);
    const e = { c, w: W, h: H };
    glowCache.set(id, e);
    return e;
  }

  function roundLen(len) { return Math.max(1, Math.round(len)); }
  function frameFor(t, x) { return (Math.floor(t * 8 + x * 0.37)) & 1; }

  /* ================= LEGENDS ================= */
  const LEGEND_BY_KEY = {}; (typeof LEGENDS !== 'undefined' ? LEGENDS : []).forEach(l => LEGEND_BY_KEY[l.k] = l);
  const LEGEND_FRAMES = 4;
  function legendFrame(t) { return Math.floor((t * 1.1) % LEGEND_FRAMES + LEGEND_FRAMES) % LEGEND_FRAMES; }

  function serpentSegments(size, cx, cy, phase, ampF, freqF, nSeg) {
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
      const u = i / nSeg;
      const x = cx - size * 0.45 + u * size * 0.9;
      const y = cy + Math.sin(u * Math.PI * freqF + phase) * size * ampF * (0.3 + 0.7 * u);
      pts.push({ x, y, u });
    }
    return pts;
  }

  function drawIsonade(g, cx, cy, size, col, phase) {
    const outline = dark(col, 0.5);
    const ry = size * 0.18, bodyRx = size * 0.34;
    const noseX = cx + size * 0.42, bodyCx = noseX - bodyRx;
    const wig = Math.sin(phase) * size * 0.03;
    ellipO(g, bodyCx, cy, bodyRx, ry, col, outline);
    bellyShade(g, bodyCx, cy, bodyRx * 0.7, ry * 0.5, light(col, 0.3));
    triH(g, bodyCx + bodyRx, noseX, cy, ry * 1.2, 1, col);
    triV(g, bodyCx - bodyRx * 0.1, cy - ry + 1, cy - ry - size * 0.3, ry * 1.1, 1, outline);
    triV(g, bodyCx + bodyRx * 0.3, cy + ry * 0.7, cy + ry * 0.7 + size * 0.2, ry * 0.7, 1, outline);
    for (let i = 0; i < 4; i++) R(g, noseX - 3 - i * 3, cy + ry * 0.3, 2, 3, '#f0f0f0');
    R(g, noseX - size * 0.05, cy - ry * 0.2, 2, 2, '#ff3020');
    const tailBaseX = bodyCx - bodyRx;
    const tailMidX = tailBaseX - size * 0.22;
    triH(g, tailBaseX, tailMidX, cy + wig, ry * 1.1, ry * 0.5, outline);
    const hookX = tailMidX - size * 0.1, hookY = cy + wig - size * 0.1;
    ellipO(g, hookX, hookY, size * 0.09, size * 0.12, outline, outline);
    R(g, hookX - size * 0.05, hookY - size * 0.02, size * 0.05, 2, col);
    R(g, hookX + size * 0.02, hookY - size * 0.1, 2, size * 0.05, col);
  }
  function drawUmibozu(g, cx, cy, size, col, phase) {
    const bob = Math.sin(phase) * size * 0.02;
    const shY = cy + size * 0.15 + bob;
    ellipO(g, cx, shY + size * 0.12, size * 0.42, size * 0.22, col, dark(col, 0.5));
    domeTopO(g, cx, shY - size * 0.05, size * 0.28, size * 0.3, col, dark(col, 0.5));
    R(g, cx - size * 0.12, shY - size * 0.12, size * 0.05, size * 0.05, '#dfeaff');
    R(g, cx + size * 0.06, shY - size * 0.12, size * 0.05, size * 0.05, '#dfeaff');
  }
  function drawUmibozuGlow(g, cx, cy, size, glow, phase) {
    const bob = Math.sin(phase) * size * 0.02;
    const shY = cy + size * 0.15 + bob;
    glowBlob(g, cx - size * 0.095, shY - size * 0.095, size * 0.1, glow);
    glowBlob(g, cx + size * 0.085, shY - size * 0.095, size * 0.1, glow);
  }
  function drawBakunawa(g, cx, cy, size, col, phase) {
    const outline = dark(col, 0.5);
    const pts = serpentSegments(size, cx, cy, phase, 0.05, 2.4, 24);
    for (const p of pts) { const rr = size * (0.04 + 0.07 * p.u); R(g, p.x - rr - 1, p.y - rr - 1, rr * 2 + 2, rr * 2 + 2, outline); }
    for (const p of pts) { const rr = size * (0.04 + 0.07 * p.u); R(g, p.x - rr, p.y - rr, rr * 2, rr * 2, col); }
    for (let i = 2; i < pts.length; i += 3) R(g, pts[i].x, pts[i].y - 1, 2, 2, light(col, 0.3));
    const head = pts[pts.length - 1];
    const headR = size * 0.13;
    ellipO(g, head.x + headR * 0.4, head.y, headR, headR * 0.85, col, outline);
    const jawOpen = size * 0.07;
    triH(g, head.x + headR * 0.2, head.x + headR * 1.6, head.y - jawOpen, headR * 0.5, 1, col);
    triH(g, head.x + headR * 0.2, head.x + headR * 1.6, head.y + jawOpen, headR * 0.5, 1, col);
    for (let i = 0; i < 4; i++) { R(g, head.x + headR * 0.5 + i * 3, head.y - jawOpen + 1, 1, 2, '#fff'); R(g, head.x + headR * 0.5 + i * 3, head.y + jawOpen - 3, 1, 2, '#fff'); }
    R(g, head.x, head.y - headR * 0.6, size * 0.12, 1, outline);
    R(g, head.x, head.y + headR * 0.6, size * 0.12, 1, outline);
    eyeDot(g, head.x + headR * 0.3, head.y - headR * 0.3, 1, 1.5);
  }
  function drawBakunawaGlow(g, cx, cy, size, glow, phase) {
    const pts = serpentSegments(size, cx, cy, phase, 0.05, 2.4, 24);
    const head = pts[pts.length - 1];
    const headR = size * 0.13;
    glowBlob(g, head.x + headR * 1.1, head.y, headR * 0.38, glow);
  }
  function drawAspidochelone(g, cx, cy, size, col, phase) {
    const outline = dark(col, 0.5);
    const bob = Math.sin(phase) * size * 0.015;
    const bodyRx = size * 0.42, bodyRy = size * 0.22;
    ellipO(g, cx, cy + bob, bodyRx, bodyRy, col, outline);
    bellyShade(g, cx, cy + bob, bodyRx * 0.8, bodyRy * 0.5, light(col, 0.2));
    triV(g, cx - bodyRx * 0.4, cy + bob + bodyRy * 0.6, cy + bob + bodyRy * 0.6 + size * 0.18, size * 0.14, 1, outline);
    triV(g, cx + bodyRx * 0.3, cy + bob + bodyRy * 0.6, cy + bob + bodyRy * 0.6 + size * 0.18, size * 0.14, 1, outline);
    ellipO(g, cx + bodyRx * 0.95, cy + bob - bodyRy * 0.2, size * 0.08, size * 0.07, col, outline);
    eyeDot(g, cx + bodyRx * 1.0, cy + bob - bodyRy * 0.25, 1, 1);
    triH(g, cx - bodyRx, cx - bodyRx - size * 0.1, cy + bob, bodyRy * 0.4, 1, outline);
    const topY = cy + bob - bodyRy;
    ellip(g, cx - size * 0.02, topY + 2, size * 0.18, size * 0.06, '#6a8a3a');
    R(g, cx - size * 0.22, topY, size * 0.05, size * 0.04, '#7a7a74');
    R(g, cx + size * 0.18, topY + 1, size * 0.04, size * 0.04, '#6a6a64');
    const trunkX = cx + size * 0.02, trunkTopY = topY - size * 0.16;
    R(g, trunkX, trunkTopY, 1, topY - trunkTopY, '#8a6a3a');
    R(g, trunkX - size * 0.05, trunkTopY - 2, size * 0.04, 2, '#3a7a2a');
    R(g, trunkX + size * 0.015, trunkTopY - 2, size * 0.04, 2, '#3a7a2a');
    R(g, trunkX - size * 0.02, trunkTopY - 3, size * 0.05, 2, '#4a8a3a');
  }
  function drawKraken(g, cx, cy, size, col, phase) {
    const outline = dark(col, 0.5);
    const mantleRx = size * 0.26, mantleRy = size * 0.3, mantleCx = cx - size * 0.05;
    domeTopO(g, mantleCx, cy - size * 0.15, mantleRx, mantleRy * 0.8, col, outline);
    ellipO(g, mantleCx, cy, mantleRx * 0.9, mantleRy, col, outline);
    bellyShade(g, mantleCx, cy, mantleRx * 0.6, mantleRy * 0.5, light(col, 0.25));
    eyeDot(g, mantleCx - mantleRx * 0.3, cy - mantleRy * 0.1, 1, size * 0.025);
    eyeDot(g, mantleCx + mantleRx * 0.3, cy - mantleRy * 0.1, 1, size * 0.025);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) / (n - 1);
      const x0 = mantleCx + Math.cos(spread * 1.2) * mantleRx * 0.6, y0 = cy + mantleRy * 0.7 + spread * mantleRy * 0.3;
      const x1 = cx - size * 0.1 + spread * size * 0.5, y1 = cy + size * 0.55 + Math.abs(spread) * size * 0.1;
      wavy(g, x0, y0, x1, y1, size * 0.05, 2.2, phase + i * 0.7, Math.max(1, size * 0.025), i % 2 === 0 ? col : outline, true);
    }
  }
  function drawKrakenGlow(g, cx, cy, size, glow, phase) {
    const mantleCx = cx - size * 0.05, mantleRx = size * 0.26, mantleRy = size * 0.3;
    glowBlob(g, mantleCx - mantleRx * 0.3, cy - mantleRy * 0.1, size * 0.05, glow);
    glowBlob(g, mantleCx + mantleRx * 0.3, cy - mantleRy * 0.1, size * 0.05, glow);
  }
  function drawLeviathan(g, cx, cy, size, col, phase) {
    const outline = dark(col, 0.6);
    const pts = serpentSegments(size, cx, cy, phase, 0.09, 3.4, 30);
    for (const p of pts) { const rr = size * (0.045 + 0.05 * Math.sin(p.u * Math.PI)); R(g, p.x - rr - 1, p.y - rr - 1, rr * 2 + 2, rr * 2 + 2, outline); }
    for (const p of pts) { const rr = size * (0.045 + 0.05 * Math.sin(p.u * Math.PI)); R(g, p.x - rr, p.y - rr, rr * 2, rr * 2, col); }
    for (let i = 0; i < pts.length; i += 3) { const p = pts[i]; R(g, p.x, p.y - size * 0.1, 1, size * 0.06, outline); }
    const head = pts[pts.length - 1];
    const headR = size * 0.1;
    ellipO(g, head.x + headR * 0.5, head.y, headR, headR * 0.8, col, outline);
    eyeDot(g, head.x + headR * 0.6, head.y - headR * 0.3, 1, 2);
  }
  function drawLeviathanGlow(g, cx, cy, size, glow, phase) {
    const pts = serpentSegments(size, cx, cy, phase, 0.09, 3.4, 30);
    for (let i = 1; i < pts.length; i += 4) glowBlob(g, pts[i].x, pts[i].y, size * 0.025, glow);
    const head = pts[pts.length - 1];
    glowBlob(g, head.x + size * 0.06, head.y - size * 0.03, size * 0.05, glow);
  }

  const LEGEND_DRAW = { isonade: drawIsonade, umibozu: drawUmibozu, bakunawa: drawBakunawa, aspidochelone: drawAspidochelone, kraken: drawKraken, leviathan: drawLeviathan };
  const LEGEND_GLOW_DRAW = { umibozu: drawUmibozuGlow, bakunawa: drawBakunawaGlow, kraken: drawKrakenGlow, leviathan: drawLeviathanGlow };

  const legendCache = new Map();
  function getLegendCanvas(key, frame) {
    const id = key + '|' + frame;
    if (legendCache.has(id)) return legendCache.get(id);
    const L = LEGEND_BY_KEY[key]; if (!L) { legendCache.set(id, null); return null; }
    const size = L.size;
    const W = Math.ceil(size * 1.7), H = Math.ceil(size * 1.4);
    const { c, g } = mkCanvas(W, H);
    const cx = W * 0.42, cy = H * 0.56;
    const phase = frame / LEGEND_FRAMES * Math.PI * 2;
    (LEGEND_DRAW[key] || drawLeviathan)(g, cx, cy, size, L.col, phase);
    const e = { c, w: W, h: H, cx, cy };
    legendCache.set(id, e);
    return e;
  }
  const legendGlowCache = new Map();
  function getLegendGlowCanvas(key, frame) {
    const id = key + '|' + frame;
    if (legendGlowCache.has(id)) return legendGlowCache.get(id);
    const L = LEGEND_BY_KEY[key];
    if (!L || !L.glow) { legendGlowCache.set(id, null); return null; }
    const size = L.size;
    const W = Math.ceil(size * 1.7), H = Math.ceil(size * 1.4);
    const { c, g } = mkCanvas(W, H);
    const cx = W * 0.42, cy = H * 0.56;
    const phase = frame / LEGEND_FRAMES * Math.PI * 2;
    const fn = LEGEND_GLOW_DRAW[key];
    if (fn) fn(g, cx, cy, size, L.glow, phase);
    const e = { c, w: W, h: H, cx, cy };
    legendGlowCache.set(id, e);
    return e;
  }

  /* ================= BOAT ================= */
  function hull(g, x, yy, halfW, h, col) {
    for (let i = 0; i <= h; i++) { const t = i / h; const w = halfW * (1 - t * 0.6); R(g, x - w, yy + i, w * 2, 1, col); }
  }
  function boatRodTipCalc(x, y, t) { const b = Math.sin(t * 1.6) * 1.3; return { x: x + 16, y: y - 22 + b }; }
  function drawBoatImpl(g, x, y, t) {
    const b = Math.sin(t * 1.6) * 1.3;
    const yy = y + b;
    hull(g, x, yy, 20, 5, '#4a3016');
    hull(g, x, yy - 1, 19, 4, '#7a5024');
    R(g, x - 6, yy - 9, 12, 8, '#9a7040');
    R(g, x - 6, yy - 9, 12, 2, '#5a3a1a');
    R(g, x - 4, yy - 7, 3, 3, '#cfe8f0');
    R(g, x + 10, yy - 24, 1, 16, '#5a3a1a');
    R(g, x + 11, yy - 24, 4, 2, '#d04030');
    const tip = boatRodTipCalc(x, y, t);
    lineSeg(g, x + 8, yy - 6, tip.x, tip.y, '#3a2a18');
  }

  /* ================= HOOKS ================= */
  function hookPlain(g, x, y, col) {
    R(g, x, y, 1, 1, col);
    R(g, x, y + 1, 1, 3, col);
    R(g, x + 1, y + 4, 1, 1, col);
    R(g, x, y + 5, 1, 1, col);
  }
  function hookTreble(g, x, y, col) {
    R(g, x, y, 1, 1, col);
    R(g, x, y + 1, 1, 3, col);
    R(g, x, y + 4, 1, 1, col); R(g, x, y + 5, 1, 1, col); R(g, x + 1, y + 5, 1, 1, col);
    R(g, x - 1, y + 4, 1, 1, col); R(g, x - 2, y + 5, 1, 1, col); R(g, x - 3, y + 4, 1, 1, col); R(g, x - 3, y + 3, 1, 1, col);
    R(g, x + 1, y + 4, 1, 1, col); R(g, x + 2, y + 5, 1, 1, col); R(g, x + 3, y + 4, 1, 1, col); R(g, x + 3, y + 3, 1, 1, col);
  }
  function hookCircle(g, x, y, col) {
    R(g, x, y, 1, 1, col);
    R(g, x - 1, y + 1, 1, 1, col); R(g, x + 1, y + 1, 1, 1, col);
    R(g, x - 2, y + 2, 1, 2, col); R(g, x + 2, y + 2, 1, 2, col);
    R(g, x - 1, y + 5, 1, 1, col); R(g, x, y + 5, 1, 1, col);
  }
  function hookGlowFn(g, x, y, col) {
    hookPlain(g, x, y, '#8a8f95');
    ellipO(g, x, y + 6, 2, 2, col, dark(col, 0.4));
  }
  function hookGold(g, x, y, col) { hookPlain(g, x, y, col); R(g, x + 1, y + 1, 1, 1, '#fff8d0'); }
  function hookBarbed(g, x, y, col) { hookPlain(g, x, y, col); R(g, x - 1, y + 2, 1, 1, col); }
  function hookMirror(g, x, y, col) {
    hookPlain(g, x, y, '#8a8f95');
    R(g, x - 2, y + 2, 1, 1, col); R(g, x - 1, y + 1, 1, 1, col); R(g, x - 1, y + 3, 1, 1, col); R(g, x, y + 2, 1, 1, col);
  }
  function hookChum(g, x, y, col) { hookPlain(g, x, y, '#8a8f95'); R(g, x - 1, y + 4, 3, 2, col); R(g, x, y + 6, 1, 1, dark(col, 0.3)); }
  function hookLucky(g, x, y, col) {
    hookPlain(g, x, y, col);
    R(g, x + 2, y, 1, 1, '#fff'); R(g, x + 1, y - 1, 1, 1, '#fff'); R(g, x + 3, y, 1, 1, '#fff'); R(g, x + 2, y + 1, 1, 1, '#fff');
  }
  function hookHarpoon(g, x, y, col) {
    R(g, x, y, 1, 5, col);
    R(g, x - 1, y + 5, 1, 1, col); R(g, x + 1, y + 5, 1, 1, col);
    R(g, x, y + 5, 1, 2, col);
  }
  const HOOK_DRAW = {
    plain: hookPlain, treble: hookTreble, circle: hookCircle, glow: hookGlowFn, gold: hookGold,
    barbed: hookBarbed, mirror: hookMirror, chum: hookChum, lucky: hookLucky, harpoon: hookHarpoon,
  };

  /* ================= TREASURE ================= */
  function drawTreasureImpl(g, x, y) {
    R(g, x - 3, y - 2, 7, 5, '#6a4420');
    R(g, x - 3, y - 2, 7, 1, '#8a5a2a');
    R(g, x - 3, y + 2, 7, 1, '#3a2410');
    R(g, x - 3, y - 2, 1, 5, '#3a2410');
    R(g, x + 3, y - 2, 1, 5, '#3a2410');
    R(g, x - 3, y, 7, 1, '#f3d23a');
    R(g, x, y - 1, 1, 2, '#f3d23a');
  }

  /* ================= ICONS ================= */
  const iconCache = new Map();
  const legendIconCache = new Map();

  /* ================= PUBLIC API ================= */
  // Sprite canvases carry padding for wiggle/glow; icons crop to the opaque pixels so small fish fill the frame.
  function opaqueBox(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 20) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? { x: 0, y: 0, w: c.width, h: c.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  const api = {
    drawFish(g, key, x, y, len, dir, t, shiny) {
      const spec = SPECIES[key]; if (!spec) return;
      const rl = roundLen(len);
      const frame = frameFor(t, x);
      const e = getFishCanvas(key, rl, frame, !!shiny);
      if (dir < 0) { g.save(); g.translate(x, y); g.scale(-1, 1); g.drawImage(e.c, -e.w / 2, -e.h / 2); g.restore(); }
      else g.drawImage(e.c, x - e.w / 2, y - e.h / 2);
    },
    drawFishGlow(g, key, x, y, len, dir, t) {
      const spec = SPECIES[key]; if (!spec || !spec.glow) return;
      const rl = roundLen(len);
      const frame = frameFor(t, x);
      const e = getGlowCanvas(key, rl, frame);
      if (!e) return;
      if (dir < 0) { g.save(); g.translate(x, y); g.scale(-1, 1); g.drawImage(e.c, -e.w / 2, -e.h / 2); g.restore(); }
      else g.drawImage(e.c, x - e.w / 2, y - e.h / 2);
    },
    drawLegend(g, legendKey, x, y, dir, t, scale) {
      const frame = legendFrame(t);
      const e = getLegendCanvas(legendKey, frame);
      if (!e) return;
      scale = scale || 1;
      const dw = e.w * scale, dh = e.h * scale;
      if (dir < 0) { g.save(); g.translate(x, y); g.scale(-1, 1); g.drawImage(e.c, -e.cx * scale, -e.cy * scale, dw, dh); g.restore(); }
      else g.drawImage(e.c, x - e.cx * scale, y - e.cy * scale, dw, dh);
    },
    drawLegendGlow(g, legendKey, x, y, dir, t, scale) {
      const frame = legendFrame(t);
      const e = getLegendGlowCanvas(legendKey, frame);
      if (!e) return;
      scale = scale || 1;
      const dw = e.w * scale, dh = e.h * scale;
      if (dir < 0) { g.save(); g.translate(x, y); g.scale(-1, 1); g.drawImage(e.c, -e.cx * scale, -e.cy * scale, dw, dh); g.restore(); }
      else g.drawImage(e.c, x - e.cx * scale, y - e.cy * scale, dw, dh);
    },
    drawBoat(g, x, y, t) { drawBoatImpl(g, x, y, t); },
    boatRodTip(x, y, t) { return boatRodTipCalc(x, y, t); },
    drawHook(g, hookKey, x, y, t) {
      const h = HOOKS[hookKey]; if (!h) return;
      (HOOK_DRAW[hookKey] || hookPlain)(g, x, y, h.col);
    },
    drawHookGlow(g, hookKey, x, y, t) {
      if (hookKey === 'glow') {
        const r = 1.6 + Math.sin(t * 4) * 0.25;
        glowBlob(g, x, y + 6, r * 1.9, HOOKS.glow.col);
      } else if (hookKey === 'lucky') {
        const r = 1 + Math.sin(t * 5) * 0.25;
        glowBlob(g, x + 2, y, r * 1.3, '#bdf5d8');
      }
    },
    drawTreasure(g, x, y) { drawTreasureImpl(g, x, y); },
    icon(speciesKey) {
      if (iconCache.has(speciesKey)) return iconCache.get(speciesKey);
      const spec = SPECIES[speciesKey];
      const W = 64, H = 40;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      canvas.style.imageRendering = 'pixelated';
      const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
      g.fillStyle = 'rgba(4,10,20,0.35)'; g.fillRect(0, 0, W, H);
      if (spec) {
        const rl = roundLen(spec.size);
        const base = getFishCanvas(speciesKey, rl, 0, false);
        const box = opaqueBox(base.c);
        const scale = Math.max(1, Math.floor(Math.min((W - 6) / box.w, (H - 6) / box.h)));
        const dw = box.w * scale, dh = box.h * scale, dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
        g.drawImage(base.c, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
        if (spec.glow) {
          const gl = getGlowCanvas(speciesKey, rl, 0);
          // the glow canvas shares the fish canvas origin, so the same crop lines it up
          if (gl) { g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(gl.c, box.x, box.y, box.w, box.h, dx, dy, dw, dh); g.restore(); }
        }
      }
      iconCache.set(speciesKey, canvas);
      return canvas;
    },
    legendIcon(legendKey) {
      if (legendIconCache.has(legendKey)) return legendIconCache.get(legendKey);
      const W = 120, H = 72;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      canvas.style.imageRendering = 'pixelated';
      const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
      g.fillStyle = 'rgba(4,10,20,0.35)'; g.fillRect(0, 0, W, H);
      const base = getLegendCanvas(legendKey, 0);
      if (base) {
        const box = opaqueBox(base.c);
        const scale = Math.min((W - 6) / box.w, (H - 6) / box.h);
        const dw = box.w * scale, dh = box.h * scale, dx = (W - dw) / 2, dy = (H - dh) / 2;
        g.drawImage(base.c, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
        const L = LEGEND_BY_KEY[legendKey];
        if (L && L.glow) {
          const gl = getLegendGlowCanvas(legendKey, 0);
          if (gl) { g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(gl.c, box.x, box.y, box.w, box.h, dx, dy, dw, dh); g.restore(); }
        }
      }
      legendIconCache.set(legendKey, canvas);
      return canvas;
    },
  };

  return api;
})();
