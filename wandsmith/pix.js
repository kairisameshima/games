'use strict';
/* =====================================================================
   WANDSMITH — Pix: hand-authored pixel-art sprite engine.
   Sprite files are plain calls to Pix.add('namespace:key', def) where def is:
     { palette, anchor, frames, face?, tip?, glow? }
   See the sprite-file contract in the project brief for the exact shape.
   This file owns: parsing text grids into cached per-frame canvases,
   anchored drawing (with optional horizontal flip / white flash / alpha /
   integer upscale), additive pulsing glow halos from def.glow, and
   64x64 bust portraits cropped from def.face. All animation STATE
   (bob, squash, lunge, rotation, red flash, etc.) lives in art.js, which
   composites these primitives into its own cached sprites exactly like
   it already does for the procedural fallback.
   ===================================================================== */
const Pix = (function () {
  const _defs = Object.create(null);     // key -> raw def as passed to add()
  const _cache = Object.create(null);    // key -> { def, frames:[canvas], flipped:[canvas], flash:[canvas], flippedFlash:[canvas] }
  const _portraitCache = Object.create(null); // "key\0bgCol" -> canvas

  function buildFrameCanvas(def, idx) {
    const rows = def.frames[idx];
    const h = rows.length;
    const w = rows.length ? rows[0].length : 0;
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const g = c.getContext('2d');
    const pal = def.palette || {};
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        const col = Object.prototype.hasOwnProperty.call(pal, ch) ? pal[ch] : null;
        if (!col) continue; // '.'/' '/unmapped char = transparent
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  function entry(key) {
    let e = _cache[key];
    if (e) return e;
    const def = _defs[key];
    if (!def) return null;
    const frames = def.frames.map((_, i) => buildFrameCanvas(def, i));
    e = { def, frames, flipped: [], flash: [], flippedFlash: [] };
    _cache[key] = e;
    return e;
  }

  function flipCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.save(); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); g.restore();
    return c;
  }
  function flashCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // -------------------------------------------------------------------
  function add(key, def) {
    _defs[key] = def;
    delete _cache[key];
    const prefix = key + '\u0000';
    for (const ck in _portraitCache) if (ck.indexOf(prefix) === 0) delete _portraitCache[ck];
  }
  function has(key) { return !!_defs[key]; }
  function def(key) { return _defs[key] || null; }
  function get(key) {
    const e = entry(key);
    return e ? e.frames : null;
  }
  function size(key) {
    const d = _defs[key];
    if (!d) return null;
    const rows = d.frames[0];
    return { w: rows[0].length, h: rows.length };
  }

  // anchor-aware draw: (x,y) is where the sprite's `anchor` pixel lands.
  function draw(g, key, x, y, opts) {
    const e = entry(key);
    if (!e) return false;
    opts = opts || {};
    const nFrames = e.frames.length;
    const frameIdx = (((opts.frame | 0) % nFrames) + nFrames) % nFrames;
    const flip = !!opts.flip;
    const scale = opts.scale || 1;
    let base = e.frames[frameIdx];
    if (flip) {
      e.flipped[frameIdx] = e.flipped[frameIdx] || flipCanvas(base);
      base = e.flipped[frameIdx];
    }
    const anchor = e.def.anchor || [base.width / 2, base.height];
    const ax = flip ? (base.width - anchor[0]) : anchor[0];
    const ay = anchor[1];
    const dw = base.width * scale, dh = base.height * scale;
    const dx = x - ax * scale, dy = y - ay * scale;
    g.save();
    g.imageSmoothingEnabled = false;
    if (opts.alpha != null) g.globalAlpha = opts.alpha;
    g.drawImage(base, dx, dy, dw, dh);
    const flashAmt = opts.flash === true ? 1 : Math.max(0, Math.min(1, opts.flash || 0));
    if (flashAmt > 0) {
      const flashArr = flip ? e.flippedFlash : e.flash;
      flashArr[frameIdx] = flashArr[frameIdx] || flashCanvas(base);
      g.globalAlpha = (opts.alpha != null ? opts.alpha : 1) * flashAmt;
      g.drawImage(flashArr[frameIdx], dx, dy, dw, dh);
    }
    g.restore();
    return true;
  }

  // world-space position of a point given in the sprite's own frame-grid
  // coordinates (e.g. `tip`), after the same anchor/flip math as draw().
  function localToWorld(key, frame, flip, x, y, lx, ly) {
    const e = entry(key);
    if (!e) return null;
    const nFrames = e.frames.length;
    const frameIdx = (((frame | 0) % nFrames) + nFrames) % nFrames;
    const base = e.frames[frameIdx];
    const anchor = e.def.anchor || [base.width / 2, base.height];
    const ax = flip ? (base.width - anchor[0]) : anchor[0];
    const ay = anchor[1];
    const wx = flip ? (base.width - lx) : lx;
    return { x: x + (wx - ax), y: y + (ly - ay) };
  }

  function circle(g, cx, cy, r, col) {
    g.fillStyle = col;
    g.beginPath(); g.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2); g.fill();
  }
  function glowDot(g, cx, cy, r, col, pulse) {
    for (let i = 2; i >= 1; i--) { g.globalAlpha = 0.15 * i * pulse; circle(g, cx, cy, r * (1 + i * 0.4), col); }
    g.globalAlpha = Math.min(1, 0.85 * pulse);
    circle(g, cx, cy, Math.max(1, r * 0.55), col);
    g.globalAlpha = 1;
  }
  // additive, gently pulsing halos from def.glow: [[x,y,r,'#hex'], ...]
  // when a sprite has several close-together spots (e.g. rune glyphs down a
  // hound's spine), damp each one so the additive overlap doesn't wash out
  // into one flat blob — a single spot (wand orb, eyes) stays at full bloom.
  function glow(g, key, x, y, frame, t, flip) {
    const e = entry(key);
    if (!e || !e.def.glow || !e.def.glow.length) return;
    const pulse = 0.82 + 0.18 * Math.sin((t || 0) * 6);
    const damp = e.def.glow.length > 1 ? 1 / Math.sqrt(e.def.glow.length) : 1;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const spot of e.def.glow) {
      const p = localToWorld(key, frame, flip, x, y, spot[0], spot[1]);
      if (p) glowDot(g, p.x, p.y, spot[2], spot[3], pulse * damp);
    }
    g.restore();
  }

  // 64x64 bust: crop def.face, integer-upscale to fill, centred on bgCol + vignette.
  function portrait(key, bgCol) {
    bgCol = bgCol || '#44465a';
    const cacheKey = key + '\u0000' + bgCol;
    let c = _portraitCache[cacheKey];
    if (c) return c;
    const d = _defs[key];
    c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = bgCol; g.fillRect(0, 0, 64, 64);
    if (d && d.face) {
      const frame0 = get(key)[0];
      const [fx, fy, fw, fh] = d.face;
      const pad = 5;
      const scale = Math.max(1, Math.floor(Math.min((64 - pad * 2) / fw, (64 - pad * 2) / fh)));
      const dw = fw * scale, dh = fh * scale;
      const dx = Math.round((64 - dw) / 2), dy = Math.round((64 - dh) / 2) + 3;
      g.drawImage(frame0, fx, fy, fw, fh, dx, dy, dw, dh);
    }
    g.save(); g.globalAlpha = 0.22;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#000000');
    g.fillStyle = grad; g.fillRect(0, 48, 64, 16);
    g.restore();
    _portraitCache[cacheKey] = c;
    return c;
  }

  return { add, has, get, def, size, draw, glow, portrait, localToWorld };
})();
