/** Frames kept for the chart: about four seconds at 60 fps. */
const HISTORY = 240;
/** The chart and readout redraw at this rate; measuring stays per frame. */
const REDRAW_SECONDS = 0.1;
/** Frame-time scale of the chart, with guides at the 60 and 30 fps budgets. */
const CHART_MAX_MS = 50;
const GUIDES_MS = [1000 / 60, 1000 / 30];
const CHART = { width: 168, height: 40 } as const;

/**
 * Frame rate readout and a frame-time line chart. Frame times go into a ring buffer each frame; the text and the
 * canvas only redraw ten times a second, so the meter costs next to nothing.
 */
export class FpsMeter {
  private readonly frameMs = new Float32Array(HISTORY);
  private next = 0;
  private filled = 0;
  private sinceRedraw = 0;
  private readonly readout: HTMLElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly scale = Math.min(devicePixelRatio, 2);

  /** `slot`: the element the meter is appended to (the controls panel, so it never overlaps the phase strip). */
  constructor(slot: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'fps';
    this.readout = document.createElement('div');
    this.readout.className = 'fps-readout';
    const canvas = document.createElement('canvas');
    canvas.className = 'fps-chart';
    canvas.width = CHART.width * this.scale;
    canvas.height = CHART.height * this.scale;
    canvas.style.width = `${CHART.width}px`;
    canvas.style.height = `${CHART.height}px`;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context unavailable');
    this.context = context;
    panel.append(this.readout, canvas);
    slot.append(panel);
  }

  /** Call once per rendered frame with the real (unpaused) frame time. */
  record(deltaSec: number): void {
    this.frameMs[this.next] = deltaSec * 1000;
    this.next = (this.next + 1) % HISTORY;
    this.filled = Math.min(this.filled + 1, HISTORY);
    this.sinceRedraw += deltaSec;
    if (this.sinceRedraw < REDRAW_SECONDS) return;
    this.sinceRedraw = 0;
    this.redraw();
  }

  private redraw(): void {
    // Average over the last half second for a steady number.
    const recent = Math.min(this.filled, 30);
    let total = 0;
    let worst = 0;
    for (let index = 1; index <= this.filled; index++) {
      const ms = this.frameMs[(this.next - index + HISTORY) % HISTORY];
      if (index <= recent) total += ms;
      worst = Math.max(worst, ms);
    }
    const average = total / Math.max(recent, 1);
    this.readout.textContent = `${Math.round(1000 / Math.max(average, 1e-3))} fps · ${average.toFixed(1)} ms · worst ${worst.toFixed(0)}`;

    const context = this.context;
    const { width, height } = context.canvas;
    const style = getComputedStyle(this.readout);
    context.clearRect(0, 0, width, height);
    const yOf = (ms: number) => height - (Math.min(ms, CHART_MAX_MS) / CHART_MAX_MS) * height;
    context.lineWidth = this.scale;
    context.strokeStyle = style.getPropertyValue('--fps-guide');
    context.setLineDash([3 * this.scale, 3 * this.scale]);
    for (const guide of GUIDES_MS) {
      context.beginPath();
      context.moveTo(0, yOf(guide));
      context.lineTo(width, yOf(guide));
      context.stroke();
    }
    context.setLineDash([]);
    context.strokeStyle = style.getPropertyValue('--fps-line');
    context.lineWidth = 1.5 * this.scale;
    context.beginPath();
    for (let index = 0; index < this.filled; index++) {
      const ms = this.frameMs[(this.next - this.filled + index + HISTORY) % HISTORY];
      const x = width - ((this.filled - 1 - index) / (HISTORY - 1)) * width;
      if (index === 0) context.moveTo(x, yOf(ms));
      else context.lineTo(x, yOf(ms));
    }
    context.stroke();
  }
}
