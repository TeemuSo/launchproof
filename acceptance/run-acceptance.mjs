#!/usr/bin/env node
// LaunchProof acceptance test — the ONE command to dogfood the harness.
//
//   node acceptance/run-acceptance.mjs
//
// End to end it:
//   1. starts the login-gated fixture app on a free-ish port
//   2. copies the LIVE tests/helpers/shot.ts into the acceptance data dir, so
//      the test always exercises the harness's current capture code (this also
//      dogfoods the SKILL's "copy shot.ts" project-setup step)
//   3. runs the login spec through run.mjs against the fixture (real browser,
//      video + per-step shot/dom/state capture)
//   4. verifies the evidence contract against ground truth (verify.mjs)
//   5. proves the captured storageState is resumable (resume-proof.mjs)
//   6. tears the app down and prints an overall PASS/FAIL
//
// Exit 0 only if BOTH the verifier and the resume proof pass.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCEPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(ACCEPT_DIR);
const PORT = Number(process.env.FIXTURE_PORT || 4599);
const TARGET = `http://localhost:${PORT}`;

function step(msg) {
  console.log(`\n\x1b[1m▶ ${msg}\x1b[0m`);
}

async function waitForServer(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  // 2. Copy the live shot.ts into the acceptance data dir.
  step('Syncing the live shot.ts capture helper into the acceptance data dir');
  const helpersDir = path.join(ACCEPT_DIR, 'tests', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  copyFileSync(path.join(ROOT, 'tests', 'helpers', 'shot.ts'), path.join(helpersDir, 'shot.ts'));
  console.log('  copied tests/helpers/shot.ts');

  // 1. Start the fixture app.
  step(`Starting the login-gated fixture app on ${TARGET}`);
  const app = spawn('node', [path.join(ACCEPT_DIR, 'fixture-app.mjs'), String(PORT)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let appExited = false;
  app.on('exit', () => (appExited = true));

  const up = await waitForServer(`${TARGET}/`);
  if (!up || appExited) {
    console.error('FAIL — fixture app never came up.');
    app.kill();
    process.exit(1);
  }

  let exitCode = 1;
  try {
    // 3. Run the login spec through the real harness.
    step('Running the login spec through run.mjs (real browser, full capture)');
    const run = spawnSync('node', [path.join(ROOT, 'run.mjs'), 'login'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, LAUNCHPROOF_DIR: ACCEPT_DIR, TARGET_URL: TARGET },
    });
    if (run.status !== 0) {
      console.error(`\nFAIL — run.mjs exited ${run.status}.`);
      return;
    }

    // 4. Verify the evidence contract.
    step('Verifying the captured evidence against ground truth');
    const verify = spawnSync('node', [path.join(ACCEPT_DIR, 'verify.mjs')], { stdio: 'inherit' });

    // 5. Prove the captured state is resumable.
    step('Proving the captured storageState resumes a live session (no re-login)');
    const resume = spawnSync('node', [path.join(ACCEPT_DIR, 'resume-proof.mjs'), '', TARGET], {
      cwd: ROOT,
      stdio: 'inherit',
    });

    // 6. Overall verdict.
    step('Acceptance result');
    const verifyOk = verify.status === 0;
    const resumeOk = resume.status === 0;
    console.log(`  evidence-contract verifier: ${verifyOk ? 'PASS' : 'FAIL'}`);
    console.log(`  storageState resume proof:  ${resumeOk ? 'PASS' : 'FAIL'}`);
    if (verifyOk && resumeOk) {
      console.log('\n\x1b[32m\x1b[1mACCEPTANCE PASS\x1b[0m — LaunchProof captured a real DOM+auth index and it resumed a live session.');
      console.log(`\nWatch it: LAUNCHPROOF_DIR="${ACCEPT_DIR}" node "${path.join(ROOT, 'viewer', 'serve.js')}"`);
      exitCode = 0;
    } else {
      console.log('\n\x1b[31m\x1b[1mACCEPTANCE FAIL\x1b[0m');
    }
  } finally {
    if (!appExited) app.kill();
  }
  process.exit(exitCode);
}

main();
