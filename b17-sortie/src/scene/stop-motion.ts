/**
 * The film is shot like stop motion: everything changes only on exposures and holds still between them. 12 a second is
 * "on twos" (each pose held for two frames of 24 fps film), the classic stop-motion rate; 24 is "on ones", smoother and
 * twice the animator's work. `advance` returns the time an exposure covers when one is taken this frame, else 0.
 */
export type StopMotionRate = 12 | 24;
/** The fastest rate the film can run at: anything sized by exposures per second is sized for this. */
export const MAX_STOP_MOTION_FPS: StopMotionRate = 24;
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
  fps: StopMotionRate = 12;
  /**
   * The animator's hand: uneven spacing and held frames here, and (read by the scene) handled models off their pose,
   * the tripod knocked as a move begins, and the frame weaving in the gate. Off, the film moves evenly and sits still.
   */
  jitter = true;
  /**
   * A charted move: a fast one across the set, which an animator plans on an exposure sheet and spaces evenly, since
   * uneven spacing or a held frame there shows as a stutter. The other touches of the hand stay.
   */
  charted = false;
  private pending = 0;
  private exposures = 0;
  private jitterState = 7919;
  private owed = 0;

  get frame(): number {
    return this.exposures;
  }

  advance(deltaSec: number): number {
    this.pending += deltaSec;
    const interval = 1 / this.fps;
    if (this.pending < interval - EXPOSURE_TOLERANCE_SEC) return 0;
    this.exposures += 1;
    // A long stall is taken in one exposure. Otherwise the exposure covers one interval and the display's overshoot
    // carries to the next: at 24 a second on a 60 Hz display, exposures alternate two and three ticks and still
    // average 24, where taking the whole wait each time would settle on every third tick, 20 a second.
    if (this.pending > interval * 2) {
      const exposed = this.pending;
      this.pending = 0;
      return exposed;
    }
    this.pending -= interval;
    return interval;
  }

  /** How far the film moves on an exposure covering `exposureSec` of wall time, with the animator's uneven hand. */
  space(exposureSec: number): number {
    if (!this.jitter || this.charted) return exposureSec;
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
