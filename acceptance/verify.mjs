// LaunchProof acceptance verifier.
//
// Given a run dir produced by driving the login fixture, asserts the evidence
// contract the DOM+state capture feature promises:
//
//   1. verdict is WORKING
//   2. every step indexes a shot, a dom, and a state file — and each file
//      actually exists on disk (the index is not lying)
//   3. the dashboard step's DOM contains the REAL greeting ("alice") — proving
//      the capture is the true serialized page, the thing an agent would grep
//      to catch a fake-green test
//   4. the dashboard step's storageState captured REAL auth — the `sid` session
//      cookie AND the `lp_demo_token` localStorage entry — proving state is
//      resumable, not an empty shell
//
// Exits 0 if every check passes, 1 otherwise, printing a check-by-check report.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCEPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(ACCEPT_DIR, 'runs');

// Find the newest run dir for the login test (argv[2] overrides).
function latestLoginRun() {
  if (process.argv[2]) return process.argv[2];
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-login'))
    .map((e) => e.name)
    .sort();
  if (dirs.length === 0) throw new Error(`no *-login run found in ${RUNS_DIR}`);
  return path.join(RUNS_DIR, dirs[dirs.length - 1]);
}

const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail });
}

function main() {
  const runDir = latestLoginRun();
  console.log(`verifying run: ${runDir}\n`);

  const resultPath = path.join(runDir, 'result.json');
  if (!existsSync(resultPath)) {
    console.error(`FAIL: no result.json at ${resultPath}`);
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));

  // 1. Verdict.
  check('verdict is WORKING', result.verdict === 'WORKING', `got ${result.verdict}`);

  // 2. Every step indexes a triple, and each indexed file exists on disk.
  check('two steps recorded', result.steps.length === 2, `got ${result.steps.length}`);
  for (const step of result.steps) {
    for (const kind of ['shot', 'dom', 'state']) {
      const rel = step[kind];
      const onDisk = rel && existsSync(path.join(runDir, rel));
      check(`step "${step.name}" indexes a ${kind} that exists`, onDisk, rel || '(null)');
    }
  }

  // Locate the dashboard step (gate B) — the one whose evidence carries the
  // real user-facing value.
  const dash = result.steps.find((s) => /dashboard/i.test(s.name));
  check('found the dashboard step', !!dash, dash ? dash.name : '(none)');

  if (dash && dash.dom) {
    // 3. DOM carries the real greeting — the fake-green catch.
    const dom = readFileSync(path.join(runDir, dash.dom), 'utf8');
    check('dashboard DOM contains the real greeting "alice"', /Welcome,\s*<strong[^>]*>alice<\/strong>/.test(dom) || /alice/.test(dom), 'greeting not found in captured DOM');
    check('dashboard DOM is the protected page (not the login form)', /Dashboard/.test(dom) && !/Sign in<\/button>/.test(dom));
  }

  if (dash && dash.state) {
    // 4. storageState captured real auth — cookie AND localStorage.
    const state = JSON.parse(readFileSync(path.join(runDir, dash.state), 'utf8'));
    const hasSid = (state.cookies || []).some((c) => c.name === 'sid' && c.value);
    check('state captured the session cookie (sid)', hasSid, `cookies: ${(state.cookies || []).map((c) => c.name).join(',') || 'none'}`);
    const localVals = (state.origins || []).flatMap((o) => o.localStorage || []);
    const hasToken = localVals.some((kv) => kv.name === 'lp_demo_token');
    check('state captured localStorage (lp_demo_token)', hasToken, `localStorage keys: ${localVals.map((kv) => kv.name).join(',') || 'none'}`);
  }

  // Report.
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    console.log(`  ${mark} ${c.name}${c.ok ? '' : `  — ${c.detail}`}`);
    if (!c.ok) failed++;
  }
  console.log('');
  if (failed === 0) {
    console.log(`PASS — all ${checks.length} evidence-contract checks held.`);
    process.exit(0);
  }
  console.log(`FAIL — ${failed}/${checks.length} checks failed.`);
  process.exit(1);
}

main();
