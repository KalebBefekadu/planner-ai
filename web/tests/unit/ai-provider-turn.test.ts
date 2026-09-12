import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These cases need the provider SDKs replaced rather than configured, because
// what is under test is what Planner AI does with a failing provider -- and no
// assertion about outage behavior is worth anything if it can only be made by
// actually calling a paid provider.
const groqCreate = vi.fn();
const openAiCreate = vi.fn();

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
  },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openAiCreate } };
  },
}));

const { completeManagedText, GROQ_PROVIDER, OPENAI_PROVIDER } = await import('@/lib/ai/provider');

function transientOutage() {
  return Object.assign(new Error('service unavailable'), { status: 503 });
}

function completion() {
  return {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

beforeEach(() => {
  groqCreate.mockReset();
  openAiCreate.mockReset();
  vi.stubEnv('GROQ_API_KEY', 'test-key-never-sent');
  vi.stubEnv('OPENAI_API_KEY', 'test-key-never-sent');
  vi.stubEnv('AI_AGENT_FALLBACK_PROVIDER', 'openai');
});

afterEach(() => vi.unstubAllEnvs());

describe('managed text turns under provider failure', () => {
  it('reaches the approved fallback exactly once instead of retrying in a loop', async () => {
    groqCreate.mockRejectedValue(transientOutage());
    openAiCreate.mockResolvedValue(completion());

    const result = await completeManagedText('agent', { messages: [] });

    expect(result.provider).toBe(OPENAI_PROVIDER);
    expect(result.fallbackUsed).toBe(true);
    // One attempt per provider at this layer. The SDK's own bounded retry
    // policy is the only repetition, so a total outage costs a fixed, small
    // number of calls rather than an open-ended spend.
    expect(groqCreate).toHaveBeenCalledTimes(1);
    expect(openAiCreate).toHaveBeenCalledTimes(1);
  });

  it('surfaces the failure of the provider that actually failed when both are down', async () => {
    groqCreate.mockRejectedValue(transientOutage());
    openAiCreate.mockRejectedValue(transientOutage());

    const error = await completeManagedText('agent', { messages: [] }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(openAiCreate).toHaveBeenCalledTimes(1);
  });

  it('keeps a pinned tool turn on one provider rather than switching mid-turn', async () => {
    // The second half of a read-tool turn replays the first half's tool_call_id
    // and is billed again. Switching providers there would both double the cost
    // of one turn and hand a second provider a transcript it never produced, so
    // a pinned turn must fail instead of failing over.
    groqCreate.mockRejectedValue(transientOutage());
    openAiCreate.mockResolvedValue(completion());

    const error = await completeManagedText(
      'agent',
      { messages: [] },
      { provider: GROQ_PROVIDER }
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it('never contacts the primary provider for the second half of a fallback turn', async () => {
    openAiCreate.mockResolvedValue(completion());

    const result = await completeManagedText(
      'agent',
      { messages: [] },
      { provider: OPENAI_PROVIDER }
    );

    expect(result.provider).toBe(OPENAI_PROVIDER);
    expect(groqCreate).not.toHaveBeenCalled();
  });
});
