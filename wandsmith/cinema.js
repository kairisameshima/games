'use strict';
/* =====================================================================
   WANDSMITH — cinema.js
   Cutscene engine + scene scripts. Owns its own DOM overlay on #stage.
   Draws through the Art contract (art.js) for characters/background, plus
   small custom prop/particle drawing for scene furniture (door, crates,
   cart, hammer, money bag, sign) that isn't part of the Art contract.
   ===================================================================== */
const Cinema = (function () {
  // ---- overlay canvas resolution: sized from Art.W (16:9), CSS-scaled to fill the 1280x720 #stage ----
  let MW = 0, MH = 0;

  // ---- module state ----
  let playing = false;
  let sceneId = 0;
  let resolveFn = null;
  let advanceResolver = null;
  let rafId = null;
  let tNow = 0, lastTs = null;
  let world = null;

  // DOM refs (all (re)created per play(), destroyed on end)
  let styleEl, root, canvas, mctx, artBuf, actx;
  let titleRoot, titleMain, titleSub;
  let dlgRoot, nameEl, textEl, portraitCanvas, pctx, skipBtn;

  const CSS = `
.cinema-root{position:absolute;left:0;top:0;width:1280px;height:720px;z-index:5000;overflow:hidden;font-family:'Jersey 10',monospace;user-select:none;cursor:pointer;}
.cinema-canvas{position:absolute;left:0;top:0;width:1280px;height:720px;image-rendering:pixelated;image-rendering:crisp-edges;background:#000;}
.cinema-title{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;opacity:0;text-align:center;}
.cinema-title-main{font-size:104px;color:#ffe066;text-shadow:5px 5px 0 #2a1a0a,-2px -2px 0 #2a1a0a;letter-spacing:6px;}
.cinema-title-sub{font-size:30px;color:#fff;margin-top:10px;text-shadow:2px 2px 0 #2a1a0a;}
.cinema-title.cinema-caption{justify-content:flex-start;padding-top:64px;}
.cinema-title.cinema-caption .cinema-title-sub{font-size:28px;margin-top:0;}
.cinema-dialogue{position:absolute;left:40px;right:40px;bottom:30px;display:none;align-items:flex-start;gap:16px;background:rgba(10,10,20,0.88);border:3px solid #ffe066;border-radius:10px;padding:16px 20px;box-shadow:0 6px 0 rgba(0,0,0,0.4);}
.cinema-portrait{width:112px;height:112px;image-rendering:pixelated;image-rendering:crisp-edges;border:2px solid #ffe066;border-radius:6px;flex-shrink:0;background:#111;}
.cinema-dtext{flex:1;padding-top:4px;}
.cinema-name{font-size:26px;color:#ffe066;margin-bottom:4px;}
.cinema-line{font-size:28px;color:#fff;line-height:1.25;min-height:70px;white-space:pre-wrap;}
.cinema-skip{position:absolute;right:24px;top:20px;font-family:'Jersey 10',monospace;font-size:22px;background:rgba(10,10,20,0.75);color:#fff;border:2px solid #ffe066;border-radius:20px;padding:6px 18px;cursor:pointer;}
.cinema-skip:hover{background:rgba(255,224,102,0.25);}
@media(max-width:899.98px){
  .cinema-root{position:fixed;inset:0;width:100%;height:100vh;height:100dvh;background:#000}
  .cinema-canvas{width:100%;height:100%;object-fit:contain}
  .cinema-title{padding:16px}
  .cinema-title-main{font-size:clamp(36px,10vw,72px);letter-spacing:2px;overflow-wrap:anywhere}
  .cinema-title-sub{font-size:20px}
  .cinema-title.cinema-caption{padding-top:calc(72px + env(safe-area-inset-top))}
  .cinema-title.cinema-caption .cinema-title-sub{font-size:20px}
  .cinema-dialogue{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));padding:12px;gap:10px;max-height:55dvh;overflow:auto}
  .cinema-portrait{width:56px;height:56px}
  .cinema-dtext{min-width:0;padding-top:0}
  .cinema-name{font-size:20px}
  .cinema-line{font-size:20px;min-height:0}
  .cinema-skip{top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));min-width:44px;min-height:44px;font-size:18px}
}
@media(max-width:899.98px) and (max-height:450px){
  .cinema-portrait{width:44px;height:44px}
  .cinema-line{font-size:18px}
}
`;

  // ---- tiny colour helpers for shaded custom props (match Art's flat outline style) ----
  const INK = '#1c140f';
  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function mix(a, b, t) { const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b); return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t); }
  function lighten(h, amt) { return mix(h, '#ffffff', amt); }
  function darken(h, amt) { return mix(h, '#000000', amt); }

  // =====================================================================
  // DOM lifecycle
  // =====================================================================
  function onSkipClick(e) { e.stopPropagation(); endScene(); }
  function onRootClick() { triggerAdvance(); }
  function onKey(e) {
    if (!playing) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); triggerAdvance(); }
  }
  function triggerAdvance() { if (advanceResolver) advanceResolver(); }

  function buildDom() {
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    root = document.createElement('div');
    root.className = 'cinema-root';
    root.innerHTML =
      '<canvas class="cinema-canvas"></canvas>' +
      '<div class="cinema-title"><div class="cinema-title-main"></div><div class="cinema-title-sub"></div></div>' +
      '<div class="cinema-dialogue"><canvas class="cinema-portrait"></canvas>' +
      '<div class="cinema-dtext"><div class="cinema-name"></div><div class="cinema-line"></div></div></div>' +
      '<button class="cinema-skip">Skip &#9654;</button>';

    canvas = root.querySelector('.cinema-canvas');
    MW = Art.W; MH = Math.round(Art.W * 9 / 16);
    canvas.width = MW; canvas.height = MH;
    mctx = canvas.getContext('2d'); mctx.imageSmoothingEnabled = false;

    artBuf = document.createElement('canvas');
    artBuf.width = Art.W; artBuf.height = Art.H;
    actx = artBuf.getContext('2d'); actx.imageSmoothingEnabled = false;

    titleRoot = root.querySelector('.cinema-title');
    titleMain = root.querySelector('.cinema-title-main');
    titleSub = root.querySelector('.cinema-title-sub');

    dlgRoot = root.querySelector('.cinema-dialogue');
    nameEl = root.querySelector('.cinema-name');
    textEl = root.querySelector('.cinema-line');
    portraitCanvas = root.querySelector('.cinema-portrait');
    pctx = portraitCanvas.getContext('2d'); pctx.imageSmoothingEnabled = false;

    skipBtn = root.querySelector('.cinema-skip');
    skipBtn.addEventListener('click', onSkipClick);
    root.addEventListener('click', onRootClick);
    document.addEventListener('keydown', onKey);

    const stage = matchMedia('(max-width:899.98px)').matches ? document.body : document.getElementById('stage') || document.body;
    stage.appendChild(root);

    world = {
      loc: 'shop',
      camera: { cx: Art.W / 2, cy: Art.H / 2, zoom: 1 },
      actors: [], particles: [],
      fadeAlpha: 1, flashAlpha: 0, flashDecay: 0,
      shakeMag: 0, shakeStart: 0, shakeDur: 0,
    };
    tNow = 0; lastTs = null;
    rafId = requestAnimationFrame(renderFrame);
  }

  function teardownDom() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    if (skipBtn) skipBtn.removeEventListener('click', onSkipClick);
    if (root) root.removeEventListener('click', onRootClick);
    document.removeEventListener('keydown', onKey);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = root = canvas = mctx = artBuf = actx = null;
    titleRoot = titleMain = titleSub = null;
    dlgRoot = nameEl = textEl = portraitCanvas = pctx = skipBtn = null;
    advanceResolver = null;
    world = null;
  }

  function endScene() {
    if (!playing) return;
    playing = false; api.playing = false;
    sceneId++;
    teardownDom();
    const r = resolveFn; resolveFn = null;
    if (r) r();
  }

  // =====================================================================
  // render loop
  // =====================================================================
  function renderFrame(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    tNow += dt;

    for (const p of world.particles) {
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot = (p.rot || 0) + (p.vr || 0) * dt;
      p.life -= dt;
    }
    world.particles = world.particles.filter(p => p.life > 0);

    if (world.flashAlpha > 0) world.flashAlpha = Math.max(0, world.flashAlpha - world.flashDecay * dt);

    mctx.fillStyle = '#000'; mctx.fillRect(0, 0, MW, MH);
    actx.clearRect(0, 0, Art.W, Art.H);

    Art.drawBackground(actx, world.loc, tNow);
    for (const a of world.actors) {
      if (a.kind === 'player') Art.drawPlayer(actx, a.x, a.y, tNow, a.state);
      else if (a.kind === 'enemy') Art.drawEnemy(actx, a.key, a.x, a.y, tNow, a.state);
      else if (a.kind === 'prop' && typeof a.draw === 'function') a.draw(actx, a.x, a.y, tNow);
    }
    for (const p of world.particles) {
      actx.save();
      actx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife || 1)));
      actx.translate(p.x, p.y); actx.rotate(p.rot || 0);
      if (p.art === 'shard' && Pix.has('frame:twig')) {
        const fragment = propCache.shard || (propCache.shard = (() => {
          const c = document.createElement('canvas'); c.width = 3; c.height = 7;
          const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
          ctx.translate(3, 0); ctx.rotate(Math.PI / 2);
          ctx.drawImage(Pix.get('frame:twig')[0], 18, 6, 7, 3, 0, 0, 7, 3);
          return c;
        })());
        actx.drawImage(fragment, -p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.art === 'spark' && Pix.has('impact:spark')) {
        const spark = Pix.get('impact:spark')[0];
        actx.drawImage(spark, -p.w, -p.h, p.w * 2, p.h * 2);
      } else {
        actx.fillStyle = p.col;
        actx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      actx.restore();
    }
    if (world.flashAlpha > 0) {
      actx.fillStyle = 'rgba(255,255,255,' + world.flashAlpha + ')';
      actx.fillRect(0, 0, Art.W, Art.H);
    }

    let jx = 0, jy = 0;
    if (world.shakeDur > 0) {
      const el = tNow - world.shakeStart;
      if (el < world.shakeDur) {
        const m = world.shakeMag * (1 - el / world.shakeDur);
        jx = (Math.random() * 2 - 1) * m; jy = (Math.random() * 2 - 1) * m * 0.6;
      } else { world.shakeDur = 0; }
    }

    const vw = Art.W / world.camera.zoom, vh = Art.H / world.camera.zoom;
    let sx = world.camera.cx - vw / 2, sy = world.camera.cy - vh / 2;
    sx = Math.max(0, Math.min(Art.W - vw, sx));
    sy = Math.max(0, Math.min(Art.H - vh, sy));
    const destX = jx, destY = (MH - Art.H) / 2 + jy;
    mctx.drawImage(artBuf, sx, sy, vw, vh, destX, destY, Art.W, Art.H);

    if (world.fadeAlpha > 0) {
      mctx.fillStyle = 'rgba(0,0,0,' + world.fadeAlpha + ')';
      mctx.fillRect(0, 0, MW, MH);
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  // =====================================================================
  // async timing helpers (skip-aware: a skip bumps sceneId, orphaning these)
  // =====================================================================
  function tween(dur, onUpdate) {
    const myId = sceneId;
    return new Promise(resolve => {
      if (dur <= 0) { onUpdate(1); resolve(); return; }
      const start = tNow;
      (function step() {
        if (sceneId !== myId) return;
        const p = Math.min(1, (tNow - start) / dur);
        onUpdate(p);
        if (p >= 1) { resolve(); return; }
        requestAnimationFrame(step);
      })();
    });
  }
  function wait(sec) { return tween(sec, () => {}); }
  function easeOut(p) { return 1 - (1 - p) * (1 - p); }
  function moveTo(actor, x, y, dur) {
    const x0 = actor.x, y0 = actor.y;
    return tween(dur, p => { const e = easeOut(p); actor.x = x0 + (x - x0) * e; actor.y = y0 + (y - y0) * e; });
  }
  function fadeTo(alpha, dur) { const a0 = world.fadeAlpha; return tween(dur, p => { world.fadeAlpha = a0 + (alpha - a0) * p; }); }
  function panTo(cx, cy, zoom, dur) {
    const c0 = { cx: world.camera.cx, cy: world.camera.cy, zoom: world.camera.zoom };
    return tween(dur, p => {
      world.camera.cx = c0.cx + (cx - c0.cx) * p;
      world.camera.cy = c0.cy + (cy - c0.cy) * p;
      world.camera.zoom = c0.zoom + (zoom - c0.zoom) * p;
    });
  }
  function shakeCam(mag, dur) { world.shakeMag = mag; world.shakeStart = tNow; world.shakeDur = dur; return wait(dur); }
  function flashPulse(peak, dur) { world.flashAlpha = peak; world.flashDecay = peak / dur; return wait(dur); }

  function addActor(a) { world.actors.push(a); return a; }
  function removeActor(a) { const i = world.actors.indexOf(a); if (i >= 0) world.actors.splice(i, 1); }
  function setState(actor, s) { actor.state = s; }
  function setLoc(loc) { world.loc = loc; }

  function spawnShards(x, y, count, cols, K) {
    K = K || 1;
    for (let i = 0; i < count; i++) {
      world.particles.push({
        x, y,
        vx: (Math.random() * 2 - 1) * 70 * K,
        vy: (-60 - Math.random() * 50) * K,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() * 2 - 1) * 10,
        w: (2 + Math.random() * 2) * K, h: (5 + Math.random() * 5) * K,
        col: cols[(Math.random() * cols.length) | 0], art: 'shard',
        life: 1.0 + Math.random() * 0.6, maxLife: 1.6, grav: 220 * K,
      });
    }
  }
  function spawnSparkle(x, y, col, K) {
    K = K || 1;
    for (let i = 0; i < 4; i++) {
      world.particles.push({
        x: x + (Math.random() * 6 - 3) * K, y: y + (Math.random() * 4 - 2) * K,
        vx: (Math.random() * 2 - 1) * 20 * K, vy: (-20 - Math.random() * 20) * K,
        rot: 0, vr: 0, w: 1.5 * K, h: 1.5 * K, col: col || '#ffe066', art: 'spark',
        life: 0.3 + Math.random() * 0.2, maxLife: 0.5, grav: 60 * K,
      });
    }
  }

  // ---- dialogue (typewriter) ----
  function say(name, portraitKey, text) {
    const myId = sceneId;
    return new Promise(resolve => {
      dlgRoot.style.display = 'flex';
      nameEl.textContent = name;
      const portraitSrc = Art.portrait(portraitKey);
      if (portraitCanvas.width !== portraitSrc.width || portraitCanvas.height !== portraitSrc.height) {
        portraitCanvas.width = portraitSrc.width; portraitCanvas.height = portraitSrc.height;
      }
      pctx.clearRect(0, 0, portraitCanvas.width, portraitCanvas.height);
      pctx.drawImage(portraitSrc, 0, 0);
      textEl.textContent = '';
      let shown = 0, doneTyping = text.length === 0, acc = 0, lastT = tNow;
      const cps = 30;
      (function tick() {
        if (sceneId !== myId) return;
        const dt = tNow - lastT; lastT = tNow;
        if (!doneTyping) {
          acc += dt * cps;
          const n = Math.min(text.length, Math.floor(acc));
          if (n > shown) {
            shown = n;
            textEl.textContent = text.slice(0, shown);
            if (shown % 3 === 0) api.sfx('talk');
          }
          if (shown >= text.length) doneTyping = true;
        }
        requestAnimationFrame(tick);
      })();
      advanceResolver = () => {
        if (!doneTyping) {
          shown = text.length; textEl.textContent = text; doneTyping = true;
        } else {
          advanceResolver = null;
          dlgRoot.style.display = 'none';
          resolve();
        }
      };
    });
  }

  // ---- title / caption cards ----
  function showTitle(main, sub, caption) {
    titleRoot.className = 'cinema-title' + (caption ? ' cinema-caption' : '');
    titleMain.textContent = main || '';
    titleMain.style.display = main ? '' : 'none';
    titleSub.textContent = sub || '';
  }
  async function caption(text, dur, fade) {
    fade = fade == null ? 0.3 : fade;
    showTitle('', text, true);
    await tween(fade, p => { titleRoot.style.opacity = String(p); });
    await wait(dur);
    await tween(fade, p => { titleRoot.style.opacity = String(1 - p); });
  }
  async function titleCard(main, sub, dur, fade) {
    fade = fade == null ? 0.6 : fade;
    showTitle(main, sub, false);
    titleRoot.style.opacity = '0';
    await tween(fade, p => { titleRoot.style.opacity = String(p); });
    await wait(dur);
    await tween(fade, p => { titleRoot.style.opacity = String(1 - p); });
  }

  // =====================================================================
  // custom scene props (not part of the Art contract)
  // =====================================================================
  const propCache = Object.create(null);
  function drawDoor(g, x, bottom, openness, K) {
    if (Pix.has('prop:door')) {
      const image = Pix.get('prop:door')[0], scale = K / 1.5;
      const w = image.width * scale, h = image.height * scale, edge = 2;
      const left = Math.round(x - w / 2), top = Math.round(bottom - h);
      const panelWidth = Math.max(1, Math.round((w - edge * scale * 2) * (1 - openness)));
      g.save(); g.imageSmoothingEnabled = false;
      // Preserve the generated door's transparent corners when it opens.
      const opening = propCache.doorOpening || (propCache.doorOpening = (() => {
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#251c30'; ctx.fillRect(0, 0, c.width, c.height);
        return c;
      })());
      g.drawImage(opening, left, top, w, h);
      g.drawImage(image, 0, 0, edge, image.height, left, top, edge * scale, h);
      g.drawImage(image, image.width - edge, 0, edge, image.height, left + w - edge * scale, top, edge * scale, h);
      g.drawImage(image, edge, 0, image.width - edge * 2, image.height, left + edge * scale, top, panelWidth, h);
      g.restore();
      return;
    }
    const w = 22 * K, h = 44 * K, top = bottom - h;
    const frame = '#2a1810', wood = '#6a4a2a';
    g.fillStyle = darken(frame, 0.25); g.fillRect(x - w / 2 - 2 * K, top - 2 * K, w + 4 * K, h + 2 * K);
    g.fillStyle = '#0a0a12'; g.fillRect(x - w / 2, top, w, h);
    const pw = Math.max(2 * K, w * (1 - openness));
    g.fillStyle = wood; g.fillRect(x - w / 2, top, pw, h);
    g.fillStyle = lighten(wood, 0.3); g.fillRect(x - w / 2, top, pw, 3 * K);
    g.fillStyle = darken(wood, 0.3); g.fillRect(x - w / 2, top + h - 3 * K, pw, 3 * K);
    g.strokeStyle = darken(wood, 0.45); g.lineWidth = 1;
    for (let i = 1; i < 3; i++) { const px = x - w / 2 + pw * i / 3; g.beginPath(); g.moveTo(px, top); g.lineTo(px, top + h); g.stroke(); }
    g.strokeStyle = INK; g.strokeRect(x - w / 2 + 0.5, top + 0.5, Math.max(1, pw - 1), h - 1);
    if (pw > 4 * K) {
      g.fillStyle = '#e0c060'; g.fillRect(x - w / 2 + pw - 4 * K, top + h / 2, 2 * K, 2 * K);
      g.fillStyle = darken('#e0c060', 0.35); g.fillRect(x - w / 2 + pw - 4 * K, top + h / 2 + 2 * K, 2 * K, Math.max(1, K * 0.5));
    }
  }
  function drawCrate(g, cx, cy, K) {
    if (Pix.has('prop:crate')) { Pix.draw(g, 'prop:crate', cx, cy, { scale: K / 1.5 }); return; }
    const w = 12 * K, h = 10 * K, base = '#8a5a32';
    g.fillStyle = base; g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = lighten(base, 0.3); g.fillRect(cx - w / 2, cy - h / 2, w, h * 0.25);
    g.fillStyle = darken(base, 0.35); g.fillRect(cx - w / 2, cy + h / 2 - h * 0.22, w, h * 0.22);
    g.strokeStyle = darken(base, 0.5); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - w / 2, cy - h / 2); g.lineTo(cx + w / 2, cy + h / 2); g.moveTo(cx + w / 2, cy - h / 2); g.lineTo(cx - w / 2, cy + h / 2); g.stroke();
    g.strokeStyle = INK; g.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
  }
  function drawCart(g, x, bottom, K) {
    if (Pix.has('prop:cart')) { Pix.draw(g, 'prop:cart', x, bottom, { scale: K / 1.5 }); return; }
    const w = 30 * K, h = 14 * K, top = bottom - h - 6 * K, base = '#6a4a2a';
    g.fillStyle = darken(base, 0.3); g.fillRect(x - w / 2 - 1 * K, top - 1 * K, w + 2 * K, h + 2 * K);
    g.fillStyle = base; g.fillRect(x - w / 2, top, w, h);
    g.fillStyle = lighten(base, 0.3); g.fillRect(x - w / 2, top, w, h * 0.3);
    g.strokeStyle = INK; g.strokeRect(x - w / 2 + 0.5, top + 0.5, w - 1, h - 1);
    [x - w / 2 + 5 * K, x + w / 2 - 5 * K].forEach(wx => {
      g.fillStyle = darken('#3a3a3a', 0.2); g.beginPath(); g.arc(wx, bottom - 4 * K, 4 * K, 0, Math.PI * 2); g.fill();
      g.fillStyle = lighten('#3a3a3a', 0.3); g.beginPath(); g.arc(wx - K * 0.8, bottom - 4 * K - K * 0.8, K * 1.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(wx, bottom - 4 * K, 4 * K, 0, Math.PI * 2); g.stroke();
    });
    for (let i = 0; i < 3; i++) drawCrate(g, x - w / 2 + 5 * K + i * 9 * K, top - 4 * K, K * 0.6);
  }
  function drawSign(g, x, y, text, col, K) {
    if (Pix.has('prop:sign')) {
      Pix.draw(g, 'prop:sign', x, y, { scale: K / 1.5 });
      g.save(); g.fillStyle = '#281b30'; g.font = Math.round(7 * K) + 'px monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y - 5 * K); g.restore();
      return;
    }
    const base = col || '#ffe066';
    g.fillStyle = darken('#5a3a1a', 0.2); g.fillRect(x - 1 * K, y - 10 * K, 2 * K, 10 * K);
    g.fillStyle = base; g.fillRect(x - 24 * K, y - 10 * K, 48 * K, 10 * K);
    g.fillStyle = lighten(base, 0.3); g.fillRect(x - 24 * K, y - 10 * K, 48 * K, 2 * K);
    g.fillStyle = darken(base, 0.3); g.fillRect(x - 24 * K, y - 2 * K, 48 * K, 2 * K);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x - 24 * K + 0.5, y - 10 * K + 0.5, 48 * K - 1, 10 * K - 1);
    g.fillStyle = INK; g.font = Math.round(7 * K) + 'px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x, y - 5 * K);
  }
  function drawHammer(g, x, y, angle, K) {
    if (Pix.has('prop:hammer')) {
      g.save(); g.translate(x, y); g.rotate(angle || 0);
      Pix.draw(g, 'prop:hammer', 0, 0, { scale: K / 1.5 }); g.restore(); return;
    }
    g.save(); g.translate(x, y); g.rotate(angle || 0);
    const wood = '#8a5a32', metal = '#8a96a8';
    g.fillStyle = darken(wood, 0.3); g.fillRect(-1 * K, -6 * K, 2 * K, 10 * K);
    g.fillStyle = wood; g.fillRect(-1 * K, -6 * K, 1 * K, 10 * K);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(-1 * K, -6 * K, 2 * K, 10 * K);
    g.fillStyle = darken(metal, 0.25); g.fillRect(-4 * K, -9 * K, 8 * K, 5 * K);
    g.fillStyle = lighten(metal, 0.3); g.fillRect(-4 * K, -9 * K, 8 * K, 1.5 * K);
    g.strokeStyle = INK; g.strokeRect(-4 * K, -9 * K, 8 * K, 5 * K);
    g.restore();
  }
  function drawMoneyBag(g, x, y, K) {
    if (Pix.has('prop:moneybag')) {
      Pix.draw(g, 'prop:moneybag', x, y, { scale: K / 1.5 });
      g.save(); g.fillStyle = '#ddaa57'; g.font = Math.round(6 * K) + 'px monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', x, y + K); g.restore(); return;
    }
    const base = '#c8a060';
    g.fillStyle = darken(base, 0.25); g.beginPath(); g.ellipse(x, y + 1 * K, 5 * K, 6 * K, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = base; g.beginPath(); g.ellipse(x, y, 5 * K, 6 * K, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = lighten(base, 0.3); g.beginPath(); g.ellipse(x - 1.5 * K, y - 2 * K, 2 * K, 2.5 * K, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, 5 * K, 6 * K, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = darken('#8a6a3a', 0.2); g.fillRect(x - 2 * K, y - 8 * K, 4 * K, 3 * K);
    g.strokeStyle = INK; g.strokeRect(x - 2 * K, y - 8 * K, 4 * K, 3 * K);
    g.fillStyle = '#ffd84a'; g.font = Math.round(6 * K) + 'px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('$', x, y + 1 * K);
  }

  // =====================================================================
  // boss flavour text (authored here; data.js only holds intro/defeat lines)
  // =====================================================================
  const OPENERS = {
    pip: 'Watch your pockets, everyone.',
    twins: 'Oh no. Both of them.',
    fin: 'Please tell me this is a final notice.',
    bruno: 'Nice outfit. Did a couch lose a fight?',
    lou: 'Audits. My favorite.',
    velvet: 'The scary quiet one. Great.',
    grimsby: 'Big guy. Bigger frown.',
    don: '...Don Grimoire. In the flesh.',
  };
  const REPLIES = {
    pip: "Hands off the merchandise, rat— er, Pip.",
    twins: 'Two goons, one wand. I like my odds.',
    fin: 'Funny. My patience has interest too.',
    bruno: "Flattened? Buddy, I'm already a pancake.",
    lou: "Your ledger's about to need an eraser.",
    velvet: 'Trinkets are nice. Spite works too.',
    grimsby: 'Tell the Don I said knock knock.',
    don: 'You smashed my shop. I rebuilt it into THIS.',
  };
  const CLOSERS = {
    pip: 'Keep the twig. I upgraded.',
    twins: 'Divide and conquer. Works on brothers too.',
    fin: 'Tell your boss: no refunds.',
    bruno: '...Still cuter than you.',
    lou: "Carry the one. You're done.",
    velvet: "Trinkets or not, I don't miss.",
    grimsby: 'Give the Don my regards. Actually— no, scratch that.',
    don: 'Shelves. Returned. With interest.',
  };

  function rungFor(key) { return RUNGS.find(r => r.boss === key); }
  function parseBossLine(key, raw, boss) {
    if (boss && boss.parts) {
      const m = /^([A-Za-z]+(?:\s*&\s*[A-Za-z]+)?):\s*(.*)$/.exec(raw);
      if (m) {
        const label = m[1].trim();
        const first = label.split(/\s*&\s*/)[0].trim().toLowerCase();
        return { name: label, portrait: boss.parts.includes(first) ? first : key, text: m[2] };
      }
    }
    return { name: boss ? boss.n : key, portrait: key, text: raw };
  }

  // =====================================================================
  // scenes
  // =====================================================================
  async function sceneIntro() {
    const K = Art.W / 224;
    const GROUND = Art.GROUND;
    const DOOR_X = Art.W - 30 * K;
    setLoc('shop');
    world.camera.cx = Art.W / 2; world.camera.cy = Art.H / 2; world.camera.zoom = 1;
    world.fadeAlpha = 1;

    const player = addActor({ kind: 'player', x: Art.W * 0.32, y: GROUND, state: 'idle' });
    let doorOpenAmt = 0;
    addActor({ kind: 'prop', x: DOOR_X, y: GROUND, draw: (g, x, y) => drawDoor(g, x, y, doorOpenAmt, K) });

    await fadeTo(0, 0.8);
    await caption('Mudwick. Closing time.', 1.6);
    await wait(0.5);

    api.sfx('sting');
    await shakeCam(0.6 * K, 0.15);
    await wait(0.5);

    api.sfx('door');
    await tween(0.4, p => { doorOpenAmt = p; });
    await shakeCam(1.2 * K, 0.25);

    const don = addActor({ kind: 'enemy', key: 'don', x: Art.W + 20 * K, y: GROUND, state: 'idle' });
    const g1 = addActor({ kind: 'enemy', key: 'mask', x: Art.W + 10 * K, y: GROUND, state: 'idle' });
    const g2 = addActor({ kind: 'enemy', key: 'rat', x: Art.W + 30 * K, y: GROUND, state: 'idle' });
    await Promise.all([
      moveTo(don, Art.W * 0.62, GROUND, 1.1),
      moveTo(g1, Art.W * 0.74, GROUND, 1.0),
      moveTo(g2, Art.W * 0.84, GROUND, 1.2),
    ]);
    tween(0.3, p => { doorOpenAmt = 1 - p * 0.3; });

    await say('Don Grimoire', 'don', 'Evening, wandsmith. Lovely shop.');
    await say('Don Grimoire', 'don', 'Shame about the... everything.');
    await say('Wandsmith', 'smith', "Mr. Grimoire! The payment's just— running a little late.");
    await say('Don Grimoire', 'don', "Late. That's the word I was looking for.");
    await say('Goon', 'goon', 'Boss says smash first, talk later.');
    await say('Don Grimoire', 'don', 'Boys. Redecorate.');

    setState(player, 'hurt');
    await panTo(Art.W * 0.5, Art.H * 0.45, 1.3, 0.4);
    api.sfx('smash');
    await shakeCam(2.5 * K, 0.5);
    spawnShards(Art.W * 0.3, GROUND - 30 * K, 10, ['#ffe066', '#b48cff', '#8fe3ff', '#ff7a3a', '#7dff9a'], K);
    addActor({ kind: 'prop', x: Art.W * 0.22, y: GROUND - 6 * K, draw: (g, x, y, t) => Art.drawWandItem(g, x, y, '#8fe3ff', true, t) });

    await wait(0.2);
    api.sfx('smash');
    await shakeCam(2.5 * K, 0.5);
    spawnShards(Art.W * 0.5, GROUND - 35 * K, 10, ['#f3c24a', '#ff5fd2', '#c8a8ff'], K);
    addActor({ kind: 'prop', x: Art.W * 0.46, y: GROUND - 6 * K, draw: (g, x, y, t) => Art.drawWandItem(g, x, y, '#ff5fd2', true, t) });

    await wait(0.2);
    api.sfx('boom');
    await flashPulse(0.5, 0.2);
    await shakeCam(3 * K, 0.6);
    spawnShards(Art.W * 0.6, GROUND - 28 * K, 14, ['#ffd84a', '#8a96a8', '#e05fff', '#5fb8ff'], K);
    addActor({ kind: 'prop', x: Art.W * 0.65, y: GROUND - 6 * K, draw: (g, x, y, t) => Art.drawWandItem(g, x, y, '#8a96a8', true, t) });
    await panTo(Art.W / 2, Art.H / 2, 1, 0.5);
    await wait(0.4);

    const crate1 = addActor({ kind: 'prop', x: g1.x, y: GROUND - 14 * K, draw: (g, x, y) => drawCrate(g, x, y, K) });
    const crate2 = addActor({ kind: 'prop', x: g2.x, y: GROUND - 14 * K, draw: (g, x, y) => drawCrate(g, x, y, K) });
    const cart = addActor({ kind: 'prop', x: DOOR_X + 6 * K, y: GROUND, draw: (g, x, y) => drawCart(g, x, y, K) });
    await say('Don Grimoire', 'don', "Pack it up, boys. It'll fetch a fine price.");
    await Promise.all([moveTo(g1, DOOR_X, GROUND, 0.9), moveTo(crate1, DOOR_X, GROUND - 14 * K, 0.9)]);
    removeActor(g1); removeActor(crate1);
    await Promise.all([moveTo(g2, DOOR_X, GROUND, 0.9), moveTo(crate2, DOOR_X, GROUND - 14 * K, 0.9)]);
    removeActor(g2); removeActor(crate2);
    await say('Don Grimoire', 'don', 'Pleasure doing business. See you around.');
    await moveTo(don, DOOR_X, GROUND, 0.8);
    removeActor(don); removeActor(cart);
    setState(player, 'sad');

    await fadeTo(1, 0.5);
    setLoc('shopRuined');
    player.x = Art.W * 0.4; player.y = GROUND; setState(player, 'sad');
    await fadeTo(0, 0.6);

    await wait(1.0);
    await say('Wandsmith', 'smithHurt', "...Okay. Ow. That could've gone better.");
    await say('Wandsmith', 'smithHurt', "They took the wands. They didn't take the parts.");

    setState(player, 'cobble');
    const hammer = addActor({ kind: 'prop', x: player.x - 14 * K, y: GROUND - 17 * K, draw: (g, x, y, t) => drawHammer(g, x, y, Math.sin(t * 6) * 0.6, K) });
    for (let i = 0; i < 3; i++) {
      await wait(0.5);
      spawnSparkle(player.x + 8 * K, GROUND - 14 * K, '#ffe066', K);
      api.sfx('step');
    }
    removeActor(hammer);
    await say('Wandsmith', 'smithHurt', 'A hammer, some string, and spite.');
    setState(player, 'win');
    await say('Wandsmith', 'smith', "That's all a wandsmith needs.");
    await say('Wandsmith', 'smith', "Let's go see Don Grimoire about my shelves.");

    await fadeTo(1, 0.6);
    await titleCard('WANDSMITH', 'Revenge on the Wizard Mafia', 2.6, 0.6);
    await fadeTo(1, 0.1);
  }

  async function sceneBossIntro(key) {
    const boss = BOSSES[key];
    if (!boss) return;
    const K = Art.W / 224;
    const GROUND = Art.GROUND;
    const rung = rungFor(key);
    setLoc(rung ? rung.loc : 'tower');
    world.camera.cx = Art.W / 2; world.camera.cy = Art.H / 2; world.camera.zoom = 1;
    world.fadeAlpha = 1;

    addActor({ kind: 'player', x: Art.W * 0.18, y: GROUND, state: 'idle' });
    const enemyKeys = boss.parts || [key];
    const n = enemyKeys.length, spread = n > 1 ? 46 * K : 0;
    const bossActors = enemyKeys.map((k, i) => addActor({ kind: 'enemy', key: k, x: Art.W + 30 * K + i * 20 * K, y: GROUND, state: 'idle' }));

    await fadeTo(0, 0.6);
    await say('Wandsmith', 'smith', OPENERS[key] || '...Here we go.');
    await Promise.all(bossActors.map((a, i) => moveTo(a, Art.W * 0.7 + (i - (n - 1) / 2) * spread, GROUND, 1.0)));
    await wait(0.2);
    await panTo(Art.W * 0.55, Art.H * 0.52, 1.15, 0.4);
    for (const raw of boss.intro) {
      const { name, portrait, text } = parseBossLine(key, raw, boss);
      await say(name, portrait, text);
    }
    await panTo(Art.W / 2, Art.H / 2, 1, 0.4);
    await say('Wandsmith', 'smith', REPLIES[key] || "Let's dance.");
    if (key === 'don') { api.sfx('boom'); await shakeCam(1.5 * K, 0.3); }
    await fadeTo(1, 0.5);
  }

  async function sceneBossDefeat(key) {
    const boss = BOSSES[key];
    if (!boss) return;
    const K = Art.W / 224;
    const GROUND = Art.GROUND;
    const rung = rungFor(key);
    setLoc(rung ? rung.loc : 'tower');
    world.camera.cx = Art.W / 2; world.camera.cy = Art.H / 2; world.camera.zoom = 1;
    world.fadeAlpha = 1;

    addActor({ kind: 'player', x: Art.W * 0.18, y: GROUND, state: 'win' });
    const enemyKeys = boss.parts || [key];
    const n = enemyKeys.length, spread = n > 1 ? 46 * K : 0;
    enemyKeys.forEach((k, i) => addActor({ kind: 'enemy', key: k, x: Art.W * 0.7 + (i - (n - 1) / 2) * spread, y: GROUND, state: 'dead' }));

    await fadeTo(0, 0.5);
    await wait(0.3);
    const { name, portrait, text } = parseBossLine(key, boss.defeat, boss);
    await say(name, portrait, text);
    await say('Wandsmith', 'smith', CLOSERS[key] || 'Next.');
    await wait(0.2);
    await fadeTo(1, 0.5);
  }

  async function sceneEnding() {
    const K = Art.W / 224;
    const GROUND = Art.GROUND;
    setLoc('shop');
    world.camera.cx = Art.W / 2; world.camera.cy = Art.H / 2; world.camera.zoom = 1;
    world.fadeAlpha = 1;

    const player = addActor({ kind: 'player', x: Art.W * 0.28, y: GROUND, state: 'idle' });
    addActor({ kind: 'prop', x: Art.W * 0.5, y: Art.H * 0.18, draw: (g, x, y) => drawSign(g, x, y, 'OPEN', '#9affd8', K) });
    const cols = ['#ffe066', '#7ad7ff', '#ff7a3a'];
    for (let i = 0; i < 3; i++) {
      const col = cols[i];
      addActor({ kind: 'prop', x: Art.W * 0.6 + i * 10 * K, y: GROUND - 7 * K, draw: (g, x, y, t) => Art.drawWandItem(g, x, y, col, false, t) });
    }

    await fadeTo(0, 0.8);
    await caption('Three weeks later.', 1.6);

    const cust1 = addActor({ kind: 'enemy', key: 'mask', x: Art.W + 20 * K, y: GROUND, state: 'idle' });
    await moveTo(cust1, Art.W * 0.6, GROUND, 1.0);
    await say('Customer', 'goon', 'One wand, please. Nothing cursed this time.');
    await say('Wandsmith', 'smith', 'Cursed is extra.');
    const bag = addActor({ kind: 'prop', x: cust1.x - 10 * K, y: GROUND - 6 * K, draw: (g, x, y) => drawMoneyBag(g, x, y, K) });
    api.sfx('coin');
    await wait(0.5);
    removeActor(bag); removeActor(cust1);

    const cust2 = addActor({ kind: 'enemy', key: 'rat', x: Art.W + 20 * K, y: GROUND, state: 'idle' });
    await moveTo(cust2, Art.W * 0.55, GROUND, 1.0);
    await say('Customer', 'goon', "Heard the old shop's back open.");
    await say('Wandsmith', 'smith', 'Mudwick has a wandsmith again.');
    setState(player, 'win');
    await say('Wandsmith', 'smith', 'Try smashing THIS one, Don.');
    await wait(0.6);
    await fadeTo(1, 0.8);
  }

  async function sceneGameover() {
    const K = Art.W / 224;
    const GROUND = Art.GROUND;
    setLoc('alley');
    world.camera.cx = Art.W / 2; world.camera.cy = Art.H / 2; world.camera.zoom = 1;
    world.fadeAlpha = 1;

    const player = addActor({ kind: 'player', x: Art.W * 0.4, y: GROUND, state: 'hurt' });
    addActor({ kind: 'enemy', key: 'mask', x: Art.W * 0.6, y: GROUND, state: 'idle' });
    addActor({ kind: 'enemy', key: 'golem', x: Art.W * 0.72, y: GROUND, state: 'idle' });

    await fadeTo(0, 0.7);
    await shakeCam(1.5 * K, 0.3);
    await wait(0.3);
    setState(player, 'sad');
    await say('Goon', 'goon', "Should've paid up, shopkeep.");
    await say('Goon', 'goon', 'Tell your next of kin we said hi.');
    await wait(0.5);
    await fadeTo(1, 0.7);
    await titleCard('', 'The debt remains...', 2.2, 0.6);
    await fadeTo(1, 0.1);
  }

  async function runScene(key) {
    if (key === 'intro') return sceneIntro();
    if (key === 'ending') return sceneEnding();
    if (key === 'gameover') return sceneGameover();
    if (key.indexOf('bossDefeat:') === 0) return sceneBossDefeat(key.slice(11));
    if (key.indexOf('boss:') === 0) return sceneBossIntro(key.slice(5));
    console.warn('[Cinema] unknown scene key', key);
  }

  // =====================================================================
  // public API
  // =====================================================================
  const api = {
    playing: false,
    sfx(_name) {},
    play(key) {
      if (playing) endScene();
      playing = true; api.playing = true;
      sceneId++;
      buildDom();
      return new Promise(resolve => {
        resolveFn = resolve;
        (async () => {
          try { await runScene(key); } catch (e) { console.error('[Cinema] scene error', e); }
          endScene();
        })();
      });
    },
  };
  return api;
})();
