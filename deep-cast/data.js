'use strict';
/* =====================================================================
   DEEP CAST — shared game data (contract between game.js and sprites.js)
   World units are LOW-RES PIXELS (the ocean is rendered at 1/3 resolution
   and scaled up 3x with nearest-neighbour for the pixel look).
   ===================================================================== */

/* Depth zones. `h` is the zone's height in world (low-res) pixels; meters map
   linearly inside each zone. `water` = [top, bottom] tint, `dark` = 0..1 darkness. */
const ZONES = [
  { k: 'sunlit', n: 'Sunlit Shallows', from: 0, to: 200, h: 230, water: ['#3fb8d8', '#1d86b0'], dark: 0, bonus: 1 },
  { k: 'twilight', n: 'Twilight Zone', from: 200, to: 1000, h: 230, water: ['#1d78a6', '#123f6a'], dark: 0.35, bonus: 2 },
  { k: 'midnight', n: 'Midnight Zone', from: 1000, to: 4000, h: 230, water: ['#0f2d58', '#081a36'], dark: 0.72, bonus: 3 },
  { k: 'abyss', n: 'The Abyss', from: 4000, to: 6000, h: 230, water: ['#0a1430', '#050b1c'], dark: 0.86, bonus: 4 },
  { k: 'hadal', n: 'Hadal Trench', from: 6000, to: 11000, h: 230, water: ['#070a1c', '#030510'], dark: 0.92, bonus: 6 },
  { k: 'below', n: 'The Below', from: 11000, to: 13000, h: 230, water: ['#170624', '#07020e'], dark: 0.95, bonus: 8 },
];

/* Fish species.
   shape: one of 'fish' | 'round' | 'flat' | 'pike' | 'sword' | 'long' | 'puffer' | 'angler' | 'viper'
          | 'gulper' | 'squid' | 'jelly' | 'shark' | 'ray' | 'octopus' | 'barreleye' | 'swallower'
          | 'snail' | 'shrimp' | 'eye'
   pattern (optional): 'stripes' (horizontal), 'bands' (vertical), 'spots'
   size: body length in low-res px (sprites may add fins/tail around it)
   value: base chips; weight: kg (line tension); rarity: spawn weight within its zone
   glow: bioluminescence color or null; pred: predator (can eat smaller hooked fish)
   school: arrives in groups; speed: swim speed in low-res px/s */
