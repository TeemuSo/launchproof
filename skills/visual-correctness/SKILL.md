---
name: visual-correctness
description: >-
  Verify a presentation-layer / UI change actually shows the RIGHT data — that
  what's rendered stays faithful to the payload the view was handed (nothing
  dropped, fabricated, distorted, or misattributed). Produces a scannable,
  shareable LaunchGuard proof page (a public URL anyone can open): annotated
  screenshots + a payload-vs-rendered diff + a per-claim verdict you can
  eyeball. Use when verifying a frontend/UI PR or
  branch, when asked to "check visual correctness", "does the UI show the right
  data", "verify this renders correctly", or before saying a UI change works.
  NOT for backend/data correctness — this assumes the fetched payload is the
  oracle. Backend correctness is a separate concern.
---

# Visual correctness

Prove that a presentation-layer change **presents its data faithfully**. The
screen is a *claim*; the payload the view received is the *oracle*. Your job is
to hold one against the other and produce proof a human can scan in ten seconds.

## What this proves — and what it doesn't

- ✅ **In scope:** the rendered output is obedient to its input. Every value the
  change touches is complete, faithful, honest, and correctly attributed
  (defined below).
- ❌ **Out of scope:** whether the input itself is correct. If the fetch is
  wrong, the query is wrong, or the DB is wrong, that's a *different boundary*
  (backend correctness) — not this skill. Here, **the payload is ground truth
  by assumption.**

You verify a layer against the layer directly beneath it — never against the
pixels alone. For a UI diff, that boundary is fixed: **rendered output vs the
payload the client received.**

## The one rule that makes this non-obvious

> **A wrong value that still looks like a valid value is invisible to the eye.**

`0,00 €`, `—`, `No data yet`, a fallback avatar, a plausible name — each is
*ambiguous by observation*: it means either "the data really was empty" or "the
data was there and got dropped / muted / misrouted," and those look identical.
That is the entire failure class this skill exists to catch. So:

> **Every zero, empty, dash, or default on screen is a QUESTION for the
> payload, not an answer.**

You can smell-test ordinary cells by looking. The empties and defaults you
cannot — you must hold them against the input.

## The four checks

For every value the change touches, the UI must be:

