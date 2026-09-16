import { describe, expect, it } from 'vitest';
import { payloadFingerprint } from '@/lib/reviews/submission';

/* The intent says "this is one submission". The fingerprint says "and this is
   what it said". Both are needed, because the intent outlives a failed attempt:
   it is minted once per mount and cleared only on success, so a correction
   typed after a failure travels under the first attempt's intent. */

describe('what counts as the same submission', () => {
  it('is the same for a payload sent twice', () => {
    const payload = { startsOn: '2026-09-07', reflectionMarkdown: 'Original' };
    expect(payloadFingerprint(payload)).toBe(payloadFingerprint({ ...payload }));
  });

  it('is different once the reflection is corrected', () => {
    const base = { startsOn: '2026-09-07', reflectionMarkdown: 'Original' };
    expect(payloadFingerprint(base)).not.toBe(
      payloadFingerprint({ ...base, reflectionMarkdown: 'Corrected' })
    );
  });

  /* A payload is rebuilt from component state on every send, and object key
     order is whatever the code happened to write. Reading that as an edit would
     turn every retry into a second review, which is the failure this whole
     mechanism exists to prevent. */
  it('does not depend on the order the payload was built in', () => {
    expect(payloadFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      payloadFingerprint({ b: { d: 3, c: 2 }, a: 1 })
    );
  });

  it('distinguishes a changed decision, not only changed prose', () => {
    const base = { decisions: [{ id: 'a', decision: 'left_overdue' }] };
    expect(payloadFingerprint(base)).not.toBe(
      payloadFingerprint({ decisions: [{ id: 'a', decision: 'rescheduled' }] })
    );
  });

  it('distinguishes an added decision from a shorter list', () => {
    expect(payloadFingerprint({ decisions: [{ id: 'a' }] })).not.toBe(
      payloadFingerprint({ decisions: [{ id: 'a' }, { id: 'b' }] })
    );
  });
});
