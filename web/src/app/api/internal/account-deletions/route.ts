import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/api/cron';
import { finishLifecycleJobRun, startLifecycleJobRun } from '@/lib/api/lifecycle-job';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Attempts are deliberately not capped.
 *
 * Every other job in this system gives up eventually, and for an email that is
 * right. This is not an email. A capped deletion stops retrying and leaves the
 * person's data in place, with the request sitting in a state nothing looks at
 * again -- a permanent silent failure, which is worse than an ongoing one.
 *
 * So it keeps trying, and the widening backoff levels off around seventeen
 * hours, which costs roughly one attempt a day. What changes at this threshold
 * is not the retrying but the reporting: the run itself finishes `failed` with
 * `deletion_stalled`, because `lifecycle_job_runs` is the visibility that
 * already exists and a red run is something a person can notice today, without
 * waiting for the alerting half of EH-06.
 *
 * Five attempts is roughly six hours of backoff, by which point the failure is
 * not transient. Whether a deletion should ever be abandoned is a decision
 * about what the product owes somebody, and the answer recorded here is no. */
const STALLED_AFTER_ATTEMPTS = 5;

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
  let stalled = 0;
  for (const claim of due ?? []) {
    // A second attempt means an earlier one did not finish. Counting them is
    // what makes a request that keeps stalling visible at all.
    if (claim.deletion_attempt_count > 1) reclaimed += 1;
    if (claim.deletion_attempt_count >= STALLED_AFTER_ATTEMPTS) stalled += 1;
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

  // A stalled deletion is reported ahead of an ordinary item failure, because
  // it is the more urgent thing: one failed attempt is weather, a request on
  // its fifth is a person still waiting to be deleted.
  const runErrorCode = stalled > 0 ? 'deletion_stalled' : failed > 0 ? 'item_failure' : undefined;
  await finishLifecycleJobRun(admin, runId, {
    status: runErrorCode ? 'failed' : 'succeeded',
    processed: due?.length ?? 0,
    succeeded: completed,
    failed,
    errorCode: runErrorCode,
  });

  return NextResponse.json(
    { processed: due?.length ?? 0, completed, reclaimed, stalled },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = POST;
