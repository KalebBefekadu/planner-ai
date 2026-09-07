import { operationFailureMessage } from '@/lib/operations';

// What to show a person when an action did not go through.
//
// A production build strips the message off any error thrown out of a Server
// Action, so `error.message` on the client is a generic React error rather than
// anything worth reading. The real message travels on the digest instead. This
// falls back to a sentence about the surface rather than showing that generic
// error, which tells a person nothing they can act on.
export function actionFailureMessage(error: unknown, fallback: string): string {
  const carried = operationFailureMessage(error);
  if (carried) return carried;
  // A message thrown on the client, or by a development server, still reads
  // correctly; a redacted production error never does.
  if (error instanceof Error && !/Minified React error|omitted in production/.test(error.message)) {
    return error.message;
  }
  return fallback;
}
