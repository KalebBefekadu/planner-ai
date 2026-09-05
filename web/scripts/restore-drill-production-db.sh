#!/usr/bin/env bash

set -euo pipefail
umask 077

release_env_file="${PLANNER_RELEASE_ENV_FILE:-.env.release.local}"
supabase_postgres_image="${PLANNER_RESTORE_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.158}"

if [[ -f "$release_env_file" ]]; then
  set -a
  # This is an operator-owned, gitignored release credential file.
  source "$release_env_file"
  set +a
fi

usage() {
  cat <<'EOF'
Usage:
  ./scripts/restore-drill-production-db.sh backups/<archive>.dump.enc

Decrypts a trusted Planner AI backup into a temporary file, restores it into a
disposable local Supabase Postgres container, verifies the restored public schema,
and destroys the container. Production is never contacted or modified.

Requires PLANNER_BACKUP_PASSPHRASE in the environment or .env.release.local.
Set PLANNER_RESTORE_IMAGE to test a different trusted Supabase Postgres image.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is unavailable: %s\n' "$1" >&2
    exit 1
  }
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

[[ $# -eq 1 ]] || {
  usage >&2
  exit 1
}

archive="$1"
[[ -f "$archive" ]] || {
  printf 'Backup archive was not found.\n' >&2
  exit 1
}
[[ -n "${PLANNER_BACKUP_PASSPHRASE:-}" ]] || {
  printf 'PLANNER_BACKUP_PASSPHRASE must be set.\n' >&2
  exit 1
}

require_command docker
require_command openssl
require_command mktemp
require_command awk
require_command seq
require_command tr

if [[ -f "$archive.sha256" ]]; then
  require_command shasum
  expected_checksum="$(awk '{print $1}' "$archive.sha256")"
  actual_checksum="$(shasum -a 256 "$archive" | awk '{print $1}')"
  [[ "$expected_checksum" == "$actual_checksum" ]] || {
    printf 'Backup checksum validation failed.\n' >&2
    exit 1
  }
fi

container_name="planner-ai-restore-drill-$$"
temporary_dump="$(mktemp /tmp/planner-ai-restore.XXXXXX)"

cleanup() {
  rm -f "$temporary_dump"
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:PLANNER_BACKUP_PASSPHRASE -in "$archive" -out "$temporary_dump"

docker run -d --name "$container_name" \
  -e POSTGRES_PASSWORD=restore-drill-only \
  "$supabase_postgres_image" >/dev/null

# The Supabase image briefly accepts connections before completing an internal
# initialization restart. Require readiness to remain stable before restoring.
for _attempt in $(seq 1 60); do
  state="$(docker inspect --format '{{.State.Status}}' "$container_name")"
  if [[ "$state" == "running" ]] && \
    docker exec -u postgres "$container_name" \
      pg_isready -U supabase_admin -d postgres >/dev/null 2>&1; then
    sleep 10
    if docker exec -u postgres "$container_name" \
      pg_isready -U supabase_admin -d postgres >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 1
done

docker exec -u postgres "$container_name" \
  pg_isready -U supabase_admin -d postgres >/dev/null
docker exec -u postgres "$container_name" \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE planner_restore WITH OWNER supabase_admin TEMPLATE template0;" >/dev/null

docker cp "$temporary_dump" "$container_name:/tmp/planner-ai-restore.dump" >/dev/null
docker exec -u root "$container_name" chmod 600 /tmp/planner-ai-restore.dump
docker exec -u root "$container_name" chown postgres:postgres /tmp/planner-ai-restore.dump
docker exec -u postgres "$container_name" \
  pg_restore --exit-on-error --no-owner --no-privileges \
  -U supabase_admin -d planner_restore /tmp/planner-ai-restore.dump

validation="$(
  docker exec -u postgres "$container_name" \
    psql -U supabase_admin -d planner_restore -v ON_ERROR_STOP=1 -Atqc \
    "select count(*) from pg_tables where schemaname = 'public';
     select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;
     select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public';" | tr '\n' ' '
)"

read -r public_tables rls_tables public_functions <<<"$validation"
[[ "$public_tables" -gt 0 ]] || {
  printf 'Restore validation failed: no public tables were restored.\n' >&2
  exit 1
}
[[ "$public_tables" -eq "$rls_tables" ]] || {
  printf 'Restore validation failed: %s of %s public tables have RLS enabled.\n' \
    "$rls_tables" "$public_tables" >&2
  exit 1
}

printf 'Restore drill passed: %s public tables, %s RLS tables, %s public functions.\n' \
  "$public_tables" "$rls_tables" "$public_functions"
