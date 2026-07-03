// LaunchProof: custom Playwright reporter.
//
// Captures the REAL wall-clock start offset of each top-level test.step()
// call -- i.e. each recordedStep() beat declared in a spec -- so the
// dashboard's chapter track can place segments at the real point in the
// recorded video where a step began.
//
// Why not just sum each step's own measured duration? Because that silently
// absorbs any time Playwright doesn't attribute to a step: the gap between
// steps (teardown of one / setup of the next), and the gap between the
// video actually starting to record and the first step's body beginning.
// Those gaps are real drift, not the step's fault, and pretending they
// don't exist by chaining durations produces a timeline that creeps further
// off the true video the more steps a test has.
//
// ALSO captures a finer sub-step layer: every 'pw:api' step (Playwright's
// own category for actual browser actions -- clicks, fills, goto, etc, see
// https://playwright.dev/docs/api/class-teststep#test-step-category) that
// happens inside a top-level test.step(). A single recordedStep() beat in a
// spec often drives several real UI transitions (click a CTA, wait for an
// overlay, click Continue, wait for a field) that today all collapse into
// one chapter segment. Recording each pw:api call's own real offset lets
// the dashboard show those sub-transitions individually, without changing
// what a "step" means to run.mjs/result.json's top level. This is still a
// mechanical capture of what Playwright itself measured -- nothing here is
// synthesized, reordered, or estimated.
//
// Output: runs/_step-timeline.json, a transient sidecar file in the same
// spirit as Playwright's own runs/_last-report.json (JSON reporter output)
// -- run.mjs reads it right after invoking `npx playwright test` and merges
// it into the steps[] array it already builds for result.json, as additive
// `startMs` and `actions` fields per step. Overwritten on every run; not
// meant to be inspected by hand.
//
// Anchor, in priority order:
//   1. PREFERRED: the start of the test-scoped "context" fixture (the step
//      Playwright's own reporter labels `Fixture "context"`). Video
//      recording is attached to the browser context, so this fixture
//      starting is the closest proxy this project has to "the video's
//      first frame" -- much closer than the alternative below. Confirmed
//      against a real trace.zip: in the sample run used to validate this
//      reporter, "Before Hooks" (browser launch begins, i.e. testResult's
//      own startTime) led the context fixture by ~300ms, all of which is
//      browser-process launch time that never appears in the recording.
//      Anchoring there instead of on the context fixture would shift
//      every step ~300ms earlier than where it actually is in the video.
//   2. FALLBACK: `result.startTime` (same instant run.mjs already reads as
//      testResult.startTime for result.json's own `startedAt`), used only
//      if the context-fixture step is never observed -- e.g. a future
//      Playwright version renaming/restructuring that fixture step. Less
//      accurate (see the ~300ms residual above) but still far better than
//      no per-step timing at all.
// The sidecar records which anchor was actually used (`anchorSource`) so
// this isn't a silent, unverifiable assumption.

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_PATH = path.join(process.env.LAUNCHPROOF_DIR || process.cwd(), 'runs', '_step-timeline.json');
const CONTEXT_FIXTURE_TITLE = 'Fixture "context"';

export default class StepTimelineReporter {
  constructor() {
    this.testStartAnchorMs = null; // fallback anchor
    this.contextAnchorMs = null; // preferred anchor
    this.steps = [];
    // Keyed by the raw TestStep object reference for each registered
    // top-level test.step(). A pw:api child step's own onStepEnd fires
    // BEFORE its parent test.step's onStepEnd (children finish first), so
    // the parent record has to already exist -- registered here in
    // onStepBegin -- by the time we need to attach an action to it.
    this.topLevelByStep = new Map();
  }

  onTestBegin(test, result) {
    // A run.mjs invocation runs exactly one spec with exactly one test, so
    // there is nothing to key this output by -- same simplifying
    // assumption Playwright's own JSON reporter output
    // (runs/_last-report.json) relies on elsewhere in this project.
    this.testStartAnchorMs = result.startTime.getTime();
    this.contextAnchorMs = null;
    this.steps = [];
    this.topLevelByStep = new Map();
  }

