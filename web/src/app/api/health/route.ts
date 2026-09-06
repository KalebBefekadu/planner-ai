import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
    const { error } = await createAdminClient()
      .from('workspaces')
      .select('id', { head: true })
      .limit(1);
    return error ? response('not_ready', 503) : response('ok', 200);
  } catch {
    return response('not_ready', 503);
  }
}
