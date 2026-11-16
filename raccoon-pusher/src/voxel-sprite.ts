import * as THREE from "three";
import type { Sheet } from "./art.ts";

/** Alpha at or above this counts as a solid pixel. */
const SOLID_ALPHA = 128;

/** Read every pixel of a sheet once, so frames can be built without touching the canvas again. */
function readPixels(sheet: Sheet): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = sheet.image.width;
  canvas.height = sheet.image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  context.drawImage(sheet.image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Extrudes each frame of a pixel-art sheet into a 3D pixel sprite: one block per solid pixel, all `depthInPixels`
 * deep, so the art keeps its exact pixels on the front and gains solid sides. Models stand on y = 0, centred on x.
 */
export function buildVoxelFrames(
  sheet: Sheet,
  voxelSize: number,
  depthInPixels: number,
  material: THREE.Material,
): THREE.InstancedMesh[] {
  const pixels = readPixels(sheet);
  const { cellWidth, cellHeight, columns, rows } = sheet.layout;
  // One block per pixel, stretched through the whole depth: far fewer instances than stacking cubes.
  const block = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize * depthInPixels);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const frames: THREE.InstancedMesh[] = [];

  for (let frame = 0; frame < columns * rows; frame++) {
    const originX = (frame % columns) * cellWidth;
    const originY = Math.floor(frame / columns) * cellHeight;
    const solidOffsets: { x: number; y: number; offset: number }[] = [];
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const offset = ((originY + y) * pixels.width + originX + x) * 4;
        if (pixels.data[offset + 3] >= SOLID_ALPHA) solidOffsets.push({ x, y, offset });
      }
    }
    const mesh = new THREE.InstancedMesh(block, material, solidOffsets.length);
    solidOffsets.forEach(({ x, y, offset }, instance) => {
      matrix.makeTranslation((x - cellWidth / 2 + 0.5) * voxelSize, (cellHeight - y - 0.5) * voxelSize, 0);
      mesh.setMatrixAt(instance, matrix);
      color.setRGB(pixels.data[offset] / 255, pixels.data[offset + 1] / 255, pixels.data[offset + 2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(instance, color);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    frames.push(mesh);
  }
  return frames;
}
