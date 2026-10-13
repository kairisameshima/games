'use strict';
/* =====================================================================
   WANDSMITH — shared game data (contract between game.js, art.js, cinema.js)
   Description markup: [c]chips/damage[/] [m]mult[/] [x]xmult[/] [o]orange[/] [g]gray[/] [p]purple[/] [$]money[/]
   ===================================================================== */

/* Wand parts. A wand is read left to right each turn:
   modifiers stack onto the next projectile; a projectile with `trigger` casts the next group on every hit.
   kind: 'proj' | 'mod' | 'special'
   proj fields: dmg (per hit, Lv1), hit: 'single' | 'aoe' | 'chain' | 'bounce' | 'rain', trigger: 0 | 1 | 2 (payload casts per hit)
   mod fields: add (flat dmg), mul (dmg multiplier), count (projectile multiplier), crit (chance), trig (makes projectile a trigger)
   col: main colour for icon/projectile; rarity 1 common, 2 uncommon, 3 rare */
const PARTS = {
  // projectiles
  spark: { n: 'Spark Bolt', kind: 'proj', dmg: 3, hit: 'single', rarity: 1, price: 3, col: '#ffe066', d: 'Fires a spark for [c]3[/] damage' },
  missile: { n: 'Magic Missile', kind: 'proj', dmg: 8, hit: 'single', rarity: 1, price: 4, col: '#b48cff', d: 'Fires a missile for [c]8[/] damage' },
  frost: { n: 'Frost Shard', kind: 'proj', dmg: 5, hit: 'single', rarity: 1, price: 4, col: '#8fe3ff', d: '[c]5[/] damage and [o]freezes[/] the target: the next group to hit it deals [x]X2[/]' },
  chain: { n: 'Chain Zap', kind: 'proj', dmg: 5, hit: 'chain', rarity: 1, price: 5, col: '#7ad7ff', d: '[c]5[/] damage that jumps between up to [o]3[/] enemies' },
  fireball: { n: 'Fireball', kind: 'proj', dmg: 10, hit: 'aoe', rarity: 2, price: 6, col: '#ff7a3a', d: 'Explodes for [c]10[/] damage on [o]every[/] enemy' },
  orb: { n: 'Bouncy Orb', kind: 'proj', dmg: 4, hit: 'bounce', rarity: 2, price: 5, col: '#7dff9a', d: '[c]4[/] damage, bounces to hit [o]twice[/] (each bounce counts as a hit)' },
  starfall: { n: 'Starfall', kind: 'proj', dmg: 3, hit: 'rain', rarity: 2, price: 6, col: '#fff3a8', d: 'Rains [o]5[/] stars for [c]3[/] damage each' },
  coin: { n: 'Coin Toss', kind: 'proj', dmg: 2, hit: 'single', rarity: 1, price: 3, col: '#f3c24a', gold: 1, d: '[c]2[/] damage. Earns [$]$1[/] per 5 hits (max $5 per fight)' },
  trigger: { n: 'Trigger Bolt', kind: 'proj', dmg: 2, hit: 'single', trigger: 1, rarity: 1, price: 5, col: '#ff5fd2', d: '[c]2[/] damage. [p]On every hit[/], casts the next group' },
  twintrigger: { n: 'Twin Trigger', kind: 'proj', dmg: 1, hit: 'single', trigger: 2, rarity: 3, price: 9, col: '#ff3fa8', d: '[c]1[/] damage. [p]On every hit[/], casts the next group [o]twice[/]' },
  bomb: { n: 'Pumpkin Bomb', kind: 'proj', dmg: 30, hit: 'aoe', rarity: 3, price: 9, col: '#ff9a1f', d: 'Explodes for [c]30[/] damage on [o]every[/] enemy' },
  // modifiers
  power: { n: 'Power Gem', kind: 'mod', add: 4, rarity: 1, price: 3, col: '#ff4f6a', d: '[c]+4[/] damage to the next projectile' },
  amp: { n: 'Amplifier', kind: 'mod', mul: 2, rarity: 2, price: 6, col: '#ff3f3f', d: '[x]X2[/] damage to the next projectile' },
  split: { n: 'Splitter', kind: 'mod', count: 2, rarity: 1, price: 4, col: '#4fd1a1', d: 'The next projectile splits into [o]2[/]' },
  prism: { n: 'Prism', kind: 'mod', count: 3, mul: 0.6, rarity: 2, price: 6, col: '#c8a8ff', d: 'The next projectile splits into [o]3[/] at [x]X0.6[/] damage' },
  crit: { n: 'Crit Lens', kind: 'mod', crit: 0.25, rarity: 1, price: 4, col: '#ffd84a', d: '[g]25%[/] chance the next projectile [x]crits for X4[/]' },
  lead: { n: 'Lead Core', kind: 'mod', mul: 3, rarity: 3, price: 9, col: '#8a96a8', d: '[x]X3[/] damage to the next projectile' },
  rune: { n: 'Trigger Rune', kind: 'mod', trig: 1, rarity: 2, price: 7, col: '#e05fff', d: 'The next projectile [p]casts the group after it on every hit[/]' },
  // specials (stand alone in a slot)
  echo: { n: 'Echo Rune', kind: 'special', rarity: 2, price: 7, col: '#5fb8ff', d: 'Casts the [o]previous group again[/]' },
};
const PART_KEYS = Object.keys(PARTS);

