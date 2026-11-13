import type { MonsterKindId } from "../data/bestiary.ts";

export const SPRITE_SIZE = 16;

const TRANSPARENT_PIXEL = ".";

type Palette = Readonly<Record<string, string>>;

export interface FacingSprites {
  right: HTMLCanvasElement;
  left: HTMLCanvasElement;
}

interface PixelArt {
  pixels: readonly string[];
  palette: Palette;
}

// Rhode Island Red facing right. N marks the bandana, recolored per chicken so individuals stay trackable.
const CHICKEN_PIXELS = [
  "................",
  ".........RR.....",
  "........RRR.....",
  ".......BBBB.....",
  "......BBBKBO....",
  "......BBBBBOO...",
  "......NNNNB.....",
  "..D..BBBBBB.....",
  "..DDBBBBBBBB....",
  "..DDBBDDDBBB....",
  "...DBBDDDDBB....",
  "....BBBBBBB.....",
  ".....BBBBB......",
  "......Y..Y......",
  "......Y..Y......",
  ".....YY.YY......",
];

const CHICKEN_PALETTE: Palette = {
  B: "#a8452a",
  D: "#6b2a17",
  R: "#e23a2a",
  O: "#f2a33a",
  K: "#140d0a",
  Y: "#e8b13c",
};

const MONSTER_ART: Readonly<Record<MonsterKindId, PixelArt>> = {
  cellarRat: {
    pixels: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "........PP......",
      ".....GGGGGG.....",
      "...GGGGGGGKGG...",
      "..GGLLLLGGGGGGN.",
      ".TGGLLLLLGGGG...",
      "T..GGGGGGGG.....",
      "....G..G.G......",
      "................",
    ],
    palette: { G: "#6f6a66", L: "#8d8781", P: "#d79a9a", K: "#140d0a", T: "#c98a8a", N: "#e0a0a0" },
  },
  cellarSpider: {
    pixels: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "...S........S...",
      "....S......S....",
      ".S...SSSSSS...S.",
      "..S.SHHSSSSS.S..",
      "...SSSSSSSSSSS..",
      "..S.SSESSESS.S..",
      ".S...SSSSSS...S.",
      "....S......S....",
      "...S........S...",
      "................",
    ],
    palette: { S: "#3b2a3f", H: "#5e4766", E: "#e23a2a" },
  },
  monsterDen: {
    pixels: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      ".....MMMMMM.....",
      "...MMMMMMMMMM...",
      "..MMMHHHHHHMMM..",
      "..MMHHHHHHHHMM..",
      ".MMHHEHHHHEHHMM.",
      ".MMHHHHHHHHHHMM.",
      ".MMMHHHHHHHHMMM.",
      "..MMMMMMMMMMMM..",
      "...MMMMMMMMMM...",
      "................",
    ],
    palette: { M: "#4a3a2a", H: "#0d0907", E: "#e23a2a" },
  },
};

const GOLD_PILE_ART: PixelArt = {
  pixels: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".......W........",
    "......AAA.......",
    ".....AAWAA......",
    "....AAAAAAA.....",
    "...BAAAAAAAB....",
    "....BBBBBBB.....",
  ],
  palette: { A: "#e8b13c", W: "#fff1b0", B: "#a36a1c" },
};

const FEATHER_PILE_ART: PixelArt = {
  pixels: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....F....R.....",
    "...FFF..RR.F....",
    "..FFRFFFFRFF....",
    "...DFFRFFFFD....",
    "....DDDDDDD.....",
  ],
  palette: { F: "#efe6d6", R: "#a8452a", D: "#6b2a17" },
};

const NEST_ART: PixelArt = {
  pixels: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....SSSSSSSS....",
    "...SsSSsSSsSS...",
    "..SSs......sSS..",
    "..SSSsSSSSsSSS..",
    "...SSSSSSSSSS...",
    "................",
  ],
  palette: { S: "#d9b25a", s: "#9c7a33" },
};

const DEN_SITE_ART: PixelArt = {
  pixels: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....dddddd.....",
    "...dd......dd...",
    "...dd......dd...",
    ".....dddddd.....",
    "................",
  ],
  palette: { d: "#3a2a1c" },
};

export function buildChickenSprites(bandanaColor: string): FacingSprites {
  return buildFacingSprites({ pixels: CHICKEN_PIXELS, palette: { ...CHICKEN_PALETTE, N: bandanaColor } });
}

export function buildMonsterSprites(kind: MonsterKindId): FacingSprites {
  return buildFacingSprites(MONSTER_ART[kind]);
}

export function buildGoldPileSprite(): HTMLCanvasElement {
  return buildSprite(GOLD_PILE_ART);
}

export function buildFeatherPileSprite(): HTMLCanvasElement {
  return buildSprite(FEATHER_PILE_ART);
}

export function buildNestSprite(): HTMLCanvasElement {
  return buildSprite(NEST_ART);
}

export function buildDenSiteSprite(): HTMLCanvasElement {
  return buildSprite(DEN_SITE_ART);
}

export function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  context.imageSmoothingEnabled = false;
  return context;
}

function buildFacingSprites(art: PixelArt): FacingSprites {
  const right = buildSprite(art);
  const left = createSpriteCanvas();
  const leftContext = contextOf(left);
  leftContext.translate(SPRITE_SIZE, 0);
  leftContext.scale(-1, 1);
  leftContext.drawImage(right, 0, 0);
  return { right, left };
}

function buildSprite(art: PixelArt): HTMLCanvasElement {
  const canvas = createSpriteCanvas();
  const context = contextOf(canvas);
  if (art.pixels.length !== SPRITE_SIZE) throw new Error(`Sprite is ${art.pixels.length} rows tall, expected ${SPRITE_SIZE}`);
  art.pixels.forEach((row, y) => {
    if (row.length !== SPRITE_SIZE) throw new Error(`Sprite row ${y} is ${row.length} pixels wide, expected ${SPRITE_SIZE}`);
    [...row].forEach((pixel, x) => {
      if (pixel === TRANSPARENT_PIXEL) return;
      const color = art.palette[pixel];
      if (!color) throw new Error(`Sprite uses unknown pixel "${pixel}"`);
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    });
  });
  return canvas;
}

function createSpriteCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  return canvas;
}
