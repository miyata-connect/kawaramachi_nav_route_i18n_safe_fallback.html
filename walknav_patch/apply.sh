#!/usr/bin/env bash
set -euo pipefail
BRANCH="chore/walknav-governance-specs"
git fetch origin
git switch -c "$BRANCH"
git apply --3way patch.diff
git add -A
git commit -m "chore: add WalkNav governance docs + spec alias (v2025-10-25) and CI guard"
git push -u origin "$BRANCH"
echo "Now create a PR:"
echo "  gh pr create -f"
