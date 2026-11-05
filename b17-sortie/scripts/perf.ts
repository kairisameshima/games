import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RenderLogReport } from '../src/render/render-log';
import { LOAD_TIMEOUT_MS, withAppPage } from './app-page.ts';

const BASELINE_PATH = fileURLToPath(new URL('./perf-baseline.json', import.meta.url));
/**
 * A segment's frame cost may grow by this fraction, plus `SLACK_MS`, before it counts as slower: even the fastest of
 * two recordings wanders by a third run to run on one machine, so the check is for a real regression, not a few
 * percent.
 */
const TOLERANCE = 0.5;
const SLACK_MS = 2;
/**
 * Recordings per run; each segment's cost is taken from the fastest, as interference from the rest of the machine
 * only ever adds to it.
 */
const RECORDINGS = 2;
/** The render log takes its live 10 s and then each probe's 5 s: well inside this. */
const RECORDING_TIMEOUT_MS = 120_000;
/** The film runs this long into the shot before it is held and recorded. */
const SETTLE_MS = 3000;
/** Sortie time of the held shot: on the bomb run, flak bursting round the box. */
const BENCHMARK_SORTIE_SECONDS = 34;

/** What a run keeps of each segment: the frame cost, median and 95th percentile, milliseconds. */
interface SegmentCost { p50: number; p95: number }

interface PerfBaseline {
  /** The GPU and browser the baseline was measured on; costs only compare on the same one. */
  gpu: string;
  segments: Record<string, SegmentCost>;
}

function costs(report: RenderLogReport): Record<string, SegmentCost> {
  return Object.fromEntries(report.segments.flatMap((segment) => (segment.costMs ? [[segment.label, { p50: segment.costMs.p50, p95: segment.costMs.p95 }]] : [])));
}

/** Segments whose cost has grown past the tolerance, worded for the console. */
function slower(measured: Record<string, SegmentCost>, baseline: PerfBaseline): string[] {
  const found: string[] = [];
  for (const [label, cost] of Object.entries(measured)) {
    const known = baseline.segments[label];
    if (!known) {
      found.push(`${label}: not in the baseline`);
      continue;
    }
    for (const statistic of ['p50', 'p95'] as const) {
      const limit = known[statistic] * (1 + TOLERANCE) + SLACK_MS;
      if (cost[statistic] > limit) found.push(`${label}: ${statistic} ${cost[statistic]} ms, over ${limit.toFixed(1)} (baseline ${known[statistic]})`);
    }
  }
  return found;
}

/** The fastest of several recordings, segment by segment: what the machine costs with the least else running on it. */
function fastest(runs: Record<string, SegmentCost>[]): Record<string, SegmentCost> {
  const best: Record<string, SegmentCost> = {};
  for (const run of runs) {
    for (const [label, cost] of Object.entries(run)) {
      const known = best[label];
      best[label] = known ? { p50: Math.min(known.p50, cost.p50), p95: Math.min(known.p95, cost.p95) } : cost;
    }
  }
  return best;
}

const update = process.argv.includes('--update');
const { result: reports, pageErrors } = await withAppPage(async (page) => {
  // One held shot, the same every run: the box on the bomb run in flak, the film paused (exposures still draw), once
  // the men are meshed and the drawing has settled.
  await page.waitForFunction('window.b17Debug.crewMeshed()', undefined, { timeout: LOAD_TIMEOUT_MS, polling: 500 });
  await page.evaluate(`window.b17Debug.jumpToPhase(3); window.b17Debug.seek(${BENCHMARK_SORTIE_SECONDS})`);
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate('window.b17Debug.setPlaying(false)');
  const recorded: RenderLogReport[] = [];
  for (let run = 0; run < RECORDINGS; run++) {
    await page.evaluate('window.b17Debug.renderLog.start()');
    await page.waitForFunction('window.b17Debug.renderLog.lastReport !== null', undefined, { timeout: RECORDING_TIMEOUT_MS, polling: 1000 });
    recorded.push(await page.evaluate<RenderLogReport>('window.b17Debug.renderLog.lastReport'));
  }
  return recorded;
});
const gpu = `${reports[0].gpu.renderer} · ${reports[0].machine.drawingBuffer.join('×')}`;
const measured = fastest(reports.map(costs));
for (const [label, cost] of Object.entries(measured)) console.log(`${label.padEnd(44)} p50 ${cost.p50.toFixed(1).padStart(6)} ms   p95 ${cost.p95.toFixed(1).padStart(6)} ms`);

if (pageErrors.length > 0) {
  for (const message of pageErrors) console.error(`page error: ${message}`);
  process.exitCode = 1;
} else if (update) {
  const baseline: PerfBaseline = { gpu, segments: measured };
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Baseline written for ${gpu}.`);
} else {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as PerfBaseline;
  if (baseline.gpu !== gpu) {
    console.log(`Baseline is for ${baseline.gpu}, this run is ${gpu}: costs not compared. Run \`npm run perf -- --update\` here to measure against this machine.`);
  } else {
    const found = slower(measured, baseline);
    for (const line of found) console.error(`SLOWER ${line}`);
    console.log(found.length === 0 ? 'Perf passed: every segment within the baseline.' : `Perf failed: ${found.length} segment cost(s) over the baseline.`);
    process.exitCode = found.length === 0 ? 0 : 1;
  }
}
