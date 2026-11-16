import cavernFarUrl from "../assets/cavern_far.png";
import cavernMidUrl from "../assets/cavern_mid.png";
import galleryCoalLayout from "../assets/gallery_coal.json";
import galleryCoalUrl from "../assets/gallery_coal.png";
import galleryCopperLayout from "../assets/gallery_copper.json";
import galleryCopperUrl from "../assets/gallery_copper.png";
import galleryCrystalLayout from "../assets/gallery_crystal.json";
import galleryCrystalUrl from "../assets/gallery_crystal.png";
import galleryGoldLayout from "../assets/gallery_gold.json";
import galleryGoldUrl from "../assets/gallery_gold.png";
import galleryTopsoilLayout from "../assets/gallery_topsoil.json";
import galleryTopsoilUrl from "../assets/gallery_topsoil.png";
import kidLayout from "../assets/kid.json";
import kidUrl from "../assets/kid.png";
import propsLayout from "../assets/props.json";
import propsUrl from "../assets/props.png";
import surfaceUrl from "../assets/surface.png";
import toolsLayout from "../assets/tools.json";
import toolsUrl from "../assets/tools.png";
import type { ZoneId } from "../data/zones.ts";

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

export interface GalleryArt {
  image: HTMLImageElement;
  /** Row of the top of the plank floor inside the image. */
  floorY: number;
  /** Column where the dig face starts inside the image. */
  faceX: number;
}

export interface GameArt {
  surface: HTMLImageElement;
  cavernFar: HTMLImageElement;
  cavernMid: HTMLImageElement;
  galleries: Record<ZoneId, GalleryArt>;
  kid: Sheet;
  props: Sheet;
  tools: Sheet;
}

/** Frame order in the props sheet. */
export const PROP_FRAMES = { liftCage: 0, crateEmpty: 1, crateFull: 2, oreSack: 3 } as const;

/** Rows in the kid sheet; each row has 4 frames. */
export const KID_ROWS = { walk: 0, mine: 1, carry: 2 } as const;
export const KID_FRAMES_PER_ROW = 4;

export const TOOLS_SHEET_URL = toolsUrl;
export const TOOLS_SHEET_LAYOUT: SheetLayout = toolsLayout;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function loadGallery(url: string, layout: { floorY: number; faceX: number }): Promise<GalleryArt> {
  return { image: await loadImage(url), ...layout };
}

export async function loadGameArt(): Promise<GameArt> {
  const [surface, cavernFar, cavernMid, kid, props, tools, topsoil, coal, copper, gold, crystal] = await Promise.all([
    loadImage(surfaceUrl),
    loadImage(cavernFarUrl),
    loadImage(cavernMidUrl),
    loadImage(kidUrl),
    loadImage(propsUrl),
    loadImage(toolsUrl),
    loadGallery(galleryTopsoilUrl, galleryTopsoilLayout),
    loadGallery(galleryCoalUrl, galleryCoalLayout),
    loadGallery(galleryCopperUrl, galleryCopperLayout),
    loadGallery(galleryGoldUrl, galleryGoldLayout),
    loadGallery(galleryCrystalUrl, galleryCrystalLayout),
  ]);
  return {
    surface,
    cavernFar,
    cavernMid,
    galleries: { topsoil, coal, copper, gold, crystal },
    kid: { image: kid, layout: kidLayout },
    props: { image: props, layout: propsLayout },
    tools: { image: tools, layout: toolsLayout },
  };
}
