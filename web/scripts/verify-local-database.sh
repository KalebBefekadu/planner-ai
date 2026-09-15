#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: verify-local-database.sh <verify|test|generate-types|exec> [command...]

  verify         Reset from migrations, run pgTAP, and check generated-type drift.
  test           Reset from migrations and run pgTAP.
  generate-types Reset from migrations and replace the checked-in generated types.
  exec           Start the stack and run a command while holding the shared lock.
EOF
  exit 64
}

[[ $# -ge 1 ]] || usage

mode=$1
shift
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ ${PLANNER_SUPABASE_LOCK_HELD:-} != "1" ]]; then
  exec env PLANNER_SUPABASE_LOCK_HELD=1 \
    "$script_dir/with-local-supabase-lock.sh" "$0" "$mode" "$@"
fi

web_root=$(cd "$script_dir/.." && pwd)
types_target="$web_root/src/types/supabase.generated.ts"
types_temp_dir=""

cleanup_types() {
  if [[ -n "$types_temp_dir" ]]; then
    rm -f "$types_temp_dir/supabase.generated.ts"
    rmdir "$types_temp_dir" 2>/dev/null || true
  fi
}

trap cleanup_types EXIT

start_stack() {
  # Supabase prints local keys on successful start. Keep stderr for failures but
  # do not place ephemeral credentials in developer terminals or CI logs.
  npx supabase start >/dev/null
}

reset_database() {
  npx supabase db reset
}

generate_types() {
  types_temp_dir=$(mktemp -d "$web_root/src/types/.supabase-generated.XXXXXX")
  npx supabase gen types typescript --local --schema public \
    >"$types_temp_dir/supabase.generated.ts"
  npx prettier --write "$types_temp_dir/supabase.generated.ts" >/dev/null
}

cd "$web_root"

case "$mode" in
  verify)
    [[ $# -eq 0 ]] || usage
    start_stack
    reset_database
    npx supabase test db
    generate_types
    if ! cmp -s "$types_target" "$types_temp_dir/supabase.generated.ts"; then
      echo "Generated Supabase types do not match a clean migration reset." >&2
      diff -u "$types_target" "$types_temp_dir/supabase.generated.ts" || true
      exit 1
    fi
    echo "Database migrations, pgTAP tests, and generated types are consistent."
    ;;
  test)
    [[ $# -eq 0 ]] || usage
    start_stack
    reset_database
    npx supabase test db
    ;;
  generate-types)
    [[ $# -eq 0 ]] || usage
    start_stack
    reset_database
    generate_types
    mv "$types_temp_dir/supabase.generated.ts" "$types_target"
    rmdir "$types_temp_dir"
    types_temp_dir=""
    echo "Generated Supabase types from a clean migration reset."
    ;;
  exec)
    [[ $# -ge 1 ]] || usage
    start_stack
    "$@"
    ;;
  *)
    usage
    ;;
esac
