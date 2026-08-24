import { describe, expect, it } from 'vitest';
import { isMissingAuthSession } from '@/lib/supabase/middleware';

describe('isMissingAuthSession', () => {
  it('treats the expected anonymous Supabase state as unauthenticated, not unavailable', () => {
    expect(isMissingAuthSession({ name: 'AuthSessionMissingError', status: 400 })).toBe(true);
  });

  it('does not hide real authentication transport failures', () => {
    expect(isMissingAuthSession(new TypeError('fetch failed'))).toBe(false);
  });
});
