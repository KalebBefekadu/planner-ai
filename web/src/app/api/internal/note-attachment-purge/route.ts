import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { finishLifecycleJobRun, startLifecycleJobRun } from '@/lib/api/lifecycle-job';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bucket = 'note-attachments';

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const runId = await startLifecycleJobRun(admin, 'note_attachment_purge');
  const now = new Date().toISOString();
  const { data: due, error } = await admin
    .from('note_attachments')
    .select('id,object_key')
    .not('removed_at', 'is', null)
    .lte('purge_after', now)
    .order('purge_after')
    .limit(100);
  if (error) {
    await finishLifecycleJobRun(admin, runId, {
      status: 'failed',
      processed: 0,
      succeeded: 0,
      failed: 0,
      errorCode: 'queue_unavailable',
    });
    return NextResponse.json({ error: 'Attachment purge queue unavailable.' }, { status: 503 });
  }

  let purged = 0;
  let failed = 0;
  for (const attachment of due ?? []) {
    const { error: storageError } = await admin.storage
      .from(bucket)
      .remove([attachment.object_key]);
    if (storageError) {
      failed += 1;
      continue;
    }
    const { error: deleteError } = await admin
      .from('note_attachments')
      .delete()
      .eq('id', attachment.id)
      .not('removed_at', 'is', null)
      .lte('purge_after', now);
    if (deleteError) failed += 1;
    else purged += 1;
  }

  await finishLifecycleJobRun(admin, runId, {
    status: failed > 0 ? 'failed' : 'succeeded',
    processed: due?.length ?? 0,
    succeeded: purged,
    failed,
    errorCode: failed > 0 ? 'item_failure' : undefined,
  });

  return NextResponse.json(
    { processed: due?.length ?? 0, purged },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = POST;
