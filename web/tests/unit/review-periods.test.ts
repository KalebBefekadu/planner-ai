import { describe, expect, it } from 'vitest';
import { currentLongReviewPeriod } from '@/lib/reviews/periods';

describe('currentLongReviewPeriod', () => {
  it('uses the workspace-local month at a UTC boundary', () => {
    expect(
      currentLongReviewPeriod('America/Los_Angeles', 'month', new Date('2026-09-01T02:00:00Z'))
    ).toEqual({ startsOn: '2026-08-01', endsOn: '2026-08-31' });
  });

  it('returns an exact calendar quarter', () => {
    expect(
      currentLongReviewPeriod('America/New_York', 'quarter', new Date('2026-08-17T12:00:00Z'))
    ).toEqual({ startsOn: '2026-07-01', endsOn: '2026-09-30' });
  });
});
