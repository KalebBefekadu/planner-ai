# Restoring a Planner AI Workspace from an export

This is the owner-facing recovery procedure and the honest statement of what
each export does and does not carry. It describes local and deployed product
behaviour only; production operational drills belong to REL-02.

## The two exports are not interchangeable

Settings -> Data offers two downloads, and neither one is a complete backup on
its own. Both require a stepped-up (AAL2) session.

**Full Workspace export** (`planner-ai-export-YYYY-MM-DD.json`) is a versioned
JSON dump of the Workspace tables: Vision, Goals, Actions, action templates,
planning horizons, daily focus, Captures, Notes and Note revisions, tags, Note
links, Note-to-Goal and Note-to-Action links, attachment metadata, Reviews and
review action items, conversations and messages, Memory, Activity, operation
receipts, Trash batches, notification history, and grant metadata. It is the
only export that contains planning data.

**Markdown Notes vault** (`planner-ai-notes-YYYY-MM-DD.zip`) is the portable
format: one Markdown file per Note under `Notes/`, attachment bytes under
`Attachments/<note id>/`, and `planner-ai-vault.json` as the index. It contains
Notes only.

Keep both files. Losing either loses something the other does not hold.

## Restoring Notes

1. Open Notes and choose Import.
2. Upload the vault ZIP unchanged. Do not unzip and re-zip it: the importer
   recognises the archive by `planner-ai-vault.json` at its root.
3. Review the preview. Importing into a Workspace that still holds the
   originals reports them as duplicates rather than creating second copies;
   importing into an empty Workspace rebuilds them.
4. Reconcile the result item for item before trusting it. A restore is not
   proven by a Note count.

A vault restore rebuilds Note bodies verbatim, parent/child hierarchy, sibling
order (including fractional order from reordering), titles, tags and AI
Exclusion.

## What a vault restore does not rebuild

- **Attachments.** The bytes are in the ZIP under `Attachments/`, but the
  importer reads only the Notes listed in the manifest. Attachments must be
  re-uploaded by hand from the ZIP after the Notes are restored.
- **Note-to-Note links and backlinks.** The manifest records them; the importer
  does not apply them.
- **Trashed and archived Notes.** The export deliberately excludes them.
- **Note revisions.** Only the current body is exported.
- **Note-to-Goal and Note-to-Action links.**

`web/src/lib/notes/vault-reconcile.ts` compares a vault manifest against a
restored Workspace and names each of these as an unreconciled item, so a
partial restore cannot be mistaken for a complete one.

## Restoring planning data

There is no import path for the full Workspace export. Vision, Goals, Actions,
Reviews, Captures, Memory and conversations can be exported but not restored
through the product. Recovering them today means reading the JSON directly.
