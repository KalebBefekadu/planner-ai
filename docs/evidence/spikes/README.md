# Planner AI M0 Evidence Register

Updated: 2026-08-25

M0 uses executable experiments to decide architecture. Passing an isolated contract does not by itself accept an ADR or enable a production feature.

| Spike                                   | Current evidence                                                                                                                                                                                                                            | Result                         | Remaining gate                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Semantic Operation rejection and rebase | Encrypted IndexedDB journal metadata, stable device sequence, lifecycle/recovery contract, flagged Capture integration, authoritative receipt acknowledgement; 25 focused tests plus duplicate-delivery and payload-mismatch pgTAP evidence | Integration stage passed       | Out-of-order, revocation, conflict, restart, and schema-upgrade tests                                     |
| Trusted GenUI schema and fallback       | Versioned five-component registry, Operation validation, renderer/fallback, deterministic evidence-backed assistant record list behind a flag; 14 tests                                                                                     | Read-only integration passed   | Visual/accessibility fixtures, data provenance fields, streaming limits, and proposal-gateway integration |
| Markdown and editor round trip          | Planner-owned mdast contract, 110 named documents, normalized snapshot; 114 focused tests                                                                                                                                                   | Semantic contract stage passed | Tiptap adapter, fallback adapter, copy/paste, undo, external edit, and performance comparison             |
| Canonical workspace object migration    | Transaction-wrapped local Supabase prototype over representative current rows                                                                                                                                                               | Prototype stage passed         | Stress/sanitized snapshot, operation dual-write, RLS/grants, expand/backfill/verify/contract plan         |

## Verification Commands

```bash
cd web
npm test -- --run tests/unit/operation-journal.test.ts tests/unit/genui-schema.test.ts
npm test -- --run tests/unit/markdown-contract.test.ts
psql postgresql://postgres:postgres@127.0.0.1:55322/postgres \
  -v ON_ERROR_STOP=1 -f supabase/spikes/m0_workspace_object.sql
```

The complete application verification on 2026-08-25 passed 27 Vitest files and 270 tests, the production build, lint, formatting, TypeScript, and all 42 pgTAP files with 854 assertions. A signed-in browser run with both M0 flags enabled verified the journaled Capture path through authoritative receipt acknowledgement and exposed a hydration mismatch that was fixed and rechecked.

The database URL above targets local Supabase only. Never substitute a production URL for the rollback experiment without a reviewed, sanitized procedure.

## Resolved Security Decision

The Supabase advisor previously reported that `public.operation_contracts` had RLS disabled. Migration `20260825174003_operation_contracts_rls.sql` now enables and forces RLS with an authenticated read-only policy while preserving anonymous denial and trusted dispatcher behavior.

pgTAP verifies the PostgreSQL RLS flag, anonymous and authenticated privileges, real read/write behavior, and dispatcher continuity. The local security advisor now reports no issues.

```sql
npx supabase db advisors --local --type security --level warn --fail-on error
```
