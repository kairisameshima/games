import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The page builds the formation and meshes the crew in workers: generous, for a software-rendered CI browser. */
export const LOAD_TIMEOUT_MS = 180_000;
const VIEWPORT = { width: 1400, height: 900 } as const;

/**
 * Serves the app from source, opens it in headless Chrome, waits for it to build, and runs `run` on the page. Whatever
 * the page throws is collected for the caller to judge.
 */
export async function withAppPage<T>(run: (page: Page) => Promise<T>): Promise<{ result: T; pageErrors: string[] }> {
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
    return { result: await run(page), pageErrors };
  } finally {
    await browser.close();
    await server.close();
  }
}
