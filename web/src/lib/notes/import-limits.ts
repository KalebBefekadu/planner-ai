// Import bounds and the words shown for them. This module is deliberately
// free of Node-only imports so the dialog can enforce the same numbers in the
// browser without pulling the ZIP reader into the client bundle.

// Vercel Functions reject a request body larger than 4.5 MB at the platform
// edge, before any handler runs, and the response the browser sees is not this
// application's JSON. An application limit above that ceiling is not a limit
// the deployment can honour: it advertises 25 MB and then fails opaquely at
// about 4.5 MB. So the upload bound is the verified platform bound, minus
// headroom for multipart framing (a boundary and headers per part, at most 500
// parts). Every user-facing size message is derived from these numbers rather
// than written out, because the earlier hard-coded "25 MB" strings are exactly
// how the advertised limit drifted away from the enforced one.
const PLATFORM_REQUEST_BYTES = 4.5 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 512 * 1024;

export const IMPORT_LIMITS = {
  requestBytes: PLATFORM_REQUEST_BYTES,
  archiveBytes: PLATFORM_REQUEST_BYTES - MULTIPART_OVERHEAD_BYTES,
  expandedBytes: 10 * 1024 * 1024,
  fileBytes: 200 * 1024,
  candidates: 500,
  totalCharacters: 5_000_000,
} as const;

/** Renders a byte bound the way a person choosing files would read it. */
export function formatImportBytes(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

export const IMPORT_UPLOAD_LIMIT_LABEL = formatImportBytes(IMPORT_LIMITS.archiveBytes);

/**
 * The message shown whenever a selection is too large to upload. It names the
 * limit and what to do about it, because "too large" alone leaves someone
 * migrating a whole Notion workspace with no next step.
 */
export const IMPORT_TOO_LARGE_MESSAGE =
  `This selection is over the ${IMPORT_UPLOAD_LIMIT_LABEL} upload limit. ` +
  `Import it in smaller batches — one top-level folder, or one ZIP under ${IMPORT_UPLOAD_LIMIT_LABEL}, at a time. ` +
  `Nothing was imported and your selection is unchanged.`;

/**
 * The commit runs in batches so no single request has to create every Note at
 * once. 50 is the ceiling the Operation contract and the database function
 * both enforce on one batch, so it is the largest batch the commit can ask for.
 */
export const IMPORT_COMMIT_BATCH_SIZE = 50;

/**
 * How many batches the commit loop will run before it stops.
 *
 * This used to be the literal 12 in the import dialog, unconnected to anything:
 * a ceiling of 600 items next to a candidate limit of 500. The two numbers
 * meant different things, lived in different files, and nothing kept them in
 * step. Raising IMPORT_LIMITS.candidates past 600 -- the obvious change the
 * first time a real export turns out to be bigger than expected -- would have
 * stranded imports partway through, under a message that read like a pause.
 *
 * Derived from the candidate limit so raising one raises the other. The extra
 * batch is a runaway guard: the loop already refuses to continue when a batch
 * commits nothing, and this bounds it even if the database somehow reports
 * progress forever.
 */
export const IMPORT_COMMIT_BATCH_CEILING =
  Math.ceil(IMPORT_LIMITS.candidates / IMPORT_COMMIT_BATCH_SIZE) + 1;

/**
 * Shown when the loop hits that ceiling. It says a limit was reached, not that
 * something paused, because nothing here resumes on its own.
 */
export const IMPORT_BATCH_CEILING_MESSAGE =
  `This import stopped at Planner AI's limit of ${IMPORT_COMMIT_BATCH_CEILING} batches ` +
  `of ${IMPORT_COMMIT_BATCH_SIZE} Notes. The Notes already imported are saved, and nothing ` +
  `was duplicated. Reopen this import to continue the rest.`;

/**
 * How long an import preview that was never committed or canceled is kept
 * before the note-import-purge worker removes it.
 *
 * A preview holds the parsed contents of someone's export -- the staged Notes
 * themselves, not a reference to them -- so an abandoned one is a copy of
 * their writing sitting in the database indefinitely. WS-01 set the precedent
 * for staged content in Planner AI: seven days, and a stated period rather
 * than an implicit one, so that "we keep this for a while" is a promise with a
 * number attached.
 */
export const IMPORT_PREVIEW_RETENTION_DAYS = 7;
