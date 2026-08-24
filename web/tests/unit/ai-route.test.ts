import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiProblem,
  aiError,
  aiQuotaDecisionProblem,
  enforceAiProcessingPreference,
  readJson,
} from '@/lib/api/ai-route';

const schema = z.object({ value: z.string().min(1).max(10) }).strict();

describe('readJson', () => {
  it('accepts schema-valid bounded JSON', async () => {
    const request = new Request('http://planner.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'plan' }),
    });

    await expect(readJson(request, schema, 100)).resolves.toEqual({ value: 'plan' });
  });

  it('rejects unknown fields', async () => {
    const request = new Request('http://planner.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'plan', userId: 'forged' }),
    });

    await expect(readJson(request, schema, 100)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_input',
    });
  });

  it('rejects a body over the byte limit', async () => {
    const request = new Request('http://planner.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'oversized' }),
    });

    await expect(readJson(request, schema, 5)).rejects.toMatchObject({
      status: 413,
      code: 'request_too_large',
    });
  });
});

describe('aiError', () => {
  it('returns a stable safe error without leaking provider details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = aiError(new Error('provider key sk-secret failed'), 'socratic');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: 'ai_request_failed' });
    expect(JSON.stringify(body)).not.toContain('sk-secret');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('preserves stable expected API problems', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = aiError(
      new ApiProblem(429, 'rate_limit_exceeded', 'Try later.'),
      'smart_goal'
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'rate_limit_exceeded',
      error: 'Try later.',
    });
    log.mockRestore();
  });

  it('classifies provider throttling without leaking provider details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = aiError(
      Object.assign(new Error('provider account secret limit exceeded'), { status: 429 }),
      'capture_analysis'
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    const body = await response.json();
    expect(body).toMatchObject({ code: 'provider_rate_limited' });
    expect(JSON.stringify(body)).not.toContain('secret');
    log.mockRestore();
  });

  it('distinguishes timeouts and malformed provider output', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const timeout = aiError(
      Object.assign(new Error('request timed out'), { status: 504 }),
      'assistant'
    );
    const malformed = aiError(new SyntaxError('Unexpected provider JSON'), 'assistant');

    expect(timeout.status).toBe(504);
    await expect(timeout.json()).resolves.toMatchObject({ code: 'provider_timeout' });
    expect(malformed.status).toBe(502);
    await expect(malformed.json()).resolves.toMatchObject({ code: 'invalid_provider_output' });
    log.mockRestore();
  });
});

describe('AI quota decisions', () => {
  it('distinguishes the monthly platform cap from a temporary rate limit', () => {
    expect(aiQuotaDecisionProblem('allowed')).toBeNull();
    expect(aiQuotaDecisionProblem('monthly_cap')).toMatchObject({
      status: 429,
      code: 'monthly_cap_reached',
    });
    expect(aiQuotaDecisionProblem('rate_limited')).toMatchObject({
      status: 429,
      code: 'rate_limit_exceeded',
    });
  });
});

describe('enforceAiProcessingPreference', () => {
  function clientFor(data: { ai_enabled: boolean } | null, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { from } as unknown as Pick<SupabaseClient, 'from'>;
  }

  it('blocks an AI request when Workspace processing is disabled', async () => {
    await expect(
      enforceAiProcessingPreference(clientFor({ ai_enabled: false }), 'user-1', true)
    ).rejects.toMatchObject({ status: 403, code: 'ai_processing_disabled' });
  });

  it('allows an AI request when Workspace processing is enabled', async () => {
    await expect(
      enforceAiProcessingPreference(clientFor({ ai_enabled: true }), 'user-1', true)
    ).resolves.toBeUndefined();
  });

  it('fails closed when Workspace privacy preferences cannot be loaded', async () => {
    await expect(
      enforceAiProcessingPreference(
        clientFor(null, new Error('database unavailable')),
        'user-1',
        true
      )
    ).rejects.toMatchObject({ status: 503, code: 'preferences_unavailable' });
  });
});
