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

export function isClientDisconnectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof candidate.code === 'string' && disconnectCodes.has(candidate.code)) return true;
  if (candidate.name === 'AbortError') return true;
  return (
    typeof candidate.message === 'string' &&
    disconnectMessages.has(candidate.message.trim().toLowerCase())
  );
}

export type DisconnectGuardHooks = {
  warn: (line: string) => void;
  fatal: (error: unknown) => void;
};

// Returns whether the error was absorbed, so the decision can be asserted
// directly rather than inferred from whether a server process is still up.
export function handleUncaughtException(error: unknown, hooks: DisconnectGuardHooks): boolean {
  if (!isClientDisconnectError(error)) {
    // Keep Node's contract: report it and end the process rather than
    // continuing from unknown state.
    hooks.fatal(error);
    return false;
  }
  // Not fatal, but never silent: a rise in disconnects is worth seeing.
  hooks.warn(
    JSON.stringify({
      event: 'client_disconnected',
      message: error instanceof Error ? error.message : String(error),
    })
  );
  return true;
}
