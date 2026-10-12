'use strict';
/* Placeable parts. kind: solid (bounces) | sensor (pass-through) | spinner (rotating bar).
   rarity 0 = never offered in the shop. Every part has a level (1..MAX_LVL): dropping a part
   onto another part of the same type merges them and adds their levels. `v(L)` is the
   level-scaled stat the hit logic reads; `d(L)` renders the description at that level. */
const MAX_LVL = 5;
const PARTS = {
  peg: { n: 'Peg', r: 6, kind: 'solid', rarity: 0, price: 1, col: '#e8eef0', v: L => L, d: L => `[c]+${L}[/] value per hit` },
  silver: { n: 'Silver Peg', r: 7, kind: 'solid', rarity: 1, price: 3, col: '#b9c9dc', v: L => 5 * L, d: L => `[c]+${5 * L}[/] value per hit` },
  gold: { n: 'Gold Peg', r: 7, kind: 'solid', rarity: 1, price: 4, col: '#f3b958', v: L => 2 * L, d: L => `[c]+${2 * L}[/] value and earn [$]$1[/] per hit [g](max $${8 * L} per round)[/]` },
  lucky: { n: 'Lucky Peg', r: 7, kind: 'solid', rarity: 1, price: 5, col: '#4bc292', v: L => 3 + 2 * L, d: L => `[g]1 in 5[/] chance for [x]X${3 + 2 * L}[/] value, otherwise [c]+${2 * L}[/]` },
  spinner: { n: 'Spinner', r: 5, len: 30, kind: 'spinner', rarity: 1, price: 5, col: '#ffd23a', v: L => 4 * L, d: L => `A spinning bar that bats balls around. [c]+${4 * L}[/] value per hit` },
  pad: { n: 'Launch Pad', r: 13, kind: 'sensor', rarity: 1, price: 4, col: '#9aff5a', v: L => 5 * L, d: L => `Launches balls back up with [c]+${5 * L}[/] value [g](twice per ball)[/]` },
  bumper: { n: 'Bumper', r: 17, kind: 'solid', rarity: 1, price: 4, col: '#009dff', kick: 560, v: L => 12 * L, d: L => `Kicks balls away hard. [c]+${12 * L}[/] value` },
  fountain: { n: 'Fountain', r: 11, kind: 'solid', rarity: 1, price: 6, col: '#5fd3ff', v: L => 2 + L, d: L => `On hit, spawns [o]${2 + L}[/] fresh balls at the top [g](2.5s recharge)[/]` },
  x2: { n: 'X2 Bumper', r: 17, kind: 'solid', rarity: 2, price: 8, col: '#fe5f55', kick: 520, v: L => 1 + L, d: L => `[x]X${1 + L}[/] value. Up to [o]3[/] times per ball` },
  ring: { n: 'Booster Ring', r: 22, kind: 'sensor', rarity: 2, price: 6, col: '#ff9a00', v: L => 1 + L, d: L => `Balls passing through get [x]X${1 + L}[/] value [g](once per ball)[/]` },
  splitter: { n: 'Splitter', r: 11, kind: 'solid', rarity: 2, price: 7, col: '#4bc292', v: L => L, d: L => `Splits the ball into [o]${1 + L}[/] balls with the same value [g](once per ball)[/]` },
  cloner: { n: 'Cloner', r: 11, kind: 'solid', rarity: 2, price: 8, col: '#a98cff', v: L => L, d: L => `Sends [o]${L}[/] clone${L > 1 ? 's' : ''} of the ball back to the top [g](once per ball)[/]` },
  bomb: { n: 'Bomb Peg', r: 10, kind: 'solid', rarity: 2, price: 6, col: '#e5304a', v: L => 30 * L, d: L => `Explodes on hit: blasts nearby balls and gives each [c]+${30 * L}[/] value [g](3s recharge)[/]` },
  warp: { n: 'Warp Gate', r: 18, kind: 'sensor', rarity: 2, price: 6, col: '#7a5cff', v: L => 15 * L, d: L => `Teleports the ball back to the top with [c]+${15 * L}[/] value [g](once per ball)[/]` },
  x3: { n: 'X3 Bumper', r: 17, kind: 'solid', rarity: 3, price: 14, col: '#c46aff', kick: 520, v: L => 2 + L, d: L => `[x]X${2 + L}[/] value. Up to [o]3[/] times per ball` },
  mega: { n: 'Mega Orb', r: 13, kind: 'solid', rarity: 3, price: 12, col: '#ff4fd8', v: L => 3 + 2 * L, d: L => `Turns the ball into a [p]MEGA BALL[/]: [x]X${3 + 2 * L}[/] value, double size` },
  prism: { n: 'Prism', r: 19, kind: 'sensor', rarity: 3, price: 15, col: '#7ff0ff', v: L => 1 + 0.5 * L, d: L => `Splits the ball into [o]3[/] balls, each with [x]X${1 + 0.5 * L}[/] value [g](once per ball)[/]` },
};
const PART_KEYS = Object.keys(PARTS);

