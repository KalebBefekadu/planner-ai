import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type AiOperation =
  | 'smart_goal'
  | 'socratic'
  | 'transcribe'
  | 'assistant'
  | 'capture_analysis'
  | 'review_analysis';

export type RequestContext = {
  operation: AiOperation;
  requestId: string;
  userFingerprint: string;
  startedAt: number;
};

export type AiUsageDetails = {
  providerRole: 'structured_analysis' | 'agent' | 'transcription' | 'internal';
  provider: string;
  modelId: string;
  pricingVersion: string;
  outcome: 'succeeded' | 'failed';
  inputTokens?: number | null;
  outputTokens?: number | null;
  audioSeconds?: number | null;
  estimatedCostMicros?: number;
  errorCode?: string | null;
};

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

function providerProblem(error: unknown): ApiProblem | null {
  if (error instanceof ApiProblem) return error;
  const candidate = error as { status?: unknown; name?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (error instanceof SyntaxError || name === 'ZodError') {
    return new ApiProblem(
      502,
      'invalid_provider_output',
      'Planner AI returned an invalid response. Your source input is unchanged.'
    );
  }
  if (
    status === 408 ||
    status === 504 ||
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /timed?\s*out|timeout/i.test(message)
  ) {
    return new ApiProblem(
      504,
      'provider_timeout',
      'Planner AI took too long to respond. Your source input is unchanged.'
    );
  }
  if (status === 429) {
    return new ApiProblem(
      503,
      'provider_rate_limited',
      'The AI provider is temporarily busy. Your source input is unchanged.'
    );
  }
  if (
    (status !== null && status >= 500) ||
    name === 'APIConnectionError' ||
    name === 'FetchError'
  ) {
    return new ApiProblem(
      503,
      'provider_unavailable',
      'AI assistance is temporarily unavailable. Your source input is unchanged.'
    );
  }
  return null;
}

function fingerprint(userId: string) {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

export async function enforceAiProcessingPreference(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  canonical = process.env.PLANNER_DATA_MODEL === 'canonical'
) {
  if (!canonical) return;
  const { data: workspace, error } = await client
    .from('workspaces')
    .select('ai_enabled')
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (error || !workspace) {
    throw new ApiProblem(
      503,
      'preferences_unavailable',
      'Workspace privacy preferences are temporarily unavailable.'
    );
  }
  if (!workspace.ai_enabled) {
    throw new ApiProblem(
      403,
      'ai_processing_disabled',
      'AI processing is disabled in Workspace preferences.'
    );
  }
}

export async function authorizeAiRequest(
  request: Request,
  operation: AiOperation,
  maxBodyBytes: number,
  options: { deferQuota?: boolean } = {}
): Promise<RequestContext> {
  const requestId = randomUUID();
  const contentLength = request.headers.get('content-length');

  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ApiProblem(400, 'invalid_content_length', 'The request could not be read.');
    }
    if (parsedLength > maxBodyBytes) {
      throw new ApiProblem(413, 'request_too_large', 'The request is too large.');
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new ApiProblem(401, 'authentication_required', 'Sign in to use Planner AI assistance.');
  }

  await enforceAiProcessingPreference(supabase, user.id);

  const context = {
    operation,
    requestId,
    userFingerprint: fingerprint(user.id),
    startedAt: Date.now(),
  };
  if (!options.deferQuota) {
    await consumeAiQuota(context, process.env.PLANNER_DATA_MODEL === 'canonical');
  }
  return context;
}

export async function consumeAiQuota(context: RequestContext, detailed = false) {
  const supabase = await createClient();
  if (detailed) {
    const { data: status, error } =
      context.operation === 'review_analysis'
        ? await supabase.rpc('consume_review_analysis_quota', {
            p_request_id: context.requestId,
          })
        : await supabase.rpc('consume_ai_quota_status', {
            p_operation: context.operation,
            p_request_id: context.requestId,
          });
    if (error) {
      throw new ApiProblem(503, 'quota_unavailable', 'AI assistance is temporarily unavailable.');
    }
    const problem = aiQuotaDecisionProblem(status);
    if (problem) throw problem;
    return;
  }
  const { data: allowed, error } = await supabase.rpc('consume_ai_quota', {
    p_operation: context.operation,
  });
  if (error) {
    throw new ApiProblem(503, 'quota_unavailable', 'AI assistance is temporarily unavailable.');
  }
  if (!allowed) {
    throw new ApiProblem(
      429,
      'rate_limit_exceeded',
      'You have reached the temporary AI usage limit. Try again later.'
    );
  }
}

export function aiQuotaDecisionProblem(status: unknown) {
  if (status === 'allowed') return null;
  if (status === 'monthly_cap') {
    return new ApiProblem(
      429,
      'monthly_cap_reached',
      'The Workspace monthly AI platform cap has been reached.'
    );
  }
  return new ApiProblem(
    429,
    'rate_limit_exceeded',
    'You have reached the temporary AI usage limit. Try again later.'
  );
}

export function stableAiErrorCode(error: unknown) {
  return providerProblem(error)?.code ?? 'provider_error';
}

export async function recordAiUsage(context: RequestContext, details: AiUsageDetails) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('record_ai_usage', {
      p_request_id: context.requestId,
      p_operation: context.operation,
      p_provider_role: details.providerRole,
      p_provider: details.provider,
      p_model_id: details.modelId,
      p_pricing_version: details.pricingVersion,
      p_outcome: details.outcome,
      p_latency_ms: Math.min(300_000, Math.max(0, Date.now() - context.startedAt)),
      p_input_tokens: details.inputTokens ?? null,
      p_output_tokens: details.outputTokens ?? null,
      p_audio_seconds: details.audioSeconds ?? null,
      p_estimated_cost_micros: details.estimatedCostMicros ?? 0,
      p_error_code: details.errorCode ?? null,
    });
    if (error) throw error;
    if (process.env.PLANNER_DATA_MODEL === 'canonical') {
      const { error: releaseError } = await supabase.rpc('release_ai_quota_reservation', {
        p_request_id: context.requestId,
      });
      if (releaseError) throw releaseError;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'ai_usage_record_failed',
        operation: context.operation,
        requestId: context.requestId,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      })
    );
  }
}

export async function readJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  maxBodyBytes: number
): Promise<z.output<TSchema>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiProblem(415, 'unsupported_media_type', 'Send this request as JSON.');
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    throw new ApiProblem(413, 'request_too_large', 'The request is too large.');
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    throw new ApiProblem(400, 'invalid_json', 'The request contains invalid JSON.');
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiProblem(400, 'invalid_input', 'Check the request and try again.');
  }
  return result.data;
}

export function aiSuccess<T>(data: T, context: RequestContext, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-Id': context.requestId,
    },
  });
}

export function aiError(error: unknown, operation: AiOperation) {
  const problem =
    providerProblem(error) ??
    new ApiProblem(500, 'ai_request_failed', 'AI assistance could not complete this request.');
  const requestId = randomUUID();

  console.error(
    JSON.stringify({
      event: 'ai_request_failed',
      operation,
      requestId,
      errorCode: problem.code,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    })
  );

  const retryAfter =
    problem.code === 'provider_rate_limited'
      ? '60'
      : problem.code === 'provider_unavailable'
        ? '15'
        : null;
  return NextResponse.json(
    { error: problem.message, code: problem.code, requestId },
    {
      status: problem.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
        ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
      },
    }
  );
}
