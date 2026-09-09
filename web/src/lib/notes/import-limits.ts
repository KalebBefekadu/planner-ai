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
