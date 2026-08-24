import Groq from 'groq-sdk';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';

export const GROQ_PROVIDER = 'groq';
export const GROQ_TEXT_MODEL = 'openai/gpt-oss-120b';
export const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
export const GROQ_PRICING_VERSION = '2026-08-17-gpt-oss-120b';
export const OPENAI_PROVIDER = 'openai';
export const OPENAI_AGENT_MODEL = 'gpt-5-mini-2025-08-07';
export const OPENAI_AGENT_PRICING_VERSION = '2026-08-21-gpt-5-mini-2025-08-07';

const TEXT_INPUT_USD_PER_MILLION = 0.15;
const TEXT_OUTPUT_USD_PER_MILLION = 0.6;
const TRANSCRIPTION_USD_PER_HOUR = 0.04;
const OPENAI_AGENT_INPUT_USD_PER_MILLION = 0.25;
const OPENAI_AGENT_OUTPUT_USD_PER_MILLION = 2;
const GROQ_FINAL_RESPONSE_TOOL = 'json';

export type ManagedAiProviderRole = 'agent' | 'structured_analysis' | 'transcription';
export type ManagedTextProviderRole = Exclude<ManagedAiProviderRole, 'transcription'>;

export type ManagedProviderIdentity = {
  provider: string;
  modelId: string;
  pricingVersion: string;
};

type ManagedTextRequest = Omit<ChatCompletionCreateParamsNonStreaming, 'model'> & {
  managed_response_schema?: Record<string, unknown>;
};
type ManagedTextCompletion = ChatCompletion;

export type ManagedTextResult = ManagedProviderIdentity & {
  completion: ManagedTextCompletion;
  fallbackUsed: boolean;
};

export const managedAiProviderPolicies = {
  agent: { timeoutMs: 30_000, maxRetries: 1 },
  structured_analysis: { timeoutMs: 20_000, maxRetries: 1 },
  transcription: { timeoutMs: 55_000, maxRetries: 0 },
} as const satisfies Record<ManagedAiProviderRole, { timeoutMs: number; maxRetries: number }>;

export function createManagedGroqClient(role: ManagedAiProviderRole) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('AI provider is not configured.');
  const policy = managedAiProviderPolicies[role];
  return new Groq({
    apiKey,
    timeout: policy.timeoutMs,
    maxRetries: policy.maxRetries,
  });
}

const groqTextIdentity = {
  provider: GROQ_PROVIDER,
  modelId: GROQ_TEXT_MODEL,
  pricingVersion: GROQ_PRICING_VERSION,
} as const satisfies ManagedProviderIdentity;

const openAiAgentIdentity = {
  provider: OPENAI_PROVIDER,
  modelId: OPENAI_AGENT_MODEL,
  pricingVersion: OPENAI_AGENT_PRICING_VERSION,
} as const satisfies ManagedProviderIdentity;

function isTransientProviderFailure(error: unknown) {
  const candidate = error as { status?: unknown; name?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return (
    status === 408 ||
    status === 429 ||
    status === 504 ||
    (status !== null && status >= 500) ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'APIConnectionError' ||
    name === 'FetchError' ||
    /timed?\s*out|timeout/i.test(message)
  );
}

function providerFailure(error: unknown, identity: ManagedProviderIdentity) {
  const failure =
    error instanceof Error ? error : new Error('The managed AI provider request failed.');
  Object.assign(failure, { managedProviderIdentity: identity });
  return failure;
}

export function managedProviderIdentityForError(
  error: unknown,
  fallback: ManagedProviderIdentity = groqTextIdentity
) {
  const identity = (error as { managedProviderIdentity?: unknown })?.managedProviderIdentity;
  if (
    identity &&
    typeof identity === 'object' &&
    typeof (identity as ManagedProviderIdentity).provider === 'string' &&
    typeof (identity as ManagedProviderIdentity).modelId === 'string' &&
    typeof (identity as ManagedProviderIdentity).pricingVersion === 'string'
  ) {
    return identity as ManagedProviderIdentity;
  }
  return fallback;
}

export function shouldUseOpenAiAgentFallback(role: ManagedTextProviderRole, error: unknown) {
  return (
    role === 'agent' &&
    isTransientProviderFailure(error) &&
    process.env.AI_AGENT_FALLBACK_PROVIDER === OPENAI_PROVIDER &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

function providerCompatibleJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerCompatibleJsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '$schema' && key !== 'propertyNames')
      .map(([key, child]) => [key, providerCompatibleJsonSchema(child)])
  );
}

