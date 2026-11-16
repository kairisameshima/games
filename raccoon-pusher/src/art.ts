import raccoonLayout from "./assets/raccoon.json";
import raccoonUrl from "./assets/raccoon.png";
import reelsLayout from "./assets/reels.json";
import reelsUrl from "./assets/reels.png";

export interface SheetLayout {
  rows: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

export interface Sheet {
  image: HTMLImageElement;
  layout: SheetLayout;
}

export interface PusherArt {
  /** Slot symbols, one frame each, in SLOT_SYMBOLS order. */
  reels: Sheet;
  /** Raccoon frames: two idle, then two cheering. */
  raccoon: Sheet;
}

export const RACCOON_FRAMES = { idle: [0, 1], cheer: [2, 3] } as const;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function loadPusherArt(): Promise<PusherArt> {
  const [reels, raccoon] = await Promise.all([loadImage(reelsUrl), loadImage(raccoonUrl)]);
  return { reels: { image: reels, layout: reelsLayout }, raccoon: { image: raccoon, layout: raccoonLayout } };
}
