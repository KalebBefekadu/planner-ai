import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabasePublicKey } from '@/lib/supabase/config';

afterEach(() => vi.unstubAllEnvs());

describe('Supabase public-key configuration', () => {
  it('prefers the current publishable key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon-key');

    expect(supabasePublicKey()).toBe('publishable-key');
  });

  it('supports a legacy anonymous key during migration', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon-key');

    expect(supabasePublicKey()).toBe('legacy-anon-key');
  });

  it('fails closed when neither public key is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    expect(supabasePublicKey).toThrow('A Supabase publishable key is not configured.');
  });
});
