---
name: launchproof
description: Prove a web feature actually works by driving it in a real browser and producing recorded proof, instead of trusting a screenshot or a green build. Use after building or changing any user-facing feature, or when asked to "prove it works", "did it actually work", "verify the flow", "write an e2e test", "test this in a real browser", or before saying a feature is done. Authors a Playwright e2e test, runs it against the running app, and produces a seekable video + per-step timeline + WORKING/BROKEN/INCONCLUSIVE verdict. The harness lives at $LAUNCHPROOF_HOME (a git checkout, or the installed Claude Code plugin); your project keeps only its own tests and recorded runs under .launchproof/ — re-run them by name, never starting from scratch.
---

# LaunchProof

The vibe-coding gap: an AI builds a feature, says "done", and never opens the page.
LaunchProof closes it. It is a thin wrapper on Playwright.

Runs entirely locally: Playwright in your own browser on your own machine. Free.

**Code vs data.** The harness (run.mjs, config, reporter, dashboard, template) is a shared
git checkout at `$LAUNCHPROOF_HOME` (default `~/Projects/launchproof`). Your project holds
only its **data** — test specs and recorded runs — under `.launchproof/` in the repo. The
harness, run against your data dir, drops a `node_modules` symlink into it so your specs
resolve the one Playwright install; you never `npm install` in a consuming project.

Update the harness with `git -C "$LAUNCHPROOF_HOME" pull` — every project instantly uses
the new code; their tests and runs are untouched.

Do NOT say "done" on user-facing work until the run is WORKING and the user has a recording.

## One-time setup

Resolve the harness (an explicit `$LAUNCHPROOF_HOME` wins; a Claude Code plugin install is
the harness itself; else the default checkout) and make sure its deps exist:
```bash
export LAUNCHPROOF_HOME="${LAUNCHPROOF_HOME:-${CLAUDE_PLUGIN_ROOT:-$HOME/Projects/launchproof}}"
[ -d "$LAUNCHPROOF_HOME/node_modules" ] || npm --prefix "$LAUNCHPROOF_HOME" install  # once per machine; re-run after a plugin update
```
Then per project:
```bash
mkdir -p .launchproof/tests/helpers
cp "$LAUNCHPROOF_HOME/tests/example.spec.ts" .launchproof/tests/
cp "$LAUNCHPROOF_HOME/tests/helpers/shot.ts"  .launchproof/tests/helpers/
```
Playwright's browsers are shared globally; `npx playwright install chromium` only if the
shared cache is missing it.

## The loop

1. **Target running.** The app must be up locally. Default target `http://localhost:3000`;
   override with `export TARGET_URL=http://localhost:PORT`.

2. **Author the test.** Copy `.launchproof/tests/example.spec.ts` to
   `.launchproof/tests/<feature>.spec.ts` and edit the two gates. Drive the real UI on
   user-facing locators; follow the checklist.

3. **Run it** from the project root:
   ```bash
   LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/run.mjs" <feature>
   ```
   Records `.launchproof/runs/<id>/` and prints WORKING / BROKEN / INCONCLUSIVE.
   `LP_SLOWMO=0` for fast iteration.

4. **Look, then hand over.** Read `.launchproof/runs/<id>/result.json` and the step
   screenshots yourself — never claim done from a green line. Serve the dashboard:
   ```bash
   LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/viewer/serve.js"   # http://localhost:4321
   ```

5. **Re-run after every change.** Tests accumulate — re-running is the point.

## Post-run webhook (optional)

Set `LAUNCHPROOF_WEBHOOK` to a URL and the run POSTs `{ runId, test, verdict, target }`
to it on completion; merge extra fields with `LAUNCHPROOF_WEBHOOK_EXTRA='{"...":"..."}'`.
This is how a system can auto-receive a verdict (e.g. VUORO attaches proof to an issue).

## Write good tests (checklist)

- Locators: user-facing, role-based — getByRole → getByLabel → getByText; `data-testid`
  only as a last resort. Never CSS classes or XPath.
- Assertions: awaited web-first auto-retrying (`await expect(locator).toBeVisible()`).
- No hard waits: wait on real conditions (`toBeVisible`, `toHaveURL`, `waitForResponse`).
- Drive the real UI (click/fill), not `page.evaluate` or API calls.
- Two gates in named `recordedStep()`s: gate A reaches and asserts the real state; gate B
  is one crisp acceptance expect on what the user cares about.
- Assert the real value, never a placeholder.