/* Charms: passive effects (the joker equivalent). Effects are implemented in game.js by key. */
const CHARMS = {
  pyro: { n: 'Pyromaniac', rarity: 1, price: 5, col: '#ff7a3a', d: 'Fireballs and Pumpkin Bombs deal [x]X3[/]' },
  sparky: { n: 'Spark Collector', rarity: 1, price: 5, col: '#ffe066', d: 'Every projectile gets [c]+2[/] damage per Spark Bolt in the wand' },
  nesting: { n: 'Nesting Doll', rarity: 2, price: 7, col: '#ff8fb8', d: 'Triggered spells deal [x]X2[/] per layer of nesting' },
  rubber: { n: 'Rubber Band', rarity: 3, price: 9, col: '#ff5fd2', d: 'Triggers cast their payload [o]one extra time[/]' },
  overkill: { n: 'Overkill', rarity: 2, price: 6, col: '#ff4f4f', d: 'Excess damage [o]carries over[/] to the next enemy' },
  glass: { n: 'Glass Cannon', rarity: 2, price: 6, col: '#bff6ff', d: '[x]X3[/] damage, but you have [r]1 fewer max heart[/]' },
  ledger: { n: 'Mafia Ledger', rarity: 1, price: 5, col: '#c8a060', d: 'Interest cap is [$]$10[/] instead of $5' },
  tape: { n: 'Duct Tape', rarity: 1, price: 6, col: '#b8c0c8', d: '[o]+1[/] wand slot' },
  wind: { n: 'Second Wind', rarity: 2, price: 7, col: '#9affd8', d: '[o]+1[/] turn every fight' },
  cat: { n: 'Lucky Cat', rarity: 1, price: 5, col: '#ffd84a', d: '[g]+20%[/] crit chance on every projectile' },
  combo: { n: 'Combo Counter', rarity: 2, price: 7, col: '#ff9a00', d: 'Each hit this turn adds [m]+2%[/] damage to every later hit' },
  snowball: { n: 'Snowball', rarity: 2, price: 7, col: '#dff4ff', d: '[x]X1.5[/] damage for each turn already taken this fight' },
  glove: { n: "Thief's Glove", rarity: 1, price: 4, col: '#6a5acd', d: 'Earn [$]$1[/] per enemy defeated' },
  mirror: { n: 'Hand Mirror', rarity: 3, price: 10, col: '#e0e8ff', d: 'Your [o]first group[/] is cast twice' },
  patchwork: { n: 'Patchwork', rarity: 2, price: 6, col: '#c8a8ff', d: '[x]X1.2[/] damage per different part in the wand' },
  grudge: { n: 'Old Grudge', rarity: 1, price: 5, col: '#a83a3a', d: '[x]X2[/] damage against bosses' },
  scrapper: { n: 'Scrapper', rarity: 1, price: 4, col: '#c88a4a', d: 'Sell parts and charms for their [o]full[/] price' },
  splitter2: { n: 'Kaleidoscope', rarity: 3, price: 9, col: '#7affd8', d: 'Splitters and Prisms add [o]+1[/] more projectile' },
  overclock: { n: 'Overclock', rarity: 3, price: 10, col: '#ff3f3f', d: 'On the first turn of a fight, the wand fires [o]twice[/]' },
  piggy: { n: 'Piggy Bank', rarity: 1, price: 4, col: '#ffb0c8', d: '[$]+$1[/] for every turn left unused when you win' },
};
const CHARM_KEYS = Object.keys(CHARMS);

