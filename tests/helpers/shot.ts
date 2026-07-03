import type { Page, TestInfo } from '@playwright/test';
import { test } from '@playwright/test';

// Per-process step counter. Each `node run.mjs <test>` invocation spawns a
// brand new `npx playwright test` process, so this always starts at 0 for a
// fresh run — no cross-run leakage.
let counter = 0;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

/**
 * Captures a screenshot for the current step into Playwright's own
 * per-test output directory (testInfo.outputPath), so run.mjs can find it
 * next to the video/trace without any extra bookkeeping. Filenames are
 * numbered in step order: shot-00-<slug>.png, shot-01-<slug>.png, ...
 */
async function shot(page: Page, testInfo: TestInfo, stepName: string): Promise<void> {
  const index = counter++;
  const slug = slugify(stepName) || 'step';
  const fileName = `shot-${String(index).padStart(2, '0')}-${slug}.png`;
  const filePath = testInfo.outputPath(fileName);
  // Never let a screenshot failure (e.g. page already closed) mask the
  // real test failure — screenshotting is best-effort evidence capture.
  await page.screenshot({ path: filePath }).catch(() => {});
}

/**
 * Wraps `test.step()` so a screenshot is always taken right after the step
 * body runs, whether it passed or threw. The `finally` fires before the
 * error propagates, so a failing step still gets a shot showing the page
 * at (or immediately after) the moment of failure.
 */
export async function recordedStep(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  await test.step(name, async () => {
    try {
      await fn();
    } finally {
      await shot(page, testInfo, name);
    }
  });
}
