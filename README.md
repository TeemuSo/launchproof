# LaunchProof

**Prove a web feature actually works, before you say it's done.**

Your AI coding agent says "done." But did it ever open the page? LaunchProof closes
that gap: an AI (or you) writes a Playwright end-to-end test, LaunchProof runs it in a
**real browser against your running app**, and hands you recorded proof:

- a seekable **video** of every step,
- a per-step **chapter timeline**, and
- a plain **WORKING / BROKEN / INCONCLUSIVE** verdict.

It runs **locally, on your machine, inside your dev loop** — right after a change, so you
catch a broken flow before you ship it, not after a user does. Free, no signup, no account.

LaunchProof is the free local companion to [LaunchGuard](https://launchguard.io), which
checks your app's security from the outside.

## Why it exists

AI writes code fast, and it will confidently tell you a feature works when it has never
watched it run. A green build and a passing type-check don't prove the button does
anything. LaunchProof is the missing step: **drive the real UI in a real browser and
record what actually happens**, so "it works" means you watched it work.

## Install

Install it as a **Claude Code plugin** — every agent in your project gains the
`launchproof` skill, and the plugin doubles as the test harness (dependencies install on
first use):

```
/plugin marketplace add TeemuSo/launchproof
/plugin install launchproof@launchproof
```

You can also just tell Claude Code: *"install the launchproof plugin from
TeemuSo/launchproof."*

Prefer a plain checkout? Clone it and point an env var at it:

```bash
git clone https://github.com/TeemuSo/launchproof ~/Projects/launchproof
cd ~/Projects/launchproof && npm install     # once per machine
export LAUNCHPROOF_HOME=~/Projects/launchproof
```

Update later with `git -C "$LAUNCHPROOF_HOME" pull` — every project you use it in picks up
the new version instantly; your tests and recordings are untouched.

## How it's laid out

LaunchProof is a shared harness (the runner + browser deps). Each project you use it in
keeps only its **own** tests and recordings, under a `.launchproof/` folder in that
project — so you never re-install browsers per project.

```
launchproof/                 ← the harness (installed once)
├── run.mjs · playwright.config.ts · reporter.mjs · viewer/
├── tests/example.spec.ts    ← copy-me template + helpers/
└── skills/launchproof/      ← the Claude Code skill

<your-project>/.launchproof/
├── tests/<feature>.spec.ts  ← your project's tests (commit these)
├── runs/                     ← recordings (gitignored)
└── node_modules -> harness   ← symlink so tests resolve one Playwright install
```

## Run

```bash
# from your project, with the app already running locally:
LAUNCHPROOF_DIR="$PWD/.launchproof" TARGET_URL=http://localhost:PORT \
  node "$LAUNCHPROOF_HOME/run.mjs" <feature>

# watch the recordings:
LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/viewer/serve.js"   # http://localhost:4321
```

`node run.mjs <name>` runs `<data>/tests/<name>.spec.ts` and prints a verdict: **WORKING**
(every gate passed), **BROKEN** (a real assertion failed), or **INCONCLUSIVE** (timeout, or
the app wasn't reachable). Review mode dwells 350ms per action so nothing blows by on the
video; set `LP_SLOWMO=0` to disable it.

## Writing tests

Copy `tests/example.spec.ts` — a commented, best-practice template. Use role-based,
user-facing locators; awaited web-first assertions; no hard waits; drive the real UI; two
named `recordedStep()` gates; and assert the **real** value, never a placeholder. See
`skills/launchproof/SKILL.md` for the full checklist.

Test metadata is **native Playwright**, not bespoke comments: declare intent as a tag and
the plain-English meaning as an annotation in the test's details object —

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
annotation as "What this means." The legacy `// @intent:` comment still works as a fallback
for older specs.

## Post-run webhook

Set `LAUNCHPROOF_WEBHOOK` to a URL and each run POSTs `{ runId, test, verdict, target }` on
completion; merge extra fields with `LAUNCHPROOF_WEBHOOK_EXTRA='{"...":"..."}'`. Handy for
wiring a verdict into your own tooling (attach proof to an issue, gate a deploy, ping a
channel).

## Requirements

- Node 18+ and Playwright's chromium (`npx playwright install chromium` if the shared cache
  is missing it).
- ffmpeg for seekable video (`brew install ffmpeg`); without it playback still works, but
  scrubbing does not.

## License

See [LICENSE](./LICENSE).
