import * as THREE from "three";
import type { Sheet } from "./art.ts";
import { MAX_SPIN_STOCK, REEL_COUNT, SLOT_SYMBOLS, type SlotReels } from "./slot.ts";

// The screen is drawn at art-pixel resolution: one canvas pixel per art pixel on the back wall.
const SCREEN_WIDTH = 64;
const SCREEN_HEIGHT = 26;
const REEL_SIZE = 18;
const REEL_GAP = 2;
const REEL_TOP = 1;
const PIP_SIZE = 2;
const PIP_SPACING = 4;
const PIP_Y = 22;
/** How many symbols per second flick past on a spinning reel. */
const SPIN_SYMBOLS_PER_SECOND = 14;
const WIN_BANNER_SECONDS = 2.5;
const WIN_FONT = `12px "Jersey 10", ui-monospace, monospace`;

/** The slot's display, drawn to a tiny canvas and shown as a pixel-art texture on the machine's back wall. */
export class SlotScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly reelIcons: Sheet;
  private winPayout = 0;
  private winShownAt = -Infinity;

  constructor(reelIcons: Sheet) {
    this.reelIcons = reelIcons;
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    context.imageSmoothingEnabled = false;
    this.context = context;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }

  showWin(payout: number, timeSeconds: number): void {
    this.winPayout = payout;
    this.winShownAt = timeSeconds;
  }

  private drawIcon(symbol: number, left: number, top: number): void {
    const { cellWidth, cellHeight, columns } = this.reelIcons.layout;
    // Scale the cell to fit the reel window, keeping its aspect.
    const scale = Math.min(REEL_SIZE / cellWidth, REEL_SIZE / cellHeight);
    const width = Math.round(cellWidth * scale);
    const height = Math.round(cellHeight * scale);
    this.context.drawImage(
      this.reelIcons.image,
      (symbol % columns) * cellWidth,
      Math.floor(symbol / columns) * cellHeight,
      cellWidth,
      cellHeight,
      left + Math.floor((REEL_SIZE - width) / 2),
      top + Math.floor((REEL_SIZE - height) / 2),
      width,
      height,
    );
  }

  draw(slot: SlotReels, timeSeconds: number): void {
    const context = this.context;
    context.fillStyle = "#12081f";
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const reelsLeft = Math.floor((SCREEN_WIDTH - REEL_COUNT * REEL_SIZE - (REEL_COUNT - 1) * REEL_GAP) / 2);

    for (let reel = 0; reel < REEL_COUNT; reel++) {
      const left = reelsLeft + reel * (REEL_SIZE + REEL_GAP);
      context.fillStyle = "#fff3d6";
      context.fillRect(left, REEL_TOP, REEL_SIZE, REEL_SIZE);
      // A spinning reel flicks through symbols; reels are offset so they do not flick in step.
      const symbol = slot.isReelSpinning(reel)
        ? Math.floor(timeSeconds * SPIN_SYMBOLS_PER_SECOND + reel * 2) % SLOT_SYMBOLS.length
        : slot.reels[reel];
      this.drawIcon(symbol, left, REEL_TOP);
    }

    const pipsLeft = Math.floor((SCREEN_WIDTH - (MAX_SPIN_STOCK - 1) * PIP_SPACING - PIP_SIZE) / 2);
    for (let pip = 0; pip < MAX_SPIN_STOCK; pip++) {
      context.fillStyle = pip < slot.stock ? "#39d7ff" : "#3a2a55";
      context.fillRect(pipsLeft + pip * PIP_SPACING, PIP_Y, PIP_SIZE, PIP_SIZE);
    }

    if (timeSeconds - this.winShownAt < WIN_BANNER_SECONDS) {
      context.fillStyle = "#12081f";
      context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      context.fillStyle = "#f5c04a";
      context.font = WIN_FONT;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`+${this.winPayout}`, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    }
    this.texture.needsUpdate = true;
  }
}
