import * as THREE from "three";
import type { Sheet, SheetLayout } from "./art.ts";
import type { HalfExtents } from "./machine.ts";

/** Alpha at or above this counts as a solid pixel. */
const SOLID_ALPHA = 128;
/** Sheet cells keep one empty pixel of padding on every side. */
const CELL_PADDING = 1;

/** Where a sprite model's origin sits: under its feet (characters) or at its center (physics bodies). */
export type VoxelOrigin = "feet" | "center";

interface Face {
  normal: [number, number, number];
  /** Pixel-grid step to the neighbour that would hide this face; undefined for front and back, which always show. */
  neighbour: [number, number] | undefined;
  /** Corner signs in counter-clockwise order seen from outside. */
  corners: [number, number, number][];
}

// Image rows grow downward, so the face pointing up (+y) checks the row above (-1).
const FACES: readonly Face[] = [
  { normal: [1, 0, 0], neighbour: [1, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { normal: [-1, 0, 0], neighbour: [-1, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { normal: [0, 1, 0], neighbour: [0, -1], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { normal: [0, -1, 0], neighbour: [0, 1], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { normal: [0, 0, 1], neighbour: undefined, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], neighbour: undefined, corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/** One frame's cell inside a sheet's pixels. */
interface FrameWindow {
  pixels: ImageData;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Read every pixel of a sheet once, so frames can be built without touching the canvas again. */
export function readSheetPixels(sheet: Sheet): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = sheet.image.width;
  canvas.height = sheet.image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  context.drawImage(sheet.image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Half size of the box a sprite frame's model fills, for a physics collider that matches the art. */
export function voxelHalfExtents(layout: SheetLayout, voxelSize: number, depthInPixels: number): HalfExtents {
  return {
    x: ((layout.cellWidth - 2 * CELL_PADDING) * voxelSize) / 2,
    y: ((layout.cellHeight - 2 * CELL_PADDING) * voxelSize) / 2,
    z: (depthInPixels * voxelSize) / 2,
  };
}

function pixelOffset(window: FrameWindow, x: number, y: number): number {
  return ((window.originY + y) * window.pixels.width + window.originX + x) * 4;
}

function isSolidPixel(window: FrameWindow, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= window.width || y >= window.height) return false;
  return window.pixels.data[pixelOffset(window, x, y) + 3] >= SOLID_ALPHA;
}

/**
 * Extrudes one frame of a pixel-art sheet into a 3D pixel sprite: every solid pixel becomes a block
 * `depthInPixels` deep, coloured with the pixel's colour. Faces hidden between neighbouring pixels are skipped,
 * so the result is one light mesh per frame. Use with a material that has `vertexColors: true`.
 */
export function buildVoxelGeometry(
  pixels: ImageData,
  layout: SheetLayout,
  frame: number,
  voxelSize: number,
  depthInPixels: number,
  origin: VoxelOrigin,
): THREE.BufferGeometry {
  const { cellWidth, cellHeight, columns } = layout;
  const window: FrameWindow = {
    pixels,
    originX: (frame % columns) * cellWidth,
    originY: Math.floor(frame / columns) * cellHeight,
    width: cellWidth,
    height: cellHeight,
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const half = [voxelSize / 2, voxelSize / 2, (depthInPixels * voxelSize) / 2];
  const bottomY = origin === "feet" ? 0 : -(cellHeight * voxelSize) / 2;

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      if (!isSolidPixel(window, x, y)) continue;
      const offset = pixelOffset(window, x, y);
      color.setRGB(pixels.data[offset] / 255, pixels.data[offset + 1] / 255, pixels.data[offset + 2] / 255, THREE.SRGBColorSpace);
      const centerX = (x - cellWidth / 2 + 0.5) * voxelSize;
      const centerY = bottomY + (cellHeight - y - 0.5) * voxelSize;
      for (const face of FACES) {
        if (face.neighbour && isSolidPixel(window, x + face.neighbour[0], y + face.neighbour[1])) continue;
        const firstVertex = positions.length / 3;
        for (const [signX, signY, signZ] of face.corners) {
          positions.push(centerX + signX * half[0], centerY + signY * half[1], signZ * half[2]);
          normals.push(...face.normal);
          colors.push(color.r, color.g, color.b);
        }
        indices.push(firstVertex, firstVertex + 1, firstVertex + 2, firstVertex, firstVertex + 2, firstVertex + 3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}
