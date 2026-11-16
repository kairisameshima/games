import { ZONES } from "../data/zones.ts";
import { openGalleryCost } from "../sim/shop.ts";
import type { GameState } from "../sim/types.ts";
import { formatGold } from "../ui/format.ts";
import { KID_FRAMES_PER_ROW, KID_ROWS, PROP_FRAMES, type GameArt, type Sheet } from "./assets.ts";

/** The world is a fixed-width column of game pixels; the canvas zooms it by a whole number. */
export const WORLD_WIDTH = 160;
const VIEW_TARGET_HEIGHT = 200;

// Shaft geometry measured on surface.png, in game pixels.
const SHAFT_LEFT_POST_X = 8;
const SHAFT_RIGHT_POST_X = 22;
const SHAFT_POST_WIDTH = 3;
const ROPE_X = 16;
const PULLEY_Y = 17;
/** Ground line where the lift cage rests at the surface. */
const SURFACE_STOP_Y = 60;
const BOLT_SPACING = 12;

const GALLERY_X = 26;
const FIRST_FLOOR_BELOW_SURFACE = 40;
const GALLERY_SPACING = 58;
/** Truss depth under each gallery floor, used to end the shaft below the last gallery. */
const FLOOR_THICKNESS = 14;
const BOTTOM_MARGIN = 24;
const LOCKED_GALLERY_ALPHA = 0.3;

const CRATE_X = 3;
const KID_START_X = 22;
const KID_DIG_OFFSET = 7;
const KID_DIG_STAGGER = 5;
const KID_DIG_SPOTS = 3;
const KID_WALK_SPEED = 16;
const KID_ANIMATION_FPS = 8;
const MINE_SWINGS_PER_TRIP = 2;
const MAX_VISIBLE_KIDS = 6;

/** Each layer scrolls at a share of the camera speed and sways a few pixels with the pointer. */
const FAR_LAYER = { scroll: 0.3, sway: 4 };
const MID_LAYER = { scroll: 0.6, sway: 2 };
const CAMERA_EASE_PER_SECOND = 12;
const POINTER_EASE_PER_SECOND = 4;

const LABEL_SIZE = 7;
const WOOD = "#8a5a2b";
const WOOD_DARK = "#3b2214";
const SHAFT_DARK = "#150d1f";
const ROPE = "#c9a35a";
const LABEL_FILL = "#fff3d6";
const LABEL_OUTLINE = "#1b1026";