const SPECIES = {
  // Sunlit Shallows
  sardine: { n: 'Sardine', zone: 0, shape: 'fish', size: 6, value: 2, weight: 0.2, rarity: 10, school: true, speed: 26, body: '#9fc4d8', belly: '#e8f4f8', fin: '#6a9ab4', glow: null },
  mackerel: { n: 'Mackerel', zone: 0, shape: 'fish', pattern: 'stripes', size: 9, value: 4, weight: 1, rarity: 7, school: true, speed: 24, body: '#2f7488', belly: '#d8e8e0', fin: '#1f5060', glow: null },
  clownfish: { n: 'Clownfish', zone: 0, shape: 'round', pattern: 'bands', size: 7, value: 6, weight: 0.3, rarity: 5, speed: 14, body: '#ff8a2a', belly: '#ffb060', fin: '#1a1a1a', glow: null },
  snapper: { n: 'Red Snapper', zone: 0, shape: 'round', size: 12, value: 8, weight: 3, rarity: 5, speed: 16, body: '#e2483c', belly: '#ffb0a0', fin: '#b0302a', glow: null },
  puffer: { n: 'Pufferfish', zone: 0, shape: 'puffer', pattern: 'spots', size: 9, value: 10, weight: 1, rarity: 3, speed: 9, body: '#e8c860', belly: '#fff2c0', fin: '#a08a30', glow: null },
  mahimahi: { n: 'Mahi-mahi', zone: 0, shape: 'fish', size: 16, value: 14, weight: 8, rarity: 3, speed: 22, body: '#3cc87a', belly: '#f0e040', fin: '#2a8ad8', glow: null },
  barracuda: { n: 'Barracuda', zone: 0, shape: 'pike', size: 18, value: 12, weight: 6, rarity: 3, pred: true, speed: 28, body: '#a8b8c0', belly: '#e0e8ec', fin: '#5a6a72', glow: null },
  tuna: { n: 'Bluefin Tuna', zone: 0, shape: 'fish', size: 22, value: 25, weight: 30, rarity: 1.5, speed: 30, body: '#2c4c78', belly: '#c8d8e8', fin: '#e8c040', glow: null },
  // Twilight Zone
  lanternfish: { n: 'Lanternfish', zone: 1, shape: 'fish', pattern: 'spots', size: 6, value: 8, weight: 0.1, rarity: 9, school: true, speed: 22, body: '#3a4a6a', belly: '#8a9ab8', fin: '#2a3450', glow: '#6af0ff' },
  hatchetfish: { n: 'Hatchetfish', zone: 1, shape: 'flat', size: 7, value: 10, weight: 0.2, rarity: 8, school: true, speed: 16, body: '#c8d0e0', belly: '#eef2fa', fin: '#8a94a8', glow: '#b0f0ff' },
  glowsquid: { n: 'Glow Squid', zone: 1, shape: 'squid', size: 9, value: 14, weight: 0.5, rarity: 6, speed: 18, body: '#6a8ad8', belly: '#a8c0ff', fin: '#4a6ab8', glow: '#4fa8ff' },
  ribboneel: { n: 'Ribbon Eel', zone: 1, shape: 'long', size: 26, value: 20, weight: 2, rarity: 4, speed: 12, body: '#5a7ad8', belly: '#f0d040', fin: '#3a5ab8', glow: null },
  opah: { n: 'Opah', zone: 1, shape: 'round', pattern: 'spots', size: 18, value: 35, weight: 25, rarity: 2, speed: 14, body: '#c84a5a', belly: '#e8a0a8', fin: '#ff3a3a', glow: null },
  swordfish: { n: 'Swordfish', zone: 1, shape: 'sword', size: 26, value: 45, weight: 40, rarity: 1.5, pred: true, speed: 34, body: '#3a4a6a', belly: '#a0b0c8', fin: '#2a3450', glow: null },
  // Midnight Zone
  fireflysquid: { n: 'Firefly Squid', zone: 2, shape: 'squid', pattern: 'spots', size: 7, value: 25, weight: 0.2, rarity: 8, school: true, speed: 20, body: '#2a3a7a', belly: '#4a6ab8', fin: '#1a2a5a', glow: '#3fd0ff' },
  viperfish: { n: 'Viperfish', zone: 2, shape: 'viper', size: 14, value: 45, weight: 1, rarity: 5, pred: true, speed: 20, body: '#2a3a4a', belly: '#4a5a6a', fin: '#1a2430', glow: '#6affc8' },
  anglerfish: { n: 'Anglerfish', zone: 2, shape: 'angler', size: 16, value: 70, weight: 6, rarity: 4, pred: true, speed: 8, body: '#3a2a2a', belly: '#5a4040', fin: '#2a1a1a', glow: '#fff27a' },
  vampiresquid: { n: 'Vampire Squid', zone: 2, shape: 'squid', size: 14, value: 60, weight: 3, rarity: 4, speed: 12, body: '#8a1a2a', belly: '#b03a4a', fin: '#5a0a1a', glow: '#ff5a8a' },
  gulpereel: { n: 'Gulper Eel', zone: 2, shape: 'gulper', size: 30, value: 80, weight: 5, rarity: 3, pred: true, speed: 14, body: '#1a1a2a', belly: '#2a2a3a', fin: '#101018', glow: '#ff7ad8' },
  oarfish: { n: 'Oarfish', zone: 2, shape: 'long', size: 60, value: 160, weight: 50, rarity: 1, speed: 10, body: '#c8ccd8', belly: '#e8ecf4', fin: '#ff4a4a', glow: null },
  // The Abyss
  abyssjelly: { n: 'Abyssal Jelly', zone: 3, shape: 'jelly', size: 12, value: 90, weight: 0.5, rarity: 8, school: true, speed: 6, body: '#7a3ac8', belly: '#c8a0ff', fin: '#5a2a9a', glow: '#c87aff' },
  barreleye: { n: 'Barreleye', zone: 3, shape: 'barreleye', size: 12, value: 120, weight: 2, rarity: 5, speed: 10, body: '#3a4a5a', belly: '#6a7a8a', fin: '#2a3440', glow: '#7affb0' },
  dumbo: { n: 'Dumbo Octopus', zone: 3, shape: 'octopus', size: 14, value: 150, weight: 4, rarity: 4, speed: 8, body: '#ffb0a0', belly: '#ffd8d0', fin: '#e08a7a', glow: null },
  blackswallower: { n: 'Black Swallower', zone: 3, shape: 'swallower', size: 16, value: 180, weight: 6, rarity: 3, pred: true, speed: 12, body: '#101018', belly: '#2a2a38', fin: '#08080c', glow: '#9a7aff' },
  frilledshark: { n: 'Frilled Shark', zone: 3, shape: 'shark', size: 34, value: 300, weight: 60, rarity: 1.5, pred: true, speed: 16, body: '#4a4038', belly: '#6a6058', fin: '#3a3028', glow: null },
  // Hadal Trench
  snailfish: { n: 'Hadal Snailfish', zone: 4, shape: 'snail', size: 12, value: 260, weight: 1, rarity: 8, school: true, speed: 8, body: '#f0d8e8', belly: '#fff0f8', fin: '#d8b8c8', glow: '#ffe0f0' },
  amphipod: { n: 'Giant Amphipod', zone: 4, shape: 'shrimp', size: 8, value: 200, weight: 0.3, rarity: 7, school: true, speed: 12, body: '#f8f0e0', belly: '#ffffff', fin: '#d8c8a8', glow: null },
  glasssquid: { n: 'Glass Squid', zone: 4, shape: 'squid', size: 14, value: 380, weight: 1, rarity: 5, speed: 10, body: '#a8e8f0', belly: '#e0ffff', fin: '#78c8d8', glow: '#a0ffff' },
  ghostshark: { n: 'Ghost Shark', zone: 4, shape: 'shark', size: 26, value: 600, weight: 20, rarity: 3, pred: true, speed: 14, body: '#8a90a8', belly: '#c8ccd8', fin: '#5a6078', glow: '#c8e8ff' },
  cuskeel: { n: 'Cusk Eel', zone: 4, shape: 'long', size: 30, value: 800, weight: 15, rarity: 2, speed: 10, body: '#d8c8b8', belly: '#f0e8e0', fin: '#a89888', glow: null },
  // The Below (mythic)
  starfry: { n: 'Starfry', zone: 5, shape: 'fish', pattern: 'spots', size: 7, value: 900, weight: 0.5, rarity: 8, school: true, speed: 20, body: '#2a1a4a', belly: '#4a3a7a', fin: '#1a0a3a', glow: '#fff6a0' },
  voidray: { n: 'Void Ray', zone: 5, shape: 'ray', size: 30, value: 2500, weight: 30, rarity: 4, speed: 12, body: '#1a0a2a', belly: '#3a1a5a', fin: '#0a0418', glow: '#b46aff' },
  eldritcheel: { n: 'Eldritch Eel', zone: 5, shape: 'long', pattern: 'spots', size: 50, value: 4000, weight: 40, rarity: 3, pred: true, speed: 14, body: '#0a1a12', belly: '#1a3a2a', fin: '#04100a', glow: '#6aff9a' },
  eyeofdeep: { n: 'Eye of the Deep', zone: 5, shape: 'eye', size: 20, value: 6000, weight: 25, rarity: 2, speed: 6, body: '#2a0a12', belly: '#4a1a24', fin: '#1a0408', glow: '#ff4a4a' },
};
const SPECIES_KEYS = Object.keys(SPECIES);

