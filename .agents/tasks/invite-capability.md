# Pre-Auth Invite Capability Task

- **Goal:** remove the last ordinary-route `createAdminClient()` by giving
  signup a narrowly validated pre-auth invite capability, completing EH-01.
- **Owner:** Codex lead
- **Branch:** `codex/invite-capability`
- **Base:** `codex/attachment-storage-capability` at `93ff21b`.
- **Dependencies:** the EH-01 admin-client register and the Stage 0 invite
  contract.
- **Writable paths:** `.agents/ACTIVE.md`, `.agents/tasks/invite-capability.md`,
  the matching handoff, `docs/engineering/admin-client-boundary.md`,
  `docs/engineering/improvement-program.md`,
  `web/supabase/migrations/20260915190000_invite_capability.sql`,
  `web/supabase/tests/stage0_security.sql`, `web/src/app/auth/actions.ts`,
  `web/src/types/supabase.generated.ts`, and
  `web/tests/unit/admin-client-boundary.test.ts`.
- **Forbidden paths:** application routes, the admin constructor, the lifecycle
  allowlist routes, production configuration/data/credentials, deployment
  settings, and other worktrees.

## Why this one is different

Every other EH-01 slice had a caller to derive an actor from. This one does
not: an invite is claimed before the account it creates, so `auth.uid()` is
null by definition. The register's alternative, a restricted non-`BYPASSRLS`
role, would need a second production credential provisioned and signed — a
deployment and credentials change, not a code change, and outside what this
contract may decide on its own.

The invite code is already a credential, and `claim_beta_invite` matches on its
SHA-256 rather than the code itself.

## Deliverables

1. `claim_beta_invite` granted to `anon` and revoked from `authenticated` and
   `service_role`. `beta_invites` table grants unchanged.
2. `release_beta_invite` requires the token hash that claimed the invite. The
   single-argument signature is dropped, not left callable.
3. Signup uses its own anonymous client; behaviour, messages and redirects are
   unchanged.
4. The Stage 0 assertions rewritten with the reasoning, plus coverage that the
   table stays closed and that an id alone no longer releases an invite.
5. The exception list in the admin-boundary test emptied, and both engineering
   documents updated to record EH-01 as met.

## Acceptance

- No ordinary request path imports or constructs the admin client.
- `anon` and `authenticated` hold nothing on `beta_invites`.
- A release with the wrong token hash changes nothing.
- `npm run agent:check`, `npm test`, and `npm run verify:db` pass under
  Node 24.21.0.

## Verification

Run from `web/` with Node 24.21.0:

```bash
npm ci
npm run agent:check
npm test
npm run verify:db
```

## Handoff

`.agents/handoffs/invite-capability.md`
