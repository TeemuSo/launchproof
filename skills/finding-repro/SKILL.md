---
name: finding-repro
description: >-
  Verify whether a code-review finding is actually REAL by writing a test that
  reproduces the alleged failure, instead of trusting the reviewer. Point a PR
  at it: it reads the review findings (Claude / human / bot comments), and for
  each writes the smallest test that ASSERTS THE CORRECT BEHAVIOR the finding
  says is violated. A RED (failing) test is a witness the finding is real; you
  fix the bug later to turn it green. Produces a shareable LaunchGuard proof
  page (per-finding verdict + evidence) plus the committed red tests. Triggers:
  "is this finding real", "repro this PR's review findings", "check Claude's
  review", "write a failing test for the code review", "verify the review
  before I fix anything", "does-vs-should for a reviewer". NOT a bug fixer: it
  proves the bug exists; fixing it is a separate step.
---

# Finding repro

Turn a code-review finding into a witnessed verdict. A reviewer says "this can
break." You do not trust that. You write the smallest test that would be green
after the fix, run it now, and let the running code answer.

## The idea in one line

A review finding is a *claim* ("this can break"). The running code is the
*oracle*. This skill turns each claim into a witnessed verdict by writing the
red test you would want green after the fix. It is the same claim-vs-oracle
machine as `visual-correctness` and `launchproof`, pointed at the reviewer
instead of the app: LaunchGuard's does-vs-should thesis applied to "is what the
AI reviewer said actually true?"

## What it proves, and the asymmetry you must respect

- ✅ **A reproduction (a RED test) PROVES the finding is real.** Strong. The red
  test is the deliverable someone fixes later.
- ❌ **A non-reproduction (GREEN) proves almost nothing.** It only means the
  inputs you tried did not trigger the failure. NEVER report a green as "false
  positive" or "safe". The only honest phrasing is **"not reproduced with the
  inputs tried."**
- ⚠️ **Cannot set up the precondition** (no local surface, unreachable state)
  → **INCONCLUSIVE**, never a pass.

This is the same discipline `visual-correctness` uses for empties and defaults:
an unresolved observation is a question, not an answer. A green here is an
unresolved observation.

## Verdict mapping (finding-level)

| Test result | Finding verdict | Strength |
|---|---|---|
| Test FAILS / red | **REAL** | Strong. The red test is the artifact to fix later. |
| Test PASSES / green | **NOT REPRODUCED** | Weak, non-exhaustive. Only the inputs tried. |
| Precondition unreachable / no local surface | **INCONCLUSIVE** | Not a pass. Note what environment would witness it. |

## Workflow

### a. Get the findings

Read the review as prose. Do NOT write a regex parser; there is no fixed format
to parse, and hardcoding one is exactly the bespoke complexity this skill
avoids.

```bash
# PR-level review comment(s) (the claude[bot] summary lives here):
gh api repos/<owner>/<repo>/issues/<PR>/comments -q '.[]|select(.user.login=="claude[bot]").body'
# Inline review comments (anchored to file:line):
gh api repos/<owner>/<repo>/pulls/<PR>/comments
# Review bodies (approve/request-changes summaries):
gh api repos/<owner>/<repo>/pulls/<PR>/reviews
```

