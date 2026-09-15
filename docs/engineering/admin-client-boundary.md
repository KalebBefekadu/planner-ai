# Admin Client Boundary

Status: **migration register for EH-01.** The service-role client remains a
server-only compatibility mechanism while ordinary request paths move to the
person's JWT, narrowly granted RPCs, or a restricted non-`BYPASSRLS` role. The
executable inventory is
[`web/tests/unit/admin-client-boundary.test.ts`](../../web/tests/unit/admin-client-boundary.test.ts).

## Intended allowlist

Only cron-authenticated lifecycle routes may retain the admin constructor after
EH-01 is complete:

- `api/internal/account-deletions`: deletes Auth users and final account data.
- `api/internal/note-attachment-purge`: removes expired private Storage objects.
- `api/internal/note-import-purge`: deletes abandoned import staging records.
- `api/internal/notifications`: claims and delivers scheduled notifications.

Each route authenticates the scheduler before constructing the client. Moving a
route under `api/internal` is not sufficient; additions require explicit review
and an allowlist change.

## Migration exceptions

These are current facts, not approved destinations:

| Surface               | Why it currently uses admin access                                           | Removal direction                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Signup invite actions | Claims/releases an invite before a session exists.                           | Expose a narrowly validated pre-auth invite capability without table-wide admin access.                                 |
| MCP route             | Manual MCP credentials create an admin client after token verification.      | Carry the verified actor and Workspace into restricted Operations/RPCs.                                                 |
| Note attachment route | Storage upload/download and recoverable metadata updates cross two services. | Implement reserve, upload, finalize, and reconcile with owner-scoped metadata writes and private Storage authorization. |
| Note export route     | Reads approved attachment bytes from private Storage.                        | Authorize each object through the verified owner and a narrow Storage read capability.                                  |

## The restricted proposal-worker capability

Done. The three AI proposal routes now write job status through `start_ai_job`,
`complete_ai_job`, `fail_ai_job`, and the two job-bound persistence functions,
shared by [`web/src/lib/ai/job-status.ts`](../../web/src/lib/ai/job-status.ts).

Every one of those functions is `security definer` with a fixed `search_path`,
revoked from `public` and `anon` before any grant, and executable by
`authenticated` alone. Each derives the actor from `auth.uid()` and the
Workspace from ownership, so no caller can assert an identity. The two
persistence functions previously took `p_owner_user_id` as a trusted parameter,
which is why they could only be granted to `service_role`; those signatures are
dropped rather than left callable.

`ai_jobs` table grants did not change. `authenticated` still holds `SELECT`
only, so the capability is the sole write path and no `BYPASSRLS` role takes
part in an ordinary request.

## Removal order

1. ~~Introduce the restricted worker capability and migrate the three proposal
   routes together so their policy does not drift.~~ Complete.
2. Remove the manual MCP admin client by routing verified actors through the
   shared Operation boundary.
3. Redesign attachment reserve/finalize/reconcile and migrate export reads.
4. Replace pre-auth invite administration with a narrowly reviewed capability.

At every step, delete the matching exception from the executable inventory. The
test must become stricter over time; replacing one broad exception with several
new files is not progress.
