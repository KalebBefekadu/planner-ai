import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { finishLifecycleJobRun, startLifecycleJobRun } from '@/lib/api/lifecycle-job';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bucket = 'note-attachments';
// Long enough that a slow upload of a 10 MB file is never mistaken for a dead
// one, short enough that a dead one does not linger for a day.
const reservationGraceMs = 15 * 60 * 1000;

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

  // Reconcile. A reservation that never finalized means an upload died
  // somewhere between the two services. The object may or may not exist; both
  // cases are cleaned the same way, and the row is what made either findable.
  const staleBefore = new Date(Date.now() - reservationGraceMs).toISOString();
  const { data: stale } = await admin
    .from('note_attachments')
    .select('id,object_key')
    .eq('upload_state', 'reserved')
    .lte('created_at', staleBefore)
    .order('created_at')
    .limit(100);

  let reconciled = 0;
  for (const reservation of stale ?? []) {
    await admin.storage.from(bucket).remove([reservation.object_key]);
    const { error: deleteError } = await admin
      .from('note_attachments')
      .delete()
      .eq('id', reservation.id)
      .eq('upload_state', 'reserved');
    if (deleteError) failed += 1;
    else reconciled += 1;
  }

  const processed = (due?.length ?? 0) + (stale?.length ?? 0);
  await finishLifecycleJobRun(admin, runId, {
    status: failed > 0 ? 'failed' : 'succeeded',
    processed,
    succeeded: purged + reconciled,
    failed,
    errorCode: failed > 0 ? 'item_failure' : undefined,
  });

  return NextResponse.json(
    { processed, purged, reconciled },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = POST;
