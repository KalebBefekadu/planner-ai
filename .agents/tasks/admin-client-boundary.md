# Admin Client Boundary Task

- **Goal:** make the current Supabase service-role surface explicit and prevent
  any new user-facing or agent-facing code path from gaining admin access while
  existing exceptions are migrated.
- **Owner:** Codex lead
- **Branch:** `codex/admin-client-boundary`
- **Base:** `codex/reproducible-delivery` at `3bcfc5d`.
- **Dependencies:** EH-01 in `docs/engineering/improvement-program.md` and the
  existing server-only admin client constructor.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/admin-client-boundary.md`, the matching handoff,
  `docs/engineering/admin-client-boundary.md`, and
  `web/tests/unit/admin-client-boundary.test.ts`.
- **Forbidden paths:** application runtime source, database schema/migrations,
  generated types, production configuration/data/credentials, deployment
  settings, and other worktrees.

## Deliverables

1. Inventory every runtime importer of the admin client and every direct source
   reference to `SUPABASE_SERVICE_ROLE_KEY`.
2. Define the four cron-authorized lifecycle importers as the intended final
   allowlist.
3. Record every ordinary-route exception with its removal direction instead of
   silently treating current access as approved architecture.
4. Add a CI-executed unit contract that fails on a new importer, a second key
   reader, a moved admin constructor, or an unreviewed exception.

## Acceptance

- The executable inventory agrees exactly with the current source tree.
- Only `src/lib/supabase/admin.ts` reads the service-role environment variable.
- Lifecycle allowlist entries are internal cron routes.
- Every non-lifecycle importer is named as a temporary migration exception.
- `npm run agent:check` and `npm test` pass under Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
```

## Handoff

`.agents/handoffs/admin-client-boundary.md`