/* Legendary goliaths: one per zone, fought on the third day of that zone.
   hooks = hooks that must hang inside its zone to hold it; weight = line strength needed.
   hp > 1 means it must be held on several casts before it is landed. size = sprite length (low-res px). */
const LEGENDS = [
  { k: 'isonade', n: 'Isonade', zone: 0, hooks: 2, weight: 25, value: 300, hp: 1, size: 70, col: '#c84a3a', glow: null,
    lore: 'A shark-demon of Japanese legend that snags whole boats with its barbed tail.',
    curse: 'Tail Lash: the top hook is cut every cast' },
  { k: 'umibozu', n: 'Umibōzu', zone: 1, hooks: 3, weight: 60, value: 900, hp: 1, size: 90, col: '#2a2a3a', glow: '#e8f0ff',
    lore: 'A colossal shadow that rises from a calm sea and capsizes ships.',
    curse: 'Dead Calm: line strength −30%' },
  { k: 'bakunawa', n: 'Bakunawa', zone: 2, hooks: 4, weight: 140, value: 2800, hp: 1, size: 150, col: '#3a6a8a', glow: '#fff6c0',
    lore: 'The Philippine sea serpent that rises to swallow the moon.',
    curse: 'Eclipse: only glowing fish bite' },
  { k: 'aspidochelone', n: 'Aspidochelone', zone: 3, hooks: 5, weight: 300, value: 8500, hp: 1, size: 170, col: '#5a6a4a', glow: null,
    lore: 'An island-sized beast that sailors mistake for land, until it dives.',
    curse: 'Shifting Island: one fewer cast' },
  { k: 'kraken', n: 'Kraken', zone: 4, hooks: 6, weight: 600, value: 26000, hp: 1, size: 130, col: '#8a2a3a', glow: '#ff8aa0',
    lore: 'The many-armed terror of the northern deep.',
    curse: 'Grasping Arms: two random hooks are tangled every cast' },
  { k: 'leviathan', n: 'Leviathan', zone: 5, hooks: 8, weight: 1000, value: 80000, hp: 3, size: 220, col: '#1a3a5a', glow: '#6affff',
    lore: 'The serpent at the bottom of the world. It must be held three times.',
    curse: 'Maelstrom: soak time is halved' },
];

