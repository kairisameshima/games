// RIP SHOP — static game data.
// Pure data module: no state, no mutation, no DOM/storage/timers.
// Consumed by engine.mjs (mechanics) and view.mjs (presentation).

/**
 * @typedef {'office'|'vault'|'crypt'} SetId
 * @typedef {'common'|'uncommon'|'rare'|'mythic'} Rarity
 * @typedef {'standard'|'foil'|'prismatic'} FinishId
 *
 * @typedef {'adjacent'|'row'|'diversity'|'completion'|'none'} EffectKind
 * @typedef {Object} CardEffect
 * @property {EffectKind} kind
 * @property {number} amount Additive income-bonus fraction (0.15 = +15%).
 * @property {string} [target] 'any', a SetId, or a role tag. Omitted for 'none'/'diversity'
 *   and for 'completion' effects that apply once per completed set.
 *
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} name
 * @property {SetId} set
 * @property {Rarity} rarity
 * @property {string} role Flavor/mechanical tag used as an effect `target`.
 * @property {number} baseIncome Cash earned per second at standard finish, before bonuses.
 * @property {number} sellValue Cash earned selling one standard-finish spare copy.
 * @property {CardEffect} effect
 * @property {string} description Human-readable explanation that matches `effect` exactly.
 *
 * @typedef {Object} GameSet
 * @property {SetId} id
 * @property {string} name
 * @property {string} subtitle
 * @property {string} color
 * @property {number} price Cash cost of a single pack.
 * @property {number} unlockAt Lifetime cash required to unlock buying this set's packs.
 *
 * @typedef {Object} Finish
 * @property {string} name
 * @property {number} multiplier Income multiplier applied before bonuses.
 * @property {number} sellMultiplier Sell-value multiplier.
 * @property {string} color
 *
 * @typedef {Object} RarityInfo
 * @property {string} name
 * @property {string} color
 * @property {number} rank 0 (common) through 3 (mythic).
 *
 * @typedef {'slots'|'lighting'|'luck'|'opener'} UpgradeId
 * @typedef {Object} Upgrade
 * @property {UpgradeId} id
 * @property {string} name
 * @property {string} description
 * @property {number} maxLevel
 * @property {number} baseCost
 * @property {number} costFactor Cost at level N is `baseCost * costFactor^N`.
 */

/** @type {GameSet[]} */
export const SETS = [
  {
    id: 'office',
    name: 'Goblin Office',
    subtitle: 'Entry-level grind, surprisingly unionized',
    color: '#b97a3d',
    price: 8,
    unlockAt: 0,
  },
  {
    id: 'vault',
    name: 'The Vault',
    subtitle: 'Dragons, gold, and questionable accounting',
    color: '#f2c94c',
    price: 45,
    unlockAt: 160,
  },
  {
    id: 'crypt',
    name: 'Neon Crypt',
    subtitle: 'Undead IT department, now hiring',
    color: '#8b5cf6',
    price: 180,
    unlockAt: 900,
  },
];

/** @type {Record<FinishId, Finish>} */
export const FINISHES = {
  standard: { name: 'Standard', multiplier: 1, sellMultiplier: 1, color: '#b8bcc4' },
  foil: { name: 'Foil', multiplier: 2.2, sellMultiplier: 3, color: '#7fd8e8' },
  prismatic: { name: 'Prismatic', multiplier: 6, sellMultiplier: 10, color: '#ffd166' },
};

/** @type {Record<Rarity, RarityInfo>} */
export const RARITIES = {
  common: { name: 'Common', color: '#9aa0a8', rank: 0 },
  uncommon: { name: 'Uncommon', color: '#59c977', rank: 1 },
  rare: { name: 'Rare', color: '#4da3ff', rank: 2 },
  mythic: { name: 'Mythic', color: '#c77dff', rank: 3 },
};

/**
 * Upgrade price progression. `slots` gates display-shelf growth so it stays
 * cheap and early; `lighting`/`luck` scale steadily across the midgame;
 * `opener` is a single costly one-time convenience unlock.
 * @type {Upgrade[]}
 */
