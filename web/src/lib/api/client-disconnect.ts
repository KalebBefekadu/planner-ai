// A client that goes away mid-request is ordinary traffic, not a fault: a
// person navigates away while a React Server Component stream is still being
// written, closes the tab during an export, or loses a connection mid-upload.
// Node reports the socket going away by emitting an error with no listener
// attached, which reaches the process as an uncaught exception and ends the
// server for everyone else it was serving.
//
// Only these disconnect signatures are treated as benign. Anything else must
// still end the process, because swallowing unknown faults would hide real
// defects behind a server that only appears healthy.
const disconnectCodes = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ABORT_ERR',
]);

const disconnectMessages = new Set([
  'aborted',
  'request aborted',
  'the destination stream closed early.',
  'the operation was aborted.',
  'premature close',
]);

/**
 * Which of the known signatures this error matched, or null if none did.
 *
 * The signature rather than the message, because the message is whatever the
 * thrower put there. Today the predicate below only admits a fixed set, so the
 * two are nearly the same thing -- but logging the match keeps that true if the
 * predicate is ever widened, and knowing *which* signature fired is the useful
 * signal anyway.
 */
export function clientDisconnectSignature(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof candidate.code === 'string' && disconnectCodes.has(candidate.code)) {
    return candidate.code;
  }
  if (candidate.name === 'AbortError') return 'AbortError';
  if (typeof candidate.message === 'string') {
    const normalized = candidate.message.trim().toLowerCase();
    if (disconnectMessages.has(normalized)) return normalized;
  }
  return null;
}

export function isClientDisconnectError(error: unknown): boolean {
  return clientDisconnectSignature(error) !== null;
}

export type DisconnectGuardHooks = {
  /** Receives the matched signature, which is already content-free. */
  warn: (signature: string) => void;
  fatal: (error: unknown) => void;
};

// Returns whether the error was absorbed, so the decision can be asserted
// directly rather than inferred from whether a server process is still up.
export function handleUncaughtException(error: unknown, hooks: DisconnectGuardHooks): boolean {
  const signature = clientDisconnectSignature(error);
  if (signature === null) {
    // Keep Node's contract: report it and end the process rather than
    // continuing from unknown state.
    hooks.fatal(error);
    return false;
  }
  // Not fatal, but never silent: a rise in disconnects is worth seeing.
  hooks.warn(signature);
  return true;
}
