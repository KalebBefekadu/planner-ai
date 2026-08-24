import { describe, expect, it } from 'vitest';
import {
  assistantExplicitReadOperation,
  assistantReadToolChoice,
  assistantReadOperationCatalog,
  assistantReadOperationIdForToolName,
  assistantReadTools,
  mergeAssistantReadRecords,
  parseAssistantReadOperation,
} from '@/lib/assistant/read-operations';

const id = '10000000-0000-4000-8000-000000000001';

describe('assistant read Operations', () => {
  it('forces only explicit non-writing read intent', () => {
    expect(assistantReadToolChoice('Search my Workspace goals for launch.')).toMatchObject({
      function: { name: 'planner_workspace_search_v1' },
    });
    expect(
      assistantReadToolChoice(
        'Read the Note with ID 74000000-0000-4000-8000-000000000001 before answering.'
      )
    ).toMatchObject({ function: { name: 'planner_workspace_record_read_v1' } });
    expect(assistantReadToolChoice('Use a read Operation to delete my account.')).toBeUndefined();
    expect(assistantReadToolChoice('What should I focus on today?')).toBeUndefined();
    expect(assistantExplicitReadOperation('Search my Workspace goals for launch beta.')).toEqual({
      operationId: 'workspace.search.v1',
      input: { query: 'launch beta', types: ['goal'], limit: 5 },
    });
    expect(
      assistantExplicitReadOperation(
        'Read the Note with ID 74000000-0000-4000-8000-000000000001 before answering.'
      )
    ).toEqual({
      operationId: 'workspace.record.read.v1',
      input: { type: 'note', id: '74000000-0000-4000-8000-000000000001' },
    });
  });
  it('publishes only the two bounded read contracts', () => {
    expect(Object.keys(assistantReadOperationCatalog())).toEqual([
      'workspace.search.v1',
      'workspace.record.read.v1',
    ]);
    expect(assistantReadTools().map((tool) => tool.function.name)).toEqual([
      'planner_workspace_search_v1',
      'planner_workspace_record_read_v1',
    ]);
    expect(assistantReadOperationIdForToolName('planner_workspace_search_v1')).toBe(
      'workspace.search.v1'
    );
  });

  it('accepts an exact record read and bounded literal search', () => {
    expect(parseAssistantReadOperation('workspace.record.read.v1', { type: 'note', id })).toEqual({
      operationId: 'workspace.record.read.v1',
      input: { type: 'note', id },
    });
    expect(
      parseAssistantReadOperation('workspace.search.v1', {
        query: 'launch',
        types: ['goal'],
        limit: 3,
      })
    ).toEqual({
      operationId: 'workspace.search.v1',
      input: { query: 'launch', types: ['goal'], limit: 3 },
    });
  });

  it('rejects wildcards, oversized limits, invented types, and write Operations', () => {
    expect(
      parseAssistantReadOperation('workspace.search.v1', { query: '%%', limit: 5 })
    ).toBeNull();
    expect(
      parseAssistantReadOperation('workspace.search.v1', { query: 'launch', limit: 11 })
    ).toBeNull();
    expect(
      parseAssistantReadOperation('workspace.record.read.v1', { type: 'secret', id })
    ).toBeNull();
    expect(parseAssistantReadOperation('note.update.v1', { id })).toBeNull();
  });

  it('merges read results into evidence-bearing context without duplicates', () => {
    expect(
      mergeAssistantReadRecords(
        { goals: [{ id, title: 'Old title' }], notifications: [{ id: 'notification' }] },
        [{ type: 'goal', id, label: 'Launch beta', href: '/goals' }]
      )
    ).toEqual({
      goals: [{ id, title: 'Launch beta' }],
      notifications: [{ id: 'notification' }],
    });
  });
});