/* Wand frames: the body your parts are wired into. slots = starting slot count. */
const FRAMES = {
  twig: { n: 'Splintered Twig', slots: 4, price: 0, col: '#8a5a3a', d: 'What survived the smashing. Held together with string.' },
  broom: { n: 'Broom Handle', slots: 6, price: 8, col: '#c89a5a', d: '[o]6[/] slots. Sturdy and humble.' },
  bone: { n: 'Bone Wand', slots: 5, price: 9, col: '#efe6d0', d: '[o]5[/] slots. Triggered spells deal [x]X1.5[/]' },
  crystal: { n: 'Crystal Rod', slots: 4, price: 10, col: '#9af0ff', d: '[o]4[/] slots. All damage [x]X2[/]' },
  staff: { n: 'Grand Staff', slots: 8, price: 14, col: '#7a5ad8', d: '[o]8[/] slots. A real wizard staff, patched up.' },
};
const FRAME_KEYS = Object.keys(FRAMES);
const MAX_SLOTS = 12;

/* Regular enemies (the mafia's goons). hpMul scales the fight's HP budget; anim hints for art. */
const ENEMIES = {
  rat: { n: 'Rat Thug', hpMul: 0.8, col: '#8a8a9a', d: 'Small, mean, carries a tiny club.' },
  toad: { n: 'Toad Bouncer', hpMul: 1.4, col: '#5a9a4a', d: 'Big belly. Guards doors.' },
  hound: { n: 'Hex Hound', hpMul: 1.0, col: '#6a4a8a', d: 'A dog with glowing hex runes.' },
  shark: { n: 'Card Shark', hpMul: 1.1, col: '#5a7aa8', d: 'A little shark in a pinstripe vest, shuffling cards.' },
  mask: { n: 'Masked Hexer', hpMul: 1.0, col: '#3a3a5a', d: 'Hooded goon with a white mask and a cheap wand.' },
  golem: { n: 'Brick Golem', hpMul: 1.8, col: '#a86a4a', d: 'Bodyguard made of bricks.' },
  cat: { n: 'Shadow Cat', hpMul: 0.9, col: '#2a2a3a', d: 'Black cat burglar with a fedora.' },
  crow: { n: 'Crow Lookout', hpMul: 0.7, col: '#2a2a4a', d: 'Crow in a trench coat with binoculars.' },
};
const ENEMY_KEYS = Object.keys(ENEMIES);

/* The crime ladder: 8 rungs. Each rung = 2 goon fights then the boss.
   loc: background key for art; goons: which enemies appear there. */
