import { describe, expect, it } from 'vitest';
import { evaluateAssistantReadRequest } from '@/lib/assistant/read-evals';
import { assistantReadCorpus } from '../evals/assistant-read-corpus';

describe('assistant read behavioral evaluator', () => {
  it('accepts one exact bounded search', () => {
    expect(
      evaluateAssistantReadRequest(assistantReadCorpus[0], [
        {
          type: 'function',
          function: {
            name: 'planner_workspace_search_v1',
            arguments: JSON.stringify({ query: 'launch beta', types: ['goal'], limit: 5 }),
          },
        },
      ])
    ).toMatchObject({ passed: true, failures: [] });
  });

  it('rejects wrong IDs, malformed inputs, extra calls, and write confusion', () => {
    const exact = evaluateAssistantReadRequest(assistantReadCorpus[1], [
      {
        type: 'function',
        function: {
          name: 'planner_workspace_record_read_v1',
          arguments: JSON.stringify({
            type: 'note',
            id: '74000000-0000-4000-8000-000000000099',
          }),
        },
      },
      {
        type: 'function',
        function: { name: 'planner_workspace_search_v1', arguments: '{}' },
      },
    ]);
    expect(exact.failures).toEqual(expect.arrayContaining(['more_than_one_read', 'wrong_record']));

    expect(
      evaluateAssistantReadRequest(assistantReadCorpus[0], [
        {
          type: 'function',
          function: { name: 'planner_workspace_search_v1', arguments: '{bad' },
        },
      ]).passed
    ).toBe(false);
    expect(
      evaluateAssistantReadRequest(assistantReadCorpus[2], [
        {
          type: 'function',
          function: { name: 'planner_workspace_record_read_v1', arguments: '{}' },
        },
      ]).failures
    ).toContain('unexpected_read');
  });
});
