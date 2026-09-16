import { describe, expect, it } from 'vitest';
import { OperationFailure, operationFailureCode, operationFailureMessage } from '@/lib/operations';
import { actionFailureMessage } from '@/lib/operations/failure-message';

/* Fifteen surfaces show their errors through `actionFailureMessage`, and none
   of it was covered. What makes it worth covering is that the case it exists
   for is the one that only happens in production: a build strips the message
   off any error thrown out of a Server Action, so `error.message` on the client
   is a generic React error. Every local run takes the branch that works. */

// What React hands the client once the real message has been stripped.
function redactedProductionError(digest?: string) {
  const error = new Error(
    'Minified React error #418; visit https://react.dev/errors/418 for the full message.'
  ) as Error & { digest?: string };
  if (digest) error.digest = digest;
  return error;
}

describe('reading a failure that crossed the Server Action boundary', () => {
  it('reads the message straight off an OperationFailure thrown on this side', () => {
    const failure = new OperationFailure('version_conflict', 'Someone else changed this first.');
    expect(operationFailureMessage(failure)).toBe('Someone else changed this first.');
    expect(operationFailureCode(failure)).toBe('version_conflict');
  });

  /* The digest is the one field React carries across, so `<code>: <message>`
     is how both halves survive a production build. */
  it('reads both halves back off a digest when the error itself was redacted', () => {
    const error = redactedProductionError('version_conflict: Someone else changed this first.');
    expect(operationFailureMessage(error)).toBe('Someone else changed this first.');
    expect(operationFailureCode(error)).toBe('version_conflict');
  });

  it('keeps a message containing a colon intact', () => {
    const error = redactedProductionError('import_failed: Could not read: the file is truncated.');
    expect(operationFailureMessage(error)).toBe('Could not read: the file is truncated.');
    expect(operationFailureCode(error)).toBe('import_failed');
  });

  it('reads nothing from an error with no digest', () => {
    expect(operationFailureMessage(new Error('plain'))).toBeNull();
    expect(operationFailureCode(new Error('plain'))).toBeNull();
  });

  it('reads nothing from a digest that is not code-prefixed', () => {
    const error = redactedProductionError('3804102146');
    expect(operationFailureMessage(error)).toBeNull();
    expect(operationFailureCode(error)).toBeNull();
  });

  it('survives values that are not errors at all', () => {
    for (const value of [null, undefined, 'a string', 42, {}]) {
      expect(operationFailureMessage(value)).toBeNull();
      expect(operationFailureCode(value)).toBeNull();
    }
  });
});

describe('what a person is shown when an action does not go through', () => {
  it('prefers the message the Operation wrote for them', () => {
    const failure = new OperationFailure('workspace_access_revoked', 'Your access changed.');
    expect(actionFailureMessage(failure, 'Something went wrong.')).toBe('Your access changed.');
  });

  it('prefers that message even when the error was redacted in production', () => {
    const error = redactedProductionError('workspace_access_revoked: Your access changed.');
    expect(actionFailureMessage(error, 'Something went wrong.')).toBe('Your access changed.');
  });

  /* An error thrown on the client, or by a development server, still reads
     correctly and is more specific than any fallback. */
  it('shows an ordinary error message when there is one worth reading', () => {
    expect(actionFailureMessage(new Error('The file is too large.'), 'Something went wrong.')).toBe(
      'The file is too large.'
    );
  });

  /* The case the function exists for. Showing "Minified React error #418" to a
     person tells them nothing they can act on, so the surface's own sentence
     is better than the error's. */
  it('falls back rather than showing a redacted production error', () => {
    expect(actionFailureMessage(redactedProductionError(), 'Your Note was not saved.')).toBe(
      'Your Note was not saved.'
    );
  });

  it('falls back for the other shape a stripped message takes', () => {
    const error = new Error(
      'An error occurred in the Server Components render, omitted in production.'
    );
    expect(actionFailureMessage(error, 'Your Note was not saved.')).toBe(
      'Your Note was not saved.'
    );
  });

  it('falls back for anything that is not an error', () => {
    expect(actionFailureMessage('a string', 'Your Note was not saved.')).toBe(
      'Your Note was not saved.'
    );
    expect(actionFailureMessage(null, 'Your Note was not saved.')).toBe('Your Note was not saved.');
  });
});
