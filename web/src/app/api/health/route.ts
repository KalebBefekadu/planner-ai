import { NextResponse } from 'next/server';
import { supabasePublicKey } from '@/lib/supabase/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(status: 'ok' | 'not_ready', code: number) {
  return NextResponse.json({ status }, { status: code, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return response('not_ready', 503);
  }

  try {
    const url = new URL('/rest/v1/', process.env.NEXT_PUBLIC_SUPABASE_URL);
    const dependency = await fetch(url, {
      cache: 'no-store',
      headers: { apikey: supabasePublicKey() },
      signal: AbortSignal.timeout(3_000),
    });
    await dependency.body?.cancel();
    return dependency.ok ? response('ok', 200) : response('not_ready', 503);
  } catch {
    return response('not_ready', 503);
  }
}
