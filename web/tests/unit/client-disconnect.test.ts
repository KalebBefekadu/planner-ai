import { describe, expect, it } from 'vitest';
import { handleUncaughtException, isClientDisconnectError } from '@/lib/api/client-disconnect';

describe('client disconnect classification', () => {
  it('recognises the ways a client going away is reported', () => {
    // What Node emits when the socket dies mid-request.
    expect(
      isClientDisconnectError(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }))
    ).toBe(true);
    expect(isClientDisconnectError(new Error('aborted'))).toBe(true);
    expect(isClientDisconnectError(new Error('request aborted'))).toBe(true);
    expect(
      isClientDisconnectError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    ).toBe(true);
    expect(
      isClientDisconnectError(
        Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
      )
    ).toBe(true);
    // What React reports when an RSC flight stream is cancelled.
    expect(isClientDisconnectError(new Error('The destination stream closed early.'))).toBe(true);
    // What an AbortController reports.
    expect(
      isClientDisconnectError(
        Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
      )
    ).toBe(true);
  });

  // The guard exists to keep one person's disconnect from ending the server for
  // everyone else. Widening it to real faults would hide defects behind a
  // server that only appears healthy.
  it('does not treat a real fault as a disconnect', () => {
    expect(isClientDisconnectError(new Error('Unable to load your Workspace.'))).toBe(false);
    expect(isClientDisconnectError(new TypeError('x is not a function'))).toBe(false);
    expect(
      isClientDisconnectError(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      )
    ).toBe(false);
    // A message that merely mentions aborting is not the disconnect signature.
    expect(isClientDisconnectError(new Error('The import was aborted by the owner'))).toBe(false);
  });

  it('tolerates values that are not errors at all', () => {
    expect(isClientDisconnectError(null)).toBe(false);
    expect(isClientDisconnectError(undefined)).toBe(false);
    expect(isClientDisconnectError('aborted')).toBe(false);
    expect(isClientDisconnectError({})).toBe(false);
  });
});

describe('uncaught exception handling', () => {
  function guard(error: unknown) {
    const warnings: string[] = [];
    const faults: unknown[] = [];
    const absorbed = handleUncaughtException(error, {
      warn: (line) => warnings.push(line),
      fatal: (fault) => faults.push(fault),
    });
    return { absorbed, warnings, faults };
  }

  // One person navigating away must not end the server for everyone else.
  it('absorbs a disconnect and records it without ending the process', () => {
    const result = guard(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));

    expect(result.absorbed).toBe(true);
    expect(result.faults).toEqual([]);
    expect(JSON.parse(result.warnings[0])).toEqual({
      event: 'client_disconnected',
      message: 'aborted',
    });
  });

  it('ends the process for a fault that is not a disconnect', () => {
    const fault = new Error('Unable to load your Workspace.');
    const result = guard(fault);

    expect(result.absorbed).toBe(false);
    expect(result.faults).toEqual([fault]);
    expect(result.warnings).toEqual([]);
  });
});
