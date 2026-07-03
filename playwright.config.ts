import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LaunchProof: config for recording full evidence (video + trace + screenshot)
// on every run so a human/agent can replay what actually happened, not just
// read a pass/fail line.
//
// CODE vs DATA: this config (harness code) lives at ROOT. The test specs and
// recorded runs live with the consuming project at LAUNCHPROOF_DIR (defaults to
// ROOT for standalone). The only app coupling is baseURL, from TARGET_URL.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.LAUNCHPROOF_DIR || ROOT;

// Default review-mode delay, in ms, applied to every CDP action (click, fill,
// goto, ...) via launchOptions.slowMo, so a fast action isn't lost in under a
// video frame. `LP_SLOWMO=0` disables it; checked with `!== undefined` so 0 is
// honored and doesn't fall through to the default.
const rawSlowMo = process.env.LP_SLOWMO;
const parsedSlowMo = rawSlowMo !== undefined ? Number(rawSlowMo) : NaN;
const slowMo = Number.isNaN(parsedSlowMo) ? 350 : parsedSlowMo;

export default defineConfig({
  testDir: path.join(DATA, 'tests'),
  outputDir: path.join(DATA, 'test-results'),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['json', { outputFile: path.join(DATA, 'runs', '_last-report.json') }],
    ['line'],
    // Real wall-clock step-start offsets for the dashboard's chapter track.
    // Absolute path so it resolves whether run standalone or from a plugin cache.
    [path.join(ROOT, 'reporter.mjs')],
  ],
  use: {
    baseURL: process.env.TARGET_URL || 'http://localhost:3000',
    // Make the AI's locator convention explicit: getByTestId targets data-testid.
    testIdAttribute: 'data-testid',
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 10_000,
    launchOptions: {
      slowMo,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
