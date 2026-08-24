import { describe, expect, it } from 'vitest';
import { validateReviewProposal, type ReviewEvidence } from '@/lib/review-proposals';

const actionId = '81000000-0000-4000-8000-000000000001';
const inventedId = '81000000-0000-4000-8000-000000000099';
const catalog: ReviewEvidence[] = [{ type: 'action', id: actionId, label: 'Ship beta', href: '/' }];

describe('review proposal policy', () => {
  it('accepts bounded recommendations and exact existing priorities', () => {
    expect(
      validateReviewProposal(
        {
          summary: 'Protect the launch work.',
          priorityActionIds: [actionId],
          recommendations: [
            {
              text: 'Ship beta is an available Action.',
              status: 'supported',
              evidence: [{ type: 'action', id: actionId }],
            },
          ],
          reflectionPrompts: ['What would make this Action easier to finish?'],
        },
        catalog,
        [actionId]
      )
    ).toMatchObject({ priorityActionIds: [actionId] });
  });

  it('rejects invented priorities and evidence', () => {
    const base = {
      summary: 'Unsafe',
      recommendations: [],
      reflectionPrompts: ['Reflect.'],
    };
    expect(
      validateReviewProposal({ ...base, priorityActionIds: [inventedId] }, catalog, [actionId])
    ).toBeNull();
    expect(
      validateReviewProposal(
        {
          ...base,
          priorityActionIds: [],
          recommendations: [
            {
              text: 'Invented evidence.',
              status: 'supported',
              evidence: [{ type: 'action', id: inventedId }],
            },
          ],
        },
        catalog,
        [actionId]
      )
    ).toBeNull();
  });

  it('enforces supported and needs-input evidence semantics', () => {
    const base = { summary: 'Boundary', priorityActionIds: [], reflectionPrompts: ['Reflect.'] };
    expect(
      validateReviewProposal(
        {
          ...base,
          recommendations: [{ text: 'Unsupported.', status: 'supported', evidence: [] }],
        },
        catalog,
        [actionId]
      )
    ).toBeNull();
    expect(
      validateReviewProposal(
        {
          ...base,
          recommendations: [
            {
              text: 'Needs input.',
              status: 'needs_input',
              evidence: [{ type: 'action', id: actionId }],
            },
          ],
        },
        catalog,
        [actionId]
      )
    ).toBeNull();
  });
});
