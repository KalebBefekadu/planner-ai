import { createHash } from 'node:crypto';

// The other half of "the same submission, sent twice".
//
// `reviewCompletionKey` answers it with the intent alone, which is right for
// the case it was written for: a transport retry carries the intent it started
// with, and completing a period again after undoing it mounts the screen afresh
// and therefore starts a new one.
//
// It is not right for the case where a submission fails. The intent is minted
// once per mount and cleared only on success, so a failed completion leaves it
// in place. Correct the reflection, press the button again, and the second
// submission travels under the first one's intent. If the first attempt had in
// fact reached the database and only its response was lost, the second finds
// that receipt and replays it -- reporting a completed review, and discarding
// the correction the person just typed.
//
// Binding the key to the payload as well closes that: the same submission sent
// twice still replays, and an edited one cannot.
//
// This module is server-only. `completion-intent.ts` is imported by the review
// components, and a client bundle cannot carry `node:crypto`.

/**
 * A stable fingerprint of what is being submitted.
 *
 * Key order is normalised, so a payload rebuilt in a different order is still
 * recognised as the same submission rather than read as an edit.
 */
export function payloadFingerprint(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex').slice(0, 32);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
