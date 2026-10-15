# RIP SHOP — Art Production Brief

RIP SHOP ships with 32 finished art assets registered in `assets.mjs`. This brief
defines their art direction and replacement contract. Procedural SVG fallbacks in
`art.mjs` remain available if an image is missing or cannot load.

## 1. Rendering contract (read first)

- **Original characters only.** Every design below is an original creature/character for this
  game — do not reference, copy, or imitate any existing copyrighted card game, IP, or real
  person's likeness.
- **Style:** late-1990s painted trading-card illustration — think gouache/airbrush fantasy
  card art: visible brushwork, dramatic single-source rim lighting, saturated but controlled
  palettes, slightly glossy varnish feel. Not flat vector, not photographic, not anime cel-shade.
- **Coherent lighting and materials per set** (see Section 4) so cards from the same set read
  as a family when placed side by side on the shelf or in a pack spread.
- **Readable at thumbnail scale.** Cards render as small as ~110px wide in the Collection grid
  and Display Shelf. Keep the silhouette and color-blocking bold and legible; avoid fine detail
  that disappears when scaled down. Check your art at 120px wide before finalizing.
- **No text, no UI frames, no rarity badges baked into the portrait.** The game draws the name
  plate, rarity pip, finish badge, and border entirely in HTML/CSS on top of your image. Deliver
  a clean illustrated rectangle only — no logos, no card frame, no gems/stars, no watermarks.