/* Hooks hang on the line, bottom hook at full line depth, the rest spaced upward. */
const HOOKS = {
  plain: { n: 'Hook', rarity: 0, price: 3, cap: 1, col: '#c8d0d8', d: 'Holds one fish' },
  treble: { n: 'Treble Hook', rarity: 1, price: 6, cap: 3, maxSize: 12, col: '#e8e0b0', d: 'Holds up to [o]3[/] small fish' },
  circle: { n: 'Circle Hook', rarity: 1, price: 6, cap: 1, minWeight: 2, col: '#f0a040', d: 'Only fish of [o]2kg+[/] bite. Its catch is worth [x]X1.5[/]' },
  glow: { n: 'Glow Lure', rarity: 1, price: 6, cap: 1, col: '#7affff', d: 'Lights up the dark. [p]Glowing[/] fish swim to it and bite [o]2x[/] as often' },
  gold: { n: 'Gold Hook', rarity: 2, price: 8, cap: 1, col: '#f3d23a', d: 'Each fish caught on it earns [$]$1[/]' },
  barbed: { n: 'Barbed Hook', rarity: 2, price: 7, cap: 1, col: '#ff6a5a', d: 'Its fish is never lost to snaps or predators' },
  mirror: { n: 'Mirror Spinner', rarity: 2, price: 9, cap: 1, col: '#d8e8ff', d: 'Its fish counts [o]twice[/] for pairs and schools' },
  chum: { n: 'Chum Hook', rarity: 2, price: 9, cap: 1, col: '#c86a4a', d: 'When it gets a bite, the free hooks next to it hook the [o]same species[/]' },
  lucky: { n: 'Lucky Hook', rarity: 3, price: 12, cap: 1, col: '#4bc292', d: '[g]1 in 3[/] chance its fish is [p]Shiny[/] ([x]X5[/] value)' },
  harpoon: { n: 'Harpoon Hook', rarity: 3, price: 14, cap: 1, col: '#ff4fd8', d: 'Counts as [o]3 hooks[/] when holding a legend' },
};
const HOOK_KEYS = Object.keys(HOOKS);

/* Tackle: permanent, repeatable upgrades bought in the shop. Each entry lists its level values and prices. */
const TACKLE = {
  length: { n: 'Line Length', unit: 'm', levels: [150, 700, 2600, 5200, 9500, 12800], prices: [6, 10, 16, 24, 34], d: 'Reach deeper zones' },
  strength: { n: 'Line Strength', unit: 'kg', levels: [15, 25, 45, 80, 140, 240, 400, 650, 1000, 1600], prices: [3, 5, 7, 9, 12, 15, 19, 24, 30], d: 'Holds more weight before it snaps' },
  slots: { n: 'Hook Slots', unit: '', levels: [3, 4, 5, 6, 7, 8, 9, 10], prices: [4, 6, 8, 11, 14, 18, 22], d: 'More hooks on the line' },
  soak: { n: 'Soak Time', unit: 's', levels: [4, 5, 6, 7, 8], prices: [6, 10, 14, 20], d: 'Line stays down longer for more bites' },
  casts: { n: 'Casts per Day', unit: '', levels: [5, 6, 7, 8], prices: [8, 14, 22], d: 'More casts every day' },
};

/* Bait: one-day boosts, applied automatically on the next day. */
const BAIT = {
  worms: { n: 'Worms', a: '🪱', price: 3, d: 'Sunlit and Twilight fish bite [o]50%[/] more often' },
  squid: { n: 'Squid Strips', a: '🦑', price: 5, d: 'Fish from the Midnight zone and deeper bite [o]50%[/] more often' },
  chum: { n: 'Chum Bucket', a: '🪣', price: 4, d: 'Schools arrive [o]twice[/] as large' },
  glowsticks: { n: 'Glow Sticks', a: '🧪', price: 4, d: 'Every hook lights the dark and draws [p]glowing[/] fish' },
  golden: { n: 'Golden Bait', a: '✨', price: 6, d: '[g]1 in 8[/] fish are [p]Shiny[/] ([x]X5[/] value)' },
  spoiled: { n: 'Spoiled Bait', a: '🦴', price: 4, d: '[r]Predators[/] bite [o]twice[/] as often and attack hooked fish more' },
};
const BAIT_KEYS = Object.keys(BAIT);

