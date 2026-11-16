import itemsLayout from "./assets/items.json";
import itemsUrl from "./assets/items.png";
import prizesLayout from "./assets/prizes.json";
import prizesUrl from "./assets/prizes.png";
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
  /** Loot items, one frame each, in ITEM_KINDS order. */
  items: Sheet;
  /** Grand prizes, one frame each, in MACHINES order. */
  prizes: Sheet;
}

export const RACCOON_FRAMES = { idle: [0, 1], cheer: [2, 3] } as const;
export const ITEMS_SHEET_URL = itemsUrl;
export const ITEMS_SHEET_LAYOUT: SheetLayout = itemsLayout;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function loadPusherArt(): Promise<PusherArt> {
  const [reels, raccoon, items, prizes] = await Promise.all([
    loadImage(reelsUrl),
    loadImage(raccoonUrl),
    loadImage(itemsUrl),
    loadImage(prizesUrl),
  ]);
  return {
    reels: { image: reels, layout: reelsLayout },
    raccoon: { image: raccoon, layout: raccoonLayout },
    items: { image: items, layout: itemsLayout },
    prizes: { image: prizes, layout: prizesLayout },
  };
}
