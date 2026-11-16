import * as THREE from "three";

/** Tiny textures with hard pixels, sized so one texel lands near one art pixel on screen. */
export const TEXELS_PER_WORLD_UNIT = 16;
const COIN_FACE_SIZE = 16;
const TILE_SIZE = 16;

/** Toon lighting in hard bands, darkest first. Each value is a light level from 0 to 255. */
export function createToonGradient(bands: readonly number[]): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(bands), bands.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function createCanvas(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  return { canvas, context };
}

function toPixelTexture(canvas: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

function fillPixel(context: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  context.fillStyle = color;
  context.fillRect(x, y, 1, 1);
}

/** Gold face with a dark rim, a top-left shine and a stamped star, decided pixel by pixel. */
export function createCoinFaceTexture(): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(COIN_FACE_SIZE);
  const center = COIN_FACE_SIZE / 2;
  const star = new Path2D();
  for (let point = 0; point < 10; point++) {
    const radius = point % 2 === 0 ? 4.6 : 2;
    const angle = (point * Math.PI) / 5 - Math.PI / 2;
    star.lineTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
  }
  star.closePath();
  for (let y = 0; y < COIN_FACE_SIZE; y++) {
    for (let x = 0; x < COIN_FACE_SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      let color = "#f5c04a";
      if (distance > center - 1.5) color = "#7a4612";
      else if (context.isPointInPath(star, x + 0.5, y + 0.5)) color = "#a8691c";
      else if (x + y < center && distance > center - 3.5) color = "#ffe58a";
      fillPixel(context, x, y, color);
    }
  }
  return toPixelTexture(canvas, false);
}

/** Arcade felt in a machine's colours, with a small diamond print every half tile. */
export function createFeltTexture(baseColor: string, printColor: string): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(TILE_SIZE);
  const armColor = new THREE.Color(baseColor).lerp(new THREE.Color(printColor), 0.5).getStyle();
  context.fillStyle = baseColor;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  for (const [cx, cy] of [
    [4, 4],
    [12, 12],
  ]) {
    fillPixel(context, cx, cy - 1, armColor);
    fillPixel(context, cx - 1, cy, armColor);
    fillPixel(context, cx + 1, cy, armColor);
    fillPixel(context, cx, cy + 1, armColor);
    fillPixel(context, cx, cy, printColor);
  }
  return toPixelTexture(canvas, true);
}

/** Back wall panelling: dark purple boards with a lit seam and a shadowed seam. */
export function createWallTexture(): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(TILE_SIZE);
  context.fillStyle = "#2a1640";
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#3a2058";
  context.fillRect(0, 0, TILE_SIZE, 1);
  context.fillStyle = "#1a0d2a";
  context.fillRect(0, TILE_SIZE - 1, TILE_SIZE, 1);
  context.fillRect(TILE_SIZE / 2, 1, 1, TILE_SIZE - 2);
  return toPixelTexture(canvas, true);
}

/** Pusher chrome: pale steel with two dark grooves running across it. */
export function createSteelTexture(): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(TILE_SIZE);
  context.fillStyle = "#c9ced8";
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#e9edf3";
  context.fillRect(0, 2, TILE_SIZE, 1);
  context.fillStyle = "#8a90a0";
  context.fillRect(0, 7, TILE_SIZE, 1);
  context.fillRect(0, 14, TILE_SIZE, 1);
  return toPixelTexture(canvas, true);
}

/** Repeats a tile texture so one texel covers 1 / TEXELS_PER_WORLD_UNIT world units on a face `width` x `height`. */
export function tiled(texture: THREE.Texture, width: number, height: number): THREE.Texture {
  const copy = texture.clone();
  copy.repeat.set((width * TEXELS_PER_WORLD_UNIT) / TILE_SIZE, (height * TEXELS_PER_WORLD_UNIT) / TILE_SIZE);
  copy.needsUpdate = true;
  return copy;
}
