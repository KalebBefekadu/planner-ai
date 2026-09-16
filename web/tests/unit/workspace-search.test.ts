import { describe, expect, it } from 'vitest';
import { buildWorkspaceSearchResults, type WorkspaceSearchInput } from '@/lib/workspace-search';

const input: WorkspaceSearchInput = {
  pages: [
    {
      id: 'page-1',
      title: 'Product strategy',
      body: 'Launch the Planner AI private beta.',
      updatedAt: '2026-08-25T10:00:00Z',
    },
  ],
  goals: [
    {
      id: 'goal-1',
      title: 'Launch private beta',
      body: 'Invite ten users.',
      updatedAt: '2026-08-24T10:00:00Z',
    },
  ],
  actions: [
    {
      id: 'action-1',
      title: 'Write beta invitation',
      body: null,
      updatedAt: '2026-08-23T10:00:00Z',
    },
  ],
  captures: [
    {
      id: 'capture-1',
      rawText: 'Remember to prepare the beta onboarding call.',
      createdAt: '2026-08-26T10:00:00Z',
    },
  ],
};

describe('workspace search', () => {
  it('searches every supported product object and sorts by recency', () => {
    const results = buildWorkspaceSearchResults('beta', input);
    expect(results.map((result) => result.kind)).toEqual(['capture', 'page', 'goal', 'action']);
  });

  it('is case insensitive and returns destination links', () => {
    const [result] = buildWorkspaceSearchResults('PRODUCT', input);
    expect(result).toMatchObject({ kind: 'page', href: '/notes?note=page-1' });
  });

  it('does not run on ambiguous one-character input', () => {
    expect(buildWorkspaceSearchResults('b', input)).toEqual([]);
  });

  it('caps the result set', () => {
    expect(buildWorkspaceSearchResults('beta', input, 2)).toHaveLength(2);
  });

  /* Two pages can honestly carry the same title. Without their location the
     list shows the same row twice and the person has to open both to find out
     which one they meant; the ids still differ, so each row opens the right
     Note, but only the location says which row that is. */
  it('keeps duplicate page titles apart by where they live', () => {
    const results = buildWorkspaceSearchResults('meeting notes', {
      pages: [
        {
          id: 'acme-notes',
          title: 'Meeting notes',
          body: 'Quarterly review.',
          context: 'Clients / Acme',
          updatedAt: '2026-08-25T10:00:00Z',
        },
        {
          id: 'globex-notes',
          title: 'Meeting notes',
          body: 'Quarterly review.',
          context: 'Clients / Globex',
          updatedAt: '2026-08-24T10:00:00Z',
        },
      ],
      goals: [],
      actions: [],
      captures: [],
    });
    expect(results.map((result) => [result.href, result.context])).toEqual([
      ['/notes?note=acme-notes', 'Clients / Acme'],
      ['/notes?note=globex-notes', 'Clients / Globex'],
    ]);
  });

  it('leaves the location empty when there is nothing to disambiguate', () => {
    const [result] = buildWorkspaceSearchResults('PRODUCT', input);
    expect(result.context).toBe('');
  });
});
