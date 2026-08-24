'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type AccountDeletionRequest = {
  id: string;
  status: 'scheduled' | 'processing';
  scheduledFor: string;
};

export async function getPendingAccountDeletion(): Promise<AccountDeletionRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('id,status,scheduled_for')
    .in('status', ['scheduled', 'processing'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Unable to load account deletion status.');
  return data
    ? {
        id: data.id as string,
        status: data.status as AccountDeletionRequest['status'],
        scheduledFor: data.scheduled_for as string,
      }
    : null;
}

export async function scheduleAccountDeletion(confirmation: string) {
  const supabase = await createClient();
  const result = await executeOperation(
    supabase,
    'account.deletion.schedule.v1',
    { confirmation: confirmation as 'DELETE MY ACCOUNT' },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/settings/data');
  revalidatePath('/settings/mcp');
  revalidatePath('/activity');
  return result;
}

export async function cancelAccountDeletion(requestId: string) {
  const supabase = await createClient();
  const result = await executeOperation(
    supabase,
    'account.deletion.cancel.v1',
    { requestId },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/settings/data');
  revalidatePath('/activity');
  return result;
}
