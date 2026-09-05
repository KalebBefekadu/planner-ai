# Production Migration Reconciliation

**Status:** completed and verified on 2026-09-05.

## Purpose

Production records two hardening migrations under versions `20260822212134` and
`20260822214744`, while the reviewed local files use versions `20260816000100`
and `20260822000100`. This procedure reconciles migration-history metadata only.
It must not rerun already-present hardening DDL.

## Evidence Recorded

- An encrypted logical backup was created from the owned production project on
  2026-09-05 and independently decrypted and validated with `pg_restore --list`.
  Its encrypted archive and checksum remain under gitignored `web/backups/`.
- Read-only production metadata inspection confirmed the stage-zero objects from
  `20260816000100_stage0_security.sql`: `extensions.pgcrypto`,
  `public.beta_invites`, `public.ai_request_windows`, and the three expected
  security-definer functions. Both tables have RLS and forced RLS enabled.
- Read-only production metadata inspection confirmed the function hardening from
  `20260822000100_legacy_security_hardening.sql`: both legacy functions use
  `search_path=pg_catalog`; `rls_auto_enable()` has no public, anonymous, or
  authenticated execute grant.

## Metadata-Only Procedure

Run from `web/` only after retaining the encrypted backup and passphrase in
separate locations:

```bash
npx supabase migration repair --status reverted 20260822212134
npx supabase migration repair --status reverted 20260822214744
npx supabase migration repair --status applied 20260816000100
npx supabase migration repair --status applied 20260822000100
```

Each command changes Supabase migration-history metadata only. It does not apply
or remove database schema objects. Immediately confirm that the four records are
in the intended state with `npx supabase migration list --output json`, then run
`npx supabase db push --dry-run`.

## Completion Evidence

- Both duplicate remote versions were marked reverted and both reviewed local
  hardening versions were marked applied.
- `supabase migration list` then showed aligned local and remote hardening
  versions with no remote-only entries.
- `supabase db push --dry-run --include-all` proposed only the expected canonical
  migration sequence.
- The canonical sequence was applied successfully through
  `20260904172530_rls_auth_uid_initplan.sql`.
- Post-cutover count-only inspection found 53 public tables, all 53 with RLS,
  two Auth users mapped to two canonical Workspaces, no unmigrated users, and 56
  registered Operations.
- The legacy tables remain available for rollback while the application moves
  to `PLANNER_DATA_MODEL=canonical`.

## Stop Conditions

- Stop if any repaired history row differs from this plan.
- Stop if the dry run proposes either already-verified hardening file.
- Do not run `supabase db push` against production until an isolated restore
  drill, maintenance window, remote pgTAP plan, rollback owner, and post-cutover
  authenticated smoke-test plan are recorded.
- Keep `PLANNER_DATA_MODEL=legacy` until remote canonical migrations and all
  post-cutover validation pass.
