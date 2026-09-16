import { describe, expect, it } from 'vitest';
import {
  newReviewIntent,
  reviewCompletionKey,
  ReviewIntentError,
} from '@/lib/reviews/completion-intent';

// The regression this exists to prevent: completing a review, undoing it, and
// completing it again used to replay the undone result. The receipt survives
// an undo -- marked reversed, deliberately, because history is not rewritten --
// so a key derived only from the period finds it and reports success for a
// review that no longer exists.

describe('the key a review completion is submitted under', () => {
  it('is the same for two sends of one submission, so a retry cannot duplicate', () => {
    const intent = newReviewIntent();
    expect(reviewCompletionKey('weekly', '2026-09-07', intent)).toBe(
      reviewCompletionKey('weekly', '2026-09-07', intent)
    );
  });

  it('differs for a second deliberate submission of the same period', () => {
    // This is the undo case. Same week, same everything except that the person
    // decided to complete it again.
    expect(reviewCompletionKey('weekly', '2026-09-07', newReviewIntent())).not.toBe(
      reviewCompletionKey('weekly', '2026-09-07', newReviewIntent())
    );
  });

  it('separates periods and kinds that happen to share an intent', () => {
    const intent = newReviewIntent();
    expect(reviewCompletionKey('weekly', '2026-09-07', intent)).not.toBe(
      reviewCompletionKey('weekly', '2026-09-14', intent)
    );
    expect(reviewCompletionKey('monthly', '2026-09-01', intent)).not.toBe(
      reviewCompletionKey('quarterly', '2026-09-01', intent)
    );
  });

  it('stays inside the length the operation gateway accepts', () => {
    const key = reviewCompletionKey('quarterly', '2026-09-01', newReviewIntent());
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it('refuses an intent it cannot vouch for rather than inventing one', () => {
    // Silently substituting a fresh intent here would turn a malformed retry
    // into a second review, which is the very thing this guards against.
    expect(() => reviewCompletionKey('weekly', '2026-09-07', 'short')).toThrow(ReviewIntentError);
    expect(() => reviewCompletionKey('weekly', '2026-09-07', 'has spaces in it')).toThrow(
      ReviewIntentError
    );
  });
});
