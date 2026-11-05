import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import type { AuditReport } from '../src/debug/audits';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL('./audit-baseline.json', import.meta.url));
/** A reach or a part outside the skin may grow by this much before it counts as a regression, centimetres. */
const TOLERANCE_CM = 0.5;
/** The page builds the formation and meshes the crew in workers: generous, for a software-rendered CI browser. */
const LOAD_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1400, height: 900 } as const;

type Baseline = AuditReport;

/** Every way `report` is worse than `baseline`: a reach or a part further out, or a man or part the baseline lacks. */
function regressions(report: AuditReport, baseline: Baseline): string[] {
  const found: string[] = [];
  const baselineCrew = new Map(baseline.crew.map((member) => [member.role, member]));
  for (const member of report.crew) {
    const known = baselineCrew.get(member.role);
    if (!known) {
      found.push(`crew: ${member.role} is not in the baseline`);
      continue;
    }
    for (const [limb, reach] of Object.entries(member.reachCm) as [keyof typeof member.reachCm, number][]) {
      if (reach > known.reachCm[limb] + TOLERANCE_CM) found.push(`crew: ${member.role} ${limb} misses its target by ${reach} cm (baseline ${known.reachCm[limb]})`);
    }
    if (member.hullOut > known.hullOut) found.push(`crew: ${member.role} has ${member.hullOut} vertices through the skin (baseline ${known.hullOut})`);
  }
  for (const [part, excess] of Object.entries(report.equipment)) {
    const known = baseline.equipment[part];
    if (known === undefined) found.push(`equipment: ${part} is ${excess} cm through the skin, not in the baseline`);
    else if (excess > known + TOLERANCE_CM) found.push(`equipment: ${part} is ${excess} cm through the skin (baseline ${known})`);
  }
  return found;
}

/** Entries the baseline still carries that the model no longer has: fixed, so the baseline can be tightened. */
function improvements(report: AuditReport, baseline: Baseline): string[] {
  const found: string[] = [];
  for (const part of Object.keys(baseline.equipment)) {
    if (!(part in report.equipment)) found.push(`equipment: ${part} is now inside the skin`);
  }
  for (const known of baseline.crew) {
    const member = report.crew.find((candidate) => candidate.role === known.role);
    if (member && member.hullOut < known.hullOut) found.push(`crew: ${member.role} through the skin ${known.hullOut} → ${member.hullOut} vertices`);
  }
  return found;
}

async function auditInBrowser(): Promise<{ report: AuditReport; pageErrors: string[] }> {
  const server = await createServer({ root: PROJECT_ROOT, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite dev server has no local URL');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.waitForFunction('"b17Debug" in window', undefined, { timeout: LOAD_TIMEOUT_MS });
    // Held still, so the audit sees one pose of everything.
    await page.evaluate('window.b17Debug.setPlaying(false)');
    await page.waitForFunction('window.b17Debug.crewMeshed()', undefined, { timeout: LOAD_TIMEOUT_MS, polling: 500 });
    const report = await page.evaluate<AuditReport>('window.b17Debug.audit()');
    return { report, pageErrors };
  } finally {
    await browser.close();
    await server.close();
  }
}

const update = process.argv.includes('--update');
const { report, pageErrors } = await auditInBrowser();
if (update && pageErrors.length > 0) {
  for (const message of pageErrors) console.error(`page error: ${message}`);
  console.error('Baseline not written: the page threw while loading.');
  process.exitCode = 1;
} else if (update) {
  await writeFile(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Baseline written: ${report.crew.length} crew, ${Object.keys(report.equipment).length} known equipment entries.`);
} else {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as Baseline;
  const failures = [...pageErrors.map((message) => `page error: ${message}`), ...regressions(report, baseline)];
  for (const note of improvements(report, baseline)) console.log(`improved  ${note}`);
  for (const failure of failures) console.error(`REGRESSED ${failure}`);
  console.log(failures.length === 0
    ? `Audit passed: ${report.crew.length} crew, ${Object.keys(report.equipment).length} equipment entries within the baseline.`
    : `Audit failed: ${failures.length} regression(s). If they are intended, run \`npm run audit -- --update\`.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