For each discrete finding, extract four things: a short **title** (in the
reviewer's own words), its **`file:line`**, the **failure scenario**, and any
**"(latent / not currently triggered)"** caveat. Real reviews look like: headers
such as `### Correctness`, `Bug: …`, or numbered items, each with a `file:line`
ref and a concrete scenario ("if a user clicks X before the fetch resolves, the
ref is still null, the scroll no-ops").

### b. Scope each finding to the SMALLEST reproduction level

This is the key judgment call. Cheapest witness that actually exercises the
buggy path wins.

| Finding shape | Repro level | Where |
|---|---|---|
| Pure logic / parsing / formatting (e.g. a regex autofill normalizer) | **unit test** | the repo's own runner, next to existing tests. Prefer this. |
| DB / RPC / service invariant (e.g. a money-model RPC) | **integration test** | against local Supabase, matching the repo's existing integration pattern |
| UI / flow / race / render-fidelity (e.g. a reveal race, a wrong-value cell) | **browser** | the launchproof harness, assert the user-facing thing |
| Deploy / build / standalone-output-only (e.g. traced files missing in Vercel standalone) | usually **INCONCLUSIVE** | not locally reproducible; note the witnessing env |

Notes on the edges:

- **Browser repros** reuse the launchproof helpers and `mark()`, one `test()`
  per file, and assert the user-facing thing (the swallowed click, the wrong
  cell value). For a *pure render-fidelity* finding (right data, wrong pixels),
  the sibling **`visual-correctness`** skill is often the better tool: it holds
  the rendered value against the payload oracle directly. Cross-link to it
  rather than rebuilding that comparison here.
- **Deploy / build-only** findings (a file that is present locally but not
  traced into the standalone bundle, an env var undefined only in prod) are
  usually **INCONCLUSIVE** locally. Say in one line what environment would
  witness it. You MAY add a weaker static assertion (e.g. grep the config for
  the missing `outputFileTracingIncludes` glob) but label it clearly as a
  static check, not a reproduction.

### c. Write the test asserting the CORRECT (post-fix) behavior

Read a neighboring test FIRST and match the repo's conventions (its runner, its
naming, its cleanup, its fixtures). Name the test in the finding's own words.
Keep it minimal: one behavior per test.

**Do NOT fix the bug.** A red test is the intended outcome here. If reaching the
buggy state needs seeding, fixtures, or a local password, do it, and SAY SO in
the note. Nothing hidden.

### d. Run it and record the verdict + evidence

- **Unit / integration:** the runner's red/green output. Paste the failing
  assertion (expected vs actual) into the note; that line IS the proof.
- **Browser:** run via the launchproof harness, then read the artifacts
  yourself. Do not trust the green line.

```bash
# Browser repro via the launchproof harness (one test() per file):
LAUNCHPROOF_DIR="$PWD/.launchproof" node "$LAUNCHPROOF_HOME/run.mjs" <feature>
# Then read the result + the assertion step's DOM/shots yourself:
#   .launchproof/runs/<id>/result.json   (steps[].shot / .dom / .state)
```

Screenshot the reproduced state (the swallowed click, the stale value). Use
`mark(locator, 'bad', label)` from `.launchproof/tests/helpers/highlight` to
outline the element the finding is about right before the shot.

### e. Emit the proof artifact, reusing the proof server unchanged

One finding = one **criterion**. One trigger = one **subcheck**. Map it like so:

- criterion `title` = the finding title; criterion `requirement` = the
  reviewer's claim text **verbatim**.
- subcheck `condition` = the trigger / state; subcheck `expected` = the correct
  (post-fix) behavior.
- **subcheck `status`:**

| `status` | Means | Finding verdict |
|---|---|---|
| `fail` | finding REPRODUCED | bug is REAL |
| `pass` | not reproduced | weak, non-exhaustive |
| `pending` | could not witness locally | INCONCLUSIVE |

So a **BROKEN top-level verdict here is the good outcome**: it means real
findings exist and here are the red tests.

The `note` carries the red/green evidence (the failing assertion, the DOM value)
AND, for any `pass` or `pending`, the asymmetry caveat spelled out ("not
reproduced with the inputs tried: X, Y; a different input could still trigger
it").

**Evidence-gate interaction, read carefully:**

- A **`fail`** subcheck (finding reproduced) does NOT require a screenshot under
  the `paired-evidence` gate. You SHOULD still put the failing test output in
  the `note` anyway. The assertion is the proof.
- A **`pass`** subcheck (not reproduced) DOES require a screenshot + note per the
  gate. So either capture one, or downgrade it to `pending`. A green you cannot
  back with evidence is a `pending` by construction.

Send `evidencePolicy: "paired-evidence"`. This is the exact same subcheck /
criteria shape, gate, and endpoint as `visual-correctness`. Build the object,
write it to `proof.json`, gate it locally, then POST `{ data, issueUrl?,
prUrls? }`. The reusable local gate lives beside that skill at
`../visual-correctness/validate-proof.mjs`; the POST snippet is identical:

```bash
# Default endpoint is prod; override for staging:
#   export LAUNCHPROOF_PROOF_ENDPOINT=https://dev.launchguard.dev/api/proof
# Surface clickable Issue/PR links in the page header:
#   export PROOF_ISSUE_URL=https://github.com/owner/repo/issues/305
#   export PROOF_PR_URLS=https://github.com/owner/repo/pull/305
node -e '
  const fs=require("fs");
  const ep=process.env.LAUNCHPROOF_PROOF_ENDPOINT||"https://www.launchguard.dev/api/proof";
  const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  // Local gate — mirrors the server so a bad proof never leaves your machine.
  if(data.evidencePolicy==="paired-evidence"){
    const IMG=/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/;
    const bad=[];
    (data.criteria||[]).forEach((c,i)=>(c.subchecks||[]).forEach((s,j)=>{
      if(s.status!=="pass") return;
      const miss=[];
      if(!(typeof s.screenshot==="string"&&IMG.test(s.screenshot))) miss.push("screenshot");
      if(!(typeof s.note==="string"&&s.note.trim())) miss.push("note");
      if(miss.length) bad.push(`criteria[${i}].subchecks[${j}] "${s.condition}" missing: ${miss.join(" + ")}`);
    }));
    if(bad.length){console.error("proof gate FAILED — a pass needs a screenshot + note:\n"+bad.join("\n")+"\nCapture the evidence, or set status to pending.");process.exit(1);}
  }
  const body={data};
  if(process.env.PROOF_ISSUE_URL) body.issueUrl=process.env.PROOF_ISSUE_URL;
  if(process.env.PROOF_PR_URLS) body.prUrls=process.env.PROOF_PR_URLS.split(",");
  fetch(ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));console.log(j.url);})
    .catch(e=>{console.error("proof upload failed:",e.message);process.exit(1);});
' proof.json
```

The subcheck object shape (same as `visual-correctness`):

```jsonc
{
  "title": "Repro of PR #305 review findings",
  "verdict": "BROKEN",                        // BROKEN here = real findings exist (good)
  "evidencePolicy": "paired-evidence",        // ALWAYS send this
  "criteria": [
    {
      "id": "F1",
      "title": "Receipt-section reveal race swallows the click",   // finding title
      "requirement": "…reviewer's claim text, verbatim…",
      "subchecks": [
        {
          "condition": "Click Transactions before the receipts fetch resolves",   // trigger/state
          "expected": "the receipt section scrolls into view once receipts populate",  // correct behavior
          "status": "fail",                   // fail = REPRODUCED = finding is REAL
          "note": "Red test: clicked at t=0, ref was null, scroll no-op'd, and no retry fired when receipts arrived at t=400ms. Assertion `expect(section).toBeInViewport()` failed. This IS the bug the reviewer described."
        }
      ]
    }
  ]
}
```

Post the returned public URL back on the PR.

### f. Hand off

State plainly, honoring the asymmetry:

- **RED (real findings):** list each and where its test lives. These are
  committed and get fixed later ("fulfill the failing test by fixing it").
- **GREEN:** not reproduced with the inputs tried. Never "safe."
- **INCONCLUSIVE:** could not witness locally; name the environment that would.

## Gotchas that fake a verdict

- **A green because your test never hit the buggy path.** Assert you actually
  reached the branch (the burst-insert code ran, the empty-receipts state was
  live) before trusting a pass. An untriggered path is `pending`, not "not
  reproduced."
- **A "(latent / not currently triggered)" finding called not-reproduced because
  the happy path is green.** These are real in the code but need a specific
  trigger to go red. Reaching that trigger IS the work. Do not report the
  happy-path green as the verdict.
- **Screenshotting a launchproof skeleton** (spinner / pre-fetch empty state)
  and reading it as the reproduced state. Wait for the settled DOM first, same
  as `visual-correctness`.
- **Treating a deploy-only finding as not-reproduced** when it is actually
  INCONCLUSIVE locally. If the failure only exists in the standalone bundle /
  prod env, a green local run says nothing.

## Honesty rules

- Separate what you **reproduced** (a red test) from what you only **observed** (a
  green run). Observation finds smells; only the red test confirms.
- An unreached precondition is **`pending`**, never `pass`.
- Disclose any seeding, fixtures, or local password needed to reach the state, in
  the subcheck `note`.
- The red test's assertion IS the proof. The proof is the test or it isn't proof.
- Never fix the bug under the guise of proving it. Proving and fixing are two
  steps; this skill is only the first.

## Minimal by design

No bespoke parser, no new server, no new harness. This skill reuses `gh` to read
the review, the launchproof browser harness for UI repros, the repo's own unit /
integration runners for the rest, and the existing proof endpoint + gate from
`visual-correctness`. Drive it one finding at a time and learn from each.
