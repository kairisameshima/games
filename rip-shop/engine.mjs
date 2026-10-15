// RIP SHOP — pure game engine.
// Synchronous, no DOM/storage/timers. Every exported function either mutates
// the passed `state` in place or is a pure query; none read globals or wall
// clock time except `createState`'s `now` parameter.

import { SETS, SET_BY_ID, CARDS, CARD_BY_ID, FINISHES, RARITIES, UPGRADES } from './data.mjs';

/**
 * @typedef {import('./data.mjs').SetId} SetId
 * @typedef {import('./data.mjs').Rarity} Rarity
 * @typedef {import('./data.mjs').FinishId} FinishId
 * @typedef {import('./data.mjs').Card} Card
 *
 * @typedef {`${string}:${FinishId}`} CardKey `${cardId}:${finish}`.
 *
 * @typedef {Object} QueuedCard
 * @property {string} cardId
 * @property {FinishId} finish
 *
 * @typedef {Object} Pack
 * @property {SetId} setId
 * @property {QueuedCard[]} cards
 * @property {number} revealed Count of cards already revealed, in order.
 * @property {boolean} torn
 *
 * @typedef {Object} Stats
 * @property {number} packsBought
 * @property {number} packsOpened
 * @property {number} cardsPulled
 * @property {number} bestPull Highest rarity rank (0-3) ever pulled.
 *
 * @typedef {Object} Settings
 * @property {boolean} sound
 * @property {boolean} auto
 * @property {boolean} fastReveal
 *
 * @typedef {Object} GameState
 * @property {1} version
 * @property {number} cash Spendable balance.
 * @property {number} lifetimeCash Total ever earned (income + sales). Never reduced by spending.
 * @property {Record<CardKey, number>} inventory Owned copy counts, includes displayed copies.
 * @property {Record<CardKey, true>} seen Permanent discovery record; never cleared.
 * @property {(CardKey|null)[]} display Always length 6; indices beyond `slotCount` stay null.
 * @property {{slots:number,lighting:number,luck:number,opener:number}} upgrades
 * @property {SetId} selectedSet
 * @property {Pack[]} queue Up to 60 packs, oldest/front first.
 * @property {Stats} stats
 * @property {Settings} settings
 * @property {number} savedAt
 *
 * @typedef {Object} RevealResult
 * @property {string} cardId
 * @property {FinishId} finish
 * @property {boolean} isNew True if this base card (any finish) had never been seen before.
 * @property {boolean} isNewFinish True if this exact id:finish had never been seen before.
 * @property {SetId|null} newSetCompleted The set id if this reveal just completed a full set, else null.
 *
 * @typedef {Object} CollectionProgress
 * @property {number} discovered Distinct base card ids ever seen.
 * @property {24} total
 * @property {SetId[]} completedSets
 * @property {boolean} mastered All 24 discovered AND all 6 display slots unlocked.
 *
 * @typedef {Object} IncomeLink
 * @property {number} from Source slot index.
 * @property {number} to Target slot index receiving the bonus.
 * @property {string} label Human-readable explanation of the bonus.
 *
 * @typedef {Object} IncomeSlot
 * @property {number} index
 * @property {CardKey|null} key
 * @property {number} base Card base income (0 if empty/locked).
 * @property {number} income Final cash/sec from this slot.
 * @property {number} multiplier Total multiplier applied to base income (0 if empty/locked).
 *
 * @typedef {Object} IncomeDetails
 * @property {number} total Cash/sec across the whole display.
 * @property {IncomeSlot[]} slots Always 6 entries.
 * @property {IncomeLink[]} links Directional bonus explanations between active slots only.
 *
 * @typedef {Object} PackOdds
 * @property {Record<Rarity, number>} rarities Sums to 1.
 * @property {Record<FinishId, number>} finishes Sums to 1.
 */

const DISPLAY_SIZE = 6;
const MAX_QUEUE = 60;
const SAME_SET_NEIGHBOR_BONUS = 0.2;
const SET_COMPLETE_BONUS = 0.25;
const LIGHTING_BONUS_PER_LEVEL = 0.25;

