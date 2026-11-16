import * as THREE from "three";
import { MAX_SPIN_STOCK, REEL_COUNT, SLOT_SYMBOLS, type SlotReels } from "./slot.ts";

const SCREEN_WIDTH = 512;
const SCREEN_HEIGHT = 192;
const REEL_WIDTH = 120;
const REEL_HEIGHT = 120;
const REEL_GAP = 16;
const REEL_TOP = 14;
const PIP_RADIUS = 7;
const PIP_SPACING = 26;
const PIP_Y = 168;
/** How many symbols per second scroll past on a spinning reel. */
const SPIN_SYMBOLS_PER_SECOND = 14;
const WIN_BANNER_SECONDS = 2.5;

/** The slot's display, drawn to a canvas and shown as a texture on the machine's back wall. */
export class SlotScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private winPayout = 0;
  private winShownAt = -Infinity;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.context = context;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  showWin(payout: number, timeSeconds: number): void {
    this.winPayout = payout;
    this.winShownAt = timeSeconds;
  }

  draw(slot: SlotReels, timeSeconds: number): void {
    const context = this.context;
    context.fillStyle = "#12081f";
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const reelsLeft = (SCREEN_WIDTH - REEL_COUNT * REEL_WIDTH - (REEL_COUNT - 1) * REEL_GAP) / 2;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `bold 84px "Jersey 10", system-ui, sans-serif`;

    for (let reel = 0; reel < REEL_COUNT; reel++) {
      const left = reelsLeft + reel * (REEL_WIDTH + REEL_GAP);
      context.fillStyle = "#fff3d6";
      context.fillRect(left, REEL_TOP, REEL_WIDTH, REEL_HEIGHT);
      // A spinning reel flicks through symbols; reels offset so they do not flick in step.
      const symbol = slot.isReelSpinning(reel)
        ? Math.floor(timeSeconds * SPIN_SYMBOLS_PER_SECOND + reel * 2) % SLOT_SYMBOLS.length
        : slot.reels[reel];
      context.fillStyle = "#c2185b";
      context.fillText(SLOT_SYMBOLS[symbol].glyph, left + REEL_WIDTH / 2, REEL_TOP + REEL_HEIGHT / 2 + 4);
    }

    for (let pip = 0; pip < MAX_SPIN_STOCK; pip++) {
      context.fillStyle = pip < slot.stock ? "#39d7ff" : "#3a2a55";
      context.beginPath();
      context.arc(SCREEN_WIDTH / 2 + (pip - (MAX_SPIN_STOCK - 1) / 2) * PIP_SPACING, PIP_Y, PIP_RADIUS, 0, Math.PI * 2);
      context.fill();
    }

    if (timeSeconds - this.winShownAt < WIN_BANNER_SECONDS) {
      context.fillStyle = "rgba(18, 8, 31, 0.7)";
      context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      context.fillStyle = "#f5c04a";
      context.font = `bold 110px "Jersey 10", system-ui, sans-serif`;
      context.fillText(`+${this.winPayout}`, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    }
    this.texture.needsUpdate = true;
  }
}
