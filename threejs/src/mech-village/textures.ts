import * as THREE from "three";
import { createRandom, fbm, valueNoise } from "./noise";

const TEXTURE_SIZE = 512;

type PixelShader = (x: number, y: number) => [number, number, number];

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  return [canvas, context];
}

function fillPixels(context: CanvasRenderingContext2D, size: number, shade: PixelShader): void {
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [red, green, blue] = shade(x, y);
      const offset = (y * size + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function toTexture(canvas: HTMLCanvasElement, isColor: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}

function mixColor(a: readonly number[], b: readonly number[], amount: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, amount));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Riveted armour plating with rust blooms and run-off streaks. One tile is 12 m. */
function createSteelTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  const steel = [108, 114, 118];
  const rustDark = [96, 52, 30];
  const rustLight = [168, 98, 52];
  fillPixels(context, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const grime = fbm(u * 8, v * 8, 5, 3, 8);
    const rustMask = fbm(u * 5, v * 5, 5, 11, 5);
    const streak = valueNoise(u * 90, v * 3, 23, 90) * fbm(u * 6, v * 6, 3, 31, 6);
    let color = mixColor(steel, [66, 70, 72], grime * 0.9);
    const rustAmount = Math.max(0, (rustMask - 0.6) * 4) + Math.max(0, streak - 0.48) * 2;
    const rustTone = mixColor(rustDark, rustLight, fbm(u * 24, v * 24, 3, 41, 24));
    color = mixColor(color, rustTone, rustAmount);
    const speck = valueNoise(x * 0.9, y * 0.9, 7, size * 0.9);
    const lift = 0.9 + speck * 0.2;
    return [color[0] * lift, color[1] * lift, color[2] * lift];
  });
  const plateRows = 3;
  const plate = size / plateRows;
  const random = createRandom(5);
  context.lineCap = "square";
  for (let row = 0; row < plateRows; row++) {
    const stagger = row % 2 === 0 ? 0 : plate / 2;
    const top = row * plate;
    const seamPaths: Array<[number, number, number, number]> = [[0, top, size, top]];
    for (let column = -1; column <= plateRows; column++) {
      const left = column * plate + stagger;
      seamPaths.push([left, top, left, top + plate]);
    }
    for (const [x0, y0, x1, y1] of seamPaths) {
      context.strokeStyle = "rgba(20,18,16,0.85)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
      context.strokeStyle = "rgba(200,200,190,0.18)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x0 + 2, y0 + 2);
      context.lineTo(x1 + 2, y1 + 2);
      context.stroke();
      const length = Math.hypot(x1 - x0, y1 - y0);
      const rivetCount = Math.floor(length / 14);
      for (let index = 1; index < rivetCount; index++) {
        const t = index / rivetCount;
        const rivetX = x0 + (x1 - x0) * t + (x1 === x0 ? 7 : 0);
        const rivetY = y0 + (y1 - y0) * t + (y1 === y0 ? 7 : 0);
        context.fillStyle = "rgba(25,22,20,0.7)";
        context.beginPath();
        context.arc(rivetX + 0.8, rivetY + 0.8, 2.6, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = `rgba(190,185,170,${0.25 + random() * 0.2})`;
        context.beginPath();
        context.arc(rivetX - 0.5, rivetY - 0.5, 1.4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  return toTexture(canvas, true);
}

/** Grayscale fractal noise used for moss masks and colour variation. */
function createNoiseTexture(): THREE.CanvasTexture {
  const size = 256;
  const [canvas, context] = createCanvas(size);
  fillPixels(context, size, (x, y) => {
    const value = fbm((x / size) * 4, (y / size) * 4, 6, 77, 4) * 255;
    const detail = fbm((x / size) * 16, (y / size) * 16, 3, 91, 16) * 255;
    return [value, detail, value];
  });
  return toTexture(canvas, false);
}

/** Horizontal planks with grain. One tile is 3 m. */
function createWoodTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  const plankHeight = size / 10;
  const random = createRandom(13);
  const plankTints = Array.from({ length: 10 }, () => 0.78 + random() * 0.35);
  const plankJoints = Array.from({ length: 10 }, () => random() * size);
  fillPixels(context, size, (x, y) => {
    const plank = Math.floor(y / plankHeight);
    const inPlank = (y % plankHeight) / plankHeight;
    const grain = valueNoise((x / size) * 6, y * 0.45, 3 + plank, 6);
    const knot = fbm((x / size) * 10, (y / size) * 10, 3, 19, 10);
    const tint = plankTints[plank];
    const base = mixColor([122, 86, 56], [84, 56, 36], grain * 0.8 + knot * 0.3);
    const gap = inPlank < 0.06 || Math.abs(x - plankJoints[plank]) < 2 ? 0.35 : 1;
    const edge = 1 - Math.pow(Math.abs(inPlank - 0.5) * 2, 6) * 0.25;
    const shade = tint * gap * edge;
    return [base[0] * shade, base[1] * shade, base[2] * shade];
  });
  return toTexture(canvas, true);
}

/** Lime plaster with damp stains. One tile is 4 m. */
function createPlasterTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  fillPixels(context, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const blotch = fbm(u * 6, v * 6, 5, 51, 6);
    const stain = Math.max(0, fbm(u * 3, v * 3, 4, 57, 3) - 0.55) * 2.5;
    const color = mixColor([236, 226, 204], [196, 182, 156], blotch * 0.7 + stain);
    return color;
  });
  return toTexture(canvas, true);
}

/** Rough cut stone blocks in courses. One tile is 4 m. */
function createStoneTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  const courseHeight = size / 8;
  const random = createRandom(29);
  const blockWidths = Array.from({ length: 8 }, () => 70 + random() * 60);
  const blockOffsets = Array.from({ length: 8 }, () => random() * size);
  fillPixels(context, size, (x, y) => {
    const course = Math.floor(y / courseHeight);
    const inCourse = (y % courseHeight) / courseHeight;
    const width = blockWidths[course];
    const shifted = x + blockOffsets[course];
    const blockIndex = Math.floor(shifted / width);
    const inBlock = (shifted % width) / width;
    const blockTint = 0.8 + valueNoise(blockIndex, course, 61) * 0.35;
    const surface = fbm((x / size) * 12, (y / size) * 12, 4, 67, 12);
    const color = mixColor([158, 150, 136], [104, 98, 90], surface);
    const mortar = inCourse < 0.07 || inBlock < 0.04 ? 0.45 : 1;
    const bevel = 1 - Math.max(0, 0.2 - inCourse) * 1.2 - Math.max(0, inCourse - 0.85) * 1.5;
    const shade = blockTint * mortar * bevel;
    return [color[0] * shade, color[1] * shade, color[2] * shade];
  });
  return toTexture(canvas, true);
}

