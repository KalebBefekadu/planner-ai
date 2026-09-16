import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { finishLifecycleJobRun, startLifecycleJobRun } from '@/lib/api/lifecycle-job';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }
  const admin = createAdminClient();
  const runId = await startLifecycleJobRun(admin, 'account_deletion');
  const { data: due, error } = await admin.rpc('claim_account_deletion_batch', { p_limit: 25 });
  if (error) {
    await finishLifecycleJobRun(admin, runId, {
      status: 'failed',
      processed: 0,
      succeeded: 0,
      failed: 0,
      errorCode: 'queue_unavailable',
    });
    return NextResponse.json({ error: 'Deletion queue unavailable.' }, { status: 503 });
  }

  let completed = 0;
  let failed = 0;
  let reclaimed = 0;
  for (const claim of due ?? []) {
    // A second attempt means an earlier one did not finish. Counting them is
    // what makes a request that keeps stalling visible at all.
    if (claim.deletion_attempt_count > 1) reclaimed += 1;
    try {
      const deletion = await admin.auth.admin.deleteUser(claim.deletion_user_id, false);
      if (deletion.error) throw new Error('auth_delete_failed');
      await admin.rpc('complete_account_deletion', { p_request_id: claim.deletion_request_id });
      completed += 1;
    } catch {
      // Hand the claim back with a widening backoff. Letting this throw out of
      // the loop instead would leave the request claimed until the visibility
      // timeout expires -- recoverable, but slower than saying so now.
      failed += 1;
      await admin.rpc('release_account_deletion', {
        p_request_id: claim.deletion_request_id,
        p_error_code: 'auth_delete_failed',
      });
    }
  }

  await finishLifecycleJobRun(admin, runId, {
    status: failed > 0 ? 'failed' : 'succeeded',
    processed: due?.length ?? 0,
    succeeded: completed,
    failed,
    errorCode: failed > 0 ? 'item_failure' : undefined,
  });

  return NextResponse.json(
    { processed: due?.length ?? 0, completed, reclaimed },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = POST;
