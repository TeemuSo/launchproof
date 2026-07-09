# LaunchProof acceptance test

The harness dogfooding itself. One command drives a real login-gated app through
LaunchProof and proves the captured evidence is real and resumable.

```bash
node acceptance/run-acceptance.mjs
```

Requires `ffmpeg` (for the seekable video) and the harness deps (`npm install` in
the repo root). Exit 0 only if both the evidence-contract verifier and the resume
proof pass.

## What it exercises

| File | Role |
|------|------|
| `fixture-app.mjs` | A real login-gated app (session cookie + localStorage) so captured state is meaningful, not an empty shell. |
| `tests/login.spec.ts` | A dogfood LaunchProof spec: drives the login UI, asserts the dashboard greets the user by name. |
| `verify.mjs` | Asserts the evidence contract: every step indexes a shot/dom/state that exists; the dashboard DOM contains the real greeting; the state captured the `sid` cookie **and** the `lp_demo_token` localStorage. |
| `resume-proof.mjs` | Launches a fresh browser seeded with the captured state, goes straight to `/dashboard`, and proves it lands logged-in with no re-login. |
| `run-acceptance.mjs` | Orchestrates all of the above and prints an overall PASS/FAIL. |

`tests/helpers/shot.ts` is copied from the live `../tests/helpers/shot.ts` at run
time, so the acceptance test always exercises the current capture code.

## Watch the run

After a pass:

```bash
LAUNCHPROOF_DIR="$PWD/acceptance" node viewer/serve.js   # http://localhost:4321
```
