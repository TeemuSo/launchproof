# LaunchProof

Prove a web feature actually works. An AI (or you) writes a Playwright e2e test, this
runs it in a real browser against your running app, and produces recorded proof: a
seekable video, a per-step chapter timeline, and a **WORKING / BROKEN / INCONCLUSIVE**
verdict. It closes the vibe-coding gap where an AI says "done" without ever opening the
page. A **LaunchGuard** subproduct.

## Free, because it runs on your machine

LaunchProof is the **free, local** lead-magnet for browser-level proof: Playwright runs in
*your* browser on *your* machine, so it burns zero of LaunchGuard's browser-minutes. That
is exactly what makes it free to give away — browser-level proof with no Browserbase cost to
us. LaunchGuard's **hosted** browser e2e (the same real-browser proof, but run on our
infrastructure and re-witnessed on every deploy) is the paid product (Pro). Same proof,
different compute: local is yours and free; hosted is ours, metered, and remembered. See the
workspace-root `MONETIZATION.md` for the full free/paid boundary.

## Code vs data

This repo is the **shared harness** (code + deps). Each consuming project keeps only its
own **data** — test specs and recorded runs — under `.launchproof/` in that repo. The
harness, pointed at a project's data dir, drops a `node_modules` symlink into it so the
project's specs resolve the one Playwright install (Playwright refuses to load twice). A
consuming project therefore never runs `npm install`.

```
launchproof/                 ← this repo (the harness, $LAUNCHPROOF_HOME)
├── run.mjs · playwright.config.ts · reporter.mjs · viewer/
├── tests/example.spec.ts    ← copy-me template + helpers/
└── skills/launchproof/      ← the Claude Code skill

<consuming-project>/.launchproof/
├── tests/<feature>.spec.ts  ← the project's own specs (tracked)
├── runs/                     ← recordings (gitignored)
└── node_modules -> $LAUNCHPROOF_HOME/node_modules   (symlink, gitignored)
```

## Setup

```bash
git clone https://github.com/TeemuSo/launchproof ~/Projects/launchproof
cd ~/Projects/launchproof && npm install     # once per machine
export LAUNCHPROOF_HOME=~/Projects/launchproof
```
Update later with `git -C "$LAUNCHPROOF_HOME" pull` — every consuming project instantly
uses the new harness; their tests and runs are untouched.

Or install it as a **Claude Code plugin** — agents in your project gain the `launchproof`
skill, and the plugin install serves as the harness (`npm install` runs on first use):

```
/plugin marketplace add TeemuSo/launchproof
/plugin install launchproof@launchproof
```

You can also just tell Claude Code: *"install the launchproof plugin from TeemuSo/launchproof"*.

## Run

```bash
# from a consuming project, with its app already running:
LAUNCHPROOF_DIR="$PWD/.launchproof" TARGET_URL=http://localhost:PORT \
  node "$LAUNCHPROOF_HOME/run.mjs" <feature>

# watch the recordings:
LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/viewer/serve.js"   # http://localhost:4321
```

`node run.mjs <name>` runs `<data>/tests/<name>.spec.ts` and prints a verdict: WORKING
(all gates passed), BROKEN (a real assertion failed), or INCONCLUSIVE (timeout / target
down). Review mode dwells 350ms per action so nothing blows by on video; `LP_SLOWMO=0`
disables it.

## Post-run webhook

Set `LAUNCHPROOF_WEBHOOK` to a URL and each run POSTs `{ runId, test, verdict, target }`
on completion; merge extra fields with `LAUNCHPROOF_WEBHOOK_EXTRA='{"...":"..."}'`. This
lets a system auto-receive a verdict (e.g. VUORO attaches proof to an issue via
`/api/proof` with an `issueId`).

## Writing tests

Copy `tests/example.spec.ts` — a commented best-practice template. Role-based user-facing
locators; awaited web-first assertions; no hard waits; drive the real UI; two named
`recordedStep()` gates; assert the real value, never a placeholder. See
`skills/launchproof/SKILL.md` for the full checklist.

Test metadata is **native Playwright**, not bespoke comments: declare intent as a native
tag and the plain-English meaning as a native annotation in the test's details object —

```ts
test('returning visitor lands on the new hub', {
  tag: '@functional',   // or '@security'
  annotation: {
    type: 'meaning',
    description: 'Red means returning customers are dropped on the legacy page.',
  },
}, async ({ page }, testInfo) => { /* gates */ });
```

Both flow through Playwright's JSON reporter into `result.json`. The dashboard renders the
failing assertion (matcher / expected / got) as first-class "Success conditions" and the
annotation as "What this means". The legacy `// @intent:` comment still works as a
fallback for pre-native specs.

## Requirements

- Node 18+ and Playwright's chromium (`npx playwright install chromium` if the shared
  cache is missing it).
- ffmpeg for seekable video (`brew install ffmpeg`); without it playback works but
  scrubbing does not.
