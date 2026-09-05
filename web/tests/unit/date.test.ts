import { describe, expect, it } from 'vitest';
import { dateInTimezone } from '@/lib/date';

describe('dateInTimezone', () => {
  it('uses the requested timezone across a UTC date boundary', () => {
    const now = new Date('2026-09-01T02:00:00Z');

    expect(dateInTimezone('America/Los_Angeles', now)).toBe('2026-08-31');
    expect(dateInTimezone('Asia/Tokyo', now)).toBe('2026-09-01');
  });

  it('returns a zero-padded ISO calendar date', () => {
    expect(dateInTimezone('UTC', new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});
