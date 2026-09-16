#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 64
fi

repo_root=$(git rev-parse --show-toplevel)
git_common_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)
lock_dir=${PLANNER_SUPABASE_LOCK_DIR:-"$git_common_dir/planner-ai-local-supabase.lock"}
owner_file="$lock_dir/owner"

if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "The shared Planner AI Supabase stack is already reserved." >&2
  if [[ -r "$owner_file" ]]; then
    echo "Current owner:" >&2
    sed 's/^/  /' "$owner_file" >&2
  else
    echo "Owner metadata is not available yet." >&2
  fi
  echo "Lock: $lock_dir" >&2
  echo "Wait for that command to finish. If it crashed, verify no local Supabase command is running before removing this exact lock directory." >&2
  exit 75
fi

cleanup() {
  local status=$?
  trap - EXIT
  rm -f "$owner_file"
  rmdir "$lock_dir" 2>/dev/null || true
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
branch=$(git -C "$repo_root" branch --show-current)
{
  printf 'pid=%s\n' "$$"
  printf 'branch=%s\n' "${branch:-detached}"
  printf 'worktree=%s\n' "$repo_root"
} >"$owner_file"

"$@"