// -- small pure helpers ------------------------------------------------------

/** @param {string} id @param {FinishId} finish @returns {CardKey} */
function makeKey(id, finish) {
  return /** @type {CardKey} */ (`${id}:${finish}`);
}

/** @param {CardKey} key @returns {{card:Card|undefined,finish:FinishId}} */
export function cardFromKey(key) {
  const i = key.indexOf(':');
  const cardId = i === -1 ? key : key.slice(0, i);
  const finish = /** @type {FinishId} */ (i === -1 ? '' : key.slice(i + 1));
  return { card: CARD_BY_ID[cardId], finish };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** Normalizes a distribution map so its values sum to exactly 1. */
function normalize(dist) {
  const sum = Object.values(dist).reduce((a, b) => a + b, 0);
  if (sum <= 0) return dist;
  for (const k of Object.keys(dist)) dist[k] = dist[k] / sum;
  return dist;
}

/** Does `card` qualify for an effect `target` ('any' | setId | role tag)? */
function matchesTarget(card, target) {
  if (target == null || target === 'any') return true;
  if (SET_BY_ID[target]) return card.set === target;
  return card.role === target;
}

function describeEffect(card, eff) {
  const pct = Math.round(eff.amount * 100);
  const label = eff.target == null || eff.target === 'any'
    ? 'card'
    : SET_BY_ID[eff.target]
      ? `${SET_BY_ID[eff.target].name}`
      : `${eff.target[0].toUpperCase()}${eff.target.slice(1)}`;
  if (eff.kind === 'adjacent') return `${card.name}: +${pct}% to adjacent ${label}`;
  if (eff.kind === 'row') return `${card.name}: +${pct}% to every other ${label}`;
  if (eff.kind === 'diversity') return `${card.name}: +${pct}% per other Set on shelf`;
  return `${card.name}: +${pct}%`;
}

// -- state lifecycle ----------------------------------------------------------

/**
 * Creates a fresh new-game state.
 * @param {number} [now]
 * @returns {GameState}
 */
export function createState(now = Date.now()) {
  const starter = makeKey('clerk', 'standard');
  return {
    version: 1,
    cash: 24,
    lifetimeCash: 24,
    inventory: { [starter]: 1 },
    seen: { [starter]: true },
    display: [starter, null, null, null, null, null],
    upgrades: { slots: 0, lighting: 0, luck: 0, opener: 0 },
    selectedSet: 'office',
    queue: [],
    stats: { packsBought: 0, packsOpened: 0, cardsPulled: 0, bestPull: 0 },
    settings: { sound: true, auto: false, fastReveal: false },
    savedAt: now,
  };
}

/** @param {GameState} state @returns {number} */
export function slotCount(state) {
  return 3 + (state.upgrades.slots || 0);
}

/** @param {GameState} state @returns {CollectionProgress} */
export function collectionProgress(state) {
  const discoveredIds = new Set(Object.keys(state.seen).map((k) => cardFromKey(k).card?.id ?? k.slice(0, k.indexOf(':'))));
  const countBySet = {};
  for (const id of discoveredIds) {
    const card = CARD_BY_ID[id];
    if (!card) continue;
    countBySet[card.set] = (countBySet[card.set] || 0) + 1;
  }
  const completedSets = SETS.filter((s) => (countBySet[s.id] || 0) >= 8).map((s) => s.id);
  return {
    discovered: discoveredIds.size,
    total: 24,
    completedSets,
    mastered: discoveredIds.size >= 24 && slotCount(state) >= DISPLAY_SIZE,
  };
}

// -- income / relationship engine --------------------------------------------

/**
 * Shared computation used by both `incomeDetails` and `advance`, so the
 * numbers shown to the player and the cash actually credited always agree.
 * @param {GameState} state
 * @returns {IncomeDetails}
 */
function computeIncome(state) {
  const slots = slotCount(state);
  const { completedSets } = collectionProgress(state);
  const lightingBonus = LIGHTING_BONUS_PER_LEVEL * (state.upgrades.lighting || 0);
  const display = state.display;

  /** @type {(i:number)=>boolean} */
  const occupied = (i) => i >= 0 && i < slots && display[i] != null;

  /** @type {Array<{card:Card,finish:FinishId}|null>} */
  const info = display.map((key, i) => {
    if (!occupied(i)) return null;
    const { card, finish } = cardFromKey(/** @type {CardKey} */ (key));
    return card ? { card, finish } : null;
  });

  /** @type {IncomeLink[]} */
  const links = [];
  const bonuses = new Array(DISPLAY_SIZE).fill(0);

  // 1. Automatic same-set neighbor bonus (bidirectional, always on).
  for (let i = 0; i < slots - 1; i++) {
    if (info[i] && info[i + 1] && info[i].card.set === info[i + 1].card.set) {
      bonuses[i] += SAME_SET_NEIGHBOR_BONUS;
      bonuses[i + 1] += SAME_SET_NEIGHBOR_BONUS;
      const setName = SET_BY_ID[info[i].card.set].name;
      const label = `${setName} neighbors +${Math.round(SAME_SET_NEIGHBOR_BONUS * 100)}%`;
      links.push({ from: i + 1, to: i, label });
      links.push({ from: i, to: i + 1, label });
    }
  }

  // 2. Per-card outgoing 'adjacent' / 'row' effects.
  for (let i = 0; i < slots; i++) {
    if (!info[i]) continue;
    const { card } = info[i];
    const eff = card.effect;
    if (!eff || eff.kind === 'none' || eff.kind === 'completion' || eff.kind === 'diversity') continue;
    if (eff.kind === 'adjacent') {
      for (const j of [i - 1, i + 1]) {
        if (info[j] && matchesTarget(info[j].card, eff.target)) {
          bonuses[j] += eff.amount;
          links.push({ from: i, to: j, label: describeEffect(card, eff) });
        }
      }
    } else if (eff.kind === 'row') {
      for (let j = 0; j < slots; j++) {
        if (j === i || !info[j]) continue;
        if (matchesTarget(info[j].card, eff.target)) {
          bonuses[j] += eff.amount;
          links.push({ from: i, to: j, label: describeEffect(card, eff) });
        }
      }
    }
  }

  // 3. 'diversity' effects: self bonus per other distinct set on the shelf.
  for (let i = 0; i < slots; i++) {
    if (!info[i]) continue;
    const { card } = info[i];
    const eff = card.effect;
    if (!eff || eff.kind !== 'diversity') continue;
    const sourceBySet = new Map();
    for (let j = 0; j < slots; j++) {
      if (j === i || !info[j]) continue;
      const s = info[j].card.set;
      if (s !== card.set && !sourceBySet.has(s)) sourceBySet.set(s, j);
    }
    bonuses[i] += eff.amount * sourceBySet.size;
    for (const [, j] of sourceBySet) {
      links.push({ from: j, to: i, label: describeEffect(card, eff) });
    }
  }

  // 4. Automatic completed-set bonus, per-card 'completion' effects, lighting.
  for (let i = 0; i < slots; i++) {
    if (!info[i]) continue;
    const { card } = info[i];
    if (completedSets.includes(card.set)) bonuses[i] += SET_COMPLETE_BONUS;
    const eff = card.effect;
    if (eff && eff.kind === 'completion') {
      if (eff.target == null || eff.target === 'any') {
        bonuses[i] += eff.amount * completedSets.length;
      } else if (completedSets.includes(eff.target)) {
        bonuses[i] += eff.amount;
      }
    }
    bonuses[i] += lightingBonus;
  }

  /** @type {IncomeSlot[]} */
  const slotsOut = [];
  let total = 0;
  for (let i = 0; i < DISPLAY_SIZE; i++) {
    if (!info[i]) {
      slotsOut.push({ index: i, key: null, base: 0, income: 0, multiplier: 0 });
      continue;
    }
    const { card, finish } = info[i];
    const base = card.baseIncome;
    const multiplier = (1 + bonuses[i]) * FINISHES[finish].multiplier;
    const income = base * multiplier;
    total += income;
    slotsOut.push({ index: i, key: display[i], base, income, multiplier });
  }

  return { total, slots: slotsOut, links };
}

/** @param {GameState} state @returns {IncomeDetails} */
export function incomeDetails(state) {
  return computeIncome(state);
}

/**
 * Credits passive income for `seconds` of elapsed time. No cap, no pack
 * opening — the caller (parent) is responsible for capping offline elapsed time.
 * @param {GameState} state @param {number} seconds @returns {number} cash earned
 */
export function advance(state, seconds) {
  if (!(seconds > 0)) return 0;
  const earned = computeIncome(state).total * seconds;
  state.cash += earned;
  state.lifetimeCash += earned;
  return earned;
}

// -- pack economy --------------------------------------------------------------

/**
 * @param {GameState} state @param {SetId} setId @param {1|6} [quantity]
 * @returns {number}
 */
export function packPrice(state, setId, quantity = 1) {
  const set = SET_BY_ID[setId];
  if (!set) throw new Error(`Unknown set: ${setId}`);
  if (quantity !== 1 && quantity !== 6) throw new Error('Pack quantity must be 1 or 6');
  if (quantity === 1) return set.price;
  return Math.floor(set.price * 6 * 0.9); // 6-pack box: 10% discount == floor(price*5.4)
}

/**
 * Base per-slot drop odds for a set, before the guaranteed-last-slot reroll.
 * Luck upgrade shifts rarity/finish weight toward better outcomes while
 * keeping every rarity/finish above zero (commons never disappear).
 * @param {GameState} state @param {SetId} setId @returns {PackOdds}
 */
export function packOdds(state, setId) {
  if (!SET_BY_ID[setId]) throw new Error(`Unknown set: ${setId}`);
  const luck = state.upgrades.luck || 0;
  const rarities = {
    common: clamp01(0.6 - 0.04 * luck),
    uncommon: clamp01(0.27 + 0.015 * luck),
    rare: clamp01(0.1 + 0.018 * luck),
    mythic: clamp01(0.03 + 0.007 * luck),
  };
  normalize(rarities);
  const finishes = {
    standard: clamp01(0.9 - 0.014 * luck),
    foil: clamp01(0.09 + 0.01 * luck),
    prismatic: clamp01(0.01 + 0.004 * luck),
  };
  normalize(finishes);
  return { rarities, finishes };
}

function pickWeighted(dist, rng) {
  const roll = rng();
  let acc = 0;
  const keys = Object.keys(dist);
  for (const k of keys) {
    acc += dist[k];
    if (roll < acc) return k;
  }
  return keys[keys.length - 1];
}

/** @param {GameState} state @param {SetId} setId @param {() => number} rng @param {boolean} guaranteed */
function rollCard(state, setId, rng, guaranteed) {
  const odds = packOdds(state, setId);
  // Conditioning the same distribution on uncommon+ needs one roll, not rejection retries.
  const distribution = guaranteed
    ? normalize({ uncommon: odds.rarities.uncommon, rare: odds.rarities.rare, mythic: odds.rarities.mythic })
    : odds.rarities;
  const rarity = pickWeighted(distribution, rng);
  const pool = CARDS.filter((c) => c.set === setId && c.rarity === rarity);
  const card = pool[Math.floor(rng() * pool.length)];
  const finish = pickWeighted(odds.finishes, rng);
  return { cardId: card.id, finish };
}

/** @param {GameState} state @param {SetId} setId @param {Function} rng @param {boolean} bonusCard @returns {Pack} */
function rollPack(state, setId, rng, bonusCard) {
  const slotTotal = bonusCard ? 5 : 4;
  const cards = [];
  for (let i = 0; i < slotTotal - 1; i++) cards.push(rollCard(state, setId, rng, false));
  cards.push(rollCard(state, setId, rng, true));
  return { setId, cards, revealed: 0, torn: false };
}

/**
 * Validates everything before mutating, rolls all pack contents up front
 * (so results survive reload), then commits cash + queue atomically.
 * @param {GameState} state @param {SetId} setId @param {1|6} [quantity] @param {Function} [rng]
 */
export function buyPacks(state, setId, quantity = 1, rng = Math.random) {
  if (quantity !== 1 && quantity !== 6) throw new Error('Pack quantity must be 1 or 6');
  const set = SET_BY_ID[setId];
  if (!set) throw new Error(`Unknown set: ${setId}`);
  if (state.lifetimeCash < set.unlockAt) {
    throw new Error(`${set.name} unlocks at $${set.unlockAt} lifetime earnings`);
  }
  const price = packPrice(state, setId, quantity);
  if (state.cash < price) throw new Error(`Not enough cash: need $${price}, have $${Math.floor(state.cash)}`);
  if (state.queue.length + quantity > MAX_QUEUE) throw new Error('Pack queue is full (max 60)');

  const bonusCard = collectionProgress(state).completedSets.includes(setId);
  const packs = [];
  for (let p = 0; p < quantity; p++) packs.push(rollPack(state, setId, rng, bonusCard));

  state.cash -= price;
  state.stats.packsBought += quantity;
  for (const pack of packs) state.queue.push(pack);
}

/** @param {GameState} state @returns {boolean} */
export function tearPack(state) {
  const pack = state.queue[0];
  if (!pack || pack.torn) return false;
  pack.torn = true;
  return true;
}

/** @param {GameState} state @returns {RevealResult|null} */
export function revealNext(state) {
  const pack = state.queue[0];
  if (!pack || !pack.torn) return null;
  if (pack.revealed >= pack.cards.length) return null;

  const { cardId, finish } = pack.cards[pack.revealed];
  const card = CARD_BY_ID[cardId];
  const key = makeKey(cardId, finish);

  const hadCard = Object.keys(state.seen).some((k) => k.startsWith(`${cardId}:`));
  const hadFinish = !!state.seen[key];
  const idsBeforeInSet = new Set(
    Object.keys(state.seen)
      .map((k) => k.slice(0, k.indexOf(':')))
      .filter((id) => CARD_BY_ID[id] && CARD_BY_ID[id].set === card.set),
  );
  const wasSetComplete = idsBeforeInSet.size >= 8;

  pack.revealed += 1;
  state.inventory[key] = (state.inventory[key] || 0) + 1;
  state.seen[key] = true;
  state.stats.cardsPulled += 1;
  state.stats.bestPull = Math.max(state.stats.bestPull, RARITIES[card.rarity].rank);

  let newSetCompleted = null;
  if (!wasSetComplete) {
    idsBeforeInSet.add(cardId);
    if (idsBeforeInSet.size >= 8) newSetCompleted = card.set;
  }

  if (pack.revealed >= pack.cards.length) state.stats.packsOpened += 1;

  return { cardId, finish, isNew: !hadCard, isNewFinish: !hadFinish, newSetCompleted };
}

/** @param {GameState} state @returns {boolean} */
export function finishPack(state) {
  const pack = state.queue[0];
  if (!pack) return false;
  if (pack.revealed < pack.cards.length) return false;
  state.queue.shift();
  return true;
}

// -- collection / display ------------------------------------------------------

/**
 * Sellable spares: owned minus whichever is bigger, 1 (always keep a
 * souvenir copy) or the number currently on display.
 * @param {GameState} state @param {CardKey} key @returns {number}
 */
export function spareCount(state, key) {
  const owned = state.inventory[key] || 0;
  const displayed = state.display.filter((k) => k === key).length;
  const protectedCopies = Math.max(1, displayed);
  return Math.max(0, owned - protectedCopies);
}

/**
 * @param {GameState} state @param {CardKey|null} key @param {number} index
 */
export function equipCard(state, key, index) {
  const slots = slotCount(state);
  if (index == null || index < 0 || index >= slots) throw new Error('That display slot is locked');
  if (key === null) {
    if (state.display[index] && state.display.filter(Boolean).length === 1) {
      throw new Error('Keep one card displayed so your shop can keep earning.');
    }
    state.display[index] = null;
    return;
  }
  if (state.display[index] === key) return; // no-op
  const { card, finish } = cardFromKey(key);
  if (!card || !FINISHES[finish]) throw new Error(`Unknown card: ${key}`);
  const owned = state.inventory[key] || 0;
  const displayedElsewhere = state.display.filter((k, i) => k === key && i !== index).length;
  if (owned <= displayedElsewhere) throw new Error(`No spare copy of ${card.name} (${finish}) to display`);
  state.display[index] = key;
}

/** @param {GameState} state @param {number} from @param {number} to */
export function moveDisplay(state, from, to) {
  const slots = slotCount(state);
  if (from < 0 || from >= slots || to < 0 || to >= slots) throw new Error('That display slot is locked');
  const tmp = state.display[from];
  state.display[from] = state.display[to];
  state.display[to] = tmp;
}

function sellValueFor(card, finish) {
  return Math.round(card.sellValue * FINISHES[finish].sellMultiplier * 100) / 100;
}

/**
 * Sells only permitted spares (protects at least one copy of each variant,
 * or the displayed count if higher).
 * @param {GameState} state @param {CardKey} key @param {number} [quantity]
 * @returns {{quantity:number, amount:number}}
 */
export function sellSpare(state, key, quantity = Infinity) {
  const spare = spareCount(state, key);
  const sellQty = Math.max(0, Math.min(spare, quantity));
  if (sellQty <= 0) return { quantity: 0, amount: 0 };
  const { card, finish } = cardFromKey(key);
  const amount = sellValueFor(card, finish) * sellQty;
  state.inventory[key] -= sellQty;
  state.cash += amount;
  state.lifetimeCash += amount;
  return { quantity: sellQty, amount };
}

/** @param {GameState} state @returns {number} total cash earned */
export function sellAllSpares(state) {
  let total = 0;
  for (const key of Object.keys(state.inventory)) {
    total += sellSpare(state, key, Infinity).amount;
  }
  return total;
}

/**
 * Sells undisplayed owned copies, including the very last one — unlike
 * `sellSpare`, this can fully liquidate a variant. Seen/album discovery is
 * untouched and permanent regardless. Throws if no undisplayed copy exists.
 * @param {GameState} state @param {CardKey} key @param {number} [quantity]
 * @returns {{quantity:number, amount:number}}
 */
export function sellCard(state, key, quantity = 1) {
  const { card, finish } = cardFromKey(key);
  if (!card || !FINISHES[finish]) throw new Error(`Unknown card: ${key}`);
  const owned = state.inventory[key] || 0;
  const displayed = state.display.filter((k) => k === key).length;
  const available = Math.max(0, owned - displayed);
  if (available <= 0) throw new Error(`No undisplayed copies of ${card.name} (${finish}) to sell`);
  const sellQty = Math.max(0, Math.min(available, quantity));
  if (sellQty <= 0) return { quantity: 0, amount: 0 };
  const amount = sellValueFor(card, finish) * sellQty;
  state.inventory[key] -= sellQty;
  state.cash += amount;
  state.lifetimeCash += amount;
  return { quantity: sellQty, amount };
}

// -- upgrades --------------------------------------------------------------

/** @param {GameState} state @param {import('./data.mjs').UpgradeId} id @returns {number} */
export function upgradePrice(state, id) {
  const upgrade = UPGRADES.find((u) => u.id === id);
  if (!upgrade) throw new Error(`Unknown upgrade: ${id}`);
  const level = state.upgrades[id] || 0;
  if (level >= upgrade.maxLevel) return Infinity;
  return Math.round(upgrade.baseCost * Math.pow(upgrade.costFactor, level));
}

/** @param {GameState} state @param {import('./data.mjs').UpgradeId} id */
export function buyUpgrade(state, id) {
  const price = upgradePrice(state, id);
  if (!Number.isFinite(price)) throw new Error('That upgrade is already maxed out');
  if (state.cash < price) throw new Error(`Not enough cash: need $${price}, have $${Math.floor(state.cash)}`);
  state.cash -= price;
  state.upgrades[id] = (state.upgrades[id] || 0) + 1;
}