/* Cups. Each cup slot has a base multiplier; the cup type multiplies it by m(L). */
const BASE_CUP_MULTS = [5, 2, 1.2, 0.8, 0.5, 0.8, 1.2, 2, 5];
const CUPS = {
  cup: { n: 'Cup', rarity: 0, price: 0, col: '#3a4d50', m: () => 1, d: () => 'Scores ball value × cup multiplier' },
  double: { n: 'Double Cup', rarity: 1, price: 5, col: '#2a7bd6', m: L => 1 + L, d: L => `Cup multiplier [x]X${1 + L}[/]` },
  piggy: { n: 'Piggy Cup', rarity: 1, price: 5, col: '#f3b958', m: () => 1, d: L => `Scores, and earns [$]$1[/] per ball [g](max $${6 * L} per round)[/]` },
  jackpot: { n: 'Jackpot Cup', rarity: 2, price: 12, col: '#e0892a', m: L => 2 + 3 * L, d: L => `Cup multiplier [x]X${2 + 3 * L}[/]` },
  recycler: { n: 'Recycler', rarity: 2, price: 9, col: '#4bc292', m: () => 1, d: L => `Scores, then relaunches the ball from the top with [x]X${1 + L}[/] value [g](twice per ball)[/]` },
  hydra: { n: 'Hydra Cup', rarity: 3, price: 12, col: '#c46aff', m: () => 1, d: L => `Scores, then relaunches the ball as [o]${1 + L}[/] balls [g](once per ball)[/]` },
  megajack: { n: 'Mega Jackpot', rarity: 3, price: 22, col: '#ff4fd8', m: L => 6 + 6 * L, d: L => `Cup multiplier [x]X${6 + 6 * L}[/]` },
};
const CUP_KEYS = Object.keys(CUPS);

/* Relics: passive run modifiers. */
const RELICS = {
  extraBalls: { n: 'Ball Pit', a: '🎱', price: 6, d: '[o]+3[/] balls every round' },
  heavy: { n: 'Lead Core', a: '🧲', price: 5, d: 'Balls start with [c]+5[/] value' },
  inflation: { n: 'Peg Inflation', a: '🎈', price: 6, d: 'Basic pegs give [c]+2[/] more value' },
  mitosis: { n: 'Mitosis', a: '🧫', price: 8, d: 'Splitters split into [o]3[/] balls instead of 2' },
  megaEvery: { n: 'Mega Loader', a: '💣', price: 10, d: 'Every [o]6th[/] ball launched is a [p]MEGA BALL[/]' },
  goldRush: { n: 'Gold Rush', a: '⛏️', price: 5, d: 'Gold pegs earn [$]$2[/] and their cap is doubled' },
  luckySeven: { n: 'Lucky Seven', a: '🍀', price: 7, d: 'Lucky pegs trigger [g]1 in 2[/]' },
  bank: { n: 'Compound Bank', a: '🏦', price: 5, d: 'Interest cap [$]+$5[/]' },
  edgeLord: { n: 'Edge Lord', a: '🗡️', price: 6, d: 'The two edge cups score [x]X3[/]' },
  ricochet: { n: 'Ricochet', a: '🏓', price: 4, d: 'Walls give [c]+5[/] value per hit' },
  overclock: { n: 'Overclock', a: '⚡', price: 10, d: 'Mult bumpers give [x]+X1[/] more' },
  floaty: { n: 'Low Gravity', a: '🪶', price: 6, d: 'Gravity [o]-30%[/]: more bounces, more hits' },
  cloneArmy: { n: 'Clone Army', a: '👯', price: 8, d: 'Cloners send [o]2[/] clones' },
  wizard: { n: 'Pinball Wizard', a: '🧙', price: 8, d: 'Balls with [o]25+[/] hits score [x]X3[/] when caught' },
  compound: { n: 'Compounding', a: '📈', price: 9, d: 'Every [o]10th[/] hit gives a ball [x]X1.25[/] value' },
  rainbow: { n: 'Rainbow Lens', a: '🌈', price: 8, d: 'Booster Rings give [x]X3[/] and Prisms give [x]X2[/] per ball' },
  demolition: { n: 'Demolition', a: '🧨', price: 6, d: 'Bombs recharge [o]3x[/] faster and give [c]+100[/]' },
  geyser: { n: 'Geyser', a: '⛲', price: 7, d: 'Fountains spawn [o]5[/] balls' },
  magnet: { n: 'Cup Magnet', a: '🧿', price: 7, d: 'Balls drift toward the [o]highest[/] cup below them' },
  piggyBank: { n: 'Golden Goose', a: '🪿', price: 7, d: 'Earn [$]$1[/] for every [o]10[/] balls caught [g](max $10)[/]' },
};
const RELIC_KEYS = Object.keys(RELICS);

/* Boss rounds: every 3rd round. */
const BOSSES = [
  { k: 'gale', n: 'The Gale', a: '🌬️', col: '#4a90a8', d: 'A strong wind pushes balls sideways' },
  { k: 'anvil', n: 'The Anvil', a: '⚓', col: '#6b6b7a', d: 'Gravity +60%' },
  { k: 'rust', n: 'The Rust', a: '🦀', col: '#a8582a', d: 'Basic pegs give no value', harsh: true },
  { k: 'miser', n: 'The Miser', a: '🪙', col: '#9a8a2a', d: 'All cups score half', harsh: true },
  { k: 'drought', n: 'The Drought', a: '🏜️', col: '#c08a4a', d: '4 fewer balls this round', harsh: true },
  { k: 'void', n: 'The Void', a: '🕳️', col: '#3a2a6a', d: 'A black hole in the middle eats balls', harsh: true },
  { k: 'damp', n: 'The Dampener', a: '🧽', col: '#5a7a8a', d: 'All X multipliers are halved' },
  { k: 'mud', n: 'The Mud', a: '🟫', col: '#6a4a2a', d: 'Balls are sluggish and bounce less' },
];
