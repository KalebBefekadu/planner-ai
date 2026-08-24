import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatUsage,
  completeManagedText,
  createManagedGroqClient,
  estimateTextCostMicros,
  estimateTranscriptionCostMicros,
  managedAiProviderPolicies,
  managedChatUsage,
  managedProviderIdentityForError,
  managedTextRequestForProvider,
  normalizeManagedTextCompletion,
  shouldUseOpenAiAgentFallback,
} from '@/lib/ai/provider';

afterEach(() => vi.unstubAllEnvs());

describe('AI provider cost estimates', () => {
  it('prices text input and output independently in integer microdollars', () => {
    expect(estimateTextCostMicros(1_000_000, 1_000_000)).toBe(750_000);
    expect(chatUsage({ usage: { prompt_tokens: 1_000, completion_tokens: 500 } })).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostMicros: 450,
    });
  });

  it('applies the transcription minimum billed duration', () => {
    expect(estimateTranscriptionCostMicros(1)).toBe(112);
    expect(estimateTranscriptionCostMicros(3600)).toBe(40_000);
  });

  it('uses explicit role-based timeout and retry policies', () => {
    expect(managedAiProviderPolicies).toEqual({
      agent: { timeoutMs: 30_000, maxRetries: 1 },
      structured_analysis: { timeoutMs: 20_000, maxRetries: 1 },
      transcription: { timeoutMs: 55_000, maxRetries: 0 },
    });
    vi.stubEnv('GROQ_API_KEY', 'test-key-never-sent');
    const client = createManagedGroqClient('agent');
    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(1);
  });

  it('fails before a provider call when managed credentials are absent', () => {
    vi.stubEnv('GROQ_API_KEY', '');
    expect(() => createManagedGroqClient('structured_analysis')).toThrow(
      'AI provider is not configured.'
    );
  });

  it('keeps the fallback disabled unless both approval and credentials are present', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'test-key-never-sent');
    vi.stubEnv('AI_AGENT_FALLBACK_PROVIDER', '');
    const error = await completeManagedText('agent', { messages: [] }).catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(managedProviderIdentityForError(error)).toMatchObject({ provider: 'groq' });
  });

  it('allows only transient agent failures to enter the approved fallback', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key-never-sent');
    vi.stubEnv('AI_AGENT_FALLBACK_PROVIDER', 'openai');
    expect(shouldUseOpenAiAgentFallback('agent', { status: 429 })).toBe(true);
    expect(shouldUseOpenAiAgentFallback('agent', { status: 503 })).toBe(true);
    expect(shouldUseOpenAiAgentFallback('agent', { name: 'TimeoutError' })).toBe(true);
    expect(shouldUseOpenAiAgentFallback('structured_analysis', { status: 503 })).toBe(false);
    expect(shouldUseOpenAiAgentFallback('agent', { status: 401 })).toBe(false);
    expect(shouldUseOpenAiAgentFallback('agent', new SyntaxError('invalid JSON'))).toBe(false);
  });

  it('normalizes tool requests to each provider contract', () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'Find my goal.' }],
      temperature: 0.2,
      response_format: { type: 'json_object' as const },
      managed_response_schema: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          metadata: { type: 'object', propertyNames: { type: 'string' } },
        },
        required: ['reply'],
        additionalProperties: false,
      },
      tools: [
        {
          type: 'function' as const,
          function: { name: 'find_goal', parameters: { type: 'object' } },
        },
      ],
    };
    expect(managedTextRequestForProvider('groq', request)).toMatchObject({
      temperature: 0.2,
      parallel_tool_calls: false,
    });
    expect(managedTextRequestForProvider('groq', request)).not.toHaveProperty('response_format');
    expect(managedTextRequestForProvider('groq', request).tools).toHaveLength(2);
    expect(managedTextRequestForProvider('groq', request).tools?.[1]).toMatchObject({
      function: {
        parameters: { required: ['reply'], additionalProperties: false },
      },
    });
    expect(managedTextRequestForProvider('groq', request).tools?.[1]).not.toHaveProperty(
      'function.parameters.properties.metadata.propertyNames'
    );
    expect(managedTextRequestForProvider('openai', request)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'planner_ai_response', strict: false },
      },
    });
    expect(managedTextRequestForProvider('openai', request)).not.toHaveProperty(
      'managed_response_schema'
    );
    expect(managedTextRequestForProvider('openai', request)).not.toHaveProperty('temperature');
  });

  it('normalizes Groq final-response tool output before route validation', () => {
    const completion = {
      id: 'test',
      object: 'chat.completion' as const,
      created: 0,
      model: 'test',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls' as const,
          logprobs: null,
          message: {
            role: 'assistant' as const,
            content: null,
            refusal: null,
            annotations: [],
            tool_calls: [
              {
                id: 'call-final',
                type: 'function' as const,
                function: { name: 'json', arguments: '{"reply":"Ready"}' },
              },
            ],
          },
        },
      ],
    };
    const normalized = normalizeManagedTextCompletion('groq', completion);
    expect(normalized.choices[0].message.content).toBe('{"reply":"Ready"}');
    expect(normalized.choices[0].message.tool_calls).toBeUndefined();
    expect(normalized.choices[0].finish_reason).toBe('stop');
  });

  it('prices managed completion usage using the provider that served it', () => {
    expect(
      managedChatUsage({
        provider: 'openai',
        modelId: 'gpt-5-mini-2025-08-07',
        pricingVersion: 'test-price',
        fallbackUsed: true,
        completion: {
          id: 'test',
          object: 'chat.completion',
          created: 0,
          model: 'test',
          choices: [],
          usage: { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 },
        },
      })
    ).toEqual({ inputTokens: 1_000, outputTokens: 500, estimatedCostMicros: 1_250 });
  });
});
