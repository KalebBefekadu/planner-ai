import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), exists: true }));
vi.mock('@/lib/planner-revalidation', () => ({ revalidatePlannerAndRecords: vi.fn() }));
vi.mock('@/lib/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations')>()),
  executeOperation: mocks.execute,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data: { id: 'workspace', timezone: 'UTC', week_starts_on: 1 },
          error: null,
        }),
        maybeSingle: async () => ({
          data: table === 'reviews' && mocks.exists ? { id: 'saved-review' } : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

import { completePeriodReview, completeWeeklyReview } from '@/app/review/actions';

/* The three properties the key has to have. The first two come from the intent
   and were already true; the third comes from the payload fingerprint and was
   not: a correction typed after a failed submission travels under the failed
   submission's intent, and without the fingerprint it replays that attempt's
   receipt and is discarded. */
describe('review server actions preserve submission intent', () => {
  beforeEach(() => {
    vi.stubEnv('PLANNER_DATA_MODEL', 'canonical');
    mocks.exists = true;
    mocks.execute
      .mockReset()
      .mockResolvedValue({ reviewId: 'saved-review', resolvedCount: 0, priorityCount: 0 });
  });

  for (const kind of ['weekly', 'monthly', 'quarterly'] as const) {
    it(`${kind}: retry stays stable, but a new completion and edited payload do not replay`, async () => {
      const intent = randomUUID();
      const period = {
        startsOn: '2026-09-07',
        endsOn: '2026-09-13',
        reflectionMarkdown: 'Original',
      };
      const submit = (id: string, reflectionMarkdown = period.reflectionMarkdown) =>
        kind === 'weekly'
          ? completeWeeklyReview({ ...period, reflectionMarkdown, decisions: [], intentId: id })
          : completePeriodReview({ ...period, kind, reflectionMarkdown, intentId: id });
      await submit(intent);
      await submit(intent);
      await submit(randomUUID());
      await submit(intent, 'Corrected');
      const keys = mocks.execute.mock.calls.map((call) => call[3].idempotencyKey);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[2]).not.toBe(keys[0]);
      expect(keys[3]).not.toBe(keys[0]);
    });
  }

  it('does not invoke the Operation with an invalid client intent', async () => {
    await expect(
      completeWeeklyReview({
        startsOn: '2026-09-07',
        endsOn: '2026-09-13',
        reflectionMarkdown: '',
        decisions: [],
        intentId: '',
      })
    ).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