export const UPGRADES = [
  {
    id: 'slots',
    name: 'Display Shelf',
    description: 'Unlock another display slot (up to 6 total). Each slot holds one card that earns passive income.',
    maxLevel: 3,
    baseCost: 40,
    costFactor: 3.2,
  },
  {
    id: 'lighting',
    name: 'Shelf Lighting',
    description: 'Better lighting flatters every displayed card: +25% income per level, stacking with all other bonuses.',
    maxLevel: 5,
    baseCost: 30,
    costFactor: 2.2,
  },
  {
    id: 'luck',
    name: 'Lucky Charm',
    description: 'Improves rare and finish odds in every pack you open. Commons stay common — this only thins them out, never removes them.',
    maxLevel: 5,
    baseCost: 50,
    costFactor: 2.0,
  },
  {
    id: 'opener',
    name: 'Auto-Opener',
    description: 'Unlocks the Auto toggle: it tears and reveals one card every 1.5s (0.35s with Fast Reveal on), buying another pack of your selected set whenever the queue empties. Auto switches itself off the moment it reveals a Mythic, a Prismatic, or a newly discovered Rare, so you never miss the moment.',
    maxLevel: 1,
    baseCost: 150,
    costFactor: 1,
  },
];

/**
 * All 24 cards. Per set: first 3 common, next 2 uncommon, next 2 rare, final mythic.
 * `effect` bonuses are additive income-fraction grants:
 *  - 'adjacent': this card grants `amount` to each immediately neighboring card
 *    (left/right display slot) whose set or role matches `target` ('any' matches all).
 *  - 'row': this card grants `amount` to every OTHER displayed card (anywhere on
 *    the shelf) whose set or role matches `target`.
 *  - 'diversity': this card itself gains `amount` for every OTHER set represented
 *    elsewhere on the shelf (no target; counts distinct sets, not cards).
 *  - 'completion': this card itself gains `amount` once a set is fully discovered.
 *    `target: 'any'` stacks per completed set (0-3x); a specific set id only pays
 *    out while that exact set is complete.
 *  - 'none': no bonus beyond base income, finish, and the automatic same-set
 *    neighbor bonus.
 * Every card also automatically grants +20% to an immediately adjacent card from
 * the same set (and receives +20% back from it) — this is not listed per-card.
 * A card's own set being fully discovered also grants it a flat +25% automatically,
 * on top of any 'completion' effect it has itself.
 * @type {Card[]}
 */
