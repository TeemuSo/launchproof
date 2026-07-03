#!/usr/bin/env node
// LaunchProof: run.mjs
//
// The ONE entrypoint an AI agent needs. Runs a named Playwright test spec
// against a live localhost app, then normalizes Playwright's raw JSON
// report + on-disk artifacts into a stable contract at
// runs/<runId>/result.json, with the video/trace/screenshots copied
// alongside it. Everything downstream (the dashboard) reads only that
// contract, never Playwright's own output shape.
//
// Usage: node run.mjs <testName>   (testName -> <data>/tests/<testName>.spec.ts)
//
// CODE vs DATA: the harness code lives at ROOT (which, installed as a plugin,
// is a read-only cache). The DATA — a project's own test specs and recorded
// runs — lives with the consuming project. Set LAUNCHPROOF_DIR to that project
// dir (e.g. <repo>/.launchproof); it defaults to ROOT for standalone use.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, symlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.LAUNCHPROOF_DIR || ROOT;
const CONFIG_PATH = path.join(ROOT, 'playwright.config.ts');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const REPORT_PATH = path.join(RUNS_DIR, '_last-report.json');
const STEP_TIMELINE_PATH = path.join(RUNS_DIR, '_step-timeline.json');
const TEST_RESULTS_DIR = path.join(DATA_DIR, 'test-results');

// Same default as playwright.config.ts's `use.baseURL` -- kept in sync by hand
// since Playwright's JSON reporter does not echo back resolved `use` options.
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';

// Give the project's data dir a node_modules symlink to the harness's, so the
// project's spec files resolve the SAME single @playwright/test the harness
// config and CLI use. The data dir needs no install of its own.
function linkNodeModules(dataDir) {
  const dnm = path.join(dataDir, 'node_modules');
  const rootNm = path.join(ROOT, 'node_modules');
  if (!existsSync(rootNm)) {
    console.error(`launchproof: harness deps missing at ${rootNm} -- run \`npm install\` in the launchproof harness dir.`);
    return;
  }
  try {
    if (existsSync(dnm)) {
      if (lstatSync(dnm).isSymbolicLink()) return; // already ours
      console.error(`launchproof: ${dnm} is a real node_modules; remove it so specs resolve the harness's single Playwright copy.`);
      return;
    }
    symlinkSync(rootNm, dnm, 'dir');
  } catch (e) {
    console.error(`launchproof: could not link node_modules into ${dataDir}: ${e.message}`);
  }
}

