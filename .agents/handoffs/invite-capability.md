# Pre-Auth Invite Capability Handoff

- **Task:** `.agents/tasks/invite-capability.md`
- **Branch:** `codex/invite-capability`
- **Base:** `codex/attachment-storage-capability` at `93ff21b`

**This completes EH-01.** No ordinary request path constructs the service-role
client. The admin-boundary test's exception list is empty.

## Behavior changed

- Signup claims and releases invites through the person's own anonymous client.
  `claim_beta_invite` is granted to `anon` and revoked from `authenticated` and
  `service_role`.
- `release_beta_invite` now takes `(p_invite_id, p_token_hash)` and matches on
  both. The single-argument signature is dropped, not left callable.
- `beta_invites` table grants are unchanged: `anon` and `authenticated` hold
  nothing, so the two functions remain the only way in.
- The signup HTTP behaviour, messages and redirects are unchanged.

## Why this one is not `auth.uid()`

An invite is claimed before the account it creates, so there is no session to
derive an actor from. The register's other option — a restricted
non-`BYPASSRLS` role — would need a second production credential provisioned
and signed, which is a deployment and credentials change rather than a code
change, and outside what this contract may decide.

The invite code is already a credential. `claim_beta_invite` matches on its
SHA-256, so reaching it means presenting a value that hashes into the table.
Guessing one means guessing a 256-bit digest, not a human-typed code, so the
weakness of the underlying codes does not matter here.

Nothing new becomes possible. Everything an anonymous caller can do with these
two functions, they could already do by submitting the signup form with the same
invite code. What changes is which secret guards the capability: the code the
operation is actually about, instead of a key that can read and write every
table in the database.

**This is the one change in the EH-01 series that reverses a previously tested
assertion** rather than only tightening one. `stage0_security.sql` asserted that
`anon` could not claim invites and that only the trusted role could. Those
assertions are rewritten with the reasoning above, and a reviewer who disagrees
with the trade should say so here rather than anywhere else.

## The defect fixed alongside it

`release_beta_invite` took a bare invite id — not a secret — and decremented the
use count. It was a way to hand uses back to any invite whose id was known, with
no proof the caller had ever claimed it. Requiring the token hash ties a release
to a claim.

Verified against the live local database: claiming as `anon` with the seeded
hash succeeds; releasing with a wrong hash leaves `uses` at 1; releasing with
the correct hash returns it to 0.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/invite-capability.md`
- `.agents/handoffs/invite-capability.md`
- `docs/engineering/admin-client-boundary.md`
- `docs/engineering/improvement-program.md`
- `web/supabase/migrations/20260915190000_invite_capability.sql`
- `web/supabase/tests/stage0_security.sql`
- `web/src/app/auth/actions.ts`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/admin-client-boundary.test.ts`

## Verification

Run in `web/` with Node 24.21.0, holding the repository-wide Supabase lock:

- `npm ci` — passed; 770 packages, 0 vulnerabilities.
- `npm run agent:check` — passed; Prettier, ESLint, and TypeScript clean.
- `npm test` — passed; 81 files, 927 tests.
- `npm run test:db` — passed; 70 files, 1,271 assertions.
- `npm run types:generate` then `npm run verify:db` — passed; migrations, pgTAP,
  and generated types agree after a clean reset.
- Live local database probe of claim and release, described above.

## Risks and follow-up

- `claim_beta_invite` is now reachable without a session, so it can be called
  repeatedly. Each call is one indexed lookup on a unique column that matches
  nothing, and the API gateway rate-limits anonymous requests, but there is no
  application-level throttle on it. If invite volume ever matters, add one.
- No browser test covers signup with an invite. The capability is proven at the
  database boundary and by the unit suite, not through the form.
- Invites are administered out of band; nothing in the app issues them. If an
  issuing surface is ever built, it needs its own contract — it would be a
  privileged write and does not belong on this capability.
- EH-01 is complete, so the next slice in the program is EH-03, splitting the
  oversized Workspace and planner modules.
