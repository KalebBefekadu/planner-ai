import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const publicPwaAssets = new Set(['/manifest.json', '/sw.js', '/offline-capture.html']);

export async function proxy(request: NextRequest) {
  if (publicPwaAssets.has(request.nextUrl.pathname)) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
