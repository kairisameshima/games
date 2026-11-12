export const SPRITE_SIZE = 16;

const TRANSPARENT_PIXEL = ".";
const BANDANA_PIXEL = "N";

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

const CHICKEN_PALETTE: Readonly<Record<string, string>> = {
  B: "#a8452a",
  D: "#6b2a17",
  R: "#e23a2a",
  O: "#f2a33a",
  K: "#140d0a",
  Y: "#e8b13c",
};

export interface FacingSprites {
  right: HTMLCanvasElement;
  left: HTMLCanvasElement;
}

export function buildChickenSprites(bandanaColor: string): FacingSprites {
  const right = createSpriteCanvas();
  const rightContext = contextOf(right);
  CHICKEN_PIXELS.forEach((row, y) => {
    if (row.length !== SPRITE_SIZE) throw new Error(`Chicken sprite row ${y} is ${row.length} pixels wide, expected ${SPRITE_SIZE}`);
    [...row].forEach((pixel, x) => {
      if (pixel === TRANSPARENT_PIXEL) return;
      const color = pixel === BANDANA_PIXEL ? bandanaColor : CHICKEN_PALETTE[pixel];
      if (!color) throw new Error(`Chicken sprite uses unknown pixel "${pixel}"`);
      rightContext.fillStyle = color;
      rightContext.fillRect(x, y, 1, 1);
    });
  });

  const left = createSpriteCanvas();
  const leftContext = contextOf(left);
  leftContext.translate(SPRITE_SIZE, 0);
  leftContext.scale(-1, 1);
  leftContext.drawImage(right, 0, 0);
  return { right, left };
}

function createSpriteCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  return canvas;
}

export function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  context.imageSmoothingEnabled = false;
  return context;
}
