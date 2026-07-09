import type { Page, TestInfo } from '@playwright/test';
import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

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
 * Captures the full evidence triple for the current step into Playwright's
 * own per-test output directory (testInfo.outputPath), so run.mjs can find
 * it next to the video/trace without any extra bookkeeping. All three files
 * for a step share the same numeric prefix so run.mjs can pair them by index:
 *
 *   shot-00-<slug>.png    the screenshot  — what the step looked like
 *   dom-00-<slug>.html    page.content()  — the serialized DOM at that instant
 *   state-00-<slug>.json  storageState()  — cookies + localStorage (auth + more)
 *
 * The screenshot is what a human eyeballs; the DOM is what an agent greps to
 * confirm the asserted content is *genuinely present* (not a test that passed
 * for the wrong reason); the storage state is the resumable entry condition
 * (who am I logged in as) that lets a browser be dropped back into this point.
 *
 * Every capture is best-effort and independently guarded: a screenshot,
 * content() read, or storageState() call failing (e.g. the page/context is
 * already closed on a hard failure) must never mask the real test failure.
 */
async function shot(page: Page, testInfo: TestInfo, stepName: string): Promise<void> {
  const index = counter++;
  const prefix = String(index).padStart(2, '0');
  const slug = slugify(stepName) || 'step';
  const base = `${prefix}-${slug}`;

  // Screenshot — the human-facing frame.
  await page
    .screenshot({ path: testInfo.outputPath(`shot-${base}.png`) })
    .catch(() => {});

  // Serialized DOM — the agent-greppable source of truth for what the page
  // actually contained when the step's assertion ran.
  await page
    .content()
    .then((html) => {
      writeFileSafe(testInfo.outputPath(`dom-${base}.html`), html);
    })
    .catch(() => {});

  // Storage state — cookies + per-origin localStorage. This is the auth/entry
  // condition; run.mjs indexes it so a browser can be resumed into this step.
  await page
    .context()
    .storageState()
    .then((state) => {
      writeFileSafe(testInfo.outputPath(`state-${base}.json`), JSON.stringify(state, null, 2));
    })
    .catch(() => {});
}

// Playwright's TestInfo has no direct "write a text file" helper, so wrap
// Node's fs.writeFileSync in a swallow-errors helper used only for the
// DOM/state sidecars — best-effort evidence capture must never throw.
function writeFileSafe(absPath: string, contents: string): void {
  try {
    writeFileSync(absPath, contents);
  } catch {
    // best-effort evidence capture — never throw from here
  }
}

/**
 * Wraps `test.step()` so the full evidence triple (screenshot + DOM +
 * storage state) is always captured right after the step body runs, whether
 * it passed or threw. The `finally` fires before the error propagates, so a
 * failing step still gets its evidence showing the page at (or immediately
 * after) the moment of failure.
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