  onStepBegin(test, result, step) {
    if (this.contextAnchorMs === null && step.category === 'fixture' && step.title === CONTEXT_FIXTURE_TITLE) {
      this.contextAnchorMs = step.startTime.getTime();
    }

    // Register top-level test.step() records as soon as they begin (see
    // the Map comment above for why this can't wait until onStepEnd).
    // durationMs/absStartMs get their real values in onStepEnd once the
    // step actually finishes; startTime is already final at begin-time so
    // it's safe to capture now.
    if (step.category === 'test.step' && !step.parent) {
      const record = { title: step.title, absStartMs: step.startTime.getTime(), durationMs: 0, actions: [] };
      this.topLevelByStep.set(step, record);
      this.steps.push(record);
    }
  }

  onStepEnd(test, result, step) {
    // Top-level test.step() calls: category 'test.step' AND no parent
    // step. This isolates exactly the recordedStep() beats declared in
    // spec source. The record already exists (registered in onStepBegin);
    // just fill in the final measured duration.
    if (step.category === 'test.step' && !step.parent) {
      const record = this.topLevelByStep.get(step);
      if (record) record.durationMs = Math.round(step.duration || 0);
      return;
    }

    // Finer action/navigation layer: real Playwright API calls (clicks,
    // fills, goto, waitForRequest, request.post, ...). 'expect' is a
    // separate category so assertions are naturally excluded here.
    if (step.category === 'pw:api') {
      // Dedup guard: if Playwright ever nests one pw:api call directly
      // inside another, only record the outer one.
      if (step.parent && step.parent.category === 'pw:api') return;

      // Walk up the parent chain to the nearest registered top-level
      // test.step. A pw:api call that happens inside a fixture/hook,
      // outside any recordedStep(), has nowhere sane to nest -- drop it.
      let ancestor = step.parent;
      let record = null;
      while (ancestor) {
        record = this.topLevelByStep.get(ancestor);
        if (record) break;
        ancestor = ancestor.parent;
      }
      if (!record) return;

      record.actions.push({
        title: step.title,
        absStartMs: step.startTime.getTime(),
        durationMs: Math.round(step.duration || 0),
      });
    }
  }

  onEnd() {
    const anchorMs = this.contextAnchorMs !== null ? this.contextAnchorMs : this.testStartAnchorMs;
    const anchorSource = this.contextAnchorMs !== null ? 'context-fixture' : 'test-start-fallback';
    const residualMs = this.contextAnchorMs !== null && this.testStartAnchorMs !== null
      ? Math.round(this.contextAnchorMs - this.testStartAnchorMs)
      : null;

    const steps = anchorMs === null
      ? []
      : this.steps.map((s) => ({
          title: s.title,
          startMs: Math.max(0, Math.round(s.absStartMs - anchorMs)),
          durationMs: s.durationMs,
          // Same anchor as the parent step, so actions and their chapter
          // live on one consistent timeline.
          actions: s.actions.map((a) => ({
            label: a.title,
            startMs: Math.max(0, Math.round(a.absStartMs - anchorMs)),
            durationMs: a.durationMs,
            type: classifyActionType(a.title),
          })),
        }));

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify({ anchorMs, anchorSource, residualMs, steps }, null, 2) + '\n'
    );
  }
}

// Two types only, deliberately coarse: 'navigation' for page.goto calls
// (the one pw:api call that jumps to a whole new page rather than acting
// within the current one), 'action' for everything else (click, fill,
// press, API request calls, waits, etc). Playwright's own pw:api step
// title for page.goto is human-readable ("Navigate to \"/foo\"") rather
// than the literal method name "page.goto" -- confirmed against a real
// captured run of this project's example.spec.ts -- so the prefix check
// below matches that actual title shape, not the raw API name.
function classifyActionType(title) {
  return title.startsWith('Navigate to') ? 'navigation' : 'action';
}
