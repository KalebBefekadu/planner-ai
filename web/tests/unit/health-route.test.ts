import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

const originalEnvironment = {
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  dataModel: process.env.PLANNER_DATA_MODEL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

function configureCanonicalHealth() {
  process.env.PLANNER_DATA_MODEL = 'canonical';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://planner-health.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-health-key';
}

function restoreEnvironment(name: keyof typeof originalEnvironment, environmentName: string) {
  const value = originalEnvironment[name];
  if (value === undefined) delete process.env[environmentName];
  else process.env[environmentName] = value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnvironment('anonKey', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  restoreEnvironment('dataModel', 'PLANNER_DATA_MODEL');
  restoreEnvironment('publishableKey', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  restoreEnvironment('supabaseUrl', 'NEXT_PUBLIC_SUPABASE_URL');
});

describe('health readiness route', () => {
  it('stays unavailable before the canonical data model is active', async () => {
    process.env.PLANNER_DATA_MODEL = 'legacy';
    const fetchProbe = vi.fn();
    vi.stubGlobal('fetch', fetchProbe);

    const result = await GET();

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({ status: 'not_ready' });
    expect(fetchProbe).not.toHaveBeenCalled();
  });

  it('uses only the publishable-key REST boundary for readiness', async () => {
    configureCanonicalHealth();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchProbe = vi.fn().mockResolvedValue({ body: { cancel }, ok: true });
    vi.stubGlobal('fetch', fetchProbe);

    const result = await GET();

    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    await expect(result.json()).resolves.toEqual({ status: 'ok' });
    expect(fetchProbe).toHaveBeenCalledWith(
      new URL('https://planner-health.supabase.co/rest/v1/'),
      expect.objectContaining({
        cache: 'no-store',
        headers: { apikey: 'public-health-key' },
        signal: expect.any(AbortSignal),
      })
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reports non-OK, network, and configuration failures as not ready', async () => {
    configureCanonicalHealth();
    const fetchProbe = vi
      .fn()
      .mockResolvedValueOnce({ body: null, ok: false })
      .mockRejectedValueOnce(new Error('dependency unavailable'));
    vi.stubGlobal('fetch', fetchProbe);

    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ status: 'not_ready' });

    const failed = await GET();
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ status: 'not_ready' });

    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const misconfigured = await GET();
    expect(misconfigured.status).toBe(503);
    await expect(misconfigured.json()).resolves.toEqual({ status: 'not_ready' });
  });
});
