import * as THREE from 'three';

/** What the app is showing, sampled into the log once a second and at every segment start. */
export interface RenderLogContext {
  view: string;
  show: string;
  phase: string;
  playing: boolean;
  pixelRatio: number;
  /** Quality features shed by adaptive quality, in shedding order. */
  featuresShed: string[];
  qualityPinned: boolean;
}

/**
 * A controlled change the log measures the frame against: applied for one segment, then undone. Probes run with
 * quality pinned, so adaptive quality cannot move under them.
 */
export interface RenderLogProbe {
  label: string;
  apply: () => void;
  restore: () => void;
}

export interface RenderLogHooks {
  context: () => RenderLogContext;
  /** Pins quality at full for the probes, and releases it after. */
  pinQuality: (pinned: boolean) => void;
  probes: RenderLogProbe[];
  onStatus: (text: string) => void;
}

/** Live recording first, as the viewer sees it, then each probe: settle, then measure. */
const LIVE_SECONDS = 10;
const PROBE_SETTLE_SECONDS = 1.5;
const PROBE_MEASURE_SECONDS = 3.5;
const CONTEXT_SAMPLE_SECONDS = 1;

interface FrameRecord {
  /** Seconds since recording began. */
  t: number;
  segment: number;
  /** Time since the previous frame started. */
  frameMs: number;
  /** Main-thread time spent in the frame callback. */
  cpuMs: number;
  /**
   * Time from the frame's start until the GPU has finished it, waited for with a one-pixel read-back. With the film
   * locked to its stop-motion rate, fps no longer shows what a frame costs; this does.
   */
  costMs: number;
  /** GPU time for the whole frame from a timer query, when the browser offers one. */
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
}

interface PassTotals { renders: number; cpuMs: number; drawCalls: number; triangles: number }

interface Segment {
  label: string;
  context: RenderLogContext;
  passes: Map<string, PassTotals>;
}

interface PendingQuery { query: WebGLQuery; record: FrameRecord }

interface Stats { mean: number; p50: number; p95: number; max: number }

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  const round = (value: number) => Math.round(value * 100) / 100;
  return { mean: round(values.reduce((sum, value) => sum + value, 0) / values.length), p50: round(pick(0.5)), p95: round(pick(0.95)), max: round(sorted[sorted.length - 1]) };
}

/**
 * Records how the renderer is doing on this machine and exports it as JSON: the machine and GPU, then per frame the
 * frame time, main-thread time, GPU time, draw calls and triangles, per render pass the main-thread cost, adaptive
 * quality changes, long tasks, and a set of probes that each switch one thing off to show what it costs here.
 */
