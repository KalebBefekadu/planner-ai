import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reviewSubmissionKey } from '@/lib/reviews/submission';

describe('review submission identity', () => {
  const input = {
    startsOn: '2026-09-07',
    endsOn: '2026-09-13',
    reflectionMarkdown: 'First draft',
    decisions: [],
  };

  it('reuses the receipt key for unchanged retries', () => {
    const intent = randomUUID();
    expect(reviewSubmissionKey(intent, input)).toBe(reviewSubmissionKey(intent, { ...input }));
  });

  it('does not replay an old receipt for a changed reflection or decisions', () => {
    const intent = randomUUID();
    const key = reviewSubmissionKey(intent, input);
    expect(reviewSubmissionKey(intent, { ...input, reflectionMarkdown: 'Corrected' })).not.toBe(
      key
    );
    expect(reviewSubmissionKey(intent, { ...input, decisions: [{ resolution: 'done' }] })).not.toBe(
      key
    );
  });

  it('gives a new completion after undo a new identity, even for identical text', () => {
    expect(reviewSubmissionKey(randomUUID(), input)).not.toBe(
      reviewSubmissionKey(randomUUID(), input)
    );
  });

  it('validates client intent and keeps note content out of the key', () => {
    expect(() => reviewSubmissionKey('', input)).toThrow();
    const key = reviewSubmissionKey(randomUUID(), input);
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key).not.toContain(input.reflectionMarkdown);
  });
});
