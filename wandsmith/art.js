'use strict';
/* WANDSMITH rendering facade. Generated source artwork is converted offline
   into Pix definitions; poses and effects reuse cached native pixel canvases.
   Legacy drawing helpers remain as API fallbacks. */
const Art = (function () {
  const W = 336, H = 168;
  const GROUND = 150;      // feet y for characters (game.js + cinema.js)
  const OUTLINE = '#241a30';

  // ---------------------------------------------------------------
  // low level helpers
  // ---------------------------------------------------------------
  const _cache = Object.create(null);
  const _poseBounds = Object.create(null);
  function cached(key, w, h, draw) {
    let c = _cache[key];
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.max(1, w | 0);
      c.height = Math.max(1, h | 0);
      draw(c.getContext('2d'), c.width, c.height);
      _cache[key] = c;
    }
    return c;
  }
  function fi(t, speed, n) { const k = Math.floor(t * speed) % n; return k < 0 ? k + n : k; }
  function poseBounds(key, image) {
    if (_poseBounds[key]) return _poseBounds[key];
    const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    const box = [image.width, image.height, 0, 0];
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (!pixels[(y * image.width + x) * 4 + 3]) continue;
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    }
    return (_poseBounds[key] = box);
  }

  function hex2rgb(h) {
    h = ('' + h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  function hex2hsl(hex) {
    let [r, g, b] = hex2rgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
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
  function hsl2hex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return rgb2hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  function shade(col, amt) { const [r, g, b] = hex2rgb(col); return rgb2hex(r + amt, g + amt, b + amt); }
  function mix(a, b, t) {
    const [r1, g1, b1] = hex2rgb(a), [r2, g2, b2] = hex2rgb(b);
    return rgb2hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  }
  // 5-tone cool/warm ramp from one base colour, used for all banded shading
  function ramp(hex) {
    const [h, s, l] = hex2hsl(hex);
    return {
      deep: hsl2hex(h - 8, Math.min(100, s + 10), Math.max(4, l - 34)),
      shadow: hsl2hex(h - 4, Math.min(100, s + 5), Math.max(6, l - 18)),
      base: hex,
      light: hsl2hex(h + 4, Math.max(0, s - 8), Math.min(96, l + 14)),
      hi: hsl2hex(h + 8, Math.max(0, s - 18), Math.min(98, l + 30)),
    };
  }

  function R(g, x, y, w, h, col) {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function Rout(g, x, y, w, h, col, out) {
    R(g, x - 1, y - 1, w + 2, h + 2, out || OUTLINE);
    R(g, x, y, w, h, col);
  }
  function Ellipse(g, cx, cy, rx, ry, col, outline) {
    cx = Math.round(cx); cy = Math.round(cy);
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    if (outline) {
      for (let yy = -ry - 1; yy <= ry + 1; yy++) {
        const f = 1 - (yy * yy) / ((ry + 1) * (ry + 1));
        if (f < 0) continue;
        const w = Math.round((rx + 1) * Math.sqrt(f));
        R(g, cx - w, cy + yy, w * 2 + 1, 1, outline);
      }
    }
    for (let yy = -ry; yy <= ry; yy++) {
      const f = 1 - (yy * yy) / (ry * ry);
      if (f < 0) continue;
      const w = Math.round(rx * Math.sqrt(f));
      R(g, cx - w, cy + yy, w * 2 + 1, 1, col);
    }
  }
  function Dot(g, x, y, col) { R(g, x, y, 1, 1, col); }

  // banded spherical shading (heads, bellies, orbs, coins) + highlight fleck
  function Blob(g, cx, cy, rx, ry, baseHex, opts) {
    opts = opts || {};
    const rp = ramp(baseHex);
    const out = opts.outline || OUTLINE;
    cx = Math.round(cx); cy = Math.round(cy);
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    for (let yy = -ry - 1; yy <= ry + 1; yy++) {
      const f = 1 - (yy * yy) / ((ry + 1) * (ry + 1)); if (f < 0) continue;
      const w = Math.round((rx + 1) * Math.sqrt(f));
      R(g, cx - w, cy + yy, w * 2 + 1, 1, out);
    }
    const bands = opts.bands || [rp.light, rp.base, rp.base, rp.shadow, rp.deep];
    const n = bands.length;
    for (let yy = -ry; yy <= ry; yy++) {
      const f = 1 - (yy * yy) / (ry * ry); if (f < 0) continue;
      const w = Math.round(rx * Math.sqrt(f));
      const tt = (yy + ry) / (2 * ry);
      const idx = Math.min(n - 1, Math.floor(tt * n));
      R(g, cx - w, cy + yy, w * 2 + 1, 1, bands[idx]);
    }
    if (!opts.noHi) Ellipse(g, cx - rx * 0.35, cy - ry * 0.5, Math.max(1, rx * 0.22), Math.max(1, ry * 0.18), rp.hi, null);
    return rp;
  }
  // banded trapezoid (robes, capes, aprons, golem torsos)
  function Cone(g, cx, topY, botY, topW, botW, baseHex, opts) {
    opts = opts || {};
    const rp = ramp(baseHex);
    const out = opts.outline || OUTLINE;
    topY = Math.round(topY); botY = Math.round(botY);
    const h = Math.max(1, botY - topY);
    const bands = opts.bands || [rp.light, rp.base, rp.base, rp.shadow, rp.deep];
    const n = bands.length;
    for (let yy = topY - 1; yy <= botY + 1; yy++) {
      const tt = Math.max(0, Math.min(1, (yy - topY) / h));
      const w = (topW + (botW - topW) * tt) / 2 + 1;
      R(g, cx - w, yy, w * 2, 1, out);
    }
    for (let yy = topY; yy <= botY; yy++) {
      const tt = (yy - topY) / h;
      const w = (topW + (botW - topW) * tt) / 2;
      const idx = Math.min(n - 1, Math.floor(tt * n));
      R(g, cx - w, yy, w * 2, 1, bands[idx]);
    }
    if (opts.hiEdge !== false) {
      const topHalfW = topW / 2;
      R(g, cx - topHalfW * 0.7, topY + 1, 1, h * 0.35, rp.hi);
    }
    return rp;
  }
  // soft magic glow halo + core orb
  function Glow(g, cx, cy, r, col, pulse) {
    pulse = pulse == null ? 1 : pulse;
    g.save();
    for (let i = 3; i >= 1; i--) { g.globalAlpha = 0.11 * i * pulse; Ellipse(g, cx, cy, r * (1 + i * 0.55), r * (1 + i * 0.55), col, null); }
    g.globalAlpha = 1;
    Ellipse(g, cx, cy, r, r, col, ramp(col).deep);
    Ellipse(g, cx - r * 0.3, cy - r * 0.3, Math.max(1, r * 0.3), Math.max(1, r * 0.3), '#ffffff', null);
    g.restore();
  }

  const BOB4 = [0, -1, -1, 0];
  const SWAY4 = [-1, 0, 1, 0];
  const GLOW4 = [0.7, 0.85, 1, 0.85];

  // soft drop shadow + faint floor reflection + the sprite itself
  function groundFX(g, spr, x, y, ax, ay, shadowRX) {
    g.save(); g.globalAlpha = 0.30;
    Ellipse(g, x, y + 2, shadowRX, Math.max(2, shadowRX * 0.3), '#0a0714', null);
    g.restore();
    g.save(); g.globalAlpha = 0.15;
    g.translate(x, y); g.scale(1, -0.4);
    g.drawImage(spr, Math.round(-ax), Math.round(-ay));
    g.restore();
    g.drawImage(spr, Math.round(x - ax), Math.round(y - ay));
  }

  // ===================================================================
  // BACKGROUNDS  (10 keys: shop, shopRuined, alley, docks, casino,
  //               sewers, vault, opera, mansion, tower)
  // ===================================================================
  const FLOOR_TOP = 130;

  function skyBand(g, topCol, botCol, h) {
    const steps = 10;
    for (let i = 0; i < steps; i++) R(g, 0, (h / steps) * i, W, h / steps + 1, mix(topCol, botCol, i / (steps - 1)));
  }
  function floorBase(g, col) {
    R(g, 0, FLOOR_TOP, W, H - FLOOR_TOP, col);
    const rp = ramp(col);
    R(g, 0, FLOOR_TOP, W, 2, rp.light);
    // polished sheen band near the ground line
    g.save(); g.globalAlpha = 0.12;
    R(g, 0, GROUND - 3, W, 10, '#ffffff');
    g.restore();
  }

  const BG_STATIC = {
    shop(g) {
      skyBand(g, '#5a3a28', '#c8976a', FLOOR_TOP);
      floorBase(g, '#b8895a');
      for (let x = 0; x < W; x += 24) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#8a5e38');
      Rout(g, 20, 14, 40, 32, '#fde6a0', OUTLINE);
      R(g, 20 + 19, 14, 1, 32, '#c8a862'); R(g, 20, 14 + 15, 40, 1, '#c8a862');
      const wandCols = ['#ff7a3a', '#7ad7ff', '#ffe066', '#b48cff', '#7dff9a', '#ff5fd2', '#8fe3ff', '#f3c24a'];
      for (let row = 0; row < 3; row++) {
        const sy = 34 + row * 24;
        R(g, 160, sy + 18, 150, 4, '#6a4525'); R(g, 160, sy + 22, 150, 3, '#4a301a');
        for (let i = 0; i < 7; i++) drawWandItemInto(g, 172 + i * 19, sy + 16, wandCols[(row * 7 + i) % wandCols.length], false, 0);
      }
      Rout(g, 6, 102, 68, 28, '#8a5a34', OUTLINE); R(g, 6, 102, 68, 6, '#a8754a');
      Rout(g, 16, 86, 16, 16, '#4a4a4a', OUTLINE); R(g, 19, 90, 10, 5, '#8a8a8a');
      R(g, 240, 0, 3, 20, '#5a4028');
      Glow(g, 242, 28, 9, '#ffdd88', 1);
    },
    shopRuined(g) {
      skyBand(g, '#201a20', '#4a3a3e', FLOOR_TOP);
      floorBase(g, '#6a5540');
      for (let x = 0; x < W; x += 24) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#4a3a2c');
      Rout(g, 20, 14, 40, 32, '#8a9a94', OUTLINE);
      g.strokeStyle = OUTLINE; g.lineWidth = 2;
      g.beginPath(); g.moveTo(24, 18); g.lineTo(36, 30); g.lineTo(30, 45); g.moveTo(36, 30); g.lineTo(52, 24); g.stroke();
      g.save(); g.translate(210, 56); g.rotate(-0.12); R(g, -60, 14, 132, 5, '#5a4525'); g.restore();
      g.save(); g.translate(190, 86); g.rotate(0.18); R(g, -45, 14, 102, 5, '#4a3820'); g.restore();
      const wandCols = ['#ff7a3a', '#7ad7ff', '#ffe066', '#b48cff', '#7dff9a'];
      const spots = [[150, 134], [180, 140], [225, 130], [255, 138], [90, 134], [285, 128]];
      spots.forEach((p, i) => drawWandItemInto(g, p[0], p[1], wandCols[i % wandCols.length], true, 0));
      for (let i = 0; i < 24; i++) { const x = (i * 37 + 11) % W, y = FLOOR_TOP + 3 + ((i * 53) % 14); R(g, x, y, 3, 1, i % 2 ? '#2a2018' : '#8a7a68'); }
      Rout(g, 6, 108, 68, 24, '#6a4528', OUTLINE); R(g, 36, 108, 6, 24, '#3a281a');
      g.save(); g.globalAlpha = 0.5; Glow(g, 242, 28, 7, '#ffcc66', 0.6); g.restore();
    },
    alley(g) {
      skyBand(g, '#14172c', '#3a3a5a', FLOOR_TOP);
      Ellipse(g, 285, 22, 13, 13, '#e8e2c8', null);
      R(g, 0, 28, W, FLOOR_TOP - 28, '#5a4446');
      for (let x = -6; x < W; x += 26) for (let r = 0; r < 5; r++) R(g, x + (r % 2) * 13, 28 + r * 20, 24, 2, '#40302e');
      floorBase(g, '#454048');
      for (let i = 0; i < 14; i++) R(g, (i * 23 + 5) % W, FLOOR_TOP + 6 + (i % 3) * 4, 9, 3, '#3a363e');
      Rout(g, 26, 100, 18, 26, '#3a5a46', OUTLINE); R(g, 26, 100, 18, 4, '#2e4a38');
      Rout(g, 280, 96, 20, 30, '#3a4a5a', OUTLINE);
      for (let i = 0; i < 5; i++) R(g, 88, 30 + i * 18, 44, 3, '#2a2a38');
      R(g, 88, 30, 3, 76, '#2a2a38'); R(g, 130, 30, 3, 76, '#2a2a38');
      R(g, 178, 0, 76, 2, '#2a2a38');
      Glow(g, 200, 32, 8, '#ffcf7a', 0.9);
    },
    docks(g) {
      skyBand(g, '#2a3a4a', '#7a98a0', 80);
      R(g, 0, 58, W, FLOOR_TOP - 58, '#3c5868');
      for (let x = 0; x < W; x += 9) R(g, x, 68 + 8 * Math.sin(x * 0.16), 6, 2, '#5a7a86');
      R(g, 222, 44, 46, 24, '#1c2a32'); R(g, 243, 14, 3, 32, '#1c2a32'); R(g, 238, 20, 16, 3, '#1c2a32');
      floorBase(g, '#6a4e34');
      for (let x = 0; x < W; x += 20) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#4a3524');
      for (let y = FLOOR_TOP; y < H; y += 7) R(g, 0, y, W, 1, '#56402c');
      Rout(g, 44, 88, 7, 54, '#4a3524', OUTLINE);
      Rout(g, 270, 86, 7, 56, '#4a3524', OUTLINE);
      Glow(g, 47, 84, 6, '#ffe8a0', 0.8);
    },
    casino(g) {
      skyBand(g, '#2a0f1e', '#4a1430', FLOOR_TOP);
      floorBase(g, '#5a1420');
      for (let x = 9; x < W; x += 21) for (let y = FLOOR_TOP + 3; y < H; y += 9) Dot(g, x, y, '#c8a060');
      Rout(g, 44, 22, 54, 20, '#1a0a14', '#ff2f7a');
      Rout(g, 226, 22, 60, 20, '#1a0a14', '#2fd8ff');
      Ellipse(g, 168, 128, 50, 12, ramp('#2e6a3a').shadow, OUTLINE);
      Ellipse(g, 168, 126, 50, 10, '#3a7c48', null);
      Glow(g, 71, 32, 10, '#ff5fa8', 1);
      Glow(g, 256, 32, 10, '#5fe0ff', 1);
    },
    sewers(g) {
      skyBand(g, '#1a2a1e', '#334a32', FLOOR_TOP);
      for (let x = 0; x < W; x += 21) for (let y = 12; y < FLOOR_TOP; y += 15) R(g, x, y, 18, 12, mix('#2a3a28', '#334a32', ((x + y) % 60) / 60));
      R(g, 0, 75, W, 10, '#5a6a52'); R(g, 0, 75, W, 3, '#6e8064');
      Rout(g, 105, 60, 15, 15, '#4a5a44', OUTLINE);
      R(g, 0, FLOOR_TOP, W, H - FLOOR_TOP, '#283a2a');
      R(g, 0, FLOOR_TOP + 6, W, 12, '#2a5a52');
      g.save(); g.globalAlpha = 0.25; R(g, 0, FLOOR_TOP + 7, W, 2, '#8fe0d8'); g.restore();
    },
    vault(g) {
      skyBand(g, '#3a3e46', '#5a606a', FLOOR_TOP);
      Blob(g, 225, 68, 44, 44, '#8a909a', { bands: [ramp('#8a909a').hi, '#8a909a', ramp('#8a909a').shadow] });
      Ellipse(g, 225, 68, 32, 32, '#6a7078', OUTLINE);
      Ellipse(g, 225, 68, 8, 8, '#454a50', OUTLINE);
      for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; R(g, 225 + Math.cos(ang) * 20, 68 + Math.sin(ang) * 20, 3, 3, '#454a50'); }
      for (let x = 15; x < 105; x += 15) for (let y = 20; y < 104; y += 15) Rout(g, x, y, 12, 12, '#6a7078', '#454a50');
      floorBase(g, '#767c84');
      for (let x = 0; x < W; x += 18) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#5a6068');
      for (let i = 0; i < 4; i++) for (let s = 0; s < 3 + (i % 2); s++) Ellipse(g, 285 + i * 13, 140 - s * 5, 6, 3, '#e8c24a', OUTLINE);
    },
    opera(g) {
      skyBand(g, '#2a0a12', '#4a1020', FLOOR_TOP);
      for (let x = 0; x < 50; x += 9) Cone(g, x + 4, 0, FLOOR_TOP, 9, 9, mix('#7a1428', '#5a0e1e', (x % 18) / 18), { bands: ['#8a1830', '#6a1222'], hiEdge: false });
      for (let x = W - 50; x < W; x += 9) Cone(g, x + 4, 0, FLOOR_TOP, 9, 9, mix('#7a1428', '#5a0e1e', (x % 18) / 18), { bands: ['#8a1830', '#6a1222'], hiEdge: false });
      g.save(); g.globalAlpha = 0.18; g.fillStyle = '#eaf0ff';
      g.beginPath(); g.moveTo(135, 0); g.lineTo(195, 0); g.lineTo(225, FLOOR_TOP); g.lineTo(120, FLOOR_TOP); g.closePath(); g.fill();
      g.restore();
      R(g, 162, 3, 12, 3, '#c8a060'); Ellipse(g, 168, 15, 15, 6, '#c8a060', OUTLINE);
      floorBase(g, '#6a4228');
      for (let x = 0; x < W; x += 21) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#4a2c1a');
    },
    mansion(g) {
      skyBand(g, '#241526', '#3a2440', FLOOR_TOP);
      [[30, 20], [90, 14], [240, 18], [285, 24]].forEach(p => { Rout(g, p[0], p[1], 21, 27, '#5a3a28', '#1a0e10'); Blob(g, p[0] + 10, p[1] + 12, 6, 8, '#caa078', { noHi: true }); });
      Rout(g, 150, 12, 36, 39, '#3a2440', OUTLINE);
      R(g, 264, 90, 3, 20, '#6a5a3a'); Glow(g, 266, 86, 7, '#ffd27a', 0.9);
      floorBase(g, '#3a2820');
      for (let x = 0; x < W; x += 21) R(g, x, FLOOR_TOP, 1, H - FLOOR_TOP, '#241810');
      Rout(g, 105, 132, 135, 15, '#6a1a2a', '#3a0c14');
    },
    tower(g) {
      skyBand(g, '#120a1e', '#2a1030', 90);
      for (let i = 0; i < 10; i++) { const bw = 9 + (i % 3) * 4, bh = 15 + (i * 7) % 30; R(g, i * 33, 90 - bh, bw, bh, '#1a0e22'); if (i % 2) Dot(g, i * 33 + 3, 90 - bh + 4, '#ffd27a'); }
      R(g, 0, 87, W, FLOOR_TOP - 87, '#241334');
      for (let x = 15; x < W; x += 60) Rout(g, x, 15, 30, 69, '#2e1840', '#120a1e');
      floorBase(g, '#e8e2ec');
      for (let x = 0; x < W; x += 15) for (let y = FLOOR_TOP; y < H; y += 9) if (((x + y) / 9) % 2 < 1) R(g, x, y, 15, 9, '#d2c8d8');
      Rout(g, 120, FLOOR_TOP, 96, H - FLOOR_TOP, '#8a1428', '#5a0c18');
      Rout(g, 150, 105, 36, 24, '#4a2050', '#1c0e20');
    },
  };

  const BG_ANIM = {
    shop(g, t) { g.save(); g.globalAlpha = 0.5 + 0.15 * Math.sin(t * 6); Ellipse(g, 242 + Math.sin(t * 1.3) * 3, 30, 15, 9, '#ffdd88', null); g.restore(); },
    shopRuined(g, t) { if (Math.sin(t * 9) > 0.6) { g.save(); g.globalAlpha = 0.3; Ellipse(g, 242, 30, 12, 7, '#ffcc66', null); g.restore(); } Dot(g, 36 + fi(t, 2, 6) * 3, 27, '#eaf4ff'); },
    alley(g, t) { g.save(); g.globalAlpha = 0.55 + 0.25 * Math.sin(t * 5); Ellipse(g, 200, 34, 9, 7, '#ffcf7a', null); g.restore(); },
    docks(g, t) { g.save(); g.globalAlpha = 0.16; g.fillStyle = '#dfefff'; const fx = (t * 12) % (W + 60) - 60; g.fillRect(fx, 60, 75, 27); g.fillRect(fx + 120, 75, 90, 21); g.restore(); },
    casino(g, t) { const c1 = mix('#ff2f7a', '#ffd84a', (Math.sin(t * 2) + 1) / 2); const c2 = mix('#2fd8ff', '#8affc8', (Math.sin(t * 2 + 2) + 1) / 2); R(g, 46, 25, 51, 18, c1); R(g, 228, 25, 57, 18, c2); },
    sewers(g, t) { const dy = (t * 36) % 56; Ellipse(g, 105, 80 + dy, 2, 3, '#9adfe0', null); R(g, 0, FLOOR_TOP + 8 + Math.sin(t * 2) * 1, W, 3, '#3a8a7a'); },
    vault(g, t) { g.save(); g.translate(225, 68); g.rotate(t * 0.15); g.strokeStyle = '#454a50'; g.lineWidth = 2; g.beginPath(); g.moveTo(-27, 0); g.lineTo(27, 0); g.stroke(); g.restore(); },
    opera(g, t) { for (let i = 0; i < 3; i++) { const y = 30 + ((t * 15 + i * 30) % 90); g.save(); g.globalAlpha = 0.5; R(g, 150 + i * 30, y, 3, 3, '#fff2c8'); g.restore(); } },
    mansion(g, t) { g.save(); g.globalAlpha = 0.6 + 0.3 * Math.sin(t * 7); Ellipse(g, 266, 84, 8, 6, '#ffd27a', null); g.restore(); if (Math.sin(t * 0.7) > 0.96) { g.save(); g.globalAlpha = 0.25; R(g, 0, 0, W, FLOOR_TOP, '#eaeaff'); g.restore(); } },
    tower(g, t) { g.save(); g.globalAlpha = 0.35 + 0.25 * Math.sin(t * 3); Ellipse(g, 168, 141, 24, 4, '#c83a5a', null); g.restore(); },
  };

  function drawBackground(g, locKey, t) {
    if (typeof BGS !== 'undefined' && BGS.has && BGS.has(locKey)) { BGS.draw(g, locKey, t || 0); return; }
    const base = cached('bg:' + locKey, W, H, (c) => (BG_STATIC[locKey] || BG_STATIC.shop)(c));
    g.drawImage(base, 0, 0);
    const anim = BG_ANIM[locKey];
    if (anim) anim(g, t || 0);
  }

  // ===================================================================
  // PLAYER — the wandsmith (scrappy, goggles, patched apron, bandages)
  // ===================================================================
  const SKIN = '#e8ae84', HAIR = '#6a4428', APRON = '#9a6a3e', BAND = '#f2ece0';
  const PATCH = ['#5a9a7a', '#c86a5a', '#7a8ac8'];
  const WAND_WOOD = '#8a6a48', WAND_GLOW = '#ffcf5a';

  const PLAYER_TIP = {
    idle: { x: 34, y: -50 }, cast: { x: 42, y: -54 }, hurt: { x: 22, y: -26 },
    win: { x: 18, y: -62 }, sad: { x: 14, y: -10 }, cobble: { x: 12, y: -8 },
  };

  function drawSmithHead(g, mood, frame) {
    const sway = SWAY4[frame || 0];
    Blob(g, 0, -41, 10, 10, SKIN, { bands: [ramp(SKIN).light, SKIN, SKIN, SKIN], noHi: false });
    // messy hair
    R(g, -9 + sway * 0.3, -51, 18, 5, HAIR); R(g, -10, -47, 4, 5, HAIR); R(g, 6, -47, 4, 5, HAIR);
    R(g, -3 + sway, -54, 4, 5, HAIR);
    // goggles
    Ellipse(g, -4, -41, 4, 4, '#cfe8ea', OUTLINE); Ellipse(g, 5, -41, 4, 4, '#cfe8ea', OUTLINE);
    R(g, 0, -42, 2, 2, '#b8927a');
    R(g, -9, -42, 2, 2, '#b8927a'); R(g, 8, -42, 2, 2, '#b8927a');
    if (mood === 'shut') { R(g, -6, -41, 3, 1, OUTLINE); R(g, 3, -41, 3, 1, OUTLINE); }
    else if (mood === 'angry') { R(g, -7, -43, 4, 1.5, OUTLINE); R(g, 3, -43, 4, 1.5, OUTLINE); Dot(g, -4, -40, '#201030'); Dot(g, 5, -40, '#201030'); }
    else { Dot(g, -4, -40, '#201030'); Dot(g, 5, -40, '#201030'); Dot(g, -4.5, -41, '#dff'); Dot(g, 4.5, -41, '#dff'); }
    Dot(g, -7, -37, '#ff9a8a'); Dot(g, 6, -37, '#ff9a8a');
    // band-aid patch on cheek
    Rout(g, 5, -35, 4, 4, BAND, '#c8a858'); R(g, 5.5, -34, 1, 2, '#e8a0a0');
  }
  const APRON_BANDS = [ramp(APRON).light, APRON, APRON, ramp(APRON).shadow];
  function drawApron(g) {
    Cone(g, 0, -30, -16, 20, 27, APRON, { bands: APRON_BANDS });
    const colors = PATCH;
    Rout(g, -8, -26, 5, 4, colors[0], OUTLINE);
    Rout(g, -1, -21, 5, 4, colors[1], OUTLINE);
    Rout(g, 4, -26, 5, 4, colors[2], OUTLINE);
    // trouser legs + boots
    R(g, -9, -16, 7, 11, '#5a4a3a'); R(g, 2, -16, 7, 11, '#5a4a3a');
    R(g, -9, -7, 7, 8, '#3a2a1e'); R(g, 2, -7, 7, 8, '#3a2a1e');
  }
  function drawCrookedWand(g, x0, y0, tipX, tipY, glowT) {
    const midX = (x0 + tipX) / 2 + 5, midY = (y0 + tipY) / 2 - 2;
    g.strokeStyle = WAND_WOOD; g.lineWidth = 3.4; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(midX, midY); g.lineTo(tipX, tipY); g.stroke();
    g.save(); g.globalAlpha = 0.5; g.strokeStyle = shade(WAND_WOOD, 28); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0 - 1, y0); g.lineTo(midX - 1, midY); g.lineTo(tipX - 1, tipY); g.stroke();
    g.restore();
    Glow(g, tipX, tipY, 6, WAND_GLOW, 0.85 + 0.15 * Math.sin(glowT * 6));
  }

  const PLAYER_DRAW = {
    idle(g, t, frame) {
      const bob = BOB4[frame || 0];
      g.save(); g.translate(0, bob);
      drawApron(g);
      R(g, -14, -24, 6, 10, SKIN);
      R(g, 8, -25, 6, 10, SKIN);
      const tip = PLAYER_TIP.idle;
      drawCrookedWand(g, 13, -22, tip.x, tip.y, t);
      drawSmithHead(g, null, frame);
      g.restore();
    },
    cast(g, t) {
      drawApron(g);
      R(g, -15, -25, 6, 10, SKIN);
      R(g, 10, -28, 7, 11, SKIN);
      const tip = PLAYER_TIP.cast;
      drawCrookedWand(g, 16, -26, tip.x, tip.y, t);
      drawSmithHead(g, 'angry', 0);
    },
    hurt(g) {
      Cone(g, 0, -26, -16, 18, 25, APRON, { bands: APRON_BANDS });
      R(g, -9, -14, 7, 10, '#5a4a3a'); R(g, 2, -14, 7, 10, '#5a4a3a');
      R(g, -9, -6, 7, 7, '#3a2a1e'); R(g, 2, -6, 7, 7, '#3a2a1e');
      R(g, -14, -21, 6, 9, SKIN);
      R(g, 6, -19, 7, 9, SKIN);
      const tip = PLAYER_TIP.hurt;
      drawCrookedWand(g, 10, -18, tip.x, tip.y, 0);
      drawSmithHead(g, 'shut', 0);
      g.save(); g.globalAlpha = 0.2; R(g, -13, -54, 28, 54, '#ff4040'); g.restore();
    },
    win(g, t, frame) {
      const bob = frame === 1 ? -3 : -1;
      g.save(); g.translate(0, bob);
      drawApron(g);
      R(g, -16, -42, 6, 16, SKIN); R(g, 8, -42, 6, 16, SKIN);
      const tip = PLAYER_TIP.win;
      drawCrookedWand(g, 6, -40, tip.x, tip.y, t);
      drawSmithHead(g, null, frame);
      g.save(); g.globalAlpha = 0.85; Dot(g, -16, -52, '#fff'); Dot(g, 14, -56, '#fff'); g.restore();
      g.restore();
    },
    sad(g) {
      Cone(g, 0, -29, -14, 20, 28, APRON, { bands: APRON_BANDS });
      R(g, -9, -14, 7, 8, '#3a2a1e'); R(g, 2, -14, 7, 8, '#3a2a1e');
      R(g, -14, -14, 6, 8, SKIN); R(g, 8, -14, 6, 8, SKIN);
      drawSmithHead(g, 'shut', 0);
      R(g, -6, -44, 14, 4, BAND);
    },
    cobble(g, t) {
      Cone(g, 0, -29, -14, 22, 30, APRON, { bands: APRON_BANDS });
      R(g, -9, -14, 7, 8, '#3a2a1e'); R(g, 2, -14, 7, 8, '#3a2a1e');
      R(g, -16, -13, 6, 8, SKIN);
      const wig = Math.sin(t * 3) > 0 ? 1 : 0;
      R(g, 9, -13 + wig, 6, 8, SKIN);
      drawSmithHead(g, null, 0);
      R(g, -6, -5, 5, 4, '#ff7a3a'); R(g, 0, -5, 5, 4, '#7ad7ff'); R(g, 7, -4, 4, 4, '#b48cff');
    },
  };

  // ---- Pix-backed player (hand-authored sprite 'player') ----
  const PLAYER_POSE_PIX = {
    idle: (frame) => ({ dx: 0, dy: BOB4[frame || 0], sx: 1, sy: 1 }),
    cast: () => ({ dx: 3, dy: -1, sx: 1.03, sy: 0.98 }),
    hurt: () => ({ dx: -4, dy: 0, sx: 1, sy: 1 }),
    win: (frame) => ({ dx: 0, dy: frame === 1 ? -3 : -1, sx: 1, sy: 1 }),
    sad: () => ({ dx: 0, dy: 3, sx: 1, sy: 0.88 }),
    cobble: () => ({ dx: 0, dy: 3, sx: 1, sy: 0.88 }),
  };
  // Pose timing is independent of artwork frame count: a strong single
  // still keeps the renderer's four-step body motion and tip movement.
  function pixPlayerFrame(t) { return fi(t, 2.4, 4); }
  function poseAndDrawPlayerPix(c, state, frame, t) {
    const pose = (PLAYER_POSE_PIX[state] || PLAYER_POSE_PIX.idle)(frame, t);
    c.save();
    c.translate(pose.dx, pose.dy);
    c.scale(pose.sx, pose.sy);
    Pix.draw(c, 'player', 0, 0, { frame, flash: state === 'hurt' ? 0.55 : 0 });
    Pix.glow(c, 'player', 0, 0, frame, t, false);
    if (state === 'cast') Pix.glow(c, 'player', 0, 0, frame, t + 1.7, false);
    c.restore();
    if (state === 'hurt') {
      const sz = Pix.size('player') || { w: 28, h: 54 };
      c.save(); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = 0.22; c.fillStyle = '#ff4040';
      c.fillRect(-sz.w * 0.4, -sz.h * 0.92, sz.w * 0.8, sz.h * 0.9);
      c.restore();
    } else if (state === 'win') {
      c.save(); c.globalAlpha = 0.85; c.fillStyle = '#fff';
      c.fillRect(-16, -52, 2, 2); c.fillRect(14, -56, 2, 2);
      c.restore();
    }
  }

  function drawPlayer(g, x, y, t, state) {
    if (Pix.has('player')) {
      const sz = Pix.size('player');
      const d = Pix.def('player');
      const anchor = (d && d.anchor) || [sz.w / 2, sz.h];
      const reach = Math.hypot(Math.max(anchor[0], sz.w - anchor[0]), Math.max(anchor[1], sz.h - anchor[1]));
      const pad = Math.ceil(reach * 1.15) + 16;
      const AX = pad, AY = pad, cw = pad * 2, ch = pad * 2;
      const frame = pixPlayerFrame(t);
      const key = 'player:px:' + state + ':' + frame + ':' + cw;
      const spr = cached(key, cw, ch, (c) => {
        c.translate(AX, AY);
        poseAndDrawPlayerPix(c, state, frame, t);
      });
      groundFX(g, spr, x, y, AX, AY, Math.max(10, sz.w * 0.35));
      return;
    }
    const AX = 60, AY = 96;
    const idleFrames = 4;
    const frame = state === 'idle' || state === 'win' ? fi(t, 2.4, idleFrames) : fi(t, 6, 2);
    const key = 'player:' + state + ':' + frame;
    const spr = cached(key, 120, 150, (c) => {
      c.translate(AX, AY);
      (PLAYER_DRAW[state] || PLAYER_DRAW.idle)(c, t, frame);
    });
    groundFX(g, spr, x, y, AX, AY, 16);
  }
  function wandTip(x, y, t, state) {
    if (Pix.has('player')) {
      const d = Pix.def('player');
      if (d && d.tip) {
        const frame = pixPlayerFrame(t);
        const pose = (PLAYER_POSE_PIX[state] || PLAYER_POSE_PIX.idle)(frame, t);
        const rel = Pix.localToWorld('player', frame, false, 0, 0, d.tip[0], d.tip[1]);
        return { x: x + rel.x * pose.sx + pose.dx, y: y + rel.y * pose.sy + pose.dy };
      }
    }
    const o = PLAYER_TIP[state] || PLAYER_TIP.idle;
    return { x: x + o.x, y: y + o.y };
  }

  // ===================================================================
  // ENEMIES — goons + boss characters
  // ===================================================================
  const ENEMY_BOX = {
    rat: { w: 40, h: 38 }, toad: { w: 50, h: 48 }, hound: { w: 54, h: 46 }, shark: { w: 46, h: 50 },
    mask: { w: 42, h: 48 }, golem: { w: 58, h: 60 }, cat: { w: 42, h: 42 }, crow: { w: 42, h: 40 },
    pip: { w: 46, h: 66 }, hex: { w: 46, h: 74 }, vex: { w: 46, h: 74 }, fin: { w: 48, h: 80 },
    bruno: { w: 70, h: 86 }, lou: { w: 46, h: 76 }, velvet: { w: 50, h: 82 }, grimsby: { w: 56, h: 90 }, don: { w: 62, h: 96 },
  };
  function enemySize(key) {
    const pixKey = 'enemy:' + key;
    if (Pix.has(pixKey)) { const sz = Pix.size(pixKey); if (sz) return { w: sz.w, h: sz.h }; }
    const b = ENEMY_BOX[key] || { w: 40, h: 44 };
    return { w: b.w, h: b.h };
  }

  function eyesFor(g, cx, cy, mood, spacing, col) {
    col = col || OUTLINE; spacing = spacing || 5;
    if (mood === 'hit') { R(g, cx - spacing, cy, 3, 2, col); R(g, cx + spacing - 2, cy, 3, 2, col); return; }
    if (mood === 'attack') { R(g, cx - spacing - 1, cy - 2, 5, 2, col); R(g, cx + spacing - 3, cy - 2, 5, 2, col); return; }
    if (mood === 'dead') {
      R(g, cx - spacing - 2, cy - 2, 2, 2, col); R(g, cx - spacing, cy, 2, 2, col); R(g, cx - spacing + 2, cy - 2, 2, 2, col);
      R(g, cx + spacing - 4, cy - 2, 2, 2, col); R(g, cx + spacing - 2, cy, 2, 2, col); R(g, cx + spacing, cy - 2, 2, 2, col);
      return;
    }
    Dot(g, cx - spacing, cy, col); Dot(g, cx + spacing - 2, cy, col);
    Dot(g, cx - spacing - 1, cy - 1, '#fff'); Dot(g, cx + spacing - 3, cy - 1, '#fff');
  }

  // ---- goon bodies (facing left; local origin = feet on ground, y up negative) ----
  const GOON_DRAW = {
    rat(g, mood, t, frame) {
      R(g, -8, -5, 5, 5, '#6a6a7a'); R(g, 5, -5, 5, 5, '#6a6a7a');
      Blob(g, 0, -17, 16, 14, '#8a8a9a');
      Blob(g, -9, -30, 13, 11, '#9a9aaa');
      R(g, -17, -40, 6, 8, '#8a8a9a'); R(g, -3, -40, 6, 8, '#8a8a9a');
      Ellipse(g, -17, -36, 2, 2, '#e8b0c0', null); Ellipse(g, -3, -36, 2, 2, '#e8b0c0', null);
      eyesFor(g, -9, -30, mood, 5);
      g.strokeStyle = '#8a8a9a'; g.lineWidth = 2; g.beginPath();
      g.moveTo(14, -10); g.quadraticCurveTo(26 + Math.sin(t * 4) * 3, -18, 20, -24); g.stroke();
      R(g, -30, -30, 5, 19, '#6a4a2a'); R(g, -35, -43, 14, 10, '#8a6a3a'); R(g, -35, -43, 14, 3, '#6a4e26');
    },
    toad(g, mood, t) {
      R(g, -13, -5, 8, 5, '#3a6a30'); R(g, 6, -5, 8, 5, '#3a6a30');
      Blob(g, 0, -22, 24, 19, '#5a9a4a');
      Blob(g, -5, -44, 16, 14, '#5a9a4a');
      Blob(g, -14, -51, 5, 5, '#7dc86a'); Blob(g, 4, -51, 5, 5, '#7dc86a');
      eyesFor(g, -5, -51, mood, 7);
      R(g, -8, -34, 10, 2, shade('#5a9a4a', -40));
    },
    hound(g, mood, t) {
      const wag = Math.sin(t * 6) * 3;
      R(g, -17, -5, 6, 5, '#4a3468'); R(g, -3, -5, 6, 5, '#4a3468'); R(g, 9, -5, 6, 5, '#4a3468'); R(g, 20, -5, 6, 5, '#4a3468');
      Blob(g, 2, -19, 24, 14, '#6a4a8a');
      Blob(g, -18, -29, 13, 11, '#6a4a8a');
      Rout(g, -28, -38, 7, 12, '#52396f', OUTLINE); Rout(g, -13, -38, 6, 9, '#52396f', OUTLINE);
      eyesFor(g, -18, -29, mood, 6);
      g.save(); g.globalAlpha = 0.75 + 0.25 * Math.sin(t * 8);
      R(g, -8, -22, 2, 2, '#c87aff'); R(g, 6, -16, 2, 2, '#c87aff');
      g.restore();
      R(g, 22, -16 + wag * 0.3, 9, 3, '#6a4a8a');
    },
    shark(g, mood, t) {
      R(g, -9, -5, 8, 5, '#3a5578'); R(g, 6, -5, 8, 5, '#3a5578');
      Blob(g, 0, -26, 20, 24, '#5a7aa8');
      R(g, -14, -34, 28, 10, '#3a5578'); R(g, -14, -34, 28, 2, '#2a4560'); R(g, -14, -26, 28, 2, '#2a4560');
      Blob(g, -3, -48, 14, 12, '#5a7aa8');
      Cone(g, -3, -62, -48, 4, 10, '#5a7aa8', { hiEdge: false });
      eyesFor(g, -3, -48, mood, 6);
      Rout(g, -30, -34, 11, 16, '#f0ead8', '#8a7a5a'); R(g, -28, -29, 8, 2, '#d02030');
    },
    mask(g, mood, t) {
      R(g, -9, -5, 8, 5, '#20203a'); R(g, 3, -5, 8, 5, '#20203a');
      Cone(g, 0, -42, -5, 22, 25, '#3a3a5a');
      Blob(g, -3, -47, 15, 14, '#3a3a5a', { noHi: true });
      Ellipse(g, -3, -47, 11, 11, '#f2ece0', OUTLINE);
      eyesFor(g, -3, -47, mood, 6, '#1c1c2a');
      Rout(g, -28, -38, 6, 18, '#8a5a3a', OUTLINE); Ellipse(g, -28, -40, 3, 3, '#c8a8ff', null);
    },
    golem(g, mood, t) {
      R(g, -19, -5, 11, 6, '#7a4a30'); R(g, 8, -5, 11, 6, '#7a4a30');
      Rout(g, -36, -32, 11, 24, '#8a5a3c', OUTLINE); Rout(g, 25, -32, 11, 24, '#8a5a3c', OUTLINE);
      Cone(g, 0, -45, -11, 52, 56, '#a86a4a', { bands: [ramp('#a86a4a').light, '#a86a4a', '#a86a4a', ramp('#a86a4a').shadow], hiEdge: false });
      for (let r = 0; r < 4; r++) { const off = (r % 2) * 9; for (let c = -2; c < 3; c++) R(g, off + c * 18 - 1, -45 + r * 9, 1, 9, '#5a3c28'); }
      for (let r = 1; r < 4; r++) R(g, -26, -45 + r * 9, 52, 1, '#5a3c28');
      Rout(g, -15, -62, 30, 18, '#9a6a48', OUTLINE);
      R(g, -15, -62, 30, 3, ramp('#9a6a48').light);
      eyesFor(g, 0, -53, mood, 8, '#ffcf5a');
      g.save(); g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5); Glow(g, -7, -53, 2.5, '#ffcf5a', 1); Glow(g, 7, -53, 2.5, '#ffcf5a', 1); g.restore();
    },
    cat(g, mood, t) {
      R(g, -8, -5, 5, 5, '#1a1a28'); R(g, 5, -5, 5, 5, '#1a1a28');
      Blob(g, 0, -17, 16, 13, '#2a2a3a');
      Blob(g, -5, -32, 13, 11, '#2a2a3a');
      Rout(g, -13, -45, 13, 7, '#2a2a3a', OUTLINE); R(g, -13, -45, 13, 2, '#1a1a28');
      R(g, -9, -51, 3, 7, '#2a2a3a'); R(g, 0, -51, 3, 7, '#2a2a3a');
      eyesFor(g, -5, -32, mood, 6, '#ffd84a');
      g.strokeStyle = '#2a2a3a'; g.lineWidth = 2; g.beginPath();
      g.moveTo(13, -10); g.quadraticCurveTo(26, -16 + Math.sin(t * 5) * 2, 16, -26); g.stroke();
    },
    crow(g, mood, t) {
      R(g, -6, -5, 5, 5, '#1a1a30'); R(g, 3, -5, 5, 5, '#1a1a30');
      Blob(g, 0, -19, 15, 15, '#2a2a4a');
      Blob(g, -5, -35, 13, 11, '#2a2a4a');
      R(g, -16, -21, 8, 13, '#20203a');
      R(g, -18, -37, 9, 5, '#e8a53a'); R(g, -19, -36, 4, 3, '#c88a2a');
      Ellipse(g, -5, -35, 8, 6, '#d8d8e0', OUTLINE);
      eyesFor(g, -5, -35, mood, 5, '#1a1a30');
    },
  };

  // ---- boss characters ----
  const BOSS_DRAW = {
    pip(g, mood, t, frame) {
      const sway = SWAY4[frame || 0] * 0.6;
      R(g, -9, -5, 7, 5, '#7a4322'); R(g, 4, -5, 7, 5, '#7a4322');
      Cone(g, 0, -30, -5, 20, 22, '#c86a3a');
      Blob(g, -3, -46, 14, 12, '#e0a878');
      Rout(g, -17 + sway, -58, 26, 9, '#8a4a22', OUTLINE); Rout(g, -9 + sway, -62, 13, 6, '#8a4a22', OUTLINE);
      eyesFor(g, -3, -46, mood, 6);
      Blob(g, -24, -24, 11, 13, '#8a5a30', { noHi: true });
    },
    hex(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      R(g, -9, -5, 7, 5, '#2a4868'); R(g, 4, -5, 7, 5, '#2a4868');
      Cone(g, 0, -42, -5, 24, 28, '#4a8ac8');
      Blob(g, -3, -58, 15, 14, '#e0a878');
      R(g, -18 + sway, -68, 26, 6, '#2a4868'); R(g, -18 + sway, -66, 9, 15, '#1a2a3a');
      eyesFor(g, -3, -58, mood, 6);
      R(g, -28, -42, 5, 18, '#8a8a9a'); Glow(g, -28, -46, 4, '#9fe8ff', 0.8);
    },
    vex(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      R(g, -9, -5, 7, 5, '#2a4868'); R(g, 4, -5, 7, 5, '#2a4868');
      Cone(g, 0, -42, -5, 24, 28, '#4a8ac8');
      Blob(g, 0, -58, 15, 14, '#e0a878');
      R(g, 7 + sway, -75, 6, 20, '#1a2a3a');
      eyesFor(g, 0, -58, mood, 6);
      R(g, -28, -42, 5, 18, '#8a8a9a'); Glow(g, -28, -46, 4, '#ff9fe8', 0.8);
    },
    fin(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      Cone(g, 0, -6, -5, 28, 36, '#5a8ab8');
      Cone(g, 0, -46, -6, 36, 30, '#5a8ab8');
      Blob(g, 0, -64, 15, 15, '#e0a878');
      R(g, -5 + sway, -84, 10, 10, '#2a4a68'); R(g, -2 + sway, -92, 5, 10, '#2a4a68');
      eyesFor(g, 0, -64, mood, 6);
      Dot(g, -8, -50, '#f2f2f8'); Dot(g, -5, -45, '#f2f2f8'); Dot(g, -10, -40, '#f2f2f8');
    },
    bruno(g, mood, t) {
      R(g, -16, -5, 11, 5, '#2a4a1e'); R(g, 6, -5, 11, 5, '#2a4a1e');
      Blob(g, 0, -34, 32, 30, '#4a8a3a');
      Blob(g, -3, -66, 19, 17, '#4a8a3a');
      Blob(g, -3, -66, 7, 7, '#6fc456', { noHi: true });
      R(g, -3, -50, 7, 5, '#d03838');
      eyesFor(g, -3, -66, mood, 8);
      Blob(g, -40, -34, 15, 15, '#c8392f'); Blob(g, 36, -34, 15, 15, '#c8392f');
    },
    lou(g, mood, t, frame) {
      const sway = SWAY4[frame || 0] * 0.4;
      R(g, -9, -5, 7, 5, '#5a4424'); R(g, 4, -5, 7, 5, '#5a4424');
      Cone(g, 0, -42, -5, 22, 26, '#c8a060');
      Blob(g, -3, -58, 15, 14, '#e0a878');
      R(g, -18 + sway, -70, 26, 7, '#3a7a52');
      R(g, -13, -56, 19, 4, '#ece8de');
      eyesFor(g, -3, -58, mood, 6);
      Rout(g, -32, -40, 18, 22, '#f2ece0', '#8a7a5a'); R(g, -29, -34, 12, 2, '#555'); R(g, -29, -28, 12, 2, '#555');
    },
    velvet(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      Cone(g, sway * 0.5, -46, -5, 26, 32, '#8a4ac8');
      R(g, -14 + sway * 0.5, -60, 28, 11, '#6a2ca0');
      Blob(g, sway * 0.5, -70, 15, 15, '#e0a878');
      R(g, -11 + sway, -83, 7, 8, '#8a4ac8'); R(g, 4 + sway, -83, 7, 8, '#8a4ac8');
      eyesFor(g, sway * 0.5, -70, mood, 6);
      Ellipse(g, 7 + sway * 0.5, -68, 5, 5, '#f2ece0', '#444');
      R(g, -32, -42, 5, 24, '#4a1a66'); Glow(g, -32, -47, 5, '#d8a8ff', 0.8);
    },
    grimsby(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      R(g, -14, -5, 10, 5, '#1a1a30'); R(g, 5, -5, 10, 5, '#1a1a30');
      Cone(g, sway * 0.6, -54, -5, 30, 38, '#3a3a6a');
      Blob(g, sway * 0.6, -74, 18, 16, '#3a3a6a', { noHi: true });
      Blob(g, sway * 0.6, -72, 13, 13, '#caa88a');
      eyesFor(g, sway * 0.6, -72, mood, 7, '#1a1a30');
      R(g, -14, -56, 28, 4, '#9a9aa8'); Dot(g, 0, -54, '#c8c8d0');
    },
    don(g, mood, t, frame) {
      const sway = SWAY4[frame || 0];
      Cone(g, sway, -60, -5, 23 + 36, 62, '#8a1a3a', { hiEdge: false });
      Blob(g, 0, -40, 30, 32, '#c83a5a');
      Blob(g, 0, -76, 18, 16, '#e0a878');
      R(g, -20 + sway, -98, 40, 14, '#1a0a12'); R(g, -22 + sway, -86, 44, 6, '#1a0a12'); Blob(g, 9 + sway, -108, 8, 7, '#c83a5a', { noHi: true });
      eyesFor(g, 0, -76, mood, 8);
      R(g, -9, -68, 18, 4, '#1a0a12');
      Rout(g, -46, -36, 22, 26, '#2a1418', '#160a0c'); R(g, -43, -30, 16, 2, '#c8a060'); R(g, -43, -24, 16, 2, '#c8a060');
      g.save(); g.globalAlpha = GLOW4[frame || 0]; Glow(g, -35, -26, 5, '#ff6a8a', 1); g.restore();
    },
  };

  const FALL_ANGLE = Math.PI * (70 / 180);
  function poseAndDrawPix(c, w, h, groundY, state, frame, pixKey, t) {
    const frames = Pix.get(pixKey);
    const poseFrame = frame % (frames ? frames.length : 1);
    c.save();
    c.translate(w / 2, groundY);
    if (state === 'hit') {
      c.save(); c.scale(1.12, 0.86);
      Pix.draw(c, pixKey, 0, 0, { frame: poseFrame, flash: frame === 1 ? 1 : 0 });
      Pix.glow(c, pixKey, 0, 0, poseFrame, t, false);
      c.restore();
    } else if (state === 'attack') {
      const lunge = frame ? 11 : 4;
      c.translate(-lunge, 0); c.scale(0.97, 1.03);
      Pix.draw(c, pixKey, 0, 0, { frame: poseFrame });
      Pix.glow(c, pixKey, 0, 0, poseFrame, t, false);
    } else if (state === 'dead') {
      c.rotate(FALL_ANGLE);
      Pix.draw(c, pixKey, 0, 0, { frame: poseFrame });
      c.restore();
      c.save();
      for (let i = 0; i < 3; i++) {
        const ang = t * 3 + i * (Math.PI * 2 / 3);
        const sx = w / 2 + Math.cos(ang) * 14, sy = groundY - h - 10 + Math.sin(ang) * 5;
        if (Pix.has('impact:starfall')) Pix.draw(c, 'impact:starfall', sx, sy, { scale: .25 });
        else { c.fillStyle = '#ffe066'; c.fillRect(sx - 2, sy - 2, 4, 4); }
      }
      c.restore();
      return;
    } else {
      const bob = BOB4[frame || 0];
      c.translate(0, bob);
      Pix.draw(c, pixKey, 0, 0, { frame: poseFrame });
      Pix.glow(c, pixKey, 0, 0, poseFrame, t, false);
    }
    c.restore();
  }

  function poseAndDraw(c, w, h, groundY, state, frame, drawFn, t) {
    c.save();
    c.translate(w / 2, groundY);
    if (state === 'hit') {
      const flashOn = frame === 1;
      c.save(); c.scale(1.12, 0.86);
      drawFn(c, 'hit', t, frame);
      c.restore();
      if (flashOn) { c.save(); c.globalAlpha = 0.4; c.fillStyle = '#fff'; c.fillRect(-w / 2, -h - 8, w, h + 16); c.restore(); }
    } else if (state === 'attack') {
      const lunge = frame ? 11 : 4;
      c.translate(-lunge, 0); c.scale(0.97, 1.03);
      drawFn(c, 'attack', t, frame);
    } else if (state === 'dead') {
      c.scale(1.25, 0.42);
      drawFn(c, 'dead', t, frame);
      c.restore();
      c.save();
      for (let i = 0; i < 3; i++) {
        const ang = t * 3 + i * (Math.PI * 2 / 3);
        const sx = w / 2 + Math.cos(ang) * 14, sy = groundY - h - 10 + Math.sin(ang) * 5;
        c.fillStyle = '#ffe066'; c.fillRect(sx - 2, sy - 2, 4, 4);
      }
      c.restore();
      return;
    } else {
      const bob = BOB4[frame || 0];
      c.translate(0, bob);
      drawFn(c, 'idle', t, frame);
    }
    c.restore();
  }

  function enemyFrameCount(state) { return state === 'dead' ? 3 : state === 'idle' ? 4 : 2; }
  function enemyFrameSpeed(state) { return state === 'attack' ? 6 : state === 'hit' ? 10 : state === 'dead' ? 1.5 : 2.4; }

  function drawEnemy(g, key, x, y, t, state) {
    const st = state || 'idle';
    const pixKey = 'enemy:' + key;
    const frame = fi(t || 0, enemyFrameSpeed(st), enemyFrameCount(st));
    if (Pix.has(pixKey)) {
      // fully generic to the sprite's own native size: pad the canvas to the
      // anchor's true max reach so idle/hit/attack/dead (any rotation angle)
      // never clips a corner, whatever dimensions the artist drew.
      const sz = Pix.size(pixKey);
      const d = Pix.def(pixKey);
      const anchor = (d && d.anchor) || [sz.w / 2, sz.h];
      const reach = Math.hypot(Math.max(anchor[0], sz.w - anchor[0]), Math.max(anchor[1], sz.h - anchor[1]));
      const pad = Math.ceil(reach * 1.2) + 18;
      const w = pad * 2, h = pad * 2, AY = pad;
      const cacheKey = 'enemy:' + key + ':' + st + ':' + frame + ':px';
      const spr = cached(cacheKey, w, h, (c) => poseAndDrawPix(c, w, sz.h, AY, st, frame, pixKey, t || 0));
      if ((st === 'hit' || st === 'dead') && x >= 0 && x <= W) {
        // Fit the cached pose itself, including raised props and fallen limbs.
        const bounds = poseBounds(cacheKey, spr);
        x = Math.max(1 - bounds[0] + w / 2, Math.min(x, W - 2 - bounds[2] + w / 2));
        y = Math.max(1 - bounds[1] + AY, Math.min(y, H - 2 - bounds[3] + AY));
      }
      groundFX(g, spr, x, y, w / 2, AY, sz.w * 0.4);
      return;
    }
    const drawFn = GOON_DRAW[key] || BOSS_DRAW[key];
    if (!drawFn) return;
    const box = ENEMY_BOX[key] || { w: 40, h: 44 };
    const pad = 32;
    const w = box.w + pad * 2, h = box.h + pad + 14, AY = box.h + pad;
    const spr = cached('enemy:' + key + ':' + st + ':' + frame, w, h, (c) => poseAndDraw(c, w, box.h + 14, AY, st, frame, drawFn, t || 0));
    groundFX(g, spr, x, y, w / 2, AY, box.w * 0.4);
  }

  // ===================================================================
  // PROJECTILES + IMPACTS
  // ===================================================================
  const PROJ_NATIVE = {
    spark: [10, 5], missile: [15, 7], frost: [11, 9], chain: [12, 7], fireball: [13, 13],
    orb: [11, 11], starfall: [11, 11], coin: [9, 9], trigger: [12, 5], twintrigger: [15, 7], bomb: [14, 14],
  };
  const PROJ_COL = {
    spark: '#ffe066', missile: '#b48cff', frost: '#8fe3ff', chain: '#7ad7ff', fireball: '#ff7a3a',
    orb: '#7dff9a', starfall: '#fff3a8', coin: '#f3c24a', trigger: '#ff5fd2', twintrigger: '#ff3fa8', bomb: '#ff9a1f',
  };
  function nativeOf(key) { return PROJ_NATIVE[key] || [9, 9]; }

  const PROJ_DRAW = {
    spark(g, cx, cy, s, col, fr) { R(g, cx - 4 * s, cy - 0.7 * s, 6 * s, 1.4 * s, col); R(g, cx + 1.5 * s, cy - 1.4 * s, 2.5 * s, 2.8 * s, '#fff'); Glow(g, cx + 2 * s, cy, 2 * s, col, 0.6); },
    missile(g, cx, cy, s, col, fr) {
      R(g, cx - 6 * s, cy - 1.4 * s, 9 * s, 2.8 * s, col); R(g, cx + 3 * s, cy - 2 * s, 3 * s, 4 * s, shade(col, -40));
      g.save(); g.globalAlpha = 0.8; R(g, cx - 8 * s, cy - 0.7 * s, 3 * s, 1.4 * s, fr ? '#ffcf6a' : '#ff7a3a'); g.restore();
    },
    frost(g, cx, cy, s, col, fr) {
      g.fillStyle = col; g.strokeStyle = ramp(col).deep; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + 4.5 * s, cy); g.lineTo(cx - 3 * s, cy - 3 * s); g.lineTo(cx - 1.5 * s, cy); g.lineTo(cx - 3 * s, cy + 3 * s); g.closePath(); g.fill(); g.stroke();
      Dot(g, cx, cy - 0.7 * s, '#fff');
    },
    chain(g, cx, cy, s, col, fr) {
      g.strokeStyle = col; g.lineWidth = 1.6 * s; g.beginPath();
      g.moveTo(cx - 4.5 * s, cy + 1.5 * s); g.lineTo(cx - 1.5 * s, cy - 2.3 * s); g.lineTo(cx + 1.5 * s, cy + 1.5 * s); g.lineTo(cx + 4.5 * s, cy - 2.3 * s);
      g.stroke();
      g.save(); g.globalAlpha = 0.5; g.strokeStyle = '#fff'; g.lineWidth = 0.6 * s; g.stroke(); g.restore();
    },
    fireball(g, cx, cy, s, col, fr) { Glow(g, cx, cy, 4 * s, col, fr ? 1 : 0.8); },
    orb(g, cx, cy, s, col, fr) { Blob(g, cx, cy, 5 * s, 5 * s, col, { noHi: true }); Dot(g, cx - 1.5 * s, cy - 1.5 * s, '#fff'); },
    starfall(g, cx, cy, s, col, fr) {
      g.fillStyle = col; g.strokeStyle = ramp(col).shadow; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a1 = -Math.PI / 2 + i * (Math.PI * 2 / 5), a2 = a1 + Math.PI / 5;
        g.lineTo(cx + Math.cos(a1) * 5 * s, cy + Math.sin(a1) * 5 * s);
        g.lineTo(cx + Math.cos(a2) * 2 * s, cy + Math.sin(a2) * 2 * s);
      }
      g.closePath(); g.fill(); g.stroke();
    },
    coin(g, cx, cy, s, col, fr) {
      const w = fr ? 2 * s : 4.5 * s;
      Blob(g, cx, cy, w, 4.5 * s, col, { noHi: true });
      if (!fr) R(g, cx - 0.6 * s, cy - 2.2 * s, 1.2 * s, 4.4 * s, ramp(col).shadow);
      Dot(g, cx - w * 0.3, cy - 1.5 * s, '#fff');
    },
    trigger(g, cx, cy, s, col, fr) { R(g, cx - 4.5 * s, cy - 0.7 * s, 7 * s, 1.4 * s, col); Glow(g, cx + 3 * s, cy, 2 * s, col, 0.8); },
    twintrigger(g, cx, cy, s, col, fr) {
      R(g, cx - 5.5 * s, cy - 2 * s, 7 * s, 1.4 * s, col); R(g, cx - 5.5 * s, cy + 0.6 * s, 7 * s, 1.4 * s, col);
      Glow(g, cx + 1.5 * s, cy - 1.3 * s, 1.6 * s, col, 0.7); Glow(g, cx + 1.5 * s, cy + 1.3 * s, 1.6 * s, col, 0.7);
    },
    bomb(g, cx, cy, s, col, fr) {
      Blob(g, cx, cy + 0.7 * s, 5.5 * s, 5 * s, col);
      for (let i = -1; i <= 1; i++) R(g, cx + i * 2.2 * s - 0.4 * s, cy - 3 * s, 0.8 * s, 3 * s, ramp(col).shadow);
      R(g, cx - 0.5 * s, cy - 5.5 * s, 1 * s, 2.6 * s, '#4a7a3a');
      Glow(g, cx, cy - 6.5 * s, fr ? 2.2 * s : 1.2 * s, '#ffcf6a', fr ? 1 : 0.5);
    },
  };

  function drawProjectile(g, partKey, x, y, angle, t, scale) {
    const s = Math.max(1, scale || 1);
    const pixKey = 'proj:' + partKey;
    if (Pix.has(pixKey)) {
      const frames = Pix.get(pixKey);
      const fr = fi(t || 0, 8, frames.length);
      g.save(); g.translate(x, y); g.rotate(angle || 0); g.scale(s, s);
      Pix.draw(g, pixKey, 0, 0, { frame: fr });
      Pix.glow(g, pixKey, 0, 0, fr, t, false);
      g.restore();
      return;
    }
    const [nw, nh] = nativeOf(partKey);
    const w = Math.ceil(nw * s) + 10, h = Math.ceil(nh * s) + 10;
    const fr = fi(t || 0, 8, 2);
    const col = PROJ_COL[partKey] || '#ffffff';
    const drawFn = PROJ_DRAW[partKey] || PROJ_DRAW.spark;
    const spr = cached('proj:' + partKey + ':' + s + ':' + fr, w, h, (c) => { drawFn(c, w / 2, h / 2, s, col, fr); });
    g.save(); g.translate(x, y); g.rotate(angle || 0); g.drawImage(spr, -w / 2, -h / 2); g.restore();
  }

  const IMPACT_STYLE = {
    spark: 'sparkle', missile: 'puff', frost: 'shards', chain: 'zig', fireball: 'ring',
    orb: 'puff', starfall: 'sparkle', coin: 'coinburst', trigger: 'sparkle', twintrigger: 'sparkle', bomb: 'ring',
  };
  const N_IMPACT = 6;
  function impactDraw(c, size, style, col, k) {
    const cx = size / 2, cy = size / 2;
    const p = k / (N_IMPACT - 1);
    if (style === 'ring') {
      const r = 5 + p * (size / 2 - 5);
      c.save(); c.globalAlpha = Math.max(0, 1 - p); c.strokeStyle = col; c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = Math.max(0, (1 - p) * 0.4); c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r * 0.6, 0, Math.PI * 2); c.fill();
      c.restore();
    } else if (style === 'shards') {
      c.save(); c.globalAlpha = 1 - p;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const r = 3 + p * (size / 2 - 4); c.fillStyle = col; c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 3); }
      c.restore();
    } else if (style === 'zig') {
      c.save(); c.globalAlpha = 1 - p; c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 8, cy - 6 + p * 3); c.lineTo(cx, cy + 6 - p * 3); c.lineTo(cx + 8, cy - 6 + p * 3); c.stroke();
      c.restore();
    } else if (style === 'coinburst') {
      c.save(); c.globalAlpha = 1 - p;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + p * 2; const r = 3 + p * (size / 2 - 3); Ellipse(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2, col, null); }
      c.restore();
    } else {
      c.save(); c.globalAlpha = 1 - p;
      const r = 3 + p * (size / 2 - 3);
      for (let i = 0; i < 5; i++) { const a = i * (Math.PI * 2 / 5) + p; Dot(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, col); }
      Ellipse(c, cx, cy, 2 + p, 2 + p, col, null);
      c.restore();
    }
  }
  function drawImpact(g, partKey, x, y, k) {
    k = Math.max(0, Math.min(1, k || 0));
    const bucket = Math.round(k * (N_IMPACT - 1));
    const pixKey = 'impact:' + partKey;
    if (Pix.has(pixKey)) {
      const size = 40;
      const spr = cached('impact:' + partKey + ':' + bucket + ':px', size, size, (c) => {
        c.imageSmoothingEnabled = false;
        const progress = bucket / (N_IMPACT - 1);
        Pix.draw(c, pixKey, size / 2, size / 2, {
          scale: 0.4 + progress * 0.6,
          alpha: Math.max(0, 0.85 * (1 - progress)),
        });
      });
      g.drawImage(spr, Math.round(x - size / 2), Math.round(y - size / 2));
      return;
    }
    const style = IMPACT_STYLE[partKey] || 'sparkle';
    const col = PROJ_COL[partKey] || '#ffffff';
    const size = 38;
    const spr = cached('impact:' + partKey + ':' + bucket, size, size, (c) => impactDraw(c, size, style, col, bucket));
    g.drawImage(spr, Math.round(x - size / 2), Math.round(y - size / 2));
  }

  // ===================================================================
  // ICONS — parts, charms, frames (24x24 / 24x24 / 64x16)
  // ===================================================================
  function partIcon(key) {
    if (Pix.has('part:' + key)) return cached('icon:part:' + key + ':px', 24, 24, (c) => { const s = Pix.get('part:' + key)[0]; c.drawImage(s, 0, 0, s.width, s.height, 0, 0, 24, 24); });
    return cached('icon:part:' + key, 24, 24, (c) => drawPartIcon(c, key));
  }
  function drawPartIcon(c, key) {
    const data = (typeof PARTS !== 'undefined') ? PARTS[key] : null;
    const col = (data && data.col) || '#cccccc';
    if (data && data.kind === 'proj') {
      const drawFn = PROJ_DRAW[key] || PROJ_DRAW.spark;
      c.save(); c.translate(12, 12); c.rotate(-Math.PI / 4);
      drawFn(c, 0, 0, 1.4, col, 1);
      c.restore();
      return;
    }
    switch (key) {
      case 'power': gemIcon(c, col, 1); break;
      case 'amp': gemIcon(c, col, 1.3); R(c, 3, 3, 3, 2, '#fff'); break;
      case 'split': gemIcon(c, mix(col, '#fff', 0.2), 0.75, -4); gemIcon(c, col, 0.75, 4); break;
      case 'prism': {
        c.fillStyle = col; c.strokeStyle = ramp(col).deep; c.lineWidth = 1;
        c.beginPath(); c.moveTo(12, 4); c.lineTo(20, 20); c.lineTo(4, 20); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(12, 4); c.lineTo(12, 20); c.stroke();
        break;
      }
      case 'crit': Ellipse(c, 12, 12, 8, 8, '#dff0ff', ramp(col).shadow); R(c, 17, 17, 4, 2, col); R(c, 18, 15, 2, 4, col); break;
      case 'lead': Blob(c, 12, 12, 9, 9, col); R(c, 3, 11, 18, 2, ramp(col).shadow); break;
      case 'rune': runeIcon(c, col); break;
      case 'echo': runeIcon(c, col); Ellipse(c, 12, 12, 10, 10, 'rgba(0,0,0,0)', mix(col, '#fff', 0.4)); break;
      default: Blob(c, 12, 12, 8, 8, col);
    }
  }
  function gemIcon(c, col, sc, ox) {
    sc = sc || 1; ox = ox || 0;
    const cx = 12 + ox, cy = 12;
    const rp = ramp(col);
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(cx, cy - 7 * sc); c.lineTo(cx + 6 * sc, cy - 1.5 * sc); c.lineTo(cx + 3 * sc, cy + 7 * sc); c.lineTo(cx - 3 * sc, cy + 7 * sc); c.lineTo(cx - 6 * sc, cy - 1.5 * sc);
    c.closePath(); c.fill();
    c.strokeStyle = rp.deep; c.lineWidth = 1; c.stroke();
    Dot(c, cx - 1.5, cy - 3, '#fff');
  }
  function runeIcon(c, col) {
    c.strokeStyle = col; c.lineWidth = 2.4; c.beginPath();
    c.moveTo(12, 3); c.lineTo(12, 21); c.moveTo(6, 7); c.lineTo(18, 17); c.moveTo(18, 7); c.lineTo(6, 17);
    c.stroke();
    Ellipse(c, 12, 12, 3, 3, mix(col, '#fff', 0.5), null);
  }

  function charmIcon(key) {
    if (Pix.has('charm:' + key)) return cached('icon:charm:' + key + ':px', 24, 24, (c) => { const s = Pix.get('charm:' + key)[0]; c.drawImage(s, 0, 0, s.width, s.height, 0, 0, 24, 24); });
    return cached('icon:charm:' + key, 24, 24, (c) => drawCharmIcon(c, key));
  }
  function drawCharmIcon(c, key) {
    const data = (typeof CHARMS !== 'undefined') ? CHARMS[key] : null;
    const col = (data && data.col) || '#cccccc';
    const rp = ramp(col);
    switch (key) {
      case 'pyro': Rout(c, 6, 9, 12, 11, col, rp.deep); R(c, 6, 9, 12, 3, rp.light); R(c, 10, 3, 3, 6, '#ff7a3a'); break;
      case 'sparky': Blob(c, 12, 13, 8, 8, col); R(c, 10, 6, 3, 6, '#fff'); break;
      case 'nesting': Blob(c, 12, 15, 8, 8, col); Blob(c, 12, 15, 5, 5, mix(col, '#fff', 0.3)); Blob(c, 12, 15, 2, 2, '#fff'); break;
      case 'rubber': Ellipse(c, 12, 12, 8, 8, 'rgba(0,0,0,0)', col); Ellipse(c, 12, 12, 5, 5, 'rgba(0,0,0,0)', col); break;
      case 'overkill': impactDraw(c, 24, 'ring', col, 2); R(c, 9, 9, 6, 6, col); break;
      case 'glass': Rout(c, 9, 4, 6, 14, mix(col, '#fff', 0.3), rp.shadow); Ellipse(c, 12, 18, 5, 3, mix(col, '#fff', 0.3), rp.shadow); break;
      case 'ledger': Rout(c, 4, 4, 15, 16, col, rp.shadow); R(c, 7, 9, 9, 1.5, rp.shadow); R(c, 7, 13, 9, 1.5, rp.shadow); break;
      case 'tape': Ellipse(c, 12, 12, 9, 9, col, rp.shadow); Ellipse(c, 12, 12, 3, 3, '#fff', null); break;
      case 'wind': c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(4, 9); c.quadraticCurveTo(15, 6, 18, 12); c.moveTo(4, 16); c.quadraticCurveTo(13, 13, 16, 18); c.stroke(); break;
      case 'cat': Blob(c, 12, 15, 8, 6, col); R(c, 7, 6, 3, 4, col); R(c, 14, 6, 3, 4, col); Dot(c, 9, 13, '#000'); Dot(c, 15, 13, '#000'); break;
      case 'combo': R(c, 4, 16, 4, 4, col); R(c, 10, 11, 4, 9, col); R(c, 16, 5, 3, 15, col); break;
      case 'snowball': Blob(c, 12, 12, 9, 9, mix(col, '#fff', 0.2)); break;
      case 'glove': Rout(c, 7, 7, 10, 11, col, rp.shadow); R(c, 7, 4, 3, 5, col); R(c, 12, 4, 3, 5, col); break;
      case 'mirror': Ellipse(c, 12, 10, 8, 9, mix(col, '#fff', 0.4), rp.shadow); R(c, 10, 19, 3, 3, rp.shadow); break;
      case 'patchwork': R(c, 4, 4, 8, 8, col); R(c, 12, 4, 8, 8, shade(col, 30)); R(c, 4, 12, 8, 8, shade(col, -30)); R(c, 12, 12, 8, 8, col); break;
      case 'grudge': Blob(c, 12, 12, 8, 6, col); for (let i = 0; i < 4; i++) R(c, 7 + i * 3, 17, 1.5, 3, rp.shadow); break;
      case 'scrapper': R(c, 6, 15, 12, 3, col); R(c, 10, 4, 3, 14, col); Ellipse(c, 12, 6, 4, 3, rp.shadow, null); break;
      case 'splitter2': Rout(c, 7, 3, 9, 15, col, rp.shadow); Ellipse(c, 12, 19, 4, 3, rp.shadow, null); break;
      case 'overclock': Blob(c, 12, 12, 9, 9, col); R(c, 12, 6, 1.5, 6, '#fff'); R(c, 12, 12, 4, 1.5, '#fff'); break;
      case 'piggy': Blob(c, 12, 14, 9, 7, col); R(c, 9, 20, 1.5, 3, rp.shadow); R(c, 15, 20, 1.5, 3, rp.shadow); Dot(c, 17, 12, rp.shadow); break;
      default: Blob(c, 12, 12, 8, 8, col);
    }
  }

  function frameIcon(key) {
    if (Pix.has('frame:' + key)) return cached('icon:frame:' + key + ':px', 64, 16, (c) => { const s = Pix.get('frame:' + key)[0]; c.drawImage(s, 0, 0, s.width, s.height, 0, 0, 64, 16); });
    return cached('icon:frame:' + key, 64, 16, (c) => drawFrameIcon(c, key));
  }
  function drawFrameIcon(c, key) {
    const data = (typeof FRAMES !== 'undefined') ? FRAMES[key] : null;
    const col = (data && data.col) || '#cccccc';
    const rp = ramp(col);
    switch (key) {
      case 'twig':
        R(c, 6, 7, 50, 3, col);
        R(c, 15, 4, 3, 9, rp.shadow); R(c, 34, 4, 3, 9, rp.shadow);
        R(c, 22, 9, 9, 1.5, rp.deep); R(c, 44, 9, 6, 1.5, rp.deep);
        break;
      case 'broom':
        R(c, 6, 7, 44, 3, col);
        R(c, 3, 3, 8, 12, '#c8a860');
        for (let i = 0; i < 5; i++) R(c, 1 + i * 1.4, 1, 1.4, 15, shade('#c8a860', -20 + i * 8));
        R(c, 47, 7, 3, 3, rp.shadow);
        break;
      case 'bone':
        R(c, 9, 7, 44, 3, col);
        Blob(c, 9, 6, 4, 3, col); Blob(c, 9, 11, 4, 3, col);
        Blob(c, 54, 6, 4, 3, col); Blob(c, 54, 11, 4, 3, col);
        break;
      case 'crystal':
        c.save(); c.globalAlpha = 0.92;
        R(c, 6, 7, 42, 3, col);
        c.fillStyle = col; c.beginPath(); c.moveTo(48, 2); c.lineTo(58, 8); c.lineTo(48, 15); c.lineTo(43, 8); c.closePath(); c.fill();
        c.restore();
        R(c, 12, 7, 22, 1.5, '#fff');
        break;
      case 'staff':
        R(c, 6, 6, 48, 4, col); R(c, 6, 6, 48, 1.5, rp.light);
        Blob(c, 56, 8, 7, 7, '#ffd84a');
        R(c, 16, 4, 1.5, 8, '#ffd84a'); R(c, 32, 4, 1.5, 8, '#ffd84a');
        break;
      default: R(c, 6, 7, 48, 3, col);
    }
  }

  // small shop wand item (vertical, ~5x22), anchor = centre point
  function drawWandItemInto(g, x, y, col, broken, t) {
    if (Pix.has('prop:wand')) {
      const source = Pix.get('prop:wand')[0];
      const tinted = cached('wand-item:' + col, source.width, source.height, c => {
        c.drawImage(source, 0, 0);
        const image = c.getImageData(0, 0, source.width, source.height);
        const [red, green, blue] = hex2rgb(col);
        for (let i = 0; i < image.data.length; i += 4) {
          const r = image.data[i], b = image.data[i + 2], gr = image.data[i + 1];
          if (image.data[i + 3] && gr > r * 1.2 && b > r * 1.2) {
            const light = Math.max(gr, b) / 255;
            image.data[i] = Math.round(red * light);
            image.data[i + 1] = Math.round(green * light);
            image.data[i + 2] = Math.round(blue * light);
          }
        }
        c.putImageData(image, 0, 0);
      });
      const image = broken ? cached('wand-item-broken:' + col, 28, 16, c => {
        c.imageSmoothingEnabled = false;
        const cut = 12;
        c.save(); c.translate(8, 7); c.rotate(-1.1);
        c.drawImage(tinted, 0, 0, tinted.width, cut, -4, -7, tinted.width, cut); c.restore();
        c.save(); c.translate(18, 9); c.rotate(1.1);
        c.drawImage(tinted, 0, cut, tinted.width, tinted.height - cut, -4, -5, tinted.width, tinted.height - cut); c.restore();
      }) : tinted;
      g.save(); g.imageSmoothingEnabled = false;
      g.drawImage(image, Math.round(x - image.width / 2), Math.round(y - image.height / 2));
      g.restore(); return;
    }
    if (!broken) {
      Rout(g, x - 2, y - 11, 4, 19, col, OUTLINE);
      Ellipse(g, x, y - 13, 3, 3, mix(col, '#fff', 0.5), OUTLINE);
    } else {
      g.save(); g.translate(x - 3, y - 8); g.rotate(-0.3);
      Rout(g, 0, 0, 4, 11, col, OUTLINE);
      g.restore();
      g.save(); g.translate(x + 3, y + 2); g.rotate(0.45);
      Rout(g, 0, 0, 4, 9, col, OUTLINE);
      Ellipse(g, 2, -2, 3, 3, mix(col, '#fff', 0.5), OUTLINE);
      g.restore();
      g.save(); g.globalAlpha = 0.7 + 0.3 * Math.sin((t || 0) * 10);
      Dot(g, x, y - 3, '#fff');
      g.restore();
    }
  }
  function drawWandItem(g, x, y, col, broken, t) { drawWandItemInto(g, x, y, col, broken, t); }

  // ===================================================================
  // PORTRAITS (64x64 bust, coloured background)
  // ===================================================================
  function portraitBg(key) {
    const bossCol = (typeof BOSSES !== 'undefined' && BOSSES[key]) ? BOSSES[key].col
      : (key === 'hex' || key === 'vex') && typeof BOSSES !== 'undefined' ? BOSSES.twins.col : null;
    return PORTRAIT_BG[key] || bossCol || '#44465a';
  }
  function portrait(key) {
    const bg = portraitBg(key);
    const pixSrc = key === 'smith' || key === 'smithHurt' ? 'player' : key === 'goon' ? 'enemy:mask' : 'enemy:' + key;
    if (Pix.has(pixSrc) && Pix.def(pixSrc).face) {
      if (key === 'smithHurt') {
        return cached('portrait:smithHurt:px', 64, 64, (c) => {
          c.drawImage(Pix.portrait('player', bg), 0, 0);
          Rout(c, 38, 43, 9, 6, BAND, '#c8a858');
          R(c, 16, 33, 9, 2, OUTLINE); R(c, 36, 33, 9, 2, OUTLINE);
        });
      }
      return Pix.portrait(pixSrc, bg);
    }
    return cached('portrait:' + key, 64, 64, (c) => drawPortrait(c, key));
  }
  function bustFrame(c, bg) { R(c, 0, 0, 64, 64, bg); }

  const PORTRAIT_DRAW = {
    smith(c) {
      c.save(); c.translate(32, 61);
      Cone(c, 0, -40, -3, 42, 48, APRON);
      Blob(c, 0, -46, 20, 20, SKIN);
      R(c, -20, -56, 40, 9, HAIR); R(c, -20, -62, 24, 8, HAIR);
      Ellipse(c, -8, -46, 8, 8, '#cfe8ea', OUTLINE); Ellipse(c, 9, -46, 8, 8, '#cfe8ea', OUTLINE);
      Dot(c, -8, -45, '#201030'); Dot(c, 9, -45, '#201030');
      Dot(c, -14, -38, '#ff9a8a'); Dot(c, 13, -38, '#ff9a8a');
      c.restore();
    },
    smithHurt(c) {
      c.save(); c.translate(32, 61);
      Cone(c, 0, -40, -3, 42, 48, APRON);
      Blob(c, 0, -46, 20, 20, SKIN);
      R(c, -20, -56, 40, 9, HAIR);
      Rout(c, -11, -42, 11, 7, BAND, '#c8a858');
      R(c, -16, -47, 5, 2, OUTLINE); R(c, -1, -47, 5, 2, OUTLINE);
      c.restore();
    },
    goon(c) {
      c.save(); c.translate(32, 62);
      Blob(c, 0, -22, 22, 22, '#333347', { noHi: true });
      Blob(c, 0, -46, 17, 16, '#3a3a52');
      Ellipse(c, 0, -46, 13, 12, '#efe9df', OUTLINE);
      R(c, -19, -54, 38, 7, '#1c1c2a'); R(c, -19, -60, 24, 6, '#1c1c2a');
      Dot(c, -5, -46, '#1c1c2a'); Dot(c, 6, -46, '#1c1c2a');
      c.restore();
    },
    pip(c) { c.save(); c.translate(32, 67); BOSS_DRAW.pip(c, 'idle', 0, 0); c.restore(); },
    hex(c) { c.save(); c.translate(32, 72); BOSS_DRAW.hex(c, 'idle', 0, 0); c.restore(); },
    vex(c) { c.save(); c.translate(32, 72); BOSS_DRAW.vex(c, 'idle', 0, 0); c.restore(); },
    fin(c) { c.save(); c.translate(32, 75); BOSS_DRAW.fin(c, 'idle', 0, 0); c.restore(); },
    bruno(c) { c.save(); c.translate(32, 72); BOSS_DRAW.bruno(c, 'idle', 0, 0); c.restore(); },
    lou(c) { c.save(); c.translate(32, 72); BOSS_DRAW.lou(c, 'idle', 0, 0); c.restore(); },
    velvet(c) { c.save(); c.translate(32, 75); BOSS_DRAW.velvet(c, 'idle', 0, 0); c.restore(); },
    grimsby(c) { c.save(); c.translate(32, 78); BOSS_DRAW.grimsby(c, 'idle', 0, 0); c.restore(); },
    don(c) { c.save(); c.translate(32, 80); BOSS_DRAW.don(c, 'idle', 0, 0); c.restore(); },
  };
  const PORTRAIT_BG = { smith: '#caa06a', smithHurt: '#a86a5a', goon: '#2a2a3a' };
  function drawPortrait(c, key) {
    const bg = portraitBg(key);
    bustFrame(c, bg);
    (PORTRAIT_DRAW[key] || PORTRAIT_DRAW.goon)(c);
    g_vignette(c);
  }
  function g_vignette(c) {
    c.save(); c.globalAlpha = 0.22;
    const grad = c.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#000000');
    c.fillStyle = grad; c.fillRect(0, 48, 64, 16);
    c.restore();
  }

  // ===================================================================
  return {
    W, H, GROUND,
    drawBackground,
    drawPlayer,
    wandTip,
    drawEnemy,
    enemySize,
    drawProjectile,
    drawImpact,
    partIcon,
    charmIcon,
    frameIcon,
    drawWandItem,
    portrait,
  };
})();