function main() {
  const testName = process.argv[2];
  if (!testName) {
    console.error('Usage: node run.mjs <testName>');
    process.exit(1);
  }

  const specAbsPath = path.join(DATA_DIR, 'tests', `${testName}.spec.ts`);
  if (!existsSync(specAbsPath)) {
    console.error(`No such spec: tests/${testName}.spec.ts (looked in ${DATA_DIR})`);
    process.exit(1);
  }

  mkdirSync(RUNS_DIR, { recursive: true });

  // Everything -- the CLI, the harness config, AND the test specs -- imports
  // '@playwright/test', and Playwright refuses to be loaded from two different
  // installs ("Requiring @playwright/test second time"). The config lives with
  // the harness (ROOT) and the specs live with the project (DATA), so both must
  // resolve to the SAME physical copy. We give DATA a node_modules SYMLINK to
  // the harness's node_modules: specs resolve through it to the one real copy,
  // the config resolves to it directly, same realpath -> one instance. DATA
  // therefore needs no install of its own; it holds only specs and runs.
  if (DATA_DIR !== ROOT) linkNodeModules(DATA_DIR);

  // 1. Run the spec. Let it fail (non-zero exit) without throwing -- a
  // failing/timing-out test is an expected, useful outcome we still want
  // to capture and render, not a script error.
  const proc = spawnSync('npx', ['playwright', 'test', specAbsPath, '--config', CONFIG_PATH], {
    cwd: DATA_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  const exitCode = proc.status;

  // 2. Parse Playwright's JSON reporter output.
  let report;
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch (err) {
    // Playwright never produced a report at all (e.g. config error, spec
    // file syntax error). We can't say anything about the app itself, so
    // this is an inconclusive run by definition.
    writeInconclusiveRun(testName, `Playwright produced no report (exit ${exitCode}): ${err.message}`);
    return;
  }

  const { spec, testResult } = extractSpecAndResult(report);
  if (!spec || !testResult) {
    writeInconclusiveRun(testName, 'Playwright report contained no test result to parse.');
    return;
  }

  const intent = extractIntent(specAbsPath);
  const declaredStepNames = extractDeclaredStepNames(specAbsPath);

  const startedAt = testResult.startTime;
  const durationMs = Math.round(testResult.duration || 0);

  // 3 & 6. Build the normalized step list. Playwright's JSON only reports
  // steps that actually started executing -- if gate A throws, gate B's
  // test.step() call is never reached and simply does not appear in the
  // report. We recover the "never ran" case by statically reading the
  // step names declared in the spec source (in source order) and treating
  // any declared step beyond what Playwright actually reported as
  // "skipped".
  const reportedSteps = testResult.steps || [];
  const stepCount = Math.max(reportedSteps.length, declaredStepNames.length);

  const testResultDir = locateTestResultDir(testResult);
  const shotFiles = testResultDir ? findShotFiles(testResultDir) : [];

  const runId = buildRunId(startedAt, testName);
  const runDir = path.join(RUNS_DIR, runId);
  const shotsDir = path.join(runDir, 'shots');
  mkdirSync(shotsDir, { recursive: true });

  const steps = [];
  for (let i = 0; i < stepCount; i++) {
    const reported = reportedSteps[i];
    const name = reported ? reported.title : declaredStepNames[i] || `step ${i}`;
    const slug = slugify(name);
    let status;
    let error = null;
    let durationMsStep = 0;

    if (reported) {
      durationMsStep = Math.round(reported.duration || 0);
      if (reported.error) {
        status = 'failed';
        error = cleanErrorMessage(reported.error.message);
      } else {
        status = 'passed';
      }
    } else {
      // Declared in source, never reached because an earlier step failed.
      status = 'skipped';
    }

    let shotRelPath = null;
    const sourceShot = shotFiles[i];
    if (sourceShot) {
      const destName = `${String(i).padStart(2, '0')}-${slug}.png`;
      copyFileSync(sourceShot, path.join(shotsDir, destName));
      shotRelPath = `shots/${destName}`;
    }

    steps.push({
      index: i,
      name,
      status,
      durationMs: durationMsStep,
      error,
      shot: shotRelPath,
    });
  }

  // 3b. Merge in real wall-clock step-start offsets (and their nested
  // action/navigation sub-steps) from reporter.mjs's sidecar, when
  // available. This only covers steps that actually ran (skipped steps
  // never happened, so there's no real video offset to give them -- they're
  // left without startMs, and the dashboard falls back to its
  // cumulative-duration estimate for any run/step missing it).
  //
  // `actions` is always set to an array (defaulting to [] when the sidecar
  // is missing or predates this field), never left undefined -- this is
  // what lets the viewer treat old and new runs uniformly without a
  // presence check on every read.
  const stepTimeline = readStepTimeline();
  for (let i = 0; i < steps.length; i++) {
    const sidecarStep = stepTimeline && stepTimeline.steps && stepTimeline.steps[i];
    steps[i].startMs = sidecarStep ? sidecarStep.startMs : undefined;
    steps[i].actions = (sidecarStep && sidecarStep.actions) || [];
  }

  // 4. Verdict classification.
  const { verdict, failureStep } = classifyVerdict(testResult, steps);

  // 5. Copy video + trace into runs/<runId>/, named per contract.
  const artifacts = { video: null, trace: null };
  if (testResultDir) {
    const videoSrc = path.join(testResultDir, 'video.webm');
    const traceSrc = path.join(testResultDir, 'trace.zip');
    if (existsSync(videoSrc)) {
      copyFileSync(videoSrc, path.join(runDir, 'video.webm'));
      artifacts.video = 'video.webm';

      // Playwright's raw .webm has no seek index -- browsers can play it
      // straight through but scrubbing (video.currentTime = x) silently
      // fails to hold. Transcode to a faststart H.264 MP4 so the dashboard
      // can actually seek. Additive: keep artifacts.video pointing at the
      // webm as-is for anything downstream that expects it, and only set
      // artifacts.videoSeekable when the transcode actually succeeds.
      const seekableName = transcodeToSeekableMp4(path.join(runDir, 'video.webm'), path.join(runDir, 'video.mp4'));
      if (seekableName) {
        artifacts.videoSeekable = seekableName;
      }
    }
    if (existsSync(traceSrc)) {
      copyFileSync(traceSrc, path.join(runDir, 'trace.zip'));
      artifacts.trace = 'trace.zip';
    }
  }

  const result = {
    runId,
    test: testName,
    title: spec.title,
    intent,
    target: TARGET_URL,
    verdict,
    startedAt,
    durationMs,
    steps,
    failureStep,
    artifacts,
  };

  const resultPath = path.join(runDir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');

  // Playwright's own test-results/ working directory is transient scratch
  // space -- everything we need has now been copied into runs/<runId>/, so
  // clear it out rather than leaving duplicate artifacts lying around.
  rmSync(TEST_RESULTS_DIR, { recursive: true, force: true });

  console.log(`\nresult: ${resultPath}`);
  console.log(`verdict: ${verdict}`);

  // Optional: notify a downstream system of the verdict. Generic on purpose --
  // a consumer sets LAUNCHPROOF_WEBHOOK to a URL and (optionally)
  // LAUNCHPROOF_WEBHOOK_EXTRA to a JSON object merged into the payload. VUORO,
  // for example, points it at /api/proof and passes { "issueId": "..." } so an
  // issue-bound run auto-attaches its proof. The in-flight request keeps the
  // process alive until it resolves; never fails the run.
  maybePostWebhook(result);
}

function maybePostWebhook(result) {
  const url = process.env.LAUNCHPROOF_WEBHOOK;
  if (!url) return;
  let extra = {};
  try { extra = JSON.parse(process.env.LAUNCHPROOF_WEBHOOK_EXTRA || '{}'); } catch {}
  const payload = { runId: result.runId, test: result.test, verdict: result.verdict, target: result.target, ...extra };
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    .then(() => console.log(`launchproof: posted result to ${url}`))
    .catch((e) => console.error(`launchproof: webhook POST failed: ${e.message}`));
}

/**
 * Verdict heuristic:
 * - Playwright test status "passed"                       -> WORKING
 * - status "failed" AND the error looks like a Playwright
 *   expect()/assertion mismatch                            -> BROKEN
 * - status "timedOut" or "interrupted", OR "failed" with a
 *   non-assertion error (nav failure, target down,
 *   connection refused, DNS failure, etc.)                 -> INCONCLUSIVE
 *
 * Rationale: a real assertion mismatch means the test actually reached
 * the app and observed the wrong thing (BROKEN, actionable). A timeout,
 * interruption, or connection-level error means we could not reliably
 * observe the app's behavior at all (INCONCLUSIVE, not a verdict on the
 * app itself -- most likely the target wasn't up or the harness stalled).
 */
function classifyVerdict(testResult, steps) {
  const status = testResult.status;
  const failedStep = steps.find((s) => s.status === 'failed');
  const failureStep = failedStep ? failedStep.name : null;

  if (status === 'passed') {
    return { verdict: 'WORKING', failureStep: null };
  }

  if (status === 'timedOut' || status === 'interrupted') {
    return { verdict: 'INCONCLUSIVE', failureStep };
  }

  if (status === 'failed') {
    const message = failedStep ? failedStep.error : cleanErrorMessage(testResult.error && testResult.error.message);
    if (isAssertionFailure(message)) {
      return { verdict: 'BROKEN', failureStep };
    }
    return { verdict: 'INCONCLUSIVE', failureStep };
  }

  // Unknown/unexpected Playwright status -- be conservative.
  return { verdict: 'INCONCLUSIVE', failureStep };
}

function isAssertionFailure(message) {
  if (!message) return false;
  const connectionPatterns = /ERR_CONNECTION_REFUSED|ECONNREFUSED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|net::ERR_/i;
  if (connectionPatterns.test(message)) return false;
  return /^Error:\s*expect\(/i.test(message.trim()) || /AssertionError/i.test(message);
}

function extractSpecAndResult(report) {
  for (const suite of report.suites || []) {
    for (const spec of suite.specs || []) {
      const test = spec.tests && spec.tests[0];
      const testResult = test && test.results && test.results[0];
      if (testResult) return { spec, testResult };
    }
  }
  return { spec: null, testResult: null };
}

/**
 * Reads reporter.mjs's sidecar output (real per-step wall-clock start
 * offsets). Missing/unparseable is a normal, non-fatal case -- e.g. a
 * Playwright version that doesn't invoke onStepEnd the way this project
 * expects, or a manually-run `npx playwright test` that didn't load
 * playwright.config.ts's reporter list. The dashboard's cumulative-duration
 * fallback covers this without any run.mjs-side special-casing.
 */
function readStepTimeline() {
  try {
    return JSON.parse(readFileSync(STEP_TIMELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function locateTestResultDir(testResult) {
  const videoAttachment = (testResult.attachments || []).find((a) => a.name === 'video');
  if (videoAttachment) return path.dirname(videoAttachment.path);
  const traceAttachment = (testResult.attachments || []).find((a) => a.name === 'trace');
  if (traceAttachment) return path.dirname(traceAttachment.path);
  // Fallback: single subdirectory of test-results/, if there is exactly one.
  if (existsSync(TEST_RESULTS_DIR)) {
    const entries = readdirSync(TEST_RESULTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (entries.length === 1) return path.join(TEST_RESULTS_DIR, entries[0].name);
  }
  return null;
}

/**
 * Transcodes a Playwright .webm recording into a seekable, faststart H.264
 * MP4 alongside it. Playwright's own .webm has no seek index, so
 * `video.currentTime = x` silently fails to hold in the dashboard's
 * <video> element.
 *
 * Degrades gracefully: if ffmpeg isn't installed, or the transcode fails
 * for any reason, this logs a warning to stderr and returns null without
 * throwing -- the run itself must never fail because of this.
 *
 * @param {string} webmAbsPath - absolute path to the source .webm
 * @param {string} mp4AbsPath - absolute path to write the .mp4 to
 * @returns {string|null} the mp4's basename (e.g. "video.mp4") on success, else null
 */
function transcodeToSeekableMp4(webmAbsPath, mp4AbsPath) {
  const ffmpegCheck = spawnSync('ffmpeg', ['-version']);
  if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
    console.error('ffmpeg not found -- video will not be scrubbable; run `brew install ffmpeg`.');
    return null;
  }

  const proc = spawnSync('ffmpeg', [
    '-y',
    '-i', webmAbsPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    mp4AbsPath,
  ]);

  if (proc.status !== 0 || !existsSync(mp4AbsPath)) {
    console.error(`ffmpeg transcode to seekable mp4 failed (exit ${proc.status}) -- video will not be scrubbable.`);
    return null;
  }

  return path.basename(mp4AbsPath);
}

function findShotFiles(testResultDir) {
  if (!existsSync(testResultDir)) return [];
  return readdirSync(testResultDir)
    .filter((f) => /^shot-\d+-.*\.png$/.test(f))
    .sort()
    .map((f) => path.join(testResultDir, f));
}

function extractIntent(specAbsPath) {
  const src = readFileSync(specAbsPath, 'utf8');
  const match = src.match(/\/\/\s*@intent:\s*(\S+)/);
  return match ? match[1] : 'unknown';
}

function extractDeclaredStepNames(specAbsPath) {
  const src = readFileSync(specAbsPath, 'utf8');
  const names = [];
  const re = /recordedStep\(\s*page\s*,\s*testInfo\s*,\s*(['"`])((?:(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    names.push(m[2]);
  }
  return names;
}

function cleanErrorMessage(message) {
  if (!message) return null;
  // Strip ANSI color codes Playwright embeds in error text so result.json
  // stays plain, readable JSON.
  return message.replace(/\[[0-9;]*m/g, '').trim();
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'step'
  );
}

function buildRunId(startedAtIso, testName) {
  // runId timestamp is derived from the test's own startTime, rendered in
  // UTC as YYYYMMDD-HHMMSS, so it stays consistent no matter what timezone
  // the machine running run.mjs is in.
  const d = new Date(startedAtIso || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${stamp}-${testName}`;
}

function writeInconclusiveRun(testName, reason) {
  const startedAt = new Date().toISOString();
  const runId = buildRunId(startedAt, testName);
  const runDir = path.join(RUNS_DIR, runId);
  mkdirSync(path.join(runDir, 'shots'), { recursive: true });
  const result = {
    runId,
    test: testName,
    title: testName,
    intent: 'unknown',
    target: TARGET_URL,
    verdict: 'INCONCLUSIVE',
    startedAt,
    durationMs: 0,
    steps: [],
    failureStep: null,
    artifacts: { video: null, trace: null },
    harnessError: reason,
  };
  const resultPath = path.join(runDir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.error(reason);
  console.log(`\nresult: ${resultPath}`);
  console.log(`verdict: ${result.verdict}`);
}

main();
