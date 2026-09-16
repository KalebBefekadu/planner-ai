# Admin Client Boundary

Status: **complete for EH-01.** No ordinary request path constructs the
service-role client. It is reserved for the four cron-authenticated lifecycle
jobs below, and the executable inventory is meant to stay that size. The
inventory is
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

None. Every ordinary route has moved. The four capabilities that replaced them
are described below in the order they were built.

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

## The MCP manual-token capability

Done. `read_mcp_workspace_snapshot` and `execute_mcp_operation` took a token
**id** -- a database identifier, not a secret -- so possession proved nothing
and both had to be granted to `service_role`. That single fact is why the MCP
route constructed an admin client on every request.

Both now take the token hash, exactly as `authenticate_mcp_token` already did,
and are granted to `anon`. The credential is the token; presenting its hash is
the only way in. This makes the manual half structurally equal to the OAuth
half, which already proved its caller with `auth.uid()` and the verified
`client_id` and already ran without admin access.

Expiry, revocation and capability scope are still re-decided inside each
function at the moment of execution rather than only at authentication.

## Attachment reserve, upload, finalize, and reconcile

Done. Uploading crossed two services with no record between them: the Storage
object was written first and the metadata row second, so any failure after the
upload left an object nothing pointed at. Deleting the object again only works
when the process survives long enough to do it.

A reservation is now written first, in `reserved` state, naming the exact object
key the upload may write. The Storage insert policy grants that one key and
nothing else -- deliberately narrower than the Workspace prefix the read policy
uses. The upload happens, the row is finalized, and anything that fails in
between leaves a reservation the purge job reconciles after a fifteen-minute
grace period. Nothing is invisible.

Metadata writes go through owner-scoped functions that derive the Workspace from
`auth.uid()`; retention is decided in the database rather than sent by the
caller. Reads use the person's own client against the Storage policy that
already existed. The select policy hides reservations, so no reader can mistake
one for an attachment.

## The pre-auth invite capability

Done, and it is the one case where the answer is not `auth.uid()`. An invite is
claimed before the account it creates, so there is no session to derive anything
from, and the register's other option -- a restricted non-`BYPASSRLS` role --
would need a second production credential provisioned and signed.

The invite code is already a credential. `claim_beta_invite` matches on its
SHA-256, so reaching it means presenting a value that hashes into the table:
guessing one means guessing a 256-bit digest, not a human-typed code. It is
granted to `anon` and revoked from everything else, including `service_role`.
Nothing new becomes possible -- everything an anonymous caller can do with it
they could already do by submitting the signup form with the same code -- and
the secret guarding it is now the one the operation is about rather than a key
that can read and write every table.

`release_beta_invite` is fixed rather than moved. It accepted a bare invite id,
which is not a secret, and decremented the use count, so it handed uses back to
any invite whose id was known with no proof the caller had ever claimed it. It
now requires the token hash that claimed the invite.

`beta_invites` grants are unchanged: `anon` and `authenticated` hold nothing on
the table, so the two functions are the only way in.

## Removal order

1. ~~Introduce the restricted worker capability and migrate the three proposal
   routes together so their policy does not drift.~~ Complete.
2. ~~Remove the manual MCP admin client by routing verified actors through the
   shared Operation boundary.~~ Complete.
3. ~~Redesign attachment reserve/finalize/reconcile and migrate export reads.~~
   Complete.
4. ~~Replace pre-auth invite administration with a narrowly reviewed
   capability.~~ Complete.

Each capability derives its actor from the narrowest credential the operation
actually has: `auth.uid()` where a session exists, the MCP token hash where the
token is the credential, and the invite code hash where no account exists yet.
None of them accepts an identifier as proof of identity, which is what the
service-role grants were compensating for.

At every step, delete the matching exception from the executable inventory. The
test must become stricter over time; replacing one broad exception with several
new files is not progress.
