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
});
