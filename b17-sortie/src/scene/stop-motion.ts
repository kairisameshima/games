/**
 * The film is shot like stop motion: everything changes only on exposures, 12 a second ("on twos" at 24 fps), and
 * holds still between them. `advance` returns the time an exposure covers when one is taken this frame, else 0.
 */
export const STOP_MOTION_FPS = 12;
/**
 * An exposure is taken this much before its interval is fully up, so a display's frame ticks that add up to it only
 * within rounding (five 60 Hz frames, ten at 120 Hz) take it on time instead of one tick late.
 */
const EXPOSURE_TOLERANCE_SEC = 0.004;

/**
 * Hand spacing: an animator never moves a model by exactly the same amount each exposure. Each step takes 80–120 % of
 * the time owed, and now and then the model is not moved at all (a held frame, three exposures on one pose), the next
 * step catching up. The film's clock still keeps time with the wall clock over a second or two.
 */
const SPACING = { min: 0.8, max: 1.2, holdChance: 0.07 } as const;

export class StopMotionClock {
  private pending = 0;
  private exposures = 0;
  private jitterState = 7919;
  private owed = 0;

  get frame(): number {
    return this.exposures;
  }

  advance(deltaSec: number): number {
    this.pending += deltaSec;
    if (this.pending < 1 / STOP_MOTION_FPS - EXPOSURE_TOLERANCE_SEC) return 0;
    const exposed = this.pending;
    this.pending = 0;
    this.exposures += 1;
    return exposed;
  }

  /** How far the film moves on an exposure covering `exposureSec` of wall time, with the animator's uneven hand. */
  space(exposureSec: number): number {
    this.owed += exposureSec;
    if (this.random() < SPACING.holdChance) return 0;
    const step = this.owed * (SPACING.min + this.random() * (SPACING.max - SPACING.min));
    this.owed -= step;
    return step;
  }

  /** Seeded jitter for the boil between exposures: the small shifts of props handled between frames. */
  readonly random = (): number => {
    this.jitterState = (this.jitterState * 16807) % 2147483647;
    return this.jitterState / 2147483647;
  };
}
