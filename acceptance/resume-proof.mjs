// LaunchProof acceptance: proves the captured storageState is RESUMABLE.
//
// Takes the dashboard step's state file from a run, launches a brand-new
// browser context seeded with it, and navigates straight to the protected
// /dashboard — WITHOUT going through the login form. If the greeting for
// "alice" renders, the captured state genuinely carried the session: you can
// drop a fresh browser back into the proven state. This is the payoff of
// capturing state per step.
//
// Usage: node resume-proof.mjs <runDir> <targetUrl>
// Exits 0 on success (landed logged-in), 1 otherwise.

import { chromium } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCEPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(ACCEPT_DIR, 'runs');

function latestLoginRun() {
  if (process.argv[2]) return process.argv[2];
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-login'))
    .map((e) => e.name)
    .sort();
  if (dirs.length === 0) throw new Error(`no *-login run found in ${RUNS_DIR}`);
  return path.join(RUNS_DIR, dirs[dirs.length - 1]);
}

const runDir = latestLoginRun();
const target = process.argv[3] || process.env.TARGET_URL || 'http://localhost:4599';

const result = JSON.parse(readFileSync(path.join(runDir, 'result.json'), 'utf8'));
const dash = result.steps.find((s) => /dashboard/i.test(s.name));
if (!dash || !dash.state) {
  console.error('resume-proof: no dashboard step with a captured state file');
  process.exit(1);
}
const statePath = path.join(runDir, dash.state);
if (!existsSync(statePath)) {
  console.error(`resume-proof: state file missing at ${statePath}`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: statePath });
const page = await context.newPage();

// Go STRAIGHT to the protected page. A no-session browser would be bounced to
// the login form ("/"). Only a resumed session lands on /dashboard.
await page.goto(`${target}/dashboard`);

let ok = false;
let landedUrl = '';
try {
  await page.getByTestId('current-user').waitFor({ state: 'visible', timeout: 5000 });
  const user = await page.getByTestId('current-user').textContent();
  landedUrl = page.url();
  ok = /\/dashboard$/.test(landedUrl) && (user || '').trim() === 'alice';
  console.log(`resumed browser landed at ${landedUrl}, greeting: "${(user || '').trim()}"`);
} catch (e) {
  landedUrl = page.url();
  console.log(`resumed browser did NOT reach the dashboard — landed at ${landedUrl} (${e.message.split('\n')[0]})`);
}

await browser.close();

if (ok) {
  console.log('PASS — captured state resumed a live session with no re-login.');
  process.exit(0);
}
console.log('FAIL — captured state did not resume a session.');
process.exit(1);
