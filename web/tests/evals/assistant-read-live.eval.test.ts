import { describe, expect, it } from 'vitest';
import { evaluateAssistantReadRequest } from '@/lib/assistant/read-evals';
import {
  assistantExplicitReadOperation,
  assistantReadToolChoice,
  assistantReadTools,
} from '@/lib/assistant/read-operations';
import { assistantManagedResponseSchema, buildAssistantSystemPrompt } from '@/lib/assistant/policy';
import { completeManagedText, GROQ_PROVIDER, OPENAI_PROVIDER } from '@/lib/ai/provider';
import { assistantReadCorpus } from './assistant-read-corpus';
import { debugProviderError, providerErrorLabel, wait } from './live-eval-helpers';

const evalProvider =
  process.env.AI_EVAL_PROVIDER === OPENAI_PROVIDER ? OPENAI_PROVIDER : GROQ_PROVIDER;
const configuredRequestInterval = Number(
  process.env.AI_EVAL_REQUEST_INTERVAL_MS ?? (evalProvider === GROQ_PROVIDER ? 32_000 : 1_000)
);
const REQUEST_INTERVAL_MS = Number.isFinite(configuredRequestInterval)
  ? Math.max(0, configuredRequestInterval)
  : evalProvider === GROQ_PROVIDER
    ? 32_000
    : 1_000;

describe('live assistant scoped-read gate', () => {
  it('passes the maintained read corpus', async () => {
    if (evalProvider === GROQ_PROVIDER && !process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required for the Groq live assistant read eval.');
    }
    if (evalProvider === OPENAI_PROVIDER && !process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI live assistant read eval.');
    }
    const failures: string[] = [];
    const fixtureFilter = process.env.ASSISTANT_READ_EVAL_FIXTURE;
    const fixtures = fixtureFilter
      ? assistantReadCorpus.filter((fixture) => fixture.id === fixtureFilter)
      : assistantReadCorpus;
    if (!fixtures.length) throw new Error(`Unknown assistant read eval fixture: ${fixtureFilter}`);

    for (const [index, fixture] of fixtures.entries()) {
      if (index > 0) await wait(REQUEST_INTERVAL_MS);
      const explicitRead = assistantExplicitReadOperation(fixture.userMessage);
      if (fixture.expected.operationId || explicitRead) {
        const choice = assistantReadToolChoice(fixture.userMessage);
        const result = evaluateAssistantReadRequest(
          fixture,
          choice && explicitRead
            ? [
                {
                  type: 'function',
                  function: {
                    name: choice.function.name,
                    arguments: JSON.stringify(explicitRead.input),
                  },
                },
              ]
            : []
        );
        if (!result.passed) failures.push(`${fixture.id}: ${result.failures.join(', ')}`);
        continue;
      }
      try {
        const { completion } = await completeManagedText(
          'agent',
          {
            messages: [
              {
                role: 'system',
                content: buildAssistantSystemPrompt({
                  canonical: true,
                  route: fixture.route,
                  productContext: {},
                  evidenceCatalog: [],
                }),
              },
              { role: 'user', content: fixture.userMessage },
            ],
            tools: assistantReadTools(),
            response_format: { type: 'json_object' },
            managed_response_schema: assistantManagedResponseSchema(),
            temperature: 0,
            max_completion_tokens: 1_600,
          },
          { provider: evalProvider }
        );
        const result = evaluateAssistantReadRequest(
          fixture,
          completion.choices[0]?.message?.tool_calls ?? []
        );
        if (!result.passed) failures.push(`${fixture.id}: ${result.failures.join(', ')}`);
      } catch (error) {
        debugProviderError('live_read_eval_provider_error', error);
        failures.push(`${fixture.id}: provider_error (${providerErrorLabel(error)})`);
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  }, 600_000);
});
