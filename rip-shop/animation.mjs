import { ASSETS } from './assets.mjs';

/** @param {number} milliseconds @param {boolean} fast @returns {number} */
function duration(milliseconds, fast) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 1;
  return fast ? milliseconds * 0.4 : milliseconds;
}

/** @param {Element} target @param {Keyframe[]} frames @param {KeyframeAnimationOptions} options @returns {Promise<void>} */
async function motion(target, frames, options) {
  const animation = target.animate(frames, { fill: 'both', ...options });
  try { await animation.finished; }
  catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
  }
}

/**
 * Keep the card stack behind the wrapper until it clears the torn foil edge.
 * @param {HTMLElement} stage @param {number} count @param {boolean} fast
 * @returns {Promise<void>}
 */
export async function animateTear(stage, count, fast = false) {
  const pack = stage.querySelector('#sealedPack');
  if (!(pack instanceof HTMLElement)) return;
  const bounds = pack.getBoundingClientRect(), area = stage.getBoundingClientRect();
  const left = bounds.left - area.left, top = bounds.top - area.top;
  const layer = document.createElement('div');
  layer.className = 'rip-animation';
  layer.setAttribute('aria-hidden', 'true');
  const halves = [];
  for (const half of ['strip', 'body']) {
    const clone = /** @type {HTMLElement} */ (pack.cloneNode(true));
    clone.removeAttribute('id');
    clone.querySelector('#packSeal')?.remove();
    clone.className = `rip-half rip-${half}`;
    Object.assign(clone.style, { left: `${left}px`, top: `${top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    layer.append(clone);
    halves.push(clone);
  }
  const mouth = document.createElement('div');
  mouth.className = 'rip-mouth';
  Object.assign(mouth.style, { left: `${left + bounds.width * 0.03}px`, top: `${top + bounds.height * 0.185}px`, width: `${bounds.width * 0.94}px`, height: `${bounds.height * 0.065}px` });
  layer.append(mouth);
  pack.style.visibility = 'hidden';
  stage.append(layer);
  const time = duration(1500, fast);
  const stripMotion = motion(halves[0], [
    { transform: 'translate(0,0) rotate(0) skewX(0)', opacity: 1, offset: 0 },
    { transform: 'translate(3px,-2px) rotate(-3deg) skewX(5deg)', opacity: 1, offset: 0.12 },
    { transform: 'translate(8px,-8px) rotate(-13deg) skewX(10deg)', opacity: 1, offset: 0.3 },
    { transform: 'translate(110px,-85px) rotate(-42deg) skewX(0)', opacity: 1, offset: 0.55 },
    { transform: 'translate(190px,-180px) rotate(-100deg)', opacity: 0, offset: 1 },
  ], { duration: time, easing: 'cubic-bezier(.35,0,.35,1)' });
  const bodyMotion = motion(halves[1], [
    { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0 },
    { transform: 'scale(1.05,.97) rotate(2deg)', opacity: 1, offset: 0.3 },
    { transform: 'scale(1) rotate(-1deg)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.62 },
    { transform: `translateY(${bounds.height * 0.55}px) scale(.92,.83) rotate(-8deg)`, opacity: 1, offset: 0.84 },
    { transform: `translateY(${bounds.height}px) scale(.75,.6) rotate(-18deg)`, opacity: 0, offset: 1 },
  ], { duration: time, easing: 'ease-in' });
  const mouthMotion = motion(mouth, [
    { transform: 'scaleY(0)', opacity: 0, offset: 0 },
    { transform: 'scaleY(.15)', opacity: 0, offset: 0.2 },
    { transform: 'scaleY(1)', opacity: 1, offset: 0.45 },
    { transform: 'scaleY(1)', opacity: 1, offset: 0.62 },
    { transform: 'translateY(45px) scaleY(.5)', opacity: 0, offset: 0.84 },
    { opacity: 0, offset: 1 },
  ], { duration: time, easing: 'ease-in-out' });
  const flying = [];
  const cardWidth = Math.min(140, (area.width - 56) / count - 10);
  const stackTop = top + bounds.height * 0.2;
  const restingY = (area.height - cardWidth * 1.25) / 2 - stackTop;
  for (let index = 0; index < count; index++) {
    const card = document.createElement('div');
    card.className = 'flying-card';
    if (ASSETS.cardBack) {
      card.classList.add('has-art');
      card.style.backgroundImage = `url("${ASSETS.cardBack}")`;
    }
    Object.assign(card.style, { width: `${cardWidth}px`, height: `${cardWidth * 1.25}px`, left: `${left + bounds.width / 2 - cardWidth / 2}px`, top: `${stackTop}px` });
    layer.append(card);
    const spread = (index - (count - 1) / 2) * (cardWidth + 10);
    flying.push(motion(card, [
      { transform: `translate(0,${bounds.height * 0.2}px) rotate(${index * 1.5}deg) scale(.88)`, opacity: 1, offset: 0 },
      { transform: 'translate(0,0) scale(.9)', opacity: 1, offset: 0.18 },
      { transform: `translate(0,${-bounds.height * 0.23}px) rotate(${index * 1.5}deg) scale(.96)`, opacity: 1, offset: 0.42 },
      { transform: `translate(${spread}px,${restingY}px) rotate(${(index - (count - 1) / 2) * 6}deg) scale(1)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${spread}px,${restingY}px) rotate(0) scale(1)`, opacity: 1, offset: 1 },
    ], { duration: time * 0.8, delay: time * 0.2 + index * duration(18, fast), easing: 'cubic-bezier(.2,.8,.2,1)' }));
  }
  stage.classList.add('rip-flash');
  try { await Promise.all([stripMotion, bodyMotion, mouthMotion, ...flying]); }
  finally { layer.remove(); pack.style.visibility = ''; stage.classList.remove('rip-flash'); }
}

/** @param {HTMLElement} stage @param {number} index @param {boolean} finalCard @param {boolean} fast @returns {Promise<void>} */
export async function anticipateReveal(stage, index, finalCard, fast = false) {
  const card = stage.querySelector('.reveal-row')?.children[index];
  if (!card) return;
  stage.classList.toggle('final-card-charge', finalCard);
  const cue = document.createElement('div');
  cue.className = 'opening-cue';
  cue.textContent = finalCard ? 'ONE LAST CARD…' : 'HERE WE GO…';
  stage.append(cue);
  try {
    await motion(card, [
      { transform: 'perspective(900px) rotateY(0) translateY(0)', filter: 'brightness(1)', offset: 0 },
      { transform: 'perspective(900px) rotateY(-8deg) translateY(-10px) scale(1.04)', filter: 'brightness(1.6)', offset: 0.35 },
      { transform: 'perspective(900px) rotateY(90deg) translateY(-4px)', filter: 'brightness(1.2)', offset: 1 },
    ], { duration: duration(finalCard ? 720 : 230, fast), easing: 'cubic-bezier(.4,0,.7,1)' });
  } finally { cue.remove(); stage.classList.remove('final-card-charge'); }
}

/** @param {HTMLElement} stage @param {number} index @param {{rarity:string,finish:string,fast:boolean}} pull @returns {Promise<void>} */
export async function revealImpact(stage, index, pull) {
  const slot = stage.querySelector('.reveal-row')?.children[index];
  const card = slot?.querySelector('.card-chip');
  if (!card) return;
  const jackpot = pull.rarity === 'mythic' || pull.finish === 'prismatic';
  const special = jackpot || pull.rarity === 'rare' || pull.finish === 'foil';
  const color = pull.finish === 'prismatic' ? '#ffb5f5' : pull.rarity === 'mythic' ? '#ffcd69' : pull.finish === 'foil' ? '#78ffe0' : '#82b9ff';
  stage.style.setProperty('--hit-color', color);
  stage.classList.add(special ? 'special-pull' : 'ordinary-pull');
  const burst = document.createElement('div');
  burst.className = 'pull-burst'; burst.setAttribute('aria-hidden', 'true');
  const motions = [];
  if (special) {
    stage.append(burst);
    const bounds = card.getBoundingClientRect(), parent = stage.getBoundingClientRect();
    const centerX = bounds.left - parent.left + bounds.width / 2;
    const centerY = bounds.top - parent.top + bounds.height * 0.4;
    const count = jackpot ? 28 : 14;
    for (let particle = 0; particle < count; particle++) {
      const spark = document.createElement('i');
      spark.className = 'pull-spark';
      spark.style.left = `${centerX}px`; spark.style.top = `${centerY}px`;
      spark.style.background = pull.finish === 'prismatic' ? `hsl(${particle * 360 / count} 90% 72%)` : color;
      burst.append(spark);
      const angle = particle / count * Math.PI * 2, distance = (jackpot ? 110 : 70) + Math.random() * 50;
      motions.push(motion(spark, [
        { transform: 'translate(0,0) scale(0)', opacity: 1, offset: 0 },
        { transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance}px) rotate(120deg) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${Math.cos(angle) * distance * 1.4}px,${Math.sin(angle) * distance * 1.4 + 35}px) rotate(240deg) scale(.2)`, opacity: 0, offset: 1 },
      ], { duration: duration(jackpot ? 1100 : 680, pull.fast), easing: 'ease-out' }));
    }
    const headline = document.createElement('div');
    headline.className = 'pull-headline';
    headline.textContent = pull.finish === 'prismatic' ? 'PRISMATIC!' : pull.rarity === 'mythic' ? 'MYTHIC!' : pull.finish === 'foil' ? 'FOIL HIT!' : 'RARE FIND!';
    burst.append(headline);
    motions.push(motion(headline, [
      { transform: 'translateY(20px) scale(.65) rotate(-6deg)', opacity: 0, offset: 0 },
      { transform: 'translateY(0) scale(1.1) rotate(-3deg)', opacity: 1, offset: 0.2 },
      { transform: 'translateY(0) scale(1) rotate(-3deg)', opacity: 1, offset: 0.8 },
      { transform: 'translateY(-15px) scale(1)', opacity: 0, offset: 1 },
    ], { duration: duration(jackpot ? 1150 : 750, pull.fast), easing: 'ease-out' }));
  }
  motions.push(motion(card, [
    { transform: 'perspective(900px) rotateY(-90deg) scale(.94)', opacity: 1, offset: 0 },
    { transform: `perspective(900px) rotateY(0) scale(${jackpot ? 1.12 : 1.055}) translateY(-8px)`, opacity: 1, offset: 0.45 },
    { transform: 'perspective(900px) rotateY(0) scale(1) translateY(0)', opacity: 1, offset: 1 },
  ], { duration: duration(special ? 550 : 280, pull.fast), easing: 'cubic-bezier(.15,.8,.25,1)' }));
  try { await Promise.all(motions); }
  finally { burst.remove(); stage.classList.remove('special-pull', 'ordinary-pull'); }
}
