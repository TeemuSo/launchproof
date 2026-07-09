#!/usr/bin/env bash
# Install the LaunchProof repo process kit (issues -> PR backbone) into a repo.
#
#   bash "$LAUNCHPROOF_HOME/kit/install.sh" [/path/to/repo] [--force]
#
# Copies into the target repo:
#   .github/ISSUE_TEMPLATE/{task,bug,config}.yml   issue forms
#   .github/pull_request_template.md               PR template with proof section
#   .github/workflows/claude-code-review.yml       automated review on PRs
#   .github/workflows/issue-autoclose.yml          "Closes #N" works on non-default branches
#
# Existing files are SKIPPED unless --force is given, so a repo that already
# has its own review workflow keeps it. The kit is repo-agnostic: nothing in
# the copied files references a specific repo, branch name, or directory
# layout, so the same install works for a single-service repo or a monorepo.
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
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ ! -d "$TARGET/.git" ] && ! git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
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

# Best-effort: make sure the labels the issue forms apply actually exist.
if command -v gh >/dev/null 2>&1 && git -C "$TARGET" remote get-url origin >/dev/null 2>&1; then
  (cd "$TARGET" \
    && gh label create task --description "Unit of work" --color 0e8a16 2>/dev/null \
    && echo "LABEL   task created" || true)
  (cd "$TARGET" \
    && gh label create bug --description "Something is broken" --color d73a4a 2>/dev/null \
    && echo "LABEL   bug created" || true)
else
  echo "NOTE    gh not available or no origin remote; create 'task' and 'bug' labels yourself."
fi

echo
echo "Done: $installed installed, $skipped skipped."
echo
echo "Follow-ups:"
echo "  1. Commit and push the new .github files on your working branch."
echo "  2. Automated review needs the CLAUDE_CODE_OAUTH_TOKEN repo secret:"
echo "       claude setup-token   # then: gh secret set CLAUDE_CODE_OAUTH_TOKEN"
echo "     Until it is set, the review job skips with a notice (it does not fail)."
echo "  3. GitHub shows issue templates in the new-issue UI only once they reach"
echo "     the repo's DEFAULT branch. Until then, open issues with"
echo "     'gh issue create' using the same fields."
echo "  4. Post LaunchProof verdicts into PRs with kit/post-proof.sh (see its header)."
