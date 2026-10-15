// RIP SHOP — presentation layer.
// Pure rendering: reads state + ui, writes DOM strings/attributes. No engine mutation calls,
// no business-logic event listeners (the one permitted exception is the <img> onerror asset
// fallback). The parent (game.mjs) owns all delegated click/input/drag handling and calls these
// exports after mutating state via engine.mjs.

import { SETS, CARDS, FINISHES, RARITIES, UPGRADES, SET_BY_ID } from './data.mjs';
import {
  cardFromKey, slotCount, collectionProgress, incomeDetails,
  packPrice, packOdds, upgradePrice, spareCount,
} from './engine.mjs';
import { cardArt, packArt, boxArt } from './art.mjs';
import { ASSETS } from './assets.mjs';

const FINISH_IDS = ['standard', 'foil', 'prismatic'];

// ---------- small utils ----------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
let uidSeq = 0;
function uid(prefix) { uidSeq += 1; return `${prefix}${uidSeq}`; }

function safeCardFromKey(key) {
  return typeof key === 'string' ? cardFromKey(key) : null;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function formatMoney(number) {
  const v = Number(number) || 0;
  const abs = Math.abs(v);
  const decimals = abs < 1000 ? 2 : 0;
  const fixed = v.toFixed(decimals);
  let [whole, frac] = fixed.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  whole = whole.replace('-', '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac && frac !== '0'.repeat(frac.length)) return `${sign}$${grouped}.${frac}`;
  return `${sign}$${grouped}`;
}

const LOCK_ICON = '<svg viewBox="0 0 24 24" class="lock-icon-svg" aria-hidden="true"><path d="M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a1 1 0 0 1 1-1h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z" fill="currentColor"/></svg>';

function cardBackSvg() {
  const id = uid('backGrad');
  const ring = uid('backRing');
  return `<svg viewBox="0 0 192 240" class="card-art-svg" role="img" aria-label="Face-down card">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1d2a52"/><stop offset="100%" stop-color="#0b1021"/>
    </linearGradient></defs>
    <rect width="192" height="240" fill="url(#${id})"/>
    <rect x="10" y="10" width="172" height="220" rx="10" fill="none" stroke="#f4c05e" stroke-width="2" opacity=".55"/>
    <circle cx="96" cy="120" r="46" fill="none" stroke="#6fe3b4" stroke-width="2" opacity=".45" id="${ring}"/>
    <path d="M96 84 L118 120 L96 156 L74 120 Z" fill="none" stroke="#ff8a73" stroke-width="2" opacity=".65"/>
    <text x="96" y="127" text-anchor="middle" font-size="16" fill="#f4c05e" font-family="system-ui, sans-serif" opacity=".75">RS</text>
  </svg>`;
}

function cardBackHTML() {
  if (ASSETS.cardBack) {
    return `<span class="card-art card-back-art">
      <img src="${esc(ASSETS.cardBack)}" alt="" loading="lazy" onerror="this.style.display='none'"/>
      <span class="art-fallback">${cardBackSvg()}</span>
    </span>`;
  }
  return `<span class="card-art card-back-art">${cardBackSvg()}</span>`;
}

// ---------- cardHTML ----------
export function cardHTML(key, opts = {}) {
  const { mode = 'collection', quantity = 1, index = null, selected = false, newCard = false } = opts;
  const parsed = safeCardFromKey(key);
  if (!parsed || !parsed.card) {
    return `<div class="card-chip mode-${mode} card-chip--missing" data-card-key="${esc(key)}">?</div>`;
  }
  const { card, finish } = parsed;
  const rarity = RARITIES[card.rarity] || { name: card.rarity, color: '#cfd8da', rank: 0 };
  const finishInfo = FINISHES[finish] || { name: finish, color: '#cfd8da', multiplier: 1, sellMultiplier: 1 };
  const locked = mode === 'locked';
  const classes = ['card-chip', `mode-${mode}`, `rarity-${card.rarity}`, `finish-${finish}`, `rank-${rarity.rank}`];
  if (selected) classes.push('is-selected');
  if (newCard) classes.push('is-new');
  if (locked) classes.push('is-locked-silhouette');
  if (mode === 'collection' && quantity <= 0) classes.push('is-depleted');
  const slotAttr = index != null ? ` data-display-slot="${index}"` : '';
  const art = cardArt(card);
  const finishBadge = (!locked && finish !== 'standard')
    ? `<span class="finish-badge" style="--c:${finishInfo.color}">${esc(finishInfo.name)}</span>` : '';
  const qtyBadge = (mode === 'collection' && quantity > 1) ? `<span class="qty-badge">&times;${quantity}</span>` : '';
  const depletedBadge = (mode === 'collection' && quantity <= 0 && !locked) ? '<span class="qty-badge qty-zero">0 owned</span>' : '';
  const newRibbon = newCard ? '<span class="new-ribbon">NEW</span>' : '';
  const rarityPip = locked ? '' : `<span class="rarity-pip" style="--c:${rarity.color}">${esc(rarity.name)}</span>`;
  const title = locked ? '???' : esc(card.name);
  const sub = locked ? 'Undiscovered' : esc(card.role);
  const tip = locked ? 'Undiscovered card — keep opening packs to find it.' : `${card.name} — ${card.description}`;
  return `<div class="${classes.join(' ')}" data-card-key="${esc(key)}"${slotAttr} title="${esc(tip)}">
    <div class="card-face">
      <div class="card-art">${art}</div>
      ${newRibbon}${finishBadge}${qtyBadge || depletedBadge}${rarityPip}
      <div class="card-plate">
        <span class="card-name">${title}</span>
        <span class="card-role">${sub}</span>
      </div>
    </div>
  </div>`;
}

// ---------- pack stage ----------
function rarityOddsLine(rarities) {
  return Object.keys(rarities).map(k => `${RARITIES[k].name} ${Math.round(rarities[k] * 100)}%`).join(' &middot; ');
}

function emptyStageMarkup(state, set) {
  const price = packPrice(state, set.id, 1);
  const unlocked = state.lifetimeCash >= set.unlockAt;
  return `
  <div class="stage-empty">
    <div class="stage-empty-art">${packArt(set)}</div>
    <h2>The counter is clear.</h2>
    <p>Buy a <strong>${esc(set.name)}</strong> pack to start the rip, or pick a different set in the Shop tab below.</p>
    <button type="button" id="quickRip" class="btn-primary btn-rip" data-action="buy-pack" data-set="${set.id}" data-quantity="1"
      data-cost="${price}" data-unlock="${unlocked ? 1 : 0}" data-queue-count="${state.queue.length}">
      Quick Rip — ${formatMoney(price)}
    </button>
    ${!unlocked ? `<p class="lock-note">${esc(set.name)} unlocks at ${formatMoney(set.unlockAt)} lifetime cash.</p>` : ''}
  </div>`;
}

function sealedStageMarkup(state, pack, set) {
  const position = state.queue.length;
  const bonus = pack.cards.length > 4;
  return `
  <div class="stage-sealed">
    <p class="stage-caption">${position > 1 ? `Pack 1 of ${position} queued` : 'One pack on the counter'} &mdash; <strong>${esc(set.name)}</strong></p>
    <div id="sealedPack" class="sealed-pack" style="--set-color:${set.color}">
      <div class="pack-art">${packArt(set)}</div>
      <div id="packSeal" class="pack-seal" data-action="tear" title="Drag the seal sideways, or tap to tear">
        <span class="seal-grip" aria-hidden="true"></span>
        <span class="seal-label">RIP</span>
      </div>
    </div>
    <button type="button" class="btn-primary" data-action="tear">Tear It Open</button>
    <p class="stage-hint">Drag the seal or tap the button &mdash; ${bonus ? 'five cards (bonus!) wait' : 'four cards wait'} inside.</p>
  </div>`;
}

function wrapRevealCard(cardHtmlStr, ribbonText, isFinalSlot) {
  return `<div class="reveal-slot ${ribbonText ? 'just-revealed' : ''}">
    ${cardHtmlStr}
    ${ribbonText ? `<span class="new-ribbon custom">${esc(ribbonText)}</span>` : ''}
    ${isFinalSlot ? '<span class="pip-guarantee">Guaranteed Uncommon+</span>' : ''}
  </div>`;
}
function faceDownSlot(isNext, isFinalSlot) {
  return `<button type="button" class="card-chip mode-facedown ${isNext ? 'is-next' : 'is-pending'}" data-action="reveal" aria-label="${isFinalSlot ? 'Reveal the final guaranteed card' : 'Reveal the next card'}" ${isNext ? '' : 'disabled'}>
    ${cardBackHTML()}
    ${isFinalSlot ? '<span class="pip-guarantee">Guaranteed Uncommon+</span>' : ''}
  </button>`;
}

function revealStageMarkup(state, ui, pack, set) {
  const total = pack.cards.length;
  const revealed = pack.revealed;
  const lastReveal = ui.lastReveal;
  const rows = pack.cards.map((entry, i) => {
    const key = `${entry.cardId}:${entry.finish}`;
    const isFinalSlot = i === total - 1;
    if (i < revealed) {
      const isLast = i === revealed - 1;
      const fresh = isLast && lastReveal && lastReveal.cardId === entry.cardId && lastReveal.finish === entry.finish;
      const ribbon = fresh ? (lastReveal.isNew ? 'NEW CARD' : (lastReveal.isNewFinish ? 'NEW FINISH' : '')) : '';
      return wrapRevealCard(cardHTML(key, { mode: 'reveal' }), ribbon, isFinalSlot);
    }
    return faceDownSlot(i === revealed, isFinalSlot);
  }).join('');
  const allRevealed = revealed >= total;
  const completedSetId = lastReveal && lastReveal.newSetCompleted;
  const completedSet = completedSetId ? SET_BY_ID[completedSetId] : null;
  const setCompleteBanner = completedSet
    ? `<div class="banner-set-complete">SET COMPLETE &mdash; ${esc(completedSet.name)}! +25% income on its cards, plus a bonus 5th card in future ${esc(completedSet.name)} packs.</div>`
    : '';
  const nextLabel = allRevealed ? '' : `Reveal Card ${revealed + 1} of ${total}${revealed === total - 1 ? ' &mdash; guaranteed uncommon or better!' : ''}`;
  return `
  <div class="stage-reveal" data-total="${total}">
    ${setCompleteBanner}
    <p class="stage-caption">${esc(set.name)} &mdash; ${revealed}/${total} revealed${total > 4 ? ' (bonus pack!)' : ''}</p>
    <div class="reveal-row reveal-row-${total}">${rows}</div>
    ${allRevealed
      ? '<button type="button" class="btn-primary" data-action="finish-pack">Finish Pack</button>'
      : `<button type="button" class="btn-primary pulse" data-action="reveal">${nextLabel}</button>`}
  </div>`;
}

function renderPackStage(state, ui) {
  const pack = state.queue[0];
  const fallbackSet = SET_BY_ID[state.selectedSet] || SETS[0];
  if (!pack) return emptyStageMarkup(state, fallbackSet);
  const set = SET_BY_ID[pack.setId] || fallbackSet;
  if (!pack.torn) return sealedStageMarkup(state, pack, set);
  return revealStageMarkup(state, ui, pack, set);
}

// ---------- display shelf ----------
function shelfHint(ui) {
  if (ui.selectedKey) {
    const parsed = safeCardFromKey(ui.selectedKey);
    const name = parsed ? parsed.card.name : 'card';
    return `Placing <strong>${esc(name)}</strong> &mdash; tap a shelf slot. Tap the card again to cancel.`;
  }
  if (ui.selectedSlot != null) {
    return `Swapping Slot ${ui.selectedSlot + 1} &mdash; tap another slot to swap, or tap it again to cancel.`;
  }
  return 'Choose Display in your Collection, then tap a slot. Tap a filled slot to swap.<span class="shelf-scroll-hint"> Swipe the shelf to reach more slots.</span>';
}

function renderShelf(state, ui, income) {
  const unlocked = slotCount(state);
  const linksByIndex = new Map();
  income.links.forEach(l => {
    if (!linksByIndex.has(l.from)) linksByIndex.set(l.from, { out: [], in: [] });
    if (!linksByIndex.has(l.to)) linksByIndex.set(l.to, { out: [], in: [] });
    linksByIndex.get(l.from).out.push(l);
    linksByIndex.get(l.to).in.push(l);
  });
  const occupiedCount = state.display.filter(Boolean).length;
  const slots = state.display.map((key, i) => {
    const locked = i >= unlocked;
    const selected = ui.selectedSlot === i;
    const slotInfo = income.slots.find(s => s.index === i) || { income: 0 };
    const rel = linksByIndex.get(i) || { in: [], out: [] };
    const relCount = rel.in.length + rel.out.length;
    const badge = relCount > 0
      ? `<span class="link-badge" title="${esc([...rel.in, ...rel.out].map(l => l.label).join('; '))}">${relCount} link${relCount === 1 ? '' : 's'}</span>`
      : '';
    let content;
    if (locked) {
      content = `<div class="slot-locked">${LOCK_ICON}<span>Locked</span><span class="slot-hint">Buy Display Slots</span></div>`;
    } else if (key) {
      const isSole = occupiedCount <= 1;
      const clearTitle = isSole
        ? 'Keep one card displayed to keep the shop earning.'
        : `Clear slot ${i + 1}`;
      content = `${cardHTML(key, { mode: 'display', index: i, selected })}${badge}
        <span class="slot-income">${formatMoney(slotInfo.income)}/s</span>
        <button type="button" class="slot-clear" data-action="clear-slot" data-index="${i}" aria-label="Clear slot ${i + 1}" title="${esc(clearTitle)}" ${isSole ? 'disabled' : ''}>&times;</button>`;
    } else {
      content = `<div class="slot-empty"><span class="slot-plus">+</span><span>Empty slot</span></div>${badge}`;
    }
    const actionAttr = locked ? '' : ` data-action="slot" data-index="${i}"`;
    return `<div class="shelf-slot ${locked ? 'is-locked' : ''} ${selected ? 'is-selected' : ''} ${key && !locked ? 'is-filled' : ''}" data-display-slot="${i}"${actionAttr}>${content}</div>`;
  }).join('');
  return `
  <div class="shelf-header">
    <h2>Display Shelf</h2>
    <p id="shelfHint" class="shelf-hint">${shelfHint(ui)}</p>
    <p class="shelf-legend"><span class="dot dot-self"></span> selected <span class="dot dot-source"></span> boosts it <span class="dot dot-target"></span> boosted by it</p>
  </div>
  <div id="displayShelf" class="display-shelf">${slots}</div>
  <p id="relationLegend" class="relation-legend" hidden></p>
  <p class="shelf-total">Shelf income: <strong>${formatMoney(income.total)}/s</strong></p>`;
}

export function setRelationshipFocus(state, index) {
  const shelf = document.getElementById('displayShelf');
  if (!shelf) return;
  const nodes = shelf.querySelectorAll('[data-display-slot]');
  const legend = document.getElementById('relationLegend');
  if (index == null) {
    nodes.forEach(n => n.classList.remove('rel-self', 'rel-source', 'rel-target', 'rel-dim'));
    if (legend) { legend.textContent = ''; legend.hidden = true; }
    return;
  }
  const details = incomeDetails(state);
  const incoming = details.links.filter(l => l.to === index);
  const outgoing = details.links.filter(l => l.from === index);
  const sources = new Set(incoming.map(l => l.from));
  const targets = new Set(outgoing.map(l => l.to));
  nodes.forEach(n => {
    const i = Number(n.getAttribute('data-display-slot'));
    n.classList.remove('rel-self', 'rel-source', 'rel-target', 'rel-dim');
    if (i === index) { n.classList.add('rel-self'); return; }
    if (sources.has(i)) n.classList.add('rel-source');
    if (targets.has(i)) n.classList.add('rel-target');
    if (!sources.has(i) && !targets.has(i)) n.classList.add('rel-dim');
  });
  if (legend) {
    const lines = [];
    incoming.forEach(l => lines.push(`Slot ${l.from + 1} boosts Slot ${l.to + 1}: ${l.label}`));
    outgoing.forEach(l => lines.push(`Slot ${l.from + 1} boosts Slot ${l.to + 1}: ${l.label}`));
    legend.hidden = false;
    legend.textContent = lines.length ? lines.join(' | ') : 'No active relationships for this card yet.';
  }
}

// ---------- shop tab ----------
function renderSetTile(state, set, progress) {
  const unlocked = state.lifetimeCash >= set.unlockAt;
  const selected = state.selectedSet === set.id;
  const completed = progress.completedSets.includes(set.id);
  const setCardIds = CARDS.filter(c => c.set === set.id).map(c => c.id);
  const discovered = setCardIds.filter(id => FINISH_IDS.some(f => state.seen[`${id}:${f}`])).length;
  const queueCount = state.queue.length;
  let body;
  if (unlocked) {
    const price1 = packPrice(state, set.id, 1);
    const price6 = packPrice(state, set.id, 6);
    const odds = packOdds(state, set.id);
    body = `
      <p class="odds-line">${rarityOddsLine(odds.rarities)}</p>
      <div class="buy-row">
        <button type="button" data-action="buy-pack" data-set="${set.id}" data-quantity="1" data-cost="${price1}" data-unlock="1" data-queue-count="${queueCount}" class="btn-buy">1 Pack &mdash; ${formatMoney(price1)}</button>
        <button type="button" data-action="buy-pack" data-set="${set.id}" data-quantity="6" data-cost="${price6}" data-unlock="1" data-queue-count="${queueCount}" class="btn-buy btn-box"><span class="btn-box-art">${boxArt(set)}</span>Box of 6 &mdash; ${formatMoney(price6)}<span class="discount-pip">-10%</span></button>
      </div>`;
  } else {
    body = `
      <p class="lock-note">Unlocks at ${formatMoney(set.unlockAt)} lifetime cash (you've earned ${formatMoney(state.lifetimeCash)}).</p>
      <button type="button" class="btn-buy" disabled>Locked</button>`;
  }
  return `
  <article class="set-tile ${selected ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'}" style="--set-color:${set.color}" data-action="select-set" data-set="${set.id}">
    <div class="set-art">${packArt(set)}</div>
    <div class="set-info">
      <h3>${esc(set.name)}${completed ? ' <span class="set-complete-pip">COMPLETE</span>' : ''}</h3>
      <p class="set-subtitle">${esc(set.subtitle)}</p>
      <p class="set-progress">${discovered}/8 discovered</p>
      ${body}
    </div>
  </article>`;
}

function renderUpgradeTile(state, u) {
  const level = state.upgrades[u.id] || 0;
  const price = upgradePrice(state, u.id);
  const maxed = level >= u.maxLevel;
  const costAttr = Number.isFinite(price) ? price : 'Infinity';
  const costLabel = maxed ? 'MAXED' : formatMoney(price);
  return `
  <article class="upgrade-tile ${maxed ? 'is-maxed' : ''}">
    <h3>${esc(u.name)} <span class="upgrade-level">Lv ${level}/${u.maxLevel}</span></h3>
    <p>${esc(u.description)}</p>
    <button type="button" data-action="upgrade" data-upgrade="${u.id}" data-cost="${costAttr}" data-unlock="1" class="btn-buy" ${maxed ? 'disabled' : ''}>${costLabel}</button>
  </article>`;
}

function renderShopTab(state, ui, progress) {
  const setsHtml = SETS.map(set => renderSetTile(state, set, progress)).join('');
  const upgradesHtml = UPGRADES.map(u => renderUpgradeTile(state, u)).join('');
  return `
  <div class="shop-grid">
    <section class="set-shop">
      <h2>Card Sets</h2>
      <div class="set-tiles">${setsHtml}</div>
    </section>
    <section class="upgrade-shop">
      <h2>Upgrades</h2>
      <div class="upgrade-tiles">${upgradesHtml}</div>
    </section>
  </div>`;
}

// ---------- collection tab ----------
function renderCollectionCard(state, ui, card) {
  const seenFinishes = FINISH_IDS.filter(f => state.seen[`${card.id}:${f}`]);
  if (!seenFinishes.length) {
    const key = `${card.id}:standard`;
    return `<div class="collection-item">${cardHTML(key, { mode: 'locked' })}</div>`;
  }
  return seenFinishes.map(finish => {
    const key = `${card.id}:${finish}`;
    const quantity = state.inventory[key] || 0;
    const displayedCount = state.display.filter(k => k === key).length;
    const canSellOne = (quantity - displayedCount) > 0;
    const spares = spareCount(state, key);
    const finishInfo = FINISHES[finish];
    const unit = Math.round(card.sellValue * finishInfo.sellMultiplier * 100) / 100;
    const selected = ui.selectedKey === key;
    const chip = cardHTML(key, { mode: 'collection', quantity, selected });
    const actions = quantity > 0
      ? `<div class="card-actions">
          <button type="button" data-action="equip" data-key="${key}" class="btn-small">Display</button>
          <button type="button" data-action="sell-one" data-key="${key}" class="btn-small" ${canSellOne ? '' : 'disabled'}>Sell 1 &mdash; ${formatMoney(unit)}</button>
          <button type="button" data-action="sell" data-key="${key}" class="btn-small" ${spares > 0 ? '' : 'disabled'}>Sell spares (${spares})</button>
        </div>`
      : '<p class="depleted-note">Every copy is placed or sold &mdash; still permanently in your album.</p>';
    return `<div class="collection-item">${chip}<p class="card-base-income">Base ${formatMoney(card.baseIncome * finishInfo.multiplier)}/s</p><p class="card-effect">${esc(card.description)}</p>${actions}</div>`;
  }).join('');
}

function renderCollectionSet(state, ui, set) {
  const cards = CARDS.filter(c => c.set === set.id);
  const search = (ui.search || '').trim().toLowerCase();
  const visible = cards.filter(c => {
    if (ui.rarity !== 'all' && c.rarity !== ui.rarity) return false;
    if (search && !(`${c.name} ${c.id} ${c.role}`.toLowerCase().includes(search))) return false;
    return true;
  });
  if (!visible.length) return '';
  const discoveredCount = cards.filter(c => FINISH_IDS.some(f => state.seen[`${c.id}:${f}`])).length;
  const chips = visible.map(card => renderCollectionCard(state, ui, card)).join('');
  return `
  <section class="collection-set" style="--set-color:${set.color}">
    <h3>${esc(set.name)} <span class="set-sub">${esc(set.subtitle)} &mdash; ${discoveredCount}/8</span></h3>
    <div class="collection-grid">${chips}</div>
  </section>`;
}

function renderCollectionTab(state, ui, progress) {
  const filterTiles = ['all', ...SETS.map(s => s.id)].map(id => {
    const label = id === 'all' ? 'All Sets' : SET_BY_ID[id].name;
    return `<button type="button" data-action="filter" data-filter="${id}" class="${ui.filter === id ? 'is-active' : ''}">${esc(label)}</button>`;
  }).join('');
  const rarityTiles = ['all', 'common', 'uncommon', 'rare', 'mythic'].map(r => {
    const label = r === 'all' ? 'All Rarities' : RARITIES[r].name;
    return `<button type="button" data-action="rarity" data-rarity="${r}" class="${ui.rarity === r ? 'is-active' : ''}">${esc(label)}</button>`;
  }).join('');
  const setsToShow = ui.filter === 'all' ? SETS : SETS.filter(s => s.id === ui.filter);
  const body = setsToShow.map(set => renderCollectionSet(state, ui, set)).join('');
  const slots = slotCount(state);
  const masteredBanner = progress.mastered
    ? '<div class="banner-mastered">COLLECTION MASTERED &mdash; all 24 cards found, all 6 slots open. The shop is yours; keep it running.</div>' : '';
  return `
  <div class="collection-goal">
    <p>Goal: discover all 24 cards and open all 6 display slots.</p>
    <div class="goal-bars">
      <div class="goal-bar"><span>Cards ${progress.discovered}/24</span><div class="bar"><div class="bar-fill" style="width:${(progress.discovered / 24 * 100).toFixed(0)}%"></div></div></div>
      <div class="goal-bar"><span>Slots ${slots}/6</span><div class="bar"><div class="bar-fill" style="width:${(slots / 6 * 100).toFixed(0)}%"></div></div></div>
    </div>
    ${masteredBanner}
  </div>
  <div class="collection-controls">
    <div class="filter-row">${filterTiles}</div>
    <div class="filter-row">${rarityTiles}</div>
    <div class="search-row">
      <input id="collectionSearch" type="search" placeholder="Search by name&hellip;" value="${esc(ui.search || '')}" aria-label="Search cards by name" autocomplete="off">
      <button type="button" data-action="sell-all" class="btn-small">Sell All Spares</button>
    </div>
  </div>
  <div class="collection-body">${body || '<p class="empty-note">No cards match these filters.</p>'}</div>`;
}

// ---------- modals & overlays ----------
function helpBody() {
  return `
  <h3>The Rip</h3>
  <p>Buy a pack from the Shop, drag the gold seal sideways (or tap "Tear It Open") to rip it, then tap the glowing card back or Reveal to turn over each card. On phones, swipe the card row to inspect your pulls. The last card in every pack is guaranteed uncommon or better. Completing a set adds a bonus fifth card to that set's future packs.</p>
  <h3>Finishes &amp; Rarity</h3>
  <p>Cards come in Standard, Foil, and Prismatic finishes &mdash; foil and prismatic multiply income and sale price far beyond standard. Luck upgrades shift the odds toward better rarities and finishes without ever making commons worthless.</p>
  <h3>Display Shelf</h3>
  <p>Equipped cards earn passive income every second. Same-set neighbors automatically give each other +20% income. Many cards also have their own adjacency, row, diversity, or completion effects &mdash; tap any shelf card to see exactly what it boosts and what boosts it. Swipe the shelf on phones to reach all six slots. One card must always stay displayed so the shop never stops earning.</p>
  <h3>Collection</h3>
  <p>Discovering a card is permanent. Use Display to choose a copy, then tap a shelf slot to place it. On phones, choosing Display brings the shelf into view. Sell 1 cashes out an undisplayed copy (even your last one). Sell spares keeps at least one copy of every finish and all displayed cards.</p>
  <h3>Upgrades</h3>
  <p>Display Slots unlock more shelf space (up to 6), Lighting adds +25% income per level, Luck improves your odds, and the Auto Opener lets the shop rip packs for you.</p>
  <h3>Auto Opener</h3>
  <p>Once purchased, flip Auto on in Settings. It buys your selected set whenever the queue is empty and reveals a card every 1.5 seconds (0.35s in Fast mode) &mdash; then automatically pauses itself the instant it reveals a mythic, a prismatic finish, or a brand-new rare, so you're always there for the big pulls.</p>
  <h3>Offline</h3>
  <p>Your shelf keeps earning while you're away, for up to four hours. Unopened packs stay sealed in the queue until you come back to rip them.</p>`;
}
function settingsBody(state) {
  const opener = (state.upgrades.opener || 0) >= 1;
  return `
  <div class="settings-row">
    <label>Sound</label>
    <button type="button" class="toggle ${state.settings.sound ? 'is-on' : ''}" data-action="toggle-sound" aria-pressed="${state.settings.sound}">${state.settings.sound ? 'On' : 'Off'}</button>
  </div>
  <div class="settings-row">
    <label>Fast Reveal</label>
    <button type="button" class="toggle ${state.settings.fastReveal ? 'is-on' : ''}" data-action="toggle-fast" aria-pressed="${state.settings.fastReveal}">${state.settings.fastReveal ? 'On' : 'Off'}</button>
  </div>
  <div class="settings-row">
    <label>Auto Opener</label>
    <button type="button" class="toggle ${state.settings.auto ? 'is-on' : ''}" data-action="toggle-auto" aria-pressed="${state.settings.auto}" ${opener ? '' : 'disabled'}>${state.settings.auto ? 'On' : 'Off'}</button>
  </div>
  ${opener
    ? '<p class="settings-note">Auto buys your selected set when the queue is empty and reveals a card every 1.5s (0.35s in Fast mode). It automatically turns itself off when it hits a mythic, a prismatic, or a brand-new rare, so nothing big flies by unseen.</p>'
    : '<p class="settings-note">Buy the Auto Opener upgrade in the Shop tab to unlock this toggle.</p>'}`;
}
function modalShell(title, body) {
  return `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal-panel" data-action="noop">
      <header><h2>${esc(title)}</h2><button type="button" class="modal-close" data-action="close-modal" aria-label="Close">&times;</button></header>
      <div class="modal-body">${body}</div>
    </div>
  </div>`;
}
function renderModal(modal, state) {
  if (modal === 'help') return modalShell('How to RIP SHOP', helpBody());
  if (modal === 'settings') return modalShell('Settings', settingsBody(state));
  return '';
}
function offlineOverlayMarkup(amount, seconds) {
  return `<div class="offline-backdrop">
    <div class="offline-panel">
      <h2>Welcome back</h2>
      <p>The shelf kept working while you were away.</p>
      <p class="offline-amount">+${formatMoney(amount)}</p>
      <p class="offline-time">${formatDuration(seconds)} of passive income</p>
      <button type="button" class="btn-primary" data-action="dismiss-offline">Collect</button>
    </div>
  </div>`;
}
export function showToast(message) {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  host.appendChild(div);
  requestAnimationFrame(() => div.classList.add('is-shown'));
  setTimeout(() => {
    div.classList.remove('is-shown');
    div.classList.add('is-leaving');
    setTimeout(() => div.remove(), 320);
  }, 3200);
  while (host.children.length > 4) host.removeChild(host.firstChild);
}
export function showOffline(amount, seconds) {
  const el = document.getElementById('offlineOverlay');
  if (el) el.innerHTML = offlineOverlayMarkup(amount, seconds);
}

// ---------- focus-preserving render ----------
function withPreservedFocus(containerId, fn) {
  const container = document.getElementById(containerId);
  const active = document.activeElement;
  let restore = null;
  if (active && container && container.contains(active) && active.id) {
    restore = { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }
  fn();
  if (restore) {
    const el = document.getElementById(restore.id);
    if (el) {
      el.focus();
      if (typeof el.setSelectionRange === 'function' && restore.start != null) {
        try { el.setSelectionRange(restore.start, restore.end); } catch { /* not a text field */ }
      }
    }
  }
}

// ---------- counters ----------
export function updateCounters(state) {
  const cashEl = document.getElementById('cash');
  if (cashEl) cashEl.textContent = formatMoney(state.cash);
  const income = incomeDetails(state);
  const rateEl = document.getElementById('incomeRate');
  if (rateEl) rateEl.textContent = `${formatMoney(income.total)}/s`;
  const progress = collectionProgress(state);
  const collEl = document.getElementById('collectionCount');
  if (collEl) collEl.textContent = `${progress.discovered}/${progress.total}`;
  const openedEl = document.getElementById('packsOpened');
  if (openedEl) openedEl.textContent = String(state.stats.packsOpened);
  const queueEl = document.getElementById('queueCount');
  if (queueEl) queueEl.textContent = String(state.queue.length);

  const saveEl = document.getElementById('saveStatus');
  if (saveEl && saveEl.getAttribute('data-save-error') !== '1') {
    const ageMs = Date.now() - (state.savedAt || 0);
    saveEl.textContent = ageMs < 4000 ? 'Saved' : (ageMs < 20000 ? 'Saved moments ago' : 'Save pending\u2026');
    saveEl.classList.toggle('is-stale', ageMs >= 20000);
  }

  document.querySelectorAll('[data-cost]').forEach(btn => {
    const cost = Number(btn.getAttribute('data-cost'));
    const unlocked = btn.getAttribute('data-unlock') !== '0';
    const qty = Number(btn.getAttribute('data-quantity') || '1');
    const queueAttr = btn.getAttribute('data-queue-count');
    const queueOk = queueAttr == null || (Number(queueAttr) + qty <= 60);
    const affordable = Number.isFinite(cost) && state.cash >= cost;
    const enabled = unlocked && affordable && queueOk;
    btn.disabled = !enabled;
    btn.classList.toggle('is-affordable', enabled);
    btn.classList.toggle('is-locked', !unlocked);
  });
}

// ---------- top-level render ----------
export function renderGame(state, ui) {
  const app = document.getElementById('app');
  if (app) app.style.setProperty('--shop-bg', ASSETS.background ? `url("${ASSETS.background}")` : 'none');

  const progress = collectionProgress(state);
  const income = incomeDetails(state);

  const packStageEl = document.getElementById('packStage');
  if (packStageEl) packStageEl.innerHTML = renderPackStage(state, ui);

  const shelfEl = document.getElementById('shelfSection');
  if (shelfEl) shelfEl.innerHTML = renderShelf(state, ui, income);

  withPreservedFocus('tabBody', () => {
    const bodyEl = document.getElementById('tabBody');
    if (bodyEl) bodyEl.innerHTML = ui.tab === 'collection' ? renderCollectionTab(state, ui, progress) : renderShopTab(state, ui, progress);
  });

  const modalEl = document.getElementById('modalLayer');
  if (modalEl) modalEl.innerHTML = ui.modal ? renderModal(ui.modal, state) : '';

  const offlineEl = document.getElementById('offlineOverlay');
  if (offlineEl) offlineEl.innerHTML = ui.offline ? offlineOverlayMarkup(ui.offline.amount, ui.offline.seconds) : '';

  document.querySelectorAll('#tabNav [data-action="tab"]').forEach(btn => {
    const active = btn.getAttribute('data-tab') === ui.tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const saveEl = document.getElementById('saveStatus');
  if (saveEl) {
    saveEl.setAttribute('data-save-error', ui.saveError ? '1' : '0');
    saveEl.classList.toggle('is-error', !!ui.saveError);
    if (ui.saveError) saveEl.textContent = 'Save failed';
  }

  const announceEl = document.getElementById('announcer');
  if (announceEl) {
    if (ui.offline) announceEl.textContent = `Welcome back. You earned ${formatMoney(ui.offline.amount)} while away.`;
    else if (progress.mastered) announceEl.textContent = 'Collection mastered: all 24 cards found and all 6 display slots open.';
    else announceEl.textContent = '';
  }

  updateCounters(state);
  if (ui.selectedSlot != null) setRelationshipFocus(state, ui.selectedSlot);
}
