import { describe, expect, it } from 'vitest';
import { evaluateAssistantOutput } from '@/lib/assistant/evals';
import { buildEvidenceCatalog } from '@/lib/assistant/evidence';
import { assistantManagedResponseSchema, buildAssistantSystemPrompt } from '@/lib/assistant/policy';
import { completeManagedText, GROQ_PROVIDER, OPENAI_PROVIDER } from '@/lib/ai/provider';
import { assistantReadTools } from '@/lib/assistant/read-operations';
import { assistantRedTeamCorpus } from './assistant-red-team-corpus';

const evalProvider =
  process.env.AI_EVAL_PROVIDER === OPENAI_PROVIDER ? OPENAI_PROVIDER : GROQ_PROVIDER;
const configuredRequestInterval = Number(
  process.env.AI_EVAL_REQUEST_INTERVAL_MS ?? (evalProvider === GROQ_PROVIDER ? 45_000 : 1_000)
);
const REQUEST_INTERVAL_MS = Number.isFinite(configuredRequestInterval)
  ? Math.max(0, configuredRequestInterval)
  : evalProvider === GROQ_PROVIDER
    ? 45_000
    : 1_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerErrorLabel(error: unknown) {
  const value = error as { status?: unknown; name?: unknown; code?: unknown };
  return (
    [value?.status, value?.name, value?.code]
      .filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number'
      )
      .join(':') || 'unknown'
  );
}

function debugProviderError(error: unknown) {
  if (process.env.AI_EVAL_DEBUG !== '1') return;
  const value = error as { status?: unknown; name?: unknown; code?: unknown; message?: unknown };
  console.error(
    JSON.stringify({
      event: 'live_eval_provider_error',
      status: value?.status ?? null,
      name: value?.name ?? null,
      code: value?.code ?? null,
      message: typeof value?.message === 'string' ? value.message.slice(0, 800) : null,
    })
  );
}

describe('live assistant behavioral gate', () => {
  it('passes the maintained red-team corpus', async () => {
    if (evalProvider === GROQ_PROVIDER && !process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required for the Groq live assistant eval.');
    }
    if (evalProvider === OPENAI_PROVIDER && !process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI live assistant eval.');
    }
    const failures: string[] = [];
    const fixtureFilter = process.env.ASSISTANT_EVAL_FIXTURE;
    const fixtureIds = fixtureFilter?.split(',').map((value) => value.trim());
    const fixtures = fixtureFilter
      ? assistantRedTeamCorpus.filter((fixture) => fixtureIds?.includes(fixture.id))
      : assistantRedTeamCorpus;
    if (!fixtures.length) throw new Error(`Unknown assistant eval fixture: ${fixtureFilter}`);

    for (const [index, fixture] of fixtures.entries()) {
      if (index > 0) await wait(REQUEST_INTERVAL_MS);
      let completion;
      try {
        const result = await completeManagedText(
          'agent',
          {
            messages: [
              {
                role: 'system',
                content: buildAssistantSystemPrompt({
                  canonical: fixture.canonical,
                  route: fixture.route,
                  productContext: fixture.productContext,
                  evidenceCatalog: buildEvidenceCatalog(fixture.productContext),
                }),
              },
              { role: 'user', content: fixture.userMessage },
            ],
            response_format: { type: 'json_object' },
            managed_response_schema: assistantManagedResponseSchema(fixture.canonical),
            temperature: 0,
            tools: assistantReadTools(),
          },
          { provider: evalProvider }
        );
        completion = result.completion;
      } catch (error) {
        debugProviderError(error);
        failures.push(`${fixture.id}: provider_error (${providerErrorLabel(error)})`);
        continue;
      }
      let output: unknown;
      try {
        output = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      } catch {
        output = null;
      }
      const result = evaluateAssistantOutput(fixture, output);
      if (!result.passed) {
        failures.push(
          `${fixture.id}: ${result.failures.map(({ code, message }) => `${code} (${message})`).join(', ')}`
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  }, 750_000);
});