const RUNGS = [
  { loc: 'alley', n: 'Mudwick Alley', goons: ['rat', 'crow', 'cat'], boss: 'pip' },
  { loc: 'docks', n: 'Foggy Docks', goons: ['rat', 'shark', 'crow'], boss: 'twins' },
  { loc: 'casino', n: 'Lucky Hex Casino', goons: ['shark', 'cat', 'mask'], boss: 'fin' },
  { loc: 'sewers', n: 'The Sewers', goons: ['rat', 'toad', 'hound'], boss: 'bruno' },
  { loc: 'vault', n: 'Gnome Bank Vault', goons: ['golem', 'mask', 'toad'], boss: 'lou' },
  { loc: 'opera', n: 'Moonlit Opera', goons: ['cat', 'mask', 'hound'], boss: 'velvet' },
  { loc: 'mansion', n: 'Gloom Manor', goons: ['golem', 'hound', 'mask'], boss: 'grimsby' },
  { loc: 'tower', n: 'Kingpin Tower', goons: ['golem', 'shark', 'toad', 'hound'], boss: 'don' },
];

/* Bosses. rule = the fight's special rule (implemented in game.js by key).
   `intro` lines are spoken before the fight (cinema.js), `defeat` after you win. */
const BOSSES = {
  pip: { n: 'Pip the Pickpocket', title: 'Street Runner', col: '#c86a3a', rule: 'Sticky Fingers: steals your rightmost part for the whole fight',
    intro: ["Oi! That's a nice little twig you got there.", "Shame if someone... borrowed it."], defeat: "Ow ow ow! Fine! The twins run the docks, go bother THEM!" },
  twins: { n: 'Hex & Vex', title: 'The Dock Twins', col: '#4a8ac8', rule: 'Twin Bond: each twin takes half damage while the other stands', parts: ['hex', 'vex'],
    intro: ["Hex: The wandsmith! Back from the scrap heap!", "Vex: We sold your best wands for a song. Literally. To a bard."], defeat: "Hex & Vex: Madame Fin will eat you alive! ...Financially!" },
  fin: { n: 'Madame Fin', title: 'The Loan Shark', col: '#5a8ab8', rule: 'Compound Interest: her health grows 25% every turn',
    intro: ["Darling. Your debt has been accruing interest.", "And so have I."], defeat: "Bruno... Bruno will collect. He always collects." },
  bruno: { n: "Bruno 'Big Toad'", title: 'The Enforcer', col: '#4a8a3a', rule: 'Thick Skin: ignores every hit under 50 damage',
    intro: ["*CROAK*", "Boss says you gotta be... flattened."], defeat: "*sad croak* Lou does the books. Lou knows where the money went." },
  lou: { n: 'Ledger Lou', title: 'The Accountant', col: '#c8a060', rule: 'Audit: your first 3 slots are frozen and do not fire',
    intro: ["According to my ledger, you owe us four thousand gold.", "Plus a smashing fee. Itemized."], defeat: "The numbers... don't add up... Velvet will hear of this." },
  velvet: { n: 'Velvet', title: 'The Consigliere', col: '#8a4ac8', rule: 'Hush: your charms are silenced',
    intro: ["Hoo. The little shopkeeper climbs so high.", "Let us see you fight without your trinkets."], defeat: "Hoo... Grimsby will not be so gentle." },
  grimsby: { n: 'Grimsby Gloom', title: 'The Underboss', col: '#3a3a6a', rule: 'Gloom Ward: blocks the first 30 hits every turn',
    intro: ["You broke Lou's abacus. He loved that abacus.", "Turn back, wandsmith. The Don is not merciful."], defeat: "Go then. Climb the tower. He's waiting." },
  don: { n: 'Don Grimoire', title: 'The Kingpin', col: '#c83a5a', rule: 'Kingpin: three phases, each with a past boss rule',
    intro: ["So. The wandsmith.", "I smashed your shop because you were late.", "Now you are early... for your funeral."], defeat: "My... my grimoire... You win, wandsmith. Take back your wands." },
};
const BOSS_KEYS = Object.keys(BOSSES);
/* Don Grimoire cycles through these past-boss rules, one per phase. */
const DON_PHASES = ['fin', 'bruno', 'grimsby'];

const RARITY = { 0: ['Basic', '#5b6b6e'], 1: ['Common', '#009dff'], 2: ['Uncommon', '#4bc292'], 3: ['Rare', '#fe5f55'] };
