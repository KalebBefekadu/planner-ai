// Every attachment arrives in quarantine and only leaves it when something has
// actually looked at the bytes. Malware scanning is a later beta gate recorded
// in docs/status.md, and this is deliberately not that: it is the narrower
// check of whether a file really is the type it claims to be.
//
// That check is worth having on its own. The browser derives the declared media
// type from the filename, so the type on an upload is a claim by whoever chose
// the name, not a fact. Serving those bytes back later under the claimed
// Content-Type is what turns a mislabelled file into a problem, so the claim is
// verified once, at rest, and a file that fails is never served at all.

export type AttachmentContentState = 'approved' | 'rejected';

// The human name of a type, used both in refusal text and in the inspector, so
// a person reads "contents do not match a PDF" rather than a media type.
const typeLabels = new Map([
  ['application/pdf', 'PDF'],
  ['image/jpeg', 'JPEG image'],
  ['image/png', 'PNG image'],
  ['text/markdown', 'Markdown file'],
  ['text/plain', 'text file'],
]);

export function attachmentTypeLabel(mediaType: string) {
  return typeLabels.get(mediaType) ?? 'file';
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

// Text has no signature to check, so the question is instead whether the bytes
// are text at all. A binary payload renamed to .txt decodes with replacement
// characters or carries NUL and other C0 control bytes that no real document
// contains; tab, carriage return and newline are the only ones that do.
function looksLikeText(bytes: Uint8Array) {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
    if (code === 0x7f) return false;
  }
  return true;
}

/**
 * Decide whether stored bytes match the media type they were uploaded under.
 *
 * An unrecognised media type is rejected rather than approved: the upload route
 * holds the allowlist, and anything that reaches here outside it has no
 * definition of "correct" to be measured against.
 */
export function verifyAttachmentContent(
  mediaType: string,
  bytes: Uint8Array
): AttachmentContentState {
  if (bytes.length === 0) return 'rejected';
  switch (mediaType) {
    case 'application/pdf':
      // "%PDF-"
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? 'approved' : 'rejected';
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? 'approved'
        : 'rejected';
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? 'approved' : 'rejected';
    case 'text/markdown':
    case 'text/plain':
      return looksLikeText(bytes) ? 'approved' : 'rejected';
    default:
      return 'rejected';
  }
}
