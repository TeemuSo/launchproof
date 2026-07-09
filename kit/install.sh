#!/usr/bin/env bash
# Install the LaunchProof repo process kit (issues -> PR backbone) into a repo.
#
#   bash "$LAUNCHPROOF_HOME/kit/install.sh" [/path/to/repo] [--force]
#
# Copies into the target repo:
#   .github/ISSUE_TEMPLATE/{task,bug,config}.yml   issue forms
#   .github/pull_request_template.md               PR template with proof section
#   .github/workflows/claude-code-review.yml       automated review that posts on PRs
#   .github/workflows/issue-autoclose.yml          "Closes #N" works on non-default branches
#
# Also makes sure the 'task' and 'bug' labels exist (GitHub seeds fresh repos
# with 'bug' but NOT 'task').
#
# Safe to re-run: existing files are SKIPPED unless --force is given, so a
# repo that already has its own review workflow keeps it. The kit is
# repo-agnostic: nothing in the copied files references a specific repo,
# branch name, or directory layout, so the same install works for a
# single-service repo or a monorepo.
#
# After installing: commit, push, and read the follow-ups this script prints.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$KIT_DIR/templates"

TARGET="$PWD"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

if ! git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: $TARGET is not a git repository" >&2
  exit 1
fi

installed=0
skipped=0

while IFS= read -r src; do
  rel="${src#"$TEMPLATE_DIR"/}"
  dest="$TARGET/$rel"
  if [ -e "$dest" ] && [ "$FORCE" -ne 1 ]; then
    echo "SKIP    $rel (exists; use --force to overwrite)"
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "INSTALL $rel"
  installed=$((installed + 1))
done < <(find "$TEMPLATE_DIR" -type f | sort)

# Labels the issue forms apply. GitHub seeds new repos with 'bug' but not
# 'task'; check first so the output tells the truth instead of hiding errors.
HAVE_GH=0
if command -v gh >/dev/null 2>&1 && git -C "$TARGET" remote get-url origin >/dev/null 2>&1; then
  HAVE_GH=1
  existing_labels="$( (cd "$TARGET" && gh label list --limit 100 --json name --jq '.[].name') 2>/dev/null || echo "__gh_label_list_failed__")"
  if [ "$existing_labels" = "__gh_label_list_failed__" ]; then
    echo "NOTE    could not list labels (gh not authenticated, or repo not on GitHub yet);"
    echo "        create 'task' and 'bug' labels yourself."
  else
    for label in task bug; do
      if printf '%s\n' "$existing_labels" | grep -qx "$label"; then
        echo "LABEL   $label already exists"
      else
        case "$label" in
          task) desc="Unit of work"; color=0e8a16 ;;
          bug)  desc="Something is broken"; color=d73a4a ;;
        esac
        if (cd "$TARGET" && gh label create "$label" --description "$desc" --color "$color" >/dev/null 2>&1); then
          echo "LABEL   $label created"
        else
          echo "NOTE    could not create label '$label'; create it yourself."
        fi
      fi
    done
  fi
else
  echo "NOTE    gh not available or no origin remote; create 'task' and 'bug' labels yourself."
fi

# Default-branch awareness: issue forms and the PR template only render in
# GitHub's UI once they exist on the DEFAULT branch.
DEFAULT_BRANCH=""
if [ "$HAVE_GH" -eq 1 ]; then
  DEFAULT_BRANCH="$( (cd "$TARGET" && gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name') 2>/dev/null || true)"
fi
CURRENT_BRANCH="$(git -C "$TARGET" branch --show-current 2>/dev/null || true)"

echo
echo "Done: $installed installed, $skipped skipped."
echo
echo "Follow-ups:"
echo "  1. Commit and push the new .github files on your working branch."
if [ -n "$DEFAULT_BRANCH" ] && [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
  echo "     You are on the default branch ($DEFAULT_BRANCH): issue forms and the PR"
  echo "     template go live in GitHub's UI as soon as this lands."
elif [ -n "$DEFAULT_BRANCH" ]; then
  echo "     You are on '$CURRENT_BRANCH' but the default branch is '$DEFAULT_BRANCH':"
  echo "     GitHub shows issue forms and the PR template in its UI only from the"
  echo "     DEFAULT branch. Until this reaches '$DEFAULT_BRANCH', open issues with"
  echo "     'gh issue create' using the same fields."
else
  echo "     GitHub shows issue forms and the PR template only once they reach the"
  echo "     repo's DEFAULT branch. Until then, open issues with 'gh issue create'."
fi
echo "  2. Automated review needs ONE repo secret (skips with a notice until set):"
echo "       claude setup-token && gh secret set CLAUDE_CODE_OAUTH_TOKEN   # Pro/Max"
echo "     or"
echo "       gh secret set ANTHROPIC_API_KEY                               # Console key"
echo "     Posting uses the Claude GitHub App (one-time: https://github.com/apps/claude)."
echo "  3. Optional: LaunchProof. If this repo has LaunchProof tests, post run"
echo "     verdicts into PRs with kit/post-proof.sh (see its header). If not, the"
echo "     loop still works: state \"docs-only\" or your own proof in the PR body."