/* Crew: passive modifiers (the joker equivalent). Effects are implemented in game.js by key. */
const CREW = {
  oldsalt: { n: 'Old Salt', a: '🧓', rarity: 1, price: 5, d: 'Each [o]school[/] (3+ of a species) gives [m]+3[/] Mult' },
  cook: { n: 'Ship Cook', a: '🍳', rarity: 1, price: 5, d: '[m]+1[/] Mult per different species in the catch' },
  sonar: { n: 'Sonar Tech', a: '📡', rarity: 1, price: 6, d: 'Fish bite [o]30%[/] more often' },
  mender: { n: 'Net Mender', a: '🧵', rarity: 1, price: 5, d: 'Line strength [o]+40%[/]' },
  fishmonger: { n: 'Fishmonger', a: '🐟', rarity: 1, price: 5, d: 'Earn [$]$1[/] for every [o]8[/] fish landed each day' },
  harpooner: { n: 'Harpooner', a: '🔱', rarity: 1, price: 6, d: 'Fish over [o]10kg[/] give [c]+60[/] Chips each' },
  lampkeeper: { n: 'Lamp Keeper', a: '🏮', rarity: 2, price: 7, d: '[p]Glowing[/] fish are worth [x]X2[/]' },
  deckhand: { n: 'Deckhand', a: '🧹', rarity: 2, price: 8, d: '[o]+1[/] cast per day' },
  cartographer: { n: 'Cartographer', a: '🗺️', rarity: 2, price: 7, d: '[m]+2[/] Mult per zone your hooks span' },
  biologist: { n: 'Biologist', a: '🔬', rarity: 2, price: 7, d: '[m]+8[/] Mult for each species caught for the first time this run' },
  nightowl: { n: 'Night Owl', a: '🦉', rarity: 2, price: 7, d: '[x]X1.5[/] Mult if the line reaches the Midnight zone or deeper' },
  luckygull: { n: 'Lucky Gull', a: '🕊️', rarity: 2, price: 8, d: '[g]1 in 10[/] fish are [p]Shiny[/] ([x]X5[/] value)' },
  bosun: { n: 'Bosun', a: '⚓', rarity: 2, price: 8, d: 'The first snap each day loses no fish' },
  sharkwhisperer: { n: 'Shark Whisperer', a: '🦈', rarity: 2, price: 7, d: 'When a predator eats a hooked fish it keeps [o]double[/] the prey value' },
  chumlord: { n: 'Chum Lord', a: '🪣', rarity: 2, price: 6, d: 'Schools are [o]50%[/] larger' },
  treasure: { n: 'Treasure Diver', a: '🤿', rarity: 2, price: 7, d: 'Hooks can snag [$]sunken treasure[/] worth $2–$8' },
  firstmate: { n: 'First Mate', a: '🧭', rarity: 3, price: 10, d: '[x]X1.5[/] Mult on every cast' },
  legendhunter: { n: 'Legend Hunter', a: '🏹', rarity: 3, price: 10, d: 'Legends need [o]1 fewer[/] hook and are worth [x]X2[/]' },
  storyteller: { n: 'Storyteller', a: '📜', rarity: 3, price: 9, d: '[x]X1[/] more Mult for each legend landed this run' },
  ghostcaptain: { n: 'Ghost Captain', a: '👻', rarity: 3, price: 11, d: '[x]X3[/] Mult when the line reaches the Hadal Trench or deeper' },
};
const CREW_KEYS = Object.keys(CREW);

/* Sea events on non-legend days (from day 4 on, 1 in 3 days). */
const EVENTS = [
  { k: 'storm', n: 'Storm', a: '⛈️', d: 'Line strength −25%' },
  { k: 'bloom', n: 'Krill Bloom', a: '🦐', d: 'Schools are twice as large' },
  { k: 'cold', n: 'Cold Current', a: '🧊', d: 'Bites are 30% less likely' },
  { k: 'migration', n: 'Migration', a: '🐋', d: 'Fish from one zone deeper swim up to meet your hooks' },
  { k: 'poachers', n: 'Poachers', a: '🏴‍☠️', d: 'Every 4th fish landed is stolen' },
];

const RARITY = { 0: ['Basic', '#5b6b6e'], 1: ['Common', '#009dff'], 2: ['Uncommon', '#4bc292'], 3: ['Rare', '#fe5f55'] };
