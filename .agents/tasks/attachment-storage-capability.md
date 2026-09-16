# Attachment Storage Capability Task

- **Goal:** model attachment upload as reserve, upload, finalize, and reconcile,
  and remove `createAdminClient()` from the attachment and Note export routes.
- **Owner:** Codex lead
- **Branch:** `codex/attachment-storage-capability`
- **Base:** `codex/mcp-actor-capability` at `4197601`.
- **Dependencies:** the EH-01 admin-client register, the `note_attachments`
  contract, the private `note-attachments` bucket, and the attachment purge
  lifecycle job.
- **Writable paths:** `.agents/ACTIVE.md`,
  `.agents/tasks/attachment-storage-capability.md`, the matching handoff,
  `docs/engineering/admin-client-boundary.md`,
  `web/supabase/migrations/20260915180000_note_attachment_capability.sql`,
  `web/supabase/tests/note_attachment_lifecycle.sql`,
  `web/src/lib/notes/attachment-availability.ts`,
  `web/src/app/api/notes/attachments/route.ts`,
  `web/src/app/api/notes/export/route.ts`,
  `web/src/app/api/internal/note-attachment-purge/route.ts`,
  `web/src/types/supabase.generated.ts`, and
  `web/tests/unit/admin-client-boundary.test.ts`.
- **Forbidden paths:** other application routes, the admin constructor, the
  other lifecycle allowlist routes, production configuration/data/credentials,
  deployment settings, and other worktrees.

## Why the admin client is there

Two separate reasons, and the upload one is a design problem rather than a
permissions problem.

`note_attachments` grants `authenticated` `SELECT` only, so every metadata write
needed `service_role`. That is the ordinary case, answered by owner-scoped
functions.

Uploading is the real issue. It wrote the Storage object first and the metadata
row second, with nothing recording that an upload was in progress. A failure
between the two left an object nothing pointed at. The route deleted the object
again on the error path, which only helps when the process lives long enough to
run it; a crash, a timeout, or a dropped connection left an orphan that nothing
would ever find.

Reads were already possible without admin access: a workspace-scoped `select`
policy on `storage.objects` has existed since the bucket was created, and the
routes simply never used it.

## Deliverables

1. `upload_state` on `note_attachments`, defaulting to `stored` so every
   existing row is unchanged, with `reserved` as the in-flight state.
2. The owner select policy hides reservations, so no reader can mistake one for
   an attachment or have to remember to filter.
3. Six owner-scoped `security definer` functions that derive the Workspace from
   `auth.uid()`: reserve, finalize, abandon, remove, restore, and the deferred
   scan write-back. Retention is decided in the database.
4. A `storage.objects` insert policy narrower than the read policy: a person may
   write exactly the object a reservation of their own is waiting for. No delete
   policy, because no request path needs one.
5. The purge job reconciles reservations older than a fifteen-minute grace
   period, removing the object and the row.
6. Both routes removed from the executable and documented service-role
   migration exceptions.

## Acceptance

- Neither route imports or constructs the admin client.
- `note_attachments` table grants are unchanged.
- An upload that fails after reserving is still on record for reconciliation.
- The admin-boundary test becomes strictly smaller: three exceptions to one.
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

`.agents/handoffs/attachment-storage-capability.md`
