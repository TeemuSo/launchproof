# LaunchProof repo process kit

A portable issues -> PR backbone for any repo that uses LaunchProof. One
install gives a repo:

- **Issue forms** (`task`, `bug`) with acceptance criteria and a proof plan
  baked into the form, so work items are born verifiable.
- **A PR template** that links the issue (`Closes #N`), carries the proof
  section, and checklists the playbook append.
- **Automated code review** on every PR (`claude-code-review.yml`, official
  `anthropics/claude-code-action`). Skips gracefully with a notice until the
  `CLAUDE_CODE_OAUTH_TOKEN` secret is set.
- **`Closes #N` on non-default branches** (`issue-autoclose.yml`): GitHub only
  auto-closes linked issues for merges into the default branch; this workflow
  restores the contract for repos that work on `dev` or any other branch.
- **`post-proof.sh`**: posts a LaunchProof run's verdict (WORKING / BROKEN /
  INCONCLUSIVE), per-step table, and evidence location into the PR as a
  comment, straight from the run's `result.json`.

## Install

```bash
bash "$LAUNCHPROOF_HOME/kit/install.sh" /path/to/repo   # or run from inside the repo
```

Existing files are never overwritten (use `--force` to replace). Then commit
and push the new `.github/` files on your working branch, and follow the
printed follow-ups (review token secret, default-branch note for templates).

## The loop the kit supports

1. Open an issue from the `task` or `bug` form (acceptance criteria + proof plan).
2. Branch, build, open a PR against the working branch with `Closes #N` in the body.
3. Automated review runs on the PR.
4. Run LaunchProof against the branch; post the verdict into the PR:
   ```bash
   bash "$LAUNCHPROOF_HOME/kit/post-proof.sh" <pr-number> .launchproof/runs/<run-id>
   ```
   Add `--proof-url` when a hosted proof page exists. Docs-only change? State
   "docs-only" in the PR's proof section instead.
5. Merge. The linked issue closes (natively on the default branch,
   via `issue-autoclose.yml` elsewhere).

## Portability rules (keep it this way)

- Nothing in `templates/` may reference a specific repo, branch name, product,
  or directory layout. The kit must install identically into a single-service
  repo or a monorepo.
- Repo-specific tuning happens in the TARGET repo after install (the installer
  never overwrites), not by editing the kit for one consumer.
- The only external requirements are `gh` (authenticated) and, for automated
  review, the `CLAUDE_CODE_OAUTH_TOKEN` secret.

## Known limits (honest by design)

- GitHub reads issue forms AND the PR template from the repo's DEFAULT branch
  only. Installed on a working branch, they ride along until that branch is
  promoted; until then open issues with `gh issue create` using the same
  fields, and paste the PR template structure into PR bodies.
- LaunchProof run directories are local and gitignored, so the PR comment
  records the verdict, step table, run id, and machine path. A public link
  requires `--proof-url` (for example a hosted proof page).
- `pull_request`-triggered workflows added by a PR do run on that same PR, but
  `issue-autoclose.yml` (a `closed`-type trigger) must already be on the BASE
  branch when the merge happens; land the kit itself first, then the loop is
  complete for every following PR.