export function managedTextRequestForProvider(
  provider: typeof GROQ_PROVIDER | typeof OPENAI_PROVIDER,
  request: ManagedTextRequest
) {
  const { managed_response_schema: responseSchema, ...normalized } = request;
  const compatibleResponseSchema = responseSchema
    ? (providerCompatibleJsonSchema(responseSchema) as Record<string, unknown>)
    : null;
  if (compatibleResponseSchema) {
    normalized.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'planner_ai_response',
        strict: false,
        schema: compatibleResponseSchema,
      },
    };
  }
  if (provider === GROQ_PROVIDER && normalized.tools?.length) {
    delete normalized.response_format;
    normalized.parallel_tool_calls = false;
    normalized.tools = [
      ...normalized.tools,
      {
        type: 'function',
        function: {
          name: GROQ_FINAL_RESPONSE_TOOL,
          description: 'Return the final JSON response when no read tool is needed.',
          parameters: compatibleResponseSchema ?? { type: 'object', additionalProperties: true },
        },
      },
    ];
  }
  if (provider === OPENAI_PROVIDER) delete normalized.temperature;
  return normalized;
}

export function normalizeManagedTextCompletion(
  provider: typeof GROQ_PROVIDER | typeof OPENAI_PROVIDER,
  completion: ManagedTextCompletion
) {
  if (provider !== GROQ_PROVIDER) return completion;
  return {
    ...completion,
    choices: completion.choices.map((choice) => {
      const toolCalls = choice.message.tool_calls ?? [];
      const finalResponse =
        toolCalls.length === 1 &&
        toolCalls[0].type === 'function' &&
        toolCalls[0].function.name === GROQ_FINAL_RESPONSE_TOOL
          ? toolCalls[0]
          : null;
      if (!finalResponse) return choice;
      return {
        ...choice,
        finish_reason: 'stop' as const,
        message: {
          ...choice.message,
          content: finalResponse.function.arguments,
          tool_calls: undefined,
        },
      };
    }),
  };
}

export async function completeManagedText(
  role: ManagedTextProviderRole,
  request: ManagedTextRequest,
  options: { provider?: typeof GROQ_PROVIDER | typeof OPENAI_PROVIDER } = {}
): Promise<ManagedTextResult> {
  const policy = managedAiProviderPolicies[role];
  if (options.provider !== OPENAI_PROVIDER) {
    try {
      const primaryRequest = managedTextRequestForProvider(GROQ_PROVIDER, request);
      const completion = await createManagedGroqClient(role).chat.completions.create({
        ...primaryRequest,
        model: GROQ_TEXT_MODEL,
      } as Parameters<
        ReturnType<typeof createManagedGroqClient>['chat']['completions']['create']
      >[0]);
      return {
        ...groqTextIdentity,
        completion: normalizeManagedTextCompletion(
          GROQ_PROVIDER,
          completion as unknown as ManagedTextCompletion
        ),
        fallbackUsed: false,
      };
    } catch (error) {
      if (options.provider === GROQ_PROVIDER || !shouldUseOpenAiAgentFallback(role, error)) {
        throw providerFailure(error, groqTextIdentity);
      }
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw providerFailure(
      new Error('AI fallback provider is not configured.'),
      openAiAgentIdentity
    );
  }
  const client = new OpenAI({ apiKey, timeout: policy.timeoutMs, maxRetries: 0 });
  const fallbackRequest = managedTextRequestForProvider(OPENAI_PROVIDER, request);
  try {
    const completion = await client.chat.completions.create({
      ...fallbackRequest,
      model: OPENAI_AGENT_MODEL,
      store: false,
    });
    return { ...openAiAgentIdentity, completion, fallbackUsed: true };
  } catch (error) {
    throw providerFailure(error, openAiAgentIdentity);
  }
}

export function estimateTextCostMicros(inputTokens = 0, outputTokens = 0) {
  return Math.ceil(
    inputTokens * TEXT_INPUT_USD_PER_MILLION + outputTokens * TEXT_OUTPUT_USD_PER_MILLION
  );
}

export function estimateTranscriptionCostMicros(audioSeconds: number) {
  const billedSeconds = Math.max(10, audioSeconds);
  return Math.ceil((billedSeconds / 3600) * TRANSCRIPTION_USD_PER_HOUR * 1_000_000);
}

export function chatUsage(completion: {
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}) {
  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    estimatedCostMicros: estimateTextCostMicros(inputTokens, outputTokens),
  };
}

export function managedChatUsage(result: ManagedTextResult) {
  const inputTokens = result.completion.usage?.prompt_tokens ?? 0;
  const outputTokens = result.completion.usage?.completion_tokens ?? 0;
  const estimatedCostMicros =
    result.provider === OPENAI_PROVIDER
      ? Math.ceil(
          inputTokens * OPENAI_AGENT_INPUT_USD_PER_MILLION +
            outputTokens * OPENAI_AGENT_OUTPUT_USD_PER_MILLION
        )
      : estimateTextCostMicros(inputTokens, outputTokens);
  return { inputTokens, outputTokens, estimatedCostMicros };
}
