#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <codex|claude> <ticket> [base-branch]" >&2
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage

agent=$1
ticket=$2
if [[ $# -eq 3 ]]; then
  base_branch=$3
else
  base_branch=integration/dogfood
fi

[[ "$agent" == "codex" || "$agent" == "claude" ]] || usage
[[ "$ticket" =~ ^[a-z0-9][a-z0-9-]*$ ]] || {
  echo "Ticket must use lowercase letters, numbers, and hyphens." >&2
  exit 2
}

repo_root=$(git rev-parse --show-toplevel)
branch="$agent/$ticket"
worktree_path="$repo_root/.worktrees/$agent-$ticket"

git show-ref --verify --quiet "refs/heads/$base_branch" || {
  echo "Base branch does not exist: $base_branch" >&2
  exit 1
}

if git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Branch already exists: $branch" >&2
  exit 1
fi

if [[ -e "$worktree_path" ]]; then
  echo "Worktree path already exists: $worktree_path" >&2
  exit 1
fi

mkdir -p "$repo_root/.worktrees"
git worktree add "$worktree_path" -b "$branch" "$base_branch"

echo "Created $branch"
echo "Path: $worktree_path"
echo "Environment files were not copied."
