#!/usr/bin/env bash

set -euo pipefail
umask 077

release_env_file="${PLANNER_RELEASE_ENV_FILE:-.env.release.local}"
if [[ -f "$release_env_file" ]]; then
  set -a
  # This file is operator-owned, gitignored, and must never be committed.
  source "$release_env_file"
  set +a
fi

usage() {
  cat <<'EOF'
Usage:
  ./scripts/preflight-production-cutover.sh

Performs read-only release checks before a canonical data-model cutover. It never
creates a backup, repairs migration history, or applies migrations. It requires
the management token, production database connection string, and backup passphrase so
the next release step cannot proceed without a recoverable rollback path.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is unavailable: %s\n' "$1" >&2
    exit 1
  }
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || {
    printf 'Required release variable is not set: %s\n' "$name" >&2
    exit 1
  }
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

[[ $# -eq 0 ]] || { usage >&2; exit 1; }

require_command npx
require_command pg_dump
require_command pg_restore
require_command openssl
require_environment SUPABASE_ACCESS_TOKEN
require_environment PLANNER_PRODUCTION_DATABASE_URL
require_environment PLANNER_BACKUP_PASSPHRASE

if [[ ! -f supabase/.temp/project-ref ]]; then
  printf 'No linked Supabase project. Run supabase link before preflight.\n' >&2
  exit 1
fi

project_ref="$(tr -d '[:space:]' < supabase/.temp/project-ref)"
[[ -n "$project_ref" ]] || {
  printf 'The linked Supabase project reference is empty.\n' >&2
  exit 1
}

database_authority="${PLANNER_PRODUCTION_DATABASE_URL#*://}"
database_credentials="${database_authority%@*}"
database_host="${database_authority#*@}"
database_host="${database_host%%/*}"
database_host="${database_host%%:*}"
expected_host="db.${project_ref}.supabase.co"
expected_pooler_user="postgres.${project_ref}"
database_user="${database_credentials%%:*}"

if [[ "$database_host" != "$expected_host" && ( "$database_host" != *.pooler.supabase.com || "$database_user" != "$expected_pooler_user" ) ]]; then
  printf 'Production database URL does not target the linked Supabase project.\n' >&2
  exit 1
fi

cli_home="${PLANNER_SUPABASE_CLI_HOME:-${TMPDIR:-/tmp}/planner-ai-supabase-cli}"
mkdir -p "$cli_home"

printf 'Checking linked project migration history without applying changes...\n'
migration_output="$(HOME="$cli_home" npx supabase migration list --output json)"

if ! printf '%s' "$migration_output" | node -e '
const output = require("node:fs").readFileSync(0, "utf8").trim();
let migrations;

try {
  migrations = JSON.parse(output).migrations;
} catch {
  migrations = output
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((cell) => cell.replaceAll("`", "").trim()))
    .filter((cells) => /^\d{14}$/.test(cells[0] || "") || /^\d{14}$/.test(cells[1] || ""))
    .map(([local, remote]) => ({ local, remote }));
}

if (!Array.isArray(migrations) || migrations.length === 0) {
  console.error("Unable to read Supabase migration history. Stop before cutover and inspect the CLI output.");
  process.exit(1);
}

const drift = migrations.filter((migration) => !migration.local || !migration.remote);
if (drift.length > 0) {
  console.error("Migration history drift is present. Do not repair or push until the encrypted backup and a deliberate reconciliation plan are recorded.");
  process.exit(1);
}
'; then
  exit 1
fi

printf 'Preflight passed. Create and verify the encrypted backup before any migration repair or push.\n'
