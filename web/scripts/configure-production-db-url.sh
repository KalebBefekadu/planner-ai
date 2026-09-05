#!/usr/bin/env bash

set -euo pipefail
umask 077

release_env_file="${PLANNER_RELEASE_ENV_FILE:-.env.release.local}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/configure-production-db-url.sh

Privately prompts for a Supabase Session Pooler URI, verifies it with a read-only
SELECT 1, and saves it as PLANNER_PRODUCTION_DATABASE_URL in the gitignored
release environment file. The URI is never printed.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

[[ $# -eq 0 ]] || { usage >&2; exit 1; }

command -v node >/dev/null 2>&1 || {
  printf 'Node.js is required to validate the connection URI.\n' >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  printf 'psql is required to verify the database connection.\n' >&2
  exit 1
}

printf 'Paste the complete Supabase Session Pooler URI, then press Enter.\n'
printf 'Input is hidden and will not be printed: '
IFS= read -r -s database_url
printf '\n'

# Trim accidental surrounding whitespace from copy/paste.
database_url="${database_url#"${database_url%%[![:space:]]*}"}"
database_url="${database_url%"${database_url##*[![:space:]]}"}"

if [[ -z "$database_url" ]]; then
  printf 'No URI was entered. Nothing was saved.\n' >&2
  exit 1
fi

if [[ "$database_url" == *\\* || "$database_url" == *"'"* ]]; then
  printf 'The URI contains a backslash or quote. Copy the dashboard URI exactly; do not escape the @ separator.\n' >&2
  exit 1
fi

if ! printf '%s' "$database_url" | node -e '
const value = require("node:fs").readFileSync(0, "utf8");
try {
  const url = new URL(value);
  const expectedUser = "postgres.ljjrstymmqlebwdkvrje";
  if (!/^postgres(?:ql)?:$/.test(url.protocol) ||
      !url.hostname.endsWith(".pooler.supabase.com") ||
      url.port !== "5432" ||
      url.username !== expectedUser ||
      !url.password) {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
'; then
  printf 'This is not a complete Planner AI Session Pooler URI on port 5432. Nothing was saved.\n' >&2
  exit 1
fi

printf 'Checking the connection with a read-only query...\n'
if ! env -u PGHOST -u PGPORT -u PGDATABASE -u PGSERVICE -u PGUSER -u PGPASSWORD \
  PGCONNECT_TIMEOUT=20 psql --dbname="$database_url" --no-password --tuples-only --no-align \
  --command 'select 1' >/dev/null 2>&1; then
  printf 'The connection was rejected. Reset the Supabase Database password, copy a fresh Session Pooler URI, and try again. Nothing was saved.\n' >&2
  exit 1
fi

temporary_file="$(mktemp "${release_env_file}.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT
updated=0

if [[ -f "$release_env_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == PLANNER_PRODUCTION_DATABASE_URL=* ]]; then
      printf "PLANNER_PRODUCTION_DATABASE_URL='%s'\n" "$database_url" >> "$temporary_file"
      updated=1
    else
      printf '%s\n' "$line" >> "$temporary_file"
    fi
  done < "$release_env_file"
fi

if [[ "$updated" -eq 0 ]]; then
  printf "PLANNER_PRODUCTION_DATABASE_URL='%s'\n" "$database_url" >> "$temporary_file"
fi

mv "$temporary_file" "$release_env_file"
chmod 600 "$release_env_file"
trap - EXIT
printf 'Connection verified and saved privately in %s.\n' "$release_env_file"
