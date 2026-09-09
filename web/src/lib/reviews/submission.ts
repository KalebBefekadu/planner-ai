import { createHash } from 'node:crypto';
import { z } from 'zod';

// Bind the retry identity to the payload on the server: a changed draft must
// never receive an earlier draft's success receipt, even with a reused intent.
export function reviewSubmissionKey(intentId: string, input: unknown): string {
  const intent = z.uuid().parse(intentId);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return `review:${intent}:${fingerprint}`;
}
