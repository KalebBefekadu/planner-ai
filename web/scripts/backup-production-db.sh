#!/usr/bin/env bash

set -euo pipefail
umask 077

release_env_file="${PLANNER_RELEASE_ENV_FILE:-.env.release.local}"
if [[ -f "$release_env_file" ]]; then
  set -a
  # This is an operator-owned, gitignored release credential file.
  source "$release_env_file"
  set +a
fi

usage() {
  cat <<'EOF'
Usage:
  PLANNER_PRODUCTION_DATABASE_URL=... PLANNER_BACKUP_PASSPHRASE=... ./scripts/backup-production-db.sh
  PLANNER_BACKUP_PASSPHRASE=... ./scripts/backup-production-db.sh --verify backups/<archive>.dump.enc

Creates or verifies an encrypted PostgreSQL custom-format archive. Credentials and
backup contents are never printed. Keep the archive and passphrase separately.

By default, credentials may be stored in a gitignored .env.release.local file.
Set PLANNER_RELEASE_ENV_FILE to use a different local file.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is unavailable: %s\n' "$1" >&2
    exit 1
  }
}

require_passphrase() {
  if [[ -z "${PLANNER_BACKUP_PASSPHRASE:-}" ]]; then
    printf 'PLANNER_BACKUP_PASSPHRASE must be set.\n' >&2
    exit 1
  fi
}

verify_archive() {
  local archive="$1"
  local temporary_dump

  [[ -f "$archive" ]] || {
    printf 'Backup archive was not found.\n' >&2
    exit 1
  }

  temporary_dump="$(mktemp "${TMPDIR:-/tmp}/planner-ai-backup.XXXXXX.dump")"
  trap 'rm -f "$temporary_dump"' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
    -pass env:PLANNER_BACKUP_PASSPHRASE -in "$archive" -out "$temporary_dump"
  pg_restore --list "$temporary_dump" >/dev/null
  rm -f "$temporary_dump"
  trap - EXIT
  printf 'Backup archive decrypted and passed pg_restore validation.\n'
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || ( "${1:-}" == "--verify" && ( "${2:-}" == "--help" || "${2:-}" == "-h" ) ) ]]; then
  usage
  exit 0
fi

require_command openssl
require_command pg_dump
require_command pg_restore
require_passphrase

if [[ "${1:-}" == "--verify" ]]; then
  [[ $# -eq 2 ]] || { usage >&2; exit 1; }
  verify_archive "$2"
  exit 0
fi

[[ $# -eq 0 ]] || { usage >&2; exit 1; }
[[ -n "${PLANNER_PRODUCTION_DATABASE_URL:-}" ]] || {
  printf 'PLANNER_PRODUCTION_DATABASE_URL must be set.\n' >&2
  exit 1
}

backup_directory="backups"
mkdir -p "$backup_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_directory/planner-ai-precutover-$timestamp.dump.enc"
temporary_dump="$(mktemp "$backup_directory/.planner-ai-backup.XXXXXX.dump")"
trap 'rm -f "$temporary_dump"' EXIT

pg_dump --dbname="$PLANNER_PRODUCTION_DATABASE_URL" --format=custom --compress=9 \
  --no-owner --no-privileges --file="$temporary_dump"
pg_restore --list "$temporary_dump" >/dev/null
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
  -pass env:PLANNER_BACKUP_PASSPHRASE -in "$temporary_dump" -out "$archive"
rm -f "$temporary_dump"
trap - EXIT

checksum="$(shasum -a 256 "$archive" | awk '{print $1}')"
printf '%s  %s\n' "$checksum" "$archive" > "$archive.sha256"
printf 'Created encrypted backup archive: %s\nChecksum file: %s.sha256\n' "$archive" "$archive"