function galleryFloorY(art: GameArt, galleryIndex: number): number {
  return art.surface.height + FIRST_FLOOR_BELOW_SURFACE + galleryIndex * GALLERY_SPACING;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function ease(current: number, target: number, ratePerSecond: number, seconds: number): number {
  return lerp(current, target, 1 - Math.exp(-ratePerSecond * seconds));
}

export class MineRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly art: GameArt;
  private readonly context: CanvasRenderingContext2D;
  private scale = 1;
  private viewHeight = VIEW_TARGET_HEIGHT;
  private cameraY = 0;
  private cameraTargetY = 0;
  private pointerX = 0;
  private pointerY = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;

  constructor(canvas: HTMLCanvasElement, art: GameArt) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.canvas = canvas;
    this.art = art;
    this.context = context;
  }

  /** Sizes the canvas to the stage: as tall as the stage, as wide as the world at a whole-number zoom. */
  resize(stageCssWidth: number, stageCssHeight: number, devicePixelRatio: number): void {
    const deviceHeight = Math.floor(stageCssHeight * devicePixelRatio);
    const heightScale = Math.floor(deviceHeight / VIEW_TARGET_HEIGHT);
    const widthScale = Math.floor((stageCssWidth * devicePixelRatio) / WORLD_WIDTH);
    this.scale = Math.max(1, Math.min(heightScale, widthScale));
    this.canvas.width = WORLD_WIDTH * this.scale;
    this.canvas.height = deviceHeight;
    this.canvas.style.width = `${this.canvas.width / devicePixelRatio}px`;
    this.canvas.style.height = `${stageCssHeight}px`;
    this.viewHeight = deviceHeight / this.scale;
  }

  /** CSS pixels per game pixel, for turning wheel and drag distances into camera movement. */
  cssPixelsPerGamePixel(devicePixelRatio: number): number {
    return this.scale / devicePixelRatio;
  }

  scrollBy(gamePixels: number): void {
    this.cameraTargetY += gamePixels;
  }

  /** Pointer position over the canvas, from -1 to 1 on each axis. */
  setPointer(x: number, y: number): void {
    this.pointerTargetX = x;
    this.pointerTargetY = y;
  }

  draw(state: GameState, timeSeconds: number, frameSeconds: number): void {
    this.updateCamera(state, frameSeconds);
    const context = this.context;
    context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, WORLD_WIDTH, this.viewHeight);

    this.drawLayer(this.art.cavernFar, FAR_LAYER, true);
    this.drawLayer(this.art.cavernMid, MID_LAYER, false);
    this.drawShaft(state);
    state.galleries.forEach((_gallery, index) => this.drawGallery(state, index, timeSeconds));
    this.drawLockedGallery(state);
    this.drawImage(this.art.surface, 0, 0);
    this.drawLift(state);
  }

  private worldBottom(state: GameState): number {
    const lowestShown = Math.min(state.galleries.length, ZONES.length - 1);
    return galleryFloorY(this.art, lowestShown) + FLOOR_THICKNESS + BOTTOM_MARGIN;
  }

  private updateCamera(state: GameState, frameSeconds: number): void {
    const maxCameraY = Math.max(0, this.worldBottom(state) - this.viewHeight);
    this.cameraTargetY = Math.min(Math.max(this.cameraTargetY, 0), maxCameraY);
    this.cameraY = ease(this.cameraY, this.cameraTargetY, CAMERA_EASE_PER_SECOND, frameSeconds);
    this.pointerX = ease(this.pointerX, this.pointerTargetX, POINTER_EASE_PER_SECOND, frameSeconds);
    this.pointerY = ease(this.pointerY, this.pointerTargetY, POINTER_EASE_PER_SECOND, frameSeconds);
  }

  /** Rounds to whole device pixels: parallax moves smoothly while sprites stay crisp. */
  private snap(gameUnits: number): number {
    return Math.round(gameUnits * this.scale) / this.scale;
  }

  private drawImage(image: CanvasImageSource, worldX: number, worldY: number): void {
    this.context.drawImage(image, this.snap(worldX), this.snap(worldY - this.cameraY));
  }

  private drawFrame(sheet: Sheet, frame: number, centerX: number, bottomY: number, flipX: boolean): void {
    const { cellWidth, cellHeight, columns } = sheet.layout;
    const sourceX = (frame % columns) * cellWidth;
    const sourceY = Math.floor(frame / columns) * cellHeight;
    // Sheet cells keep 1 pixel of padding below each sprite.
    const screenX = this.snap(centerX - cellWidth / 2);
    const screenY = this.snap(bottomY - cellHeight + 1 - this.cameraY);
    const context = this.context;
    context.save();
    context.translate(flipX ? screenX + cellWidth : screenX, screenY);
    context.scale(flipX ? -1 : 1, 1);
    context.drawImage(sheet.image, sourceX, sourceY, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
    context.restore();
  }

  /** Tiles a parallax layer down the whole view. Far tiles mirror every other row so seams match. */
  private drawLayer(image: HTMLImageElement, layer: { scroll: number; sway: number }, mirrorRows: boolean): void {
    const context = this.context;
    const originX = this.snap(this.pointerX * layer.sway);
    const originY = this.snap(this.art.surface.height - this.cameraY * layer.scroll + this.pointerY * layer.sway);
    const firstRow = Math.floor(-originY / image.height);
    for (let row = firstRow; originY + row * image.height < this.viewHeight; row++) {
      const flipY = mirrorRows && row % 2 !== 0;
      // Mirrored neighbours on both sides cover the gap the pointer sway opens at the edges.
      for (const column of [-1, 0, 1]) {
        context.save();
        context.translate(originX + column * image.width + (column !== 0 ? image.width : 0), originY + row * image.height);
        context.scale(column !== 0 ? -1 : 1, flipY ? -1 : 1);
        context.drawImage(image, 0, flipY ? -image.height : 0);
        context.restore();
      }
    }
  }

  private drawShaft(state: GameState): void {
    const context = this.context;
    const top = this.art.surface.height;
    const bottom = galleryFloorY(this.art, state.galleries.length - 1) + FLOOR_THICKNESS;
    const screenTop = this.snap(top - this.cameraY);
    const height = bottom - top;
    context.fillStyle = SHAFT_DARK;
    context.fillRect(SHAFT_LEFT_POST_X, screenTop, SHAFT_RIGHT_POST_X + SHAFT_POST_WIDTH - SHAFT_LEFT_POST_X, height);
    for (const postX of [SHAFT_LEFT_POST_X, SHAFT_RIGHT_POST_X]) {
      context.fillStyle = WOOD;
      context.fillRect(postX, screenTop, SHAFT_POST_WIDTH, height);
      context.fillStyle = WOOD_DARK;
      context.fillRect(postX + SHAFT_POST_WIDTH - 1, screenTop, 1, height);
      for (let boltY = BOLT_SPACING / 2; boltY < height; boltY += BOLT_SPACING) {
        context.fillRect(postX + 1, screenTop + boltY, 1, 1);
      }
    }
  }

  private drawGallery(state: GameState, galleryIndex: number, timeSeconds: number): void {
    const gallery = state.galleries[galleryIndex];
    const art = this.art.galleries[ZONES[galleryIndex].id];
    const floorY = galleryFloorY(this.art, galleryIndex);
    this.drawImage(art.image, GALLERY_X, floorY - art.floorY);

    const crateFrame = gallery.stockpile >= 1 ? PROP_FRAMES.crateFull : PROP_FRAMES.crateEmpty;
    const crateCenterX = GALLERY_X + CRATE_X + this.art.props.layout.cellWidth / 2;
    this.drawFrame(this.art.props, crateFrame, crateCenterX, floorY, false);
    this.drawLabel(formatGold(gallery.stockpile), crateCenterX, floorY - this.art.props.layout.cellHeight + 8);

    const visibleKids = Math.min(gallery.crew, MAX_VISIBLE_KIDS);
    for (let kid = 0; kid < visibleKids; kid++) {
      this.drawKid(galleryIndex, kid, visibleKids, art.faceX, floorY, timeSeconds);
    }
  }

  /** Kids loop crate -> dig face -> crate. The loop is cosmetic; digging income is continuous in the sim. */
  private drawKid(galleryIndex: number, kid: number, visibleKids: number, faceX: number, floorY: number, timeSeconds: number): void {
    const startX = GALLERY_X + KID_START_X;
    const digX = GALLERY_X + faceX - KID_DIG_OFFSET - (kid % KID_DIG_SPOTS) * KID_DIG_STAGGER;
    const walkSeconds = (digX - startX) / KID_WALK_SPEED;
    const mineSeconds = (MINE_SWINGS_PER_TRIP * KID_FRAMES_PER_ROW) / KID_ANIMATION_FPS;
    const cycleSeconds = walkSeconds * 2 + mineSeconds;
    // Spread kids evenly through the loop, and offset each gallery so floors do not move in lockstep.
    const phase = (timeSeconds + (kid * cycleSeconds) / visibleKids + galleryIndex * 0.37) % cycleSeconds;
    const walkFrame = Math.floor(timeSeconds * KID_ANIMATION_FPS) % KID_FRAMES_PER_ROW;

    if (phase < walkSeconds) {
      const x = lerp(startX, digX, phase / walkSeconds);
      this.drawFrame(this.art.kid, KID_ROWS.walk * KID_FRAMES_PER_ROW + walkFrame, x, floorY, false);
    } else if (phase < walkSeconds + mineSeconds) {
      const mineFrame = Math.floor((phase - walkSeconds) * KID_ANIMATION_FPS) % KID_FRAMES_PER_ROW;
      this.drawFrame(this.art.kid, KID_ROWS.mine * KID_FRAMES_PER_ROW + mineFrame, digX, floorY, false);
    } else {
      const x = lerp(digX, startX, (phase - walkSeconds - mineSeconds) / walkSeconds);
      this.drawFrame(this.art.kid, KID_ROWS.carry * KID_FRAMES_PER_ROW + walkFrame, x, floorY, true);
    }
  }

  private drawLockedGallery(state: GameState): void {
    const cost = openGalleryCost(state);
    if (cost === undefined) return;
    const galleryIndex = state.galleries.length;
    const zone = ZONES[galleryIndex];
    const art = this.art.galleries[zone.id];
    const floorY = galleryFloorY(this.art, galleryIndex);
    this.context.globalAlpha = LOCKED_GALLERY_ALPHA;
    this.drawImage(art.image, GALLERY_X, floorY - art.floorY);
    this.context.globalAlpha = 1;
    this.drawLabel(`${zone.name.toUpperCase()}: ${formatGold(cost)}`, GALLERY_X + art.image.width / 2, floorY - 14);
  }

  /** Where the cage bottom rests at a stop: 0 is the surface, 1 is the first gallery. */
  private liftStopY(stop: number): number {
    return stop === 0 ? SURFACE_STOP_Y : galleryFloorY(this.art, stop - 1);
  }

  private liftBottomY(depth: number): number {
    const stop = Math.floor(depth);
    const between = depth - stop;
    return between === 0 ? this.liftStopY(stop) : lerp(this.liftStopY(stop), this.liftStopY(stop + 1), between);
  }

  private drawLift(state: GameState): void {
    const bottomY = this.liftBottomY(state.lift.depth);
    const cageHeight = this.art.props.layout.cellHeight - 2;
    const context = this.context;
    context.fillStyle = ROPE;
    context.fillRect(ROPE_X, this.snap(PULLEY_Y - this.cameraY), 1, this.snap(bottomY - cageHeight - PULLEY_Y));
    this.drawFrame(this.art.props, PROP_FRAMES.liftCage, ROPE_X + 0.5, bottomY, false);
    if (state.lift.cargo >= 1) this.drawLabel(formatGold(state.lift.cargo), ROPE_X + 0.5, bottomY - cageHeight - 2);
  }

  /** Text is drawn in device pixels so it stays sharp at any zoom. */
  private drawLabel(text: string, centerX: number, baselineY: number): void {
    const context = this.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.font = `${LABEL_SIZE * this.scale}px "Jersey 10", ui-monospace, monospace`;
    context.textAlign = "center";
    context.lineJoin = "round";
    context.lineWidth = this.scale;
    context.strokeStyle = LABEL_OUTLINE;
    context.fillStyle = LABEL_FILL;
    const x = Math.round(centerX * this.scale);
    const y = Math.round((baselineY - this.cameraY) * this.scale);
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.restore();
  }
}
