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
cp "$LAUNCHPROOF_HOME/tests/example.spec.ts"     .launchproof/tests/
cp "$LAUNCHPROOF_HOME/tests/helpers/shot.ts"      .launchproof/tests/helpers/
cp "$LAUNCHPROOF_HOME/tests/helpers/highlight.ts" .launchproof/tests/helpers/
```
These helpers are harness code copied into your project so specs can resolve them
locally — treat them as read-only mirrors: never edit them in place, re-copy from
`$LAUNCHPROOF_HOME` after a harness update so they never drift.
Playwright's browsers are shared globally; `npx playwright install chromium` only if the
shared cache is missing it.

## The loop

1. **Target running.** The app must be up locally. Default target `http://localhost:3000`;
   override with `export TARGET_URL=http://localhost:PORT` (not on 3000? find the port:
   `lsof -iTCP -sTCP:LISTEN -P | grep node`).

2. **Author the test.** Copy `.launchproof/tests/example.spec.ts` to
   `.launchproof/tests/<feature>.spec.ts` and edit the two gates. Drive the real UI on
   user-facing locators; follow the checklist. Test the EXACT page and flow the user
   named — never a synthetic reconstruction of it on a different page; if the user says
   "the demo site", the spec opens the demo site.
   **One `test()` per file** — LaunchProof records one test per run, so only the first is
   captured; a second is dropped with a warning (a `test.describe` around a single test is
   fine). Split scenarios into separate `<feature>-<case>.spec.ts` files. Behind a login?
   Load a captured session with `test.use({ storageState })`, file kept in `.launchproof/auth/`.

3. **Run it** from the project root:
   ```bash
   LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/run.mjs" <feature>
   ```
   Records `.launchproof/runs/<id>/` and prints WORKING / BROKEN / INCONCLUSIVE.
   `LP_SLOWMO=0` for fast iteration.

4. **Look AND audit, then hand over.** Read `.launchproof/runs/<id>/result.json` and the
   step screenshots yourself — never claim done from a green line. `result.json`'s
   `steps[]` is your evidence **index**: each step carries a `shot` (screenshot), a `dom`
   (the serialized page HTML at that instant), and a `state` (cookies + localStorage). Use
   it to audit your OWN test — a green verdict only means the assertions you wrote passed,
   not that they asserted the right thing. Read/Grep the `dom` of the assertion step and
   confirm the value the user cares about is *genuinely present in the page* (the real
   price, the real label, the logged-in username), not a stale placeholder the test happened
   to match. A passing test whose DOM shows `$0.00` is BROKEN in disguise — this catch is
   the whole point. Read as few or as many step DOMs/shots as you need; they're on disk for
   querying. Then ALWAYS serve the dashboard and hand the user its URL — the dashboard
   (video + step timeline + parsed assertions), not a raw video file, is the deliverable a
   human reviews:
   ```bash
   LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/viewer/serve.js"   # http://localhost:4321
   ```
   The startup line prints `serving runs from <dir>` — confirm it is YOUR project's
   `.launchproof/runs`. An `EADDRINUSE` means another viewer (possibly another project's)
   already owns the port: start yours on a free one with `PORT=4322`, and never kill a
   process you didn't start.

5. **Re-run after every change.** Tests accumulate — re-running is the point.

**Keep runs out of git.** A run's `state/*.json` files are captured storage state — cookies
and localStorage, i.e. live session credentials — and its screenshots/trace can show
logged-in data. Add `.launchproof/runs/` (and `.launchproof/auth/`) to the project's
`.gitignore`. The recordings are local evidence, not source.

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
- Assert the thing you'd point at on screen, named in the user's words — the visible label,
  the price, the chip — not a numeric proxy. A magic `rgb(...)` or pixel width means nothing
  to whoever reads the dashboard; prefer a semantic class or the visible text. Never a placeholder.
- Visual/layout change? The screenshot is the proof a human eyeballs. Keep assertions to a
  couple of legible structural tripwires (a semantic class present, a column gone); don't
  fake precision by measuring pixels. To make a shot self-proving, outline the exact element
  an assertion is about right before its screenshot fires with `mark(locator, 'ok'|'bad', label)`
  from `./helpers/highlight` — green = the asserted value is present/correct, red = absent/wrong.
- Metadata is NATIVE Playwright, never invented comment tags: intent as a native tag
  (`tag: '@functional'` or `'@security'`) and a plain-English meaning as a native
  annotation (`annotation: { type: 'meaning', description: '...' }`) in the test's
  details object. The meaning is what a non-author reads on the dashboard to understand
  what green/red MEANS for the product — write it for them, one or two sentences.
  (`// @intent:` comments are a legacy fallback only.)
