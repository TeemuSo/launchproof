#!/usr/bin/env node
/**
 * Local pre-POST gate for a visual-correctness proof.
 *
 * Mirrors the server's opt-in `evidencePolicy: "paired-evidence"` rule (see
 * launchguard-app src/app/api/proof/validate.ts) so you get the SAME rejection —
 * with the SAME actionable message — BEFORE the network round-trip: every `pass`
 * subcheck must carry an annotated screenshot AND a note (the rendered-vs-oracle
 * pairing). Anything not yet captured must be `pending`, not `pass`.
 *
 * Usage:  node validate-proof.mjs proof.json
 * Exit 0 = ok to POST; exit 1 = fix the listed subchecks first.
 *
 * This is intentionally standalone (no deps) so it runs anywhere the skill does.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node validate-proof.mjs <proof.json>");
  process.exit(2);
}

let proof;
try {
  proof = JSON.parse(readFileSync(path, "utf8"));
  // Accept either the bare proof object or a { data: {...} } envelope.
  if (proof && proof.data && !proof.criteria) proof = proof.data;
} catch (e) {
  console.error(`could not read/parse ${path}: ${e.message}`);
  process.exit(2);
}

const DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/;

const problems = [];

// The gate only applies when the proof opts in — same as the server.
if (proof?.evidencePolicy && proof.evidencePolicy !== "paired-evidence") {
  console.error(
    `invalid evidencePolicy "${proof.evidencePolicy}" — the only supported value is "paired-evidence".`,
  );
  process.exit(1);
}

if (proof?.evidencePolicy === "paired-evidence") {
  const criteria = Array.isArray(proof.criteria) ? proof.criteria : [];
  criteria.forEach((c, i) => {
    const subs = Array.isArray(c?.subchecks) ? c.subchecks : [];
    subs.forEach((s, j) => {
      if (s?.status !== "pass") return;
      const missing = [];
      const hasShot =
        typeof s.screenshot === "string" && DATA_IMAGE_RE.test(s.screenshot);
      const hasNote = typeof s.note === "string" && s.note.trim().length > 0;
      if (!hasShot) missing.push("screenshot");
      if (!hasNote) missing.push("note");
      if (missing.length) {
        problems.push({
          path: `criteria[${i}].subchecks[${j}]`,
          condition: s.condition ?? "(no condition)",
          missing,
        });
      }
    });
  });
}

if (problems.length) {
  console.error(
    `\n✗ ${problems.length} 'pass' subcheck(s) lack paired evidence — the server will reject this (422 pass_without_evidence):\n`,
  );
  for (const p of problems) {
    console.error(`  ${p.path}  "${p.condition}"  → missing: ${p.missing.join(" + ")}`);
  }
  console.error(
    "\nA 'pass' must include an annotated screenshot AND a note pairing the rendered output to its oracle.\n" +
      "Capture the evidence (see the skill's mark()/shot() helpers), or set status to 'pending' if you haven't yet.\n",
  );
  process.exit(1);
}

console.log("✓ proof gate passed — every 'pass' subcheck has a screenshot + note.");