/** Overlapping shingles, near-white so vertex colour sets the roof tint. U runs along the ridge. */
function createShingleTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  const rowHeight = size / 12;
  const shingleWidth = size / 10;
  fillPixels(context, size, (x, y) => {
    const row = Math.floor(y / rowHeight);
    const inRow = (y % rowHeight) / rowHeight;
    const shifted = x + (row % 2) * shingleWidth * 0.5;
    const column = Math.floor(shifted / shingleWidth);
    const inShingle = (shifted % shingleWidth) / shingleWidth;
    const tint = 0.75 + valueNoise(column, row, 71) * 0.35;
    const roundedBottom = Math.pow(Math.abs(inShingle - 0.5) * 2, 3) * 0.25;
    const gap = inRow > 0.92 - roundedBottom || inShingle < 0.04 ? 0.4 : 1;
    const shadow = 0.7 + inRow * 0.3;
    const grit = 0.9 + fbm((x / size) * 20, (y / size) * 20, 3, 73, 20) * 0.2;
    const shade = 220 * tint * gap * shadow * grit;
    return [shade, shade * 0.97, shade * 0.93];
  });
  return toTexture(canvas, true);
}

/** Straw thatch. V runs down the slope. */
function createThatchTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  fillPixels(context, size, (x, y) => {
    const straw = valueNoise(x * 0.6, (y / size) * 8, 83, 0);
    const clump = fbm((x / size) * 8, (y / size) * 4, 4, 89, 4);
    const layer = 0.75 + 0.25 * Math.pow((y % 48) / 48, 0.6);
    const color = mixColor([214, 178, 112], [126, 96, 56], straw * 0.6 + clump * 0.5);
    return [color[0] * layer, color[1] * layer, color[2] * layer];
  });
  return toTexture(canvas, true);
}

