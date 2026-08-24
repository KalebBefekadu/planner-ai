import { describe, expect, it } from 'vitest';
import { buildEvidenceCatalog, resolveEvidence } from '@/lib/assistant/evidence';

const goalId = '10000000-0000-4000-8000-000000000001';
const excludedId = '10000000-0000-4000-8000-000000000002';

describe('assistant evidence', () => {
  it('builds links only from records present in bounded context', () => {
    expect(buildEvidenceCatalog({ goals: [{ id: goalId, title: 'Launch beta' }] })).toContainEqual({
      type: 'goal',
      id: goalId,
      label: 'Launch beta',
      href: '/goals',
    });
  });

  it('drops invented and duplicate model references', () => {
    const catalog = buildEvidenceCatalog({ goals: [{ id: goalId, title: 'Launch beta' }] });
    expect(
      resolveEvidence(
        [
          { type: 'goal', id: goalId },
          { type: 'goal', id: excludedId },
          { type: 'goal', id: goalId },
        ],
        catalog
      )
    ).toEqual([{ type: 'goal', id: goalId, label: 'Launch beta', href: '/goals' }]);
  });

  it('defensively excludes Notes marked outside AI processing', () => {
    expect(
      buildEvidenceCatalog({
        noteTitles: [
          { id: goalId, title: 'Available Note', aiExcluded: false },
          { id: excludedId, title: 'Private Note', aiExcluded: true },
        ],
      })
    ).toEqual([
      {
        type: 'note',
        id: goalId,
        label: 'Available Note',
        href: `/notes?note=${goalId}`,
      },
    ]);
  });
});
