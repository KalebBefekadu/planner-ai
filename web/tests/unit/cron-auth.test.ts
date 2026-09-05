import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAuthorizedCronRequest } from '@/lib/api/cron';

const originalSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new Request('https://planner.example/api/internal/job', {
    headers: authorization ? { authorization } : undefined,
  });
}

describe('isAuthorizedCronRequest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'expected-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('accepts the configured bearer secret', () => {
    expect(isAuthorizedCronRequest(request('Bearer expected-secret'))).toBe(true);
    expect(isAuthorizedCronRequest(request('bearer expected-secret'))).toBe(true);
  });

  it('rejects missing, incorrect, and differently sized credentials', () => {
    expect(isAuthorizedCronRequest(request())).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer incorrect-value'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer short'))).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(request('Bearer expected-secret'))).toBe(false);
  });
});