export const CARDS = [
  // ---------------------------------------------------------------- office --
  {
    id: 'clerk',
    name: 'Goblin Clerk',
    set: 'office',
    rarity: 'common',
    role: 'grunt',
    baseIncome: 0.5,
    sellValue: 0.25,
    effect: { kind: 'none', amount: 0 },
    description: 'Punches in, punches out, never complains. A steady earner with no bonuses and no drama.',
  },
  {
    id: 'runner',
    name: 'Errand Imp',
    set: 'office',
    rarity: 'common',
    role: 'grunt',
    baseIncome: 0.45,
    sellValue: 0.25,
    effect: { kind: 'adjacent', amount: 0.15, target: 'grunt' },
    description: "Sprints between desks hyping up the floor: adjacent Grunt cards earn +15% income.",
  },
  {
    id: 'accountant',
    name: 'Bean Counter',
    set: 'office',
    rarity: 'common',
    role: 'grunt',
    baseIncome: 0.5,
    sellValue: 0.35,
    effect: { kind: 'row', amount: 0.08, target: 'grunt' },
    description: 'Audits every ledger on the shelf: every other Grunt card anywhere earns +8% income.',
  },
  {
    id: 'janitor',
    name: 'Mop Goblin',
    set: 'office',
    rarity: 'uncommon',
    role: 'support',
    baseIncome: 0.9,
    sellValue: 0.65,
    effect: { kind: 'adjacent', amount: 0.12, target: 'any' },
    description: "Mops up next to whoever's working: adjacent cards of any kind earn +12% income.",
  },
  {
    id: 'manager',
    name: 'Shift Witch',
    set: 'office',
    rarity: 'uncommon',
    role: 'support',
    baseIncome: 1,
    sellValue: 0.75,
    effect: { kind: 'row', amount: 0.1, target: 'any' },
    description: "Runs the whole shift from her broomstick: every other card on the shelf earns +10% income.",
  },
  {
    id: 'printer',
    name: 'Paper Golem',
    set: 'office',
    rarity: 'rare',
    role: 'machine',
    baseIncome: 1.8,
    sellValue: 3,
    effect: { kind: 'diversity', amount: 0.1 },
    description: 'Thrives on cross-department paperwork: earns +10% income for every other Set represented on your shelf.',
  },
  {
    id: 'director',
    name: 'The Big Boss',
    set: 'office',
    rarity: 'rare',
    role: 'leadership',
    baseIncome: 2.2,
    sellValue: 4,
    effect: { kind: 'row', amount: 0.2, target: 'grunt' },
    description: 'Barks orders across the floor: every Grunt card anywhere earns +20% income.',
  },
  {
    id: 'founder',
    name: 'Founder of the Month',
    set: 'office',
    rarity: 'mythic',
    role: 'leadership',
    baseIncome: 4.5,
    sellValue: 14,
    effect: { kind: 'completion', amount: 0.15, target: 'any' },
    description: 'A framed photo radiating quiet pride: earns +15% income for every fully-collected Set (up to +45%).',
  },
  // ----------------------------------------------------------------- vault --
  {
    id: 'hatchling',
    name: 'Penny Drake',
    set: 'vault',
    rarity: 'common',
    role: 'treasure',
    baseIncome: 1.8,
    sellValue: 1.4,
    effect: { kind: 'none', amount: 0 },
    description: 'A tiny hoarder of loose change. Dependable, unremarkable, perfectly content.',
  },
  {
    id: 'mimic',
    name: 'Pocket Mimic',
    set: 'vault',
    rarity: 'common',
    role: 'treasure',
    baseIncome: 1.7,
    sellValue: 1.4,
    effect: { kind: 'adjacent', amount: 0.18, target: 'treasure' },
    description: 'Snuggles up to shinier neighbors: adjacent Treasure cards earn +18% income.',
  },
  {
    id: 'squire',
    name: 'Coin Squire',
    set: 'vault',
    rarity: 'common',
    role: 'guardian',
    baseIncome: 1.9,
    sellValue: 1.9,
    effect: { kind: 'adjacent', amount: 0.1, target: 'any' },
    description: "Stands watch for whoever's beside him: adjacent cards of any kind earn +10% income.",
  },
  {
    id: 'appraiser',
    name: 'Gem Appraiser',
    set: 'vault',
    rarity: 'uncommon',
    role: 'treasure',
    baseIncome: 3.2,
    sellValue: 3.6,
    effect: { kind: 'row', amount: 0.15, target: 'treasure' },
    description: 'Prices every coin on the shelf: every other Treasure card anywhere earns +15% income.',
  },
  {
    id: 'hoarder',
    name: 'Hoard Keeper',
    set: 'vault',
    rarity: 'uncommon',
    role: 'guardian',
    baseIncome: 3.6,
    sellValue: 4.2,
    effect: { kind: 'diversity', amount: 0.12 },
    description: 'Jealously compares hoards from other vaults: earns +12% income for every other Set represented on your shelf.',
  },
  {
    id: 'knight',
    name: 'Gilded Knight',
    set: 'vault',
    rarity: 'rare',
    role: 'guardian',
    baseIncome: 6,
    sellValue: 17,
    effect: { kind: 'row', amount: 0.2, target: 'guardian' },
    description: 'Rallies fellow guardians shelf-wide: every other Guardian card earns +20% income.',
  },
  {
    id: 'wyrm',
    name: 'Dividend Wyrm',
    set: 'vault',
    rarity: 'rare',
    role: 'dragon',
    baseIncome: 7.5,
    sellValue: 22,
    effect: { kind: 'row', amount: 0.22, target: 'treasure' },
    description: 'Pays dividends to the whole hoard: every Treasure card anywhere earns +22% income.',
  },
  {
    id: 'dragon',
    name: 'The Last Gold Dragon',
    set: 'vault',
    rarity: 'mythic',
    role: 'dragon',
    baseIncome: 16,
    sellValue: 80,
    effect: { kind: 'completion', amount: 0.5, target: 'vault' },
    description: 'The final dragon stirs once every coin in the Vault is found: +50% income while the Vault set is fully collected.',
  },
  // ----------------------------------------------------------------- crypt --
  {
    id: 'wisp',
    name: 'Static Wisp',
    set: 'crypt',
    rarity: 'common',
    role: 'signal',
    baseIncome: 5.5,
    sellValue: 5.5,
    effect: { kind: 'none', amount: 0 },
    description: 'Flickers quietly in the server racks. No tricks, just uptime.',
  },
  {
    id: 'skeleton',
    name: 'Night Shift Skeleton',
    set: 'crypt',
    rarity: 'common',
    role: 'undead',
    baseIncome: 5,
    sellValue: 5.5,
    effect: { kind: 'adjacent', amount: 0.2, target: 'undead' },
    description: 'Clocks in for the graveyard shift: adjacent Undead cards earn +20% income.',
  },
  {
    id: 'rat',
    name: 'Cable Rat',
    set: 'crypt',
    rarity: 'common',
    role: 'tech',
    baseIncome: 6,
    sellValue: 7.5,
    effect: { kind: 'adjacent', amount: 0.15, target: 'tech' },
    description: 'Chews through cable slack to speed up nearby machines: adjacent Tech cards earn +15% income.',
  },
  {
    id: 'medium',
    name: 'Hotline Medium',
    set: 'crypt',
    rarity: 'uncommon',
    role: 'signal',
    baseIncome: 10,
    sellValue: 14.5,
    effect: { kind: 'row', amount: 0.18, target: 'undead' },
    description: 'Keeps every undead line open shelf-wide: every Undead card anywhere earns +18% income.',
  },
  {
    id: 'hacker',
    name: 'Hex Hacker',
    set: 'crypt',
    rarity: 'uncommon',
    role: 'tech',
    baseIncome: 11.5,
    sellValue: 17,
    effect: { kind: 'row', amount: 0.2, target: 'tech' },
    description: 'Pushes a patch to every machine on the shelf: every other Tech card earns +20% income.',
  },
  {
    id: 'ghost',
    name: 'Ghost in the Machine',
    set: 'crypt',
    rarity: 'rare',
    role: 'undead',
    baseIncome: 19,
    sellValue: 68,
    effect: { kind: 'diversity', amount: 0.15 },
    description: 'Haunts whatever system is nearby: earns +15% income for every other Set represented on your shelf.',
  },
  {
    id: 'lich',
    name: 'Neon Lich',
    set: 'crypt',
    rarity: 'rare',
    role: 'undead',
    baseIncome: 23,
    sellValue: 90,
    effect: { kind: 'row', amount: 0.15, target: 'any' },
    description: 'Casts a shelf-wide curse of productivity: every other card earns +15% income.',
  },
  {
    id: 'oracle',
    name: 'Oracle Zero',
    set: 'crypt',
    rarity: 'mythic',
    role: 'signal',
    baseIncome: 50,
    sellValue: 320,
    effect: { kind: 'completion', amount: 0.2, target: 'any' },
    description: 'Sees every outcome across every vault: earns +20% income for every fully-collected Set (up to +60%).',
  },
];

/** @type {Record<string, Card>} */
export const CARD_BY_ID = Object.fromEntries(CARDS.map((card) => [card.id, card]));

/** @type {Record<SetId, GameSet>} */
export const SET_BY_ID = Object.fromEntries(SETS.map((set) => [set.id, set]));
