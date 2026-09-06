import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from('account_deletion_requests')
    .select('id,user_id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for')
    .limit(25);
  if (error) {
    return NextResponse.json({ error: 'Deletion queue unavailable.' }, { status: 503 });
  }

  let completed = 0;
  for (const requestRow of due ?? []) {
    const { data: claimed } = await admin
      .from('account_deletion_requests')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', requestRow.id)
      .eq('status', 'scheduled')
      .select('id,user_id')
      .maybeSingle();
    if (!claimed?.user_id) continue;

    const deletion = await admin.auth.admin.deleteUser(claimed.user_id, false);
    if (deletion.error) {
      await admin
        .from('account_deletion_requests')
        .update({
          status: 'scheduled',
          processing_started_at: null,
          last_error_code: 'auth_delete_failed',
        })
        .eq('id', claimed.id)
        .eq('status', 'processing');
      continue;
    }
    await admin
      .from('account_deletion_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq('id', claimed.id);
    completed += 1;
  }

  return NextResponse.json(
    { processed: due?.length ?? 0, completed },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = POST;