/** Grass and soil detail for the terrain, multiplied over vertex colour. */
function createGroundTexture(): THREE.CanvasTexture {
  const size = TEXTURE_SIZE;
  const [canvas, context] = createCanvas(size);
  fillPixels(context, size, (x, y) => {
    const fine = valueNoise(x * 0.5, y * 0.5, 97, size * 0.5);
    const clump = fbm((x / size) * 8, (y / size) * 8, 4, 101, 8);
    const shade = 150 + fine * 70 + clump * 60;
    return [shade, shade * 1.02, shade * 0.92];
  });
  return toTexture(canvas, true);
}

/** Warm four-pane window, used as both colour and emissive map. */
function createWindowTexture(): THREE.CanvasTexture {
  const size = 64;
  const [canvas, context] = createCanvas(size);
  const glow = context.createRadialGradient(32, 36, 4, 32, 32, 40);
  glow.addColorStop(0, "#ffe2a0");
  glow.addColorStop(1, "#d88a32");
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#2a1c12";
  context.fillRect(0, 0, size, 5);
  context.fillRect(0, size - 5, size, 5);
  context.fillRect(0, 0, 5, size);
  context.fillRect(size - 5, 0, 5, size);
  context.fillRect(size / 2 - 2, 0, 4, size);
  context.fillRect(0, size / 2 - 2, size, 4);
  const texture = toTexture(canvas, true);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Soft round puff for smoke, fireflies and spray. */
function createPuffTexture(): THREE.CanvasTexture {
  const size = 64;
  const [canvas, context] = createCanvas(size);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Falling-water streaks; V scrolls downward over time. */
function createWaterfallTexture(): THREE.CanvasTexture {
  const size = 256;
  const [canvas, context] = createCanvas(size);
  fillPixels(context, size, (x, y) => {
    const streak = fbm((x / size) * 16, (y / size) * 2, 4, 107, 16);
    const foam = Math.pow(streak, 2.2) * 1.6;
    const value = Math.min(1, 0.25 + foam);
    return [180 * value + 60, 210 * value + 40, 225 * value + 30];
  });
  return toTexture(canvas, true);
}

export interface SceneTextures {
  steel: THREE.CanvasTexture;
  noise: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  stone: THREE.CanvasTexture;
  shingle: THREE.CanvasTexture;
  thatch: THREE.CanvasTexture;
  ground: THREE.CanvasTexture;
  window: THREE.CanvasTexture;
  puff: THREE.CanvasTexture;
  waterfall: THREE.CanvasTexture;
}

export function createSceneTextures(): SceneTextures {
  return {
    steel: createSteelTexture(),
    noise: createNoiseTexture(),
    wood: createWoodTexture(),
    plaster: createPlasterTexture(),
    stone: createStoneTexture(),
    shingle: createShingleTexture(),
    thatch: createThatchTexture(),
    ground: createGroundTexture(),
    window: createWindowTexture(),
    puff: createPuffTexture(),
    waterfall: createWaterfallTexture(),
  };
}