1. **Complete** — every field in the payload that should surface actually
   surfaces. *(Silent drop: payload has it, screen doesn't.)*
2. **Faithful** — the rendered value equals the payload value after *only* the
   transform you intended (rounding, unit, currency, date format, enum→label).
   Any other difference is distortion.
3. **Honest** — nothing on screen that isn't derivable from the payload. No
   fabricated defaults, no leaked placeholder/mock, no hardcoded sample data.
4. **Attributed** — each value sits on the right row / entity / label. No
   off-by-one, no right-value-wrong-owner.

## Workflow

1. **Scope it.** From the diff, list the concrete values and states the change
   touches (columns, cells, badges, empty states, conditional rendering). These
   are your assertions.

2. **Drive the app to the state — for real.** Use a real browser
   (`playwright-cli`, Playwright, etc.). Reach the exact screen the change
   affects, with data that actually exercises the branch (a zero AND a non-zero;
   an enabled AND a disabled case — the contrast is what makes conditional
   logic legible). If the interesting state needs data, seed it locally and say
   so in the report.

3. **Capture BOTH sides.**
   - **Rendered:** a screenshot AND the DOM (text content + any relevant
     `title`/`aria` — enough to tell "muted because disabled" from "plain
     zero"). Read the DOM, don't eyeball the pixels. **Wait for the SETTLED
     element before you capture** — assert the real value is present
     (`locator.waitFor()` on the actual cell/row), never screenshot a loading
     skeleton, spinner, or the pre-fetch empty state and call it the rendered
     truth. If the app scrolls an inner container (a fixed-height shell whose
     child scrolls, not the document), a `fullPage` screenshot will silently
     miss anything below the fold — scroll the real scroll container to the
     element and shoot the viewport instead.
   - **Payload (the oracle):** get the data the view was handed. In priority
     order of how directly it reflects the input:
     1. the **network JSON response** feeding the view (Playwright
        `waitForResponse` / a response listener; or the browser Network panel).
        A passive listener can MISS the load (fetch resolved before you
        attached, or fired on a prior navigation) — if the payload isn't
        captured, don't guess; fall to #3 and fetch it explicitly.
     2. the **hydration / RSC payload** (`window.__NEXT_DATA__`, the flight
        data, serialized props),
     3. **call the same API / data function directly** with the session
        (`page.evaluate(() => fetch('/api/…').then(r => r.json()))` reuses the
        page's cookies) — the reliable default when the passive capture is
        flaky,
     4. **last resort**, the DB — only when the value never crosses a client
        boundary you can observe. (This is the escape hatch, not the default.)

4. **Diff, per value.** Run the four checks. For each empty/zero/dash/default,
   explicitly resolve the ambiguity: is the payload field also empty (honest) or
   populated (bug)?

5. **Annotate at the assertion — reuse the harness, don't hand-roll it.** The
   launchproof harness already ships this: `mark(locator, 'ok' | 'bad', label)`
   in `tests/helpers/highlight.ts` outlines the exact element in the browser
   (green = the value you asserted is correct/present, red = absent/wrong) with
   a floating label, right before you screenshot — it lands on the real element
   regardless of layout. Pair it with `recordedStep(page, testInfo, name, fn)`
   in `tests/helpers/shot.ts`, which captures the screenshot **and** the
   serialized DOM together, so every shot has its DOM pair for free. Do NOT
   re-invent the DOM-eval outline; the common bugs (labelling the wrong node,
   capturing a skeleton) are exactly what these solve.
   - **Target with a precise `Locator`, never a text-content search.** A text
     match grabs the first *leaf* with that text — so `"API key"` lands on the
     breadcrumb instead of the sidebar item, and it silently EXCLUDES an
     `<a>`/button that wraps an icon `<svg>` (its `childElementCount` isn't 0).
     Use the real selector/role: `mark(page.getByRole('link', { name: 'API
     key' }).and(page.locator('nav.sidebar a')), 'ok', 'Nav item · active')`.
   - Verify the class/attribute you're claiming in the DOM too (e.g. read that
     the link actually has `aria-current`/an `active` class), so the highlight
     and the DOM assertion agree.

6. **Report as structured proof DATA.** You do NOT author markup. LaunchGuard's
   proof viewer owns all design and chrome server-side; the skill's only job is to
   emit a JSON payload. Build the object below (the report unit is the **subcheck**:
   one `condition` → one `expected` outcome → one `status` → one annotated
   `screenshot` → one natural-voice `note`, grouped under an acceptance criterion),
   write it to `proof.json`, then POST `{ data, issueUrl?, prUrls? }`. The server
   derives the tally and, when omitted, each criterion's status and the top-level
   `verdict`, from the subcheck statuses.

   ```jsonc
   {
     "title": "Creators table revamp",          // required, non-empty
     "subtitle": "chat-only creators now show chat revenue",  // optional, one line
     "target": "dev.burndial.com",               // optional
     "verdict": "BROKEN",                        // optional: WORKING|BROKEN|INCONCLUSIVE (server derives if omitted)
     "evidencePolicy": "paired-evidence",        // ALWAYS send this — turns on the gate: every `pass` subcheck must carry a screenshot + note, else the server rejects with 422 pass_without_evidence
     "criteria": [                               // required, >= 1 (<= 100)
       {
         "id": "AC1",                            // optional -> shown as the card number
         "title": "Chat revenue shows for chat-only creators",  // required
         "requirement": "…original requirement text…",          // optional
         "status": "fail",                       // optional override; server derives from subchecks if omitted
         "subchecks": [                          // required, >= 1 (<= 50)
           {
             "condition": "Chat-only creator row",                        // required — the trigger/state
             "expected": "chatGrossRevenue renders as 7,00 €",            // required — what should show
             "status": "fail",                   // required: pass|fail|pending
             "screenshot": "data:image/png;base64,…",                     // optional; MUST be a data:image/(png|jpeg|jpg|webp|gif|avif);base64 URI
             "note": "Payload had chatGrossRevenue: 7.00 but the cell rendered 0,00 € — value dropped."  // optional, natural voice
           }
         ]
       }
     ]
   }
   ```

   Every subcheck that resolves an empty/zero/dash/default MUST say, in its `note`,
   whether the payload field was also empty (honest) or populated (bug) — the
   payload comparison lives in the note, not in a separate diff table. Then publish
   and share the returned **public URL** (works for anyone, unlike a
   developer-scoped Claude artifact). Ingest is anonymous — no LaunchGuard account
   needed:

   The POST script below GATES LOCALLY FIRST: with `evidencePolicy: "paired-evidence"`
   set, it refuses to send if any `pass` subcheck lacks a screenshot + note — the same
   rule and message the server enforces (422 `pass_without_evidence`), but without the
   round-trip. It names the offending subchecks so you can fix them (or mark them
   `pending`). A reusable standalone copy lives beside this skill at
   `validate-proof.mjs` if you want to gate a `proof.json` on its own.

   ```bash
   # Default endpoint is prod; override for staging:
   #   export LAUNCHPROOF_PROOF_ENDPOINT=https://dev.launchguard.dev/api/proof
   # Optional: surface clickable Issue/PR links in the page header:
   #   export PROOF_ISSUE_URL=https://github.com/owner/repo/issues/296
   #   export PROOF_PR_URLS=https://github.com/owner/repo/pull/298,https://github.com/owner/repo/pull/301
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

   The page renders inside LaunchGuard chrome with a "Proof hosted by LaunchGuard"
   footer (the shared link is itself the ad). Constraints: screenshots MUST be
   inlined as `data:` image URIs (png/jpeg/webp/gif/avif — external URLs and
   non-image data URIs are rejected with 400); total payload ≤ 5 MB, ≤ 100
   criteria, ≤ 50 subchecks each, ≤ 20 PR links, and all links must be http/https.
   The server escapes all text — send plain strings, not markup. Post the returned
   URL on the PR/issue.

## Gotchas that fake a green (learned the hard way)

Each of these produces a screenshot that *looks* like proof but isn't:

- **`waitUntil: 'networkidle'` on a live app hangs.** Anything with SSE, a
  polling feed, websockets, or background refetch never goes idle, so `goto`
  times out (often flaky-passing on retry, which hides it). Use
  `domcontentloaded` + an explicit `waitForSelector`/`locator.waitFor()` on the
  settled element. Never `networkidle` here.
- **`fullPage` misses inner-scroll shells.** A fixed-height app frame that
  scrolls a child (not the document) gives a `fullPage` shot that stops at the
  fold — your element is simply absent from the image. Scroll the real
  container (`el.closest('[data-scroll]')` / the shell's main pane) and shoot
  the viewport.
- **Skeleton capture.** Screenshotting before the fetch resolves captures a
  spinner/empty row and reads as "no data" — an honest-looking lie. Wait for the
  real value in the DOM first.
- **Text-match annotation hits the wrong node.** See step 5 — annotate via a
  precise `Locator`, not `textContent === '…'`.
- **Passive oracle capture silently missed.** A `page.on('response')` listener
  that never fired leaves you with no payload; don't publish `pass` off memory —
  fetch the oracle explicitly in-session.
- **Branch-switch 404s.** Checking out a branch that lacks a route (or a
  dev-server file-watcher confused by the switch) makes the page 404 mid-run.
  Before capturing, sanity-check the target returns 200; if not, the server is
  stale or on the wrong branch — don't proceed against a broken page.

## Honesty rules

- State claims you **checked against the payload** separately from ones you only
  **observed**. Observation finds smells; only the payload confirms.
- Mark anything you didn't capture as **`pending`**, not `pass`.
- If reaching the state required seeding/fixtures or a local password, say so in
  a subcheck `note` (or the criterion `requirement`). Nothing hidden.
- Don't publish a value as `pass` unless the payload comparison is in that
  subcheck's `note`. "The proof is inline or it isn't proof."
- This is now ENFORCED, not just asked: send `evidencePolicy: "paired-evidence"`
  and every `pass` must carry a screenshot + note or ingest fails with 422
  `pass_without_evidence` (the POST script gates locally first, same message). A
  green check you can't back with evidence is a `pending`, by construction.

## The proof design is server-owned

There is no local template. LaunchGuard owns all proof-page markup, styling, and
chrome server-side; the skill emits only the structured JSON in step 6 and POSTs
it. Do not hand-author HTML, and do not load `artifact-design` for this — shape
your findings into criteria and subchecks and let the viewer render them.
