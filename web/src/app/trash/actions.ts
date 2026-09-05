'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type TrashActionResult = { ok: boolean; error?: string };

export async function restoreTrashBatchAction(batchId: string): Promise<TrashActionResult> {
  const parsed = z.uuid().safeParse(batchId);
  if (!parsed.success) return { ok: false, error: 'This Trash item is not valid.' };
  try {
    const supabase = await createClient();
    await executeOperation(
      supabase,
      'trash.restore.v1',
      { batchId: parsed.data },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    revalidatePath('/trash');
    revalidatePath('/');
    revalidatePath('/notes');
    revalidatePath('/planner');
    revalidatePath('/settings/memory');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Planner AI could not restore this batch.' };
  }
}

export async function emptyEligibleTrashAction(confirmation: string): Promise<TrashActionResult> {
  if (confirmation !== 'EMPTY TRASH') return { ok: false, error: 'Enter the exact confirmation.' };
  try {
    const supabase = await createClient();
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.data?.currentLevel !== 'aal2') {
      return { ok: false, error: 'Verify this session in Security first.' };
    }
    await executeOperation(
      supabase,
      'trash.empty.v1',
      { retentionDays: 30, confirmation: 'EMPTY TRASH' },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    revalidatePath('/trash');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Eligible Trash could not be permanently deleted.' };
  }
}
