import { expect, test } from '@playwright/test';

/* The app shipped with no security headers. These pin the ones added in
   next.config.ts, because a header regression is silent — nothing breaks, the
   protection just stops being there. */

test('sends the baseline security headers', async ({ request }) => {
  const response = await request.get('/login');
  const headers = response.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
});

test('uses a strict per-request Content Security Policy', async ({ request }) => {
  const first = (await request.get('/login')).headers()['content-security-policy'] ?? '';
  const second = (await request.get('/login')).headers()['content-security-policy'] ?? '';

  expect(first).toContain("default-src 'self'");
  expect(first).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(first).toContain("object-src 'none'");
  expect(first).toContain("base-uri 'self'");
  expect(first).toContain("form-action 'self'");
  expect(first).toContain("frame-ancestors 'none'");
  expect(first).toContain("media-src 'self' blob:");
  expect(first).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(first).not.toBe(second);
});

test('keeps the microphone available to voice capture, and shuts off the rest', async ({
  request,
}) => {
  const policy = (await request.get('/login')).headers()['permissions-policy'] ?? '';

  // dump-ui.tsx records audio; denying this would break capture, which is
  // journey 1 of 5.
  expect(policy).toContain('microphone=(self)');

  for (const denied of ['camera=()', 'geolocation=()', 'payment=()']) {
    expect(policy).toContain(denied);
  }
});

test('applies the headers to every route, not just the entry page', async ({ request }) => {
  for (const path of ['/signup', '/forgot-password']) {
    const headers = (await request.get(path)).headers();
    expect(headers['x-content-type-options'], `${path} is missing nosniff`).toBe('nosniff');
    expect(headers['x-frame-options'], `${path} is framable`).toBe('DENY');
  }
});

test('does not leak the framework version', async ({ request }) => {
  const headers = (await request.get('/login')).headers();
  expect(headers['x-powered-by']).toBeUndefined();
});
