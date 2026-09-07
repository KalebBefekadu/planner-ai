#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
branch=$(git branch --show-current)

case "$branch" in
  codex/*|claude/*) ;;
  *)
    echo "Run this check from a codex/* or claude/* worker branch." >&2
    exit 1
    ;;
esac

git diff --check

cd "$repo_root/web"
npm run agent:check

echo "Worker checks passed on $branch."
