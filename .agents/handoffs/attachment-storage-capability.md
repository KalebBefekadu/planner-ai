# Attachment Storage Capability Handoff

- **Task:** `.agents/tasks/attachment-storage-capability.md`
- **Branch:** `codex/attachment-storage-capability`
- **Base:** `codex/mcp-actor-capability` at `4197601`

## Behavior changed

- Uploading a Note attachment is now reserve, upload, finalize, reconcile. The
  metadata row is written first in `reserved` state and names the exact object
  key the upload may write; the object is uploaded; the row is finalized.
- A `storage.objects` insert policy grants a person exactly the object a
  reservation of their own is waiting for — deliberately narrower than the
  workspace-prefix read policy that already existed. There is no delete policy,
  because no request path needs one.
- Six owner-scoped `security definer` functions carry every metadata write and
  derive the Workspace from `auth.uid()`. Retention is decided in the database,
  so a request can no longer send a purge date of its own choosing.
- The owner select policy hides reservations, so a reservation cannot appear in
  a Note, an export, or the list a person removes things from.
- The purge job gained a reconcile pass: reservations older than fifteen minutes
  have their object removed and their row deleted. Its response now reports
  `reconciled` alongside `purged`.
- Downloads and export reads use the person's own client against the Storage
  read policy that has existed since the bucket was created.
- The HTTP contract is unchanged: the same multipart POST, the same 201 body,
  the same status codes on every failure.
- The executable admin-client inventory is strictly smaller: four lifecycle
  consumers and one ordinary-route exception, down from three.

## What this actually fixes

The old order wrote the Storage object first and the metadata row second, with
nothing recording that an upload was in progress. Any failure between the two
left an object nothing pointed at. The route deleted the object again on the
error path, which only helps when the process survives long enough to run it. A
crash, a timeout, or a dropped connection left an orphan that nothing would ever
find, in a private bucket nobody lists.

Writing the row first makes the failure visible. Whatever happens next, there is
a row saying an upload was expected, and reconciliation can act on it. The same
row is what authorizes writing the object at all, which is why the Storage grant
could be narrowed from a whole workspace prefix to a single key.

## Files changed

- `.agents/ACTIVE.md`
- `.agents/tasks/attachment-storage-capability.md`
- `.agents/handoffs/attachment-storage-capability.md`
- `docs/engineering/admin-client-boundary.md`
- `web/supabase/migrations/20260915180000_note_attachment_capability.sql`
- `web/supabase/tests/note_attachment_lifecycle.sql`
- `web/src/lib/notes/attachment-availability.ts`
- `web/src/app/api/notes/attachments/route.ts`
- `web/src/app/api/notes/export/route.ts`
- `web/src/app/api/internal/note-attachment-purge/route.ts`
- `web/src/types/supabase.generated.ts`
- `web/tests/unit/admin-client-boundary.test.ts`

## Verification

Run in `web/` with Node 24.21.0, holding the repository-wide Supabase lock:

- `npm ci` — passed; 770 packages, 0 vulnerabilities.
- `npm run agent:check` — passed; Prettier, ESLint, and TypeScript clean.
- `npm test` — passed; 81 files, 927 tests.
- `npm run test:db` — passed; 70 files, 1,266 assertions.
- `npm run types:generate` then `npm run verify:db` — passed; migrations, pgTAP,
  and generated types agree after a clean reset.

## Risks and follow-up

- The upload still streams through the route rather than going straight from the
  browser to Storage, so a 10 MB file still occupies server memory. The
  reservation makes a direct browser upload possible later without another
  schema change, because the object key and its authorization already exist
  before any byte moves. That is a deliberate non-goal here.
- No test drives a real Storage object end to end. The pgTAP suite proves the
  metadata lifecycle and its ownership; the Storage insert policy is asserted to
  exist and to be reservation-scoped, not exercised against a live upload. A
  browser test over the real bucket is the missing piece.
- The fifteen-minute reconcile grace period is a judgement, not a measurement.
  It must stay comfortably longer than the slowest plausible 10 MB upload; if
  uploads ever move to the browser, revisit it.
- One ordinary route still uses the admin client: signup invite actions, which
  claim and release an invite before a session exists. That is the last EH-01
  exception and the only one where no caller identity exists yet.
