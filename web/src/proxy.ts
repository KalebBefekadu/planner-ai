import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const publicPwaAssets = new Set(['/manifest.json', '/sw.js', '/offline-capture.html']);

function supabaseOrigins() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return [];

  try {
    const origin = new URL(configuredUrl).origin;
    const websocketOrigin = new URL(origin);
    websocketOrigin.protocol = websocketOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
    return [origin, websocketOrigin.origin];
  } catch {
    return [];
  }
}

function contentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const connectSources = ["'self'", ...supabaseOrigins()].join(' ');

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  if (publicPwaAssets.has(request.nextUrl.pathname)) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
