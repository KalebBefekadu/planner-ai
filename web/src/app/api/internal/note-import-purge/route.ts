import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { finishLifecycleJobRun, startLifecycleJobRun } from '@/lib/api/lifecycle-job';
import { IMPORT_PREVIEW_RETENTION_DAYS } from '@/lib/notes/import-limits';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// IM-05 (#168): a job still in 'preview' was never committed and was never
// explicitly canceled (#175 added that path). It is an abandoned experiment,
// not a record the owner asked Planner AI to keep. This worker removes it
// after the stated retention window, mirroring note-attachment-purge: a
// bounded page per run, one delete per row re-checked against the same
// predicate it was selected with, so a job that starts committing between the
// select and the delete is never touched.
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const runId = await startLifecycleJobRun(admin, 'note_import_purge');
  const cutoff = new Date(
    Date.now() - IMPORT_PREVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: due, error } = await admin
    .from('note_import_jobs')
    .select('id')
    .eq('status', 'preview')
    .lt('created_at', cutoff)
    .order('created_at')
    .limit(100);
  if (error) {
    await finishLifecycleJobRun(admin, runId, {
      status: 'failed',
      processed: 0,
      succeeded: 0,
      failed: 0,
      errorCode: 'queue_unavailable',
    });
    return NextResponse.json({ error: 'Import purge queue unavailable.' }, { status: 503 });
  }

  let purged = 0;
  let failed = 0;
  for (const job of due ?? []) {
    // note_import_items carries `foreign key (job_id, workspace_id)
    // references note_import_jobs(id, workspace_id) on delete cascade`, so
    // deleting the job releases its staged items in the same statement.
    const { error: deleteError } = await admin
      .from('note_import_jobs')
      .delete()
      .eq('id', job.id)
      .eq('status', 'preview')
      .lt('created_at', cutoff);
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
