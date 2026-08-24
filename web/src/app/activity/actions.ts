'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export async function undoOperation(receiptId: string) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Undo is unavailable before data migration.');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  const result = await executeOperation(
    supabase,
    'operation.undo.v1',
    { receiptId },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/', 'layout');
  revalidatePath('/activity');
  return result;
}
