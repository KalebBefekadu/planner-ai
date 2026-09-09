import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.generated';

export type LifecycleJobName =
  | 'notification_delivery'
  | 'account_deletion'
  | 'note_attachment_purge'
  | 'note_import_purge';

type LifecycleJobOutcome = {
  status: 'succeeded' | 'failed';
  processed: number;
  succeeded: number;
  failed: number;
  errorCode?: string;
};

type AdminClient = SupabaseClient<Database>;

export async function startLifecycleJobRun(admin: AdminClient, jobName: LifecycleJobName) {
  const { data, error } = await admin
    .from('lifecycle_job_runs')
    .insert({ job_name: jobName })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    console.error('Could not record lifecycle job start.', { jobName });
    return null;
  }
  return data.id;
}

export async function finishLifecycleJobRun(
  admin: AdminClient,
  runId: string | null,
  outcome: LifecycleJobOutcome
) {
  if (!runId) return;
  const { error } = await admin
    .from('lifecycle_job_runs')
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      processed_count: outcome.processed,
      succeeded_count: outcome.succeeded,
      failed_count: outcome.failed,
      error_code: outcome.status === 'failed' ? (outcome.errorCode ?? 'worker_failed') : null,
    })
    .eq('id', runId)
    .eq('status', 'running');

  if (error) console.error('Could not record lifecycle job outcome.');
}
