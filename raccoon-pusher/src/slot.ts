export interface SlotSymbol {
  glyph: string;
  /** Relative chance of landing on each reel. */
  weight: number;
  /** Coins showered for three of this symbol across the reels. */
  tripletPayout: number;
}

export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
  { glyph: "🍒", weight: 5, tripletPayout: 8 },
  { glyph: "🔔", weight: 4, tripletPayout: 15 },
  { glyph: "🗑️", weight: 4, tripletPayout: 20 },
  { glyph: "7", weight: 2, tripletPayout: 50 },
  { glyph: "🦝", weight: 1, tripletPayout: 150 },
];

/** Coins for matching the first two reels without the third. */
export const PAIR_PAYOUT = 3;
export const REEL_COUNT = 3;
/** Gate hits beyond this many waiting spins are lost, like a real machine's spin stock. */
export const MAX_SPIN_STOCK = 5;
/** Seconds after a spin starts when each reel stops, left to right. */
export const REEL_STOP_SECONDS = [1, 1.4, 1.8] as const;
const PAUSE_BETWEEN_SPINS_SECONDS = 0.6;

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);

export function rollSymbol(random: () => number): number {
  let roll = random() * TOTAL_WEIGHT;
  for (let index = 0; index < SLOT_SYMBOLS.length; index++) {
    roll -= SLOT_SYMBOLS[index].weight;
    if (roll < 0) return index;
  }
  return SLOT_SYMBOLS.length - 1;
}

export function payoutFor(reels: readonly number[]): number {
  const [first, second, third] = reels;
  if (first === second && second === third) return SLOT_SYMBOLS[first].tripletPayout;
  if (first === second) return PAIR_PAYOUT;
  return 0;
}

export interface SpinResult {
  reels: number[];
  payout: number;
}

export class SlotReels {
  /** Symbol index shown on each reel; mid-spin reels keep the last result until they stop. */
  readonly reels: number[] = [0, 0, 0];
  stock = 0;
  /** Seconds into the current spin, or undefined when idle. */
  spinSeconds: number | undefined;
  private pendingReels: number[] = [];
  private pauseSeconds = 0;

  addStock(spins: number): void {
    this.stock = Math.min(MAX_SPIN_STOCK, this.stock + spins);
  }

  isReelSpinning(reel: number): boolean {
    return this.spinSeconds !== undefined && this.spinSeconds < REEL_STOP_SECONDS[reel];
  }

  /** Advances the reels. Returns the result when a spin finishes. */
  update(seconds: number, random: () => number): SpinResult | undefined {
    if (this.spinSeconds === undefined) {
      this.pauseSeconds = Math.max(0, this.pauseSeconds - seconds);
      if (this.stock === 0 || this.pauseSeconds > 0) return undefined;
      this.stock -= 1;
      this.spinSeconds = 0;
      // The outcome is decided at the start; the reels only reveal it.
      this.pendingReels = Array.from({ length: REEL_COUNT }, () => rollSymbol(random));
      return undefined;
    }
    this.spinSeconds += seconds;
    REEL_STOP_SECONDS.forEach((stopSeconds, reel) => {
      if (this.spinSeconds !== undefined && this.spinSeconds >= stopSeconds) this.reels[reel] = this.pendingReels[reel];
    });
    if (this.spinSeconds < REEL_STOP_SECONDS[REEL_COUNT - 1]) return undefined;
    this.spinSeconds = undefined;
    this.pauseSeconds = PAUSE_BETWEEN_SPINS_SECONDS;
    return { reels: [...this.reels], payout: payoutFor(this.reels) };
  }
}