- **Generate large, resize down carefully.** Render/paint at a minimum of 2x final pixel
  dimensions (or your tool's largest comfortable size) and downsample with a high-quality
  filter (Lanczos or better) to the exact final dimensions below. This keeps edges clean at
  thumbnail scale instead of looking soft or aliased.
- Every final file must be an intentionally composed illustration matching the character
  identity below, not a generic texture, programmatic silhouette, or unrelated image resized
  to fit. Use an image-generation tool or digital painting workflow to produce real raster art.
- Replacement art must not change `view.mjs`, `game.mjs`, `data.mjs`, `engine.mjs`,
  `animation.mjs`, or `style.css`. Only add images and their paths in `assets.mjs`.

## 2. Exact final paths and dimensions

| Asset | Path (relative to `games/rip-shop/`) | Dimensions | Count |
|---|---|---|---|
| Card portraits | `assets/cards/<card-id>.png` | 384×480 | 24 |
| Pack wrappers | `assets/packs/<set-id>.png` | 324×480 | 3 |
| Booster boxes | `assets/boxes/<set-id>.png` | 600×400 | 3 |
| Shop background | `assets/shop-background.png` | 1920×1080 | 1 |
| Card back | `assets/card-back.png` | 384×480 | 1 |

All files are PNG with alpha where it helps (card portraits may be fully opaque rectangles;
pack/box art should have transparent corners if the silhouette isn't a full rectangle).
`<card-id>` and `<set-id>` are the exact lowercase IDs listed in Section 3/4 (e.g. `clerk.png`,
`office.png`).

Create `assets/cards/`, `assets/packs/`, and `assets/boxes/` as needed when adding final files.

## 3. Card portraits — identity and composition (24)

Each entry: **id** — Name (set, rarity) — composition notes. Rarity should visibly escalate
within a set: commons are modest/plain, mythics are the most elaborate, largest-presence pose
with a radiant/crowned treatment. Current placeholder silhouette archetype is noted in
parentheses as a *starting* compositional reference, not a hard requirement — feel free to
elevate beyond a silhouette now that it's a full painting.

### Office (rarity ladder: clerk/runner/accountant → janitor/manager → printer/director → founder)
- `clerk` — Goblin Clerk (common): small green-skinned goblin in an ill-fitting vest, clutching
  a ledger. Tired, harried expression. (ref: stout humanoid, ledger prop)
- `runner` — Errand Imp (common): a leaner, winged imp caught mid-sprint, papers flying, motion
  blur in the pose. (ref: humanoid, motion lines)
- `accountant` — Bean Counter (common): a bespectacled goblin behind an abacus/adding machine,
  squinting at numbers. (ref: humanoid, abacus prop)
- `janitor` — Mop Goblin (uncommon): a weary goblin with a mop and bucket, faint supernatural
  glow around the mop head hinting at hidden power. (ref: humanoid, mop prop)
- `manager` — Shift Witch (uncommon): a goblin witch in a pointed hat with a broom, clipboard in
  the other hand, equal parts manager and sorceress. (ref: humanoid, witch hat + broom)
- `printer` — Paper Golem (rare): a blocky construct built from bound stacks of paper and
  staples, glowing seams, ink-stained joints. (ref: golem, blocky body)
- `director` — The Big Boss (rare): a towering goblin in an oversized suit, wide shoulders, a
  commanding stance, a neon-lit name plaque behind him. (ref: big humanoid, necktie)
- `founder` — Founder of the Month (mythic): the most ornate office figure — gilded suit, a
  crooked paper crown, radiant golden light bursting behind, trophy in hand. (ref: big humanoid,
  crown + radiant burst)

### Vault (rarity ladder: hatchling/mimic/squire → appraiser/hoarder → knight/wyrm → dragon)
- `hatchling` — Penny Drake (common): a small copper-scaled baby dragon curled around a single
  coin, curious and small. (ref: drake, tiny wings)
- `mimic` — Pocket Mimic (common): a small treasure chest with a mischievous eye and teeth
  peeking from the lid seam. (ref: chest creature)
- `squire` — Coin Squire (common): a young armored figure polishing a small round shield, coins
  spilling from a belt pouch. (ref: armored humanoid, small shield)
- `appraiser` — Gem Appraiser (uncommon): a robed figure holding a jeweler's loupe up to a
  glowing gem, calculating expression. (ref: robed humanoid, loupe prop)
- `hoarder` — Hoard Keeper (uncommon): a round, furry creature nested atop a modest pile of
  coins, hugging them protectively. (ref: round creature, coin pile)
- `knight` — Gilded Knight (rare): a fully armored knight in gold-trimmed plate, a large ornate
  shield with a plumed helm, heroic stance. (ref: armored humanoid, large shield + plume)
- `wyrm` — Dividend Wyrm (rare): a mid-sized serpentine dragon coiled around a stack of ingots,
  small wings flared, scales catching light. (ref: serpent, wings)
- `dragon` — The Last Gold Dragon (mythic): a grand coiled golden dragon, wings fully spread,
  crown-like horns, radiant golden light, the most dramatic vault piece. (ref: grand serpent,
  large wings + crown spikes)

### Crypt (rarity ladder: wisp/skeleton/rat → medium/hacker → ghost/lich → oracle)
- `wisp` — Static Wisp (common): a small drifting flame/orb creature made of flickering blue-
  white static, faint screen-glitch texture. (ref: floating orb, flame flicker)
- `skeleton` — Night Shift Skeleton (common): a bony figure in a worn work vest holding a dim
  lantern, clocking in for an endless shift. (ref: skeletal humanoid, lantern prop)
- `rat` — Cable Rat (common): a small wiry rat creature with a tail that trails off into a
  glowing data cable. (ref: small quadruped, cable tail)
- `medium` — Hotline Medium (uncommon): a seated robed figure with a candle and an old rotary
  phone, eyes closed, receiving a message from beyond. (ref: robed humanoid, candle prop)
- `hacker` — Hex Hacker (uncommon): a hooded figure hunched over a glowing laptop, screen light
  lighting the face from below. (ref: hooded humanoid, laptop glow)
- `ghost` — Ghost in the Machine (rare): a classic draped-sheet ghost with faint CRT scanlines
  running through its translucent body. (ref: ghost-sheet, scanline texture)
- `lich` — Neon Lich (rare): a crowned skeletal sorcerer in tattered robes, wreathed in neon-
  colored (not natural) flame, staff in hand. (ref: crowned skeleton, staff)
- `oracle` — Oracle Zero (mythic): a floating, crowned eye/skull hybrid encircled by glowing
  halo rings and faint circuit-trace patterns, the most otherworldly crypt piece. (ref: eye-orb,
  halo rings)

## 4. Pack wrappers, booster boxes, set palette/lighting

Each set needs one consistent palette and light source carried across its pack wrapper, box,
and all 8 card portraits.

- **Office** (`office.png`) — warm amber/brown, centered on `#b97a3d`. Fluorescent office
  lighting: slightly green-white key light, soft shadows, mundane-but-magical mood.
  Pack wrapper: a foil pouch with a perforated tear strip near its top fifth; box: a small
  cardboard carton with a flip lid and a front display window.
- **Vault** (`vault.png`) — gold `#f2c94c`, deep amber shadows, warm torch-and-treasure
  lighting, baroque ornamental trim on the wrapper and box.
- **Crypt** (`crypt.png`) — violet `#8b5cf6` with teal accents, cool neon rim lighting,
  deep near-black shadows, subtle scanline/static texture on the wrapper material.

Wrapper and box art should NOT include literal rarity odds, prices, or UI text — those are
rendered by the game. A small emblem/mascot silhouette and the set's color identity are
appropriate; store-shelf-style branding flourishes (foil accents, pattern, a stylized mark) are
welcome since these are physical product assets, not character portraits.

## 5. Shop background (`shop-background.png`, 1920×1080)

A single wide establishing image of the RIP SHOP counter at night: a cluttered, cozy late-night
trading card counter — shelves of boxes in the background, warm counter lamp light pooling in
the foreground, midnight-blue ambient light from a window, a hint of all three sets' color
identities visible in the background dressing (a goblin office folder here, a treasure glint
there, a flickering screen in the corner). Keep the center-bottom ~40% of the frame relatively
calm/uncluttered in value and detail — the pack-opening stage and UI sit on top of this image at
low opacity, so a busy center reads as visual noise through the UI.

## 6. Card back (`card-back.png`, 384×480)

One universal card back used for every face-down slot while a pack is being revealed. A
symmetrical, non-character design: a dark midnight-blue field, a thin gold border, and a central
emblem (an abstract card-shop sigil) echoing the mint/coral/gold accent palette. No text
or set-specific color: this back appears before the player sees the next card.

## 7. Integration into `assets.mjs`

All 24 portraits, three wrappers, three boxes, the background, and the card back are
already registered. Replace artwork at its existing path to retain the current mappings.
If a path changes, update only its corresponding entry in `assets.mjs`.

`art.mjs` retains procedural fallbacks for missing entries or images that cannot load.
Pack-art containers preserve the wrapper's 27:40 aspect ratio independently of image
loading. This keeps the sealed wrapper visible and gives its tear animation real dimensions.

## 8. QA — contact sheet and in-game check

Before marking a batch "done":

1. **Contact sheet.** Lay out all delivered PNGs for a set (8 cards + pack + box, or the
   background/card-back) on a single reference sheet at their true final pixel dimensions, in
   rarity order, to confirm the lighting/palette family reads as consistent at a glance.
2. **Thumbnail check.** View each card at ~120px wide (the Collection grid size) — confirm the
   character and rarity read clearly with no illegible fine detail.
3. **In-game preview.** Drop the finished paths into `assets.mjs`, open `index.html` through a
   local static server (e.g. `npx serve games/rip-shop` or any static file server — no build
   step), and check:
   - The card appears correctly in the Collection grid, on the Display Shelf, and in a pack
     reveal (all three use the same portrait).
   - Foil/prismatic finish overlays (animated sheen/rainbow) still read well over the new art.
   - The pack wrapper appears correctly on the pack-opening stage (sealed state) and set tile
     (Shop tab).
   - The box art appears wherever box purchases are shown.
   - Temporarily renaming the file (to simulate a 404) confirms the procedural placeholder
     reappears cleanly with no layout break, then restore the real filename.
4. Confirm no image embeds any text, UI frame, or rarity badge — those must come from the game
   itself.