export class RenderLog {
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private active = false;
  private startedAt = 0;
  private segmentIndex = -1;
  private segmentStartedAt = 0;
  private settling = false;
  private awaitingFirstFrame = false;
  private frameStartedAt = 0;
  private lastFrameAt = 0;
  private sinceContext = 0;
  private frames: FrameRecord[] = [];
  private segments: Segment[] = [];
  private timeline: (RenderLogContext & { t: number })[] = [];
  private events: { t: number; kind: string; detail: Record<string, unknown> }[] = [];
  private longTasks: { t: number; ms: number }[] = [];
  private pending: PendingQuery[] = [];
  private frameQuery: WebGLQuery | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  private originalRender: THREE.WebGLRenderer['render'] | null = null;
  private readonly readBack = new Uint8Array(4);

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly hooks: RenderLogHooks) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get recording(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.frames = [];
    this.segments = [];
    this.timeline = [];
    this.events = [];
    this.longTasks = [];
    this.renderer.info.autoReset = false;
    this.wrapRender();
    this.observeLongTasks();
    this.enterSegment(0);
  }

  /** Records an app event (adaptive quality stepping, a view change) against the recording's clock. */
  note(kind: string, detail: Record<string, unknown>): void {
    if (this.active) this.events.push({ t: this.elapsed(), kind, detail });
  }

  /** Call at the top of the frame callback. */
  beginFrame(): void {
    if (!this.active) return;
    this.frameStartedAt = performance.now();
    this.renderer.info.reset();
    this.collectQueries();
    if (this.timer) {
      this.frameQuery = this.gl.createQuery();
      if (this.frameQuery) this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.frameQuery);
    }
  }

  /** Call at the end of the frame callback, after the frame is submitted. */
  endFrame(frameDeltaSec: number): void {
    if (!this.active) return;
    const now = performance.now();
    if (this.timer && this.frameQuery) this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.readBack);
    const finished = performance.now();
    const record: FrameRecord = {
      t: round(this.elapsed()),
      segment: this.segmentIndex,
      frameMs: round(this.lastFrameAt === 0 ? frameDeltaSec * 1000 : this.frameStartedAt - this.lastFrameAt),
      cpuMs: round(now - this.frameStartedAt),
      costMs: round(finished - this.frameStartedAt),
      gpuMs: null,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.lastFrameAt = this.frameStartedAt;
    if (!this.settling) this.frames.push(record);
    if (this.frameQuery) this.pending.push({ query: this.frameQuery, record });
    this.frameQuery = null;

    this.sinceContext += frameDeltaSec;
    if (this.sinceContext >= CONTEXT_SAMPLE_SECONDS) {
      this.sinceContext = 0;
      this.timeline.push({ t: round(this.elapsed()), ...this.hooks.context() });
    }
    this.advanceSegment(now);
  }

  private elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  private segmentLabel(index: number): string {
    return index === 0 ? 'live' : this.hooks.probes[index - 1].label;
  }

  private enterSegment(index: number): void {
    if (this.segmentIndex > 0) this.hooks.probes[this.segmentIndex - 1].restore();
    this.segmentIndex = index;
    this.segmentStartedAt = performance.now();
    if (index === 1) this.hooks.pinQuality(true);
    if (index > 0) this.hooks.probes[index - 1].apply();
    this.settling = index > 0;
    this.awaitingFirstFrame = index > 0;
    this.segments.push({ label: this.segmentLabel(index), context: this.hooks.context(), passes: new Map() });
    this.reportStatus();
  }

  private advanceSegment(now: number): void {
    // A probe's first frame can stall (a driver compiling for what it changed); its settle time starts once it is done.
    if (this.awaitingFirstFrame) {
      this.awaitingFirstFrame = false;
      this.segmentStartedAt = performance.now();
      return;
    }
    const inSegment = (now - this.segmentStartedAt) / 1000;
    if (this.segmentIndex === 0) {
      if (inSegment >= LIVE_SECONDS) this.enterSegment(1);
      else this.reportStatus();
      return;
    }
    if (this.settling && inSegment >= PROBE_SETTLE_SECONDS) this.settling = false;
    if (inSegment < PROBE_SETTLE_SECONDS + PROBE_MEASURE_SECONDS) return;
    if (this.segmentIndex < this.hooks.probes.length) this.enterSegment(this.segmentIndex + 1);
    else this.finish();
  }

  private reportStatus(): void {
    if (this.segmentIndex === 0) {
      const left = Math.max(0, Math.ceil(LIVE_SECONDS - (performance.now() - this.segmentStartedAt) / 1000));
      this.hooks.onStatus(`Recording · ${left} s`);
    } else {
      this.hooks.onStatus(`Probe ${this.segmentIndex}/${this.hooks.probes.length}: ${this.segmentLabel(this.segmentIndex)}`);
    }
  }

  private finish(): void {
    this.hooks.probes[this.segmentIndex - 1].restore();
    this.hooks.pinQuality(false);
    this.active = false;
    this.renderer.info.autoReset = true;
    if (this.originalRender) this.renderer.render = this.originalRender;
    this.originalRender = null;
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    // Queries still in flight are given a moment to land before the log is written.
    window.setTimeout(() => {
      this.collectQueries();
      const name = `b17-render-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      download(name, JSON.stringify(this.report(), null, 1));
      this.hooks.onStatus(`Saved ${name}`);
    }, 300);
  }

  /** Times every `renderer.render` call by target and pass, into the current segment. */
  private wrapRender(): void {
    const renderer = this.renderer;
    const render = renderer.render.bind(renderer);
    this.originalRender = renderer.render;
    renderer.render = (scene, camera) => {
      const segment = this.segments[this.segmentIndex];
      if (!segment || this.settling) {
        render(scene, camera);
        return;
      }
      const target = renderer.getRenderTarget();
      const shadow = renderer.shadowMap.enabled && renderer.shadowMap.needsUpdate && scene instanceof THREE.Scene;
      const kind = scene instanceof THREE.Scene ? (scene.overrideMaterial ? `scene (${scene.overrideMaterial.type})` : 'scene') : 'fullscreen pass';
      const key = `${kind} → ${target ? `${target.width}×${target.height}${target.samples ? ` msaa${target.samples}` : ''}` : 'canvas'}${shadow ? ' + shadow map' : ''}`;
      const callsBefore = renderer.info.render.calls;
      const trianglesBefore = renderer.info.render.triangles;
      const started = performance.now();
      render(scene, camera);
      const totals = segment.passes.get(key) ?? { renders: 0, cpuMs: 0, drawCalls: 0, triangles: 0 };
      totals.renders += 1;
      totals.cpuMs += performance.now() - started;
      totals.drawCalls += renderer.info.render.calls - callsBefore;
      totals.triangles += renderer.info.render.triangles - trianglesBefore;
      segment.passes.set(key, totals);
    };
  }

  private observeLongTasks(): void {
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    this.longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) this.longTasks.push({ t: round((entry.startTime - this.startedAt) / 1000), ms: Math.round(entry.duration) });
    });
    this.longTaskObserver.observe({ type: 'longtask' });
  }

  private collectQueries(): void {
    if (!this.timer) return;
    const disjoint = this.gl.getParameter(this.timer.GPU_DISJOINT_EXT) as boolean;
    this.pending = this.pending.filter(({ query, record }) => {
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) record.gpuMs = round((this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number) / 1e6);
      this.gl.deleteQuery(query);
      return false;
    });
  }

  private report(): Record<string, unknown> {
    const debugInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
    const drawingBuffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const segments = this.segments.map((segment, index) => {
      const frames = this.frames.filter((frame) => frame.segment === index);
      const frameMs = stats(frames.map((frame) => frame.frameMs));
      const gpu = frames.map((frame) => frame.gpuMs).filter((value): value is number => value !== null);
      return {
        label: segment.label,
        context: segment.context,
        frames: frames.length,
        fps: frameMs ? Math.round((1000 / frameMs.mean) * 10) / 10 : null,
        frameMs,
        cpuMs: stats(frames.map((frame) => frame.cpuMs)),
        costMs: stats(frames.map((frame) => frame.costMs)),
        gpuMs: stats(gpu),
        drawCalls: stats(frames.map((frame) => frame.drawCalls)),
        triangles: stats(frames.map((frame) => frame.triangles)),
        passesPerFrame: [...segment.passes.entries()]
          .map(([pass, totals]) => ({
            pass,
            renders: round(totals.renders / Math.max(frames.length, 1)),
            cpuMs: round(totals.cpuMs / Math.max(frames.length, 1)),
            drawCalls: Math.round(totals.drawCalls / Math.max(frames.length, 1)),
            triangles: Math.round(totals.triangles / Math.max(frames.length, 1)),
          }))
          .sort((a, b) => b.cpuMs - a.cpuMs),
      };
    });
    return {
      app: 'b17-sortie',
      recordedAt: new Date().toISOString(),
      machine: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        cpuThreads: navigator.hardwareConcurrency,
        memoryGb: navigatorWithMemory.deviceMemory ?? null,
        devicePixelRatio,
        window: [innerWidth, innerHeight],
        screen: [screen.width, screen.height],
        drawingBuffer: [drawingBuffer.x, drawingBuffer.y],
      },
      gpu: {
        vendor: debugInfo ? this.gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : this.gl.getParameter(this.gl.VENDOR),
        renderer: debugInfo ? this.gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : this.gl.getParameter(this.gl.RENDERER),
        timerQueries: this.timer !== null,
        maxSamples: this.gl.getParameter(this.gl.MAX_SAMPLES),
        maxTextureSize: this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),
        programs: this.renderer.info.programs?.length ?? null,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      },
      notes: [
        'live: as the viewer saw it, adaptive quality on. Probes: quality pinned at full, one change each.',
        'The film is locked to 12 exposures a second, so fps sits near 12 wherever the machine keeps up; costMs, the',
        'time until the GPU has finished a frame, is the cost to compare. frameMs is the interval between drawn frames;',
        'cpuMs is main-thread time in the frame callback;',
        'gpuMs comes from a timer query round the whole frame and is missing where the browser has none; ANGLE on Metal',
        'times whole command buffers, idle included, so there it overstates: compare probes against each other, not 16.7 ms.',
      ],
      segments,
      timeline: this.timeline,
      events: this.events,
      longTasks: this.longTasks,
      frames: this.frames,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
