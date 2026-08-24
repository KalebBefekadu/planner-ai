'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export async function updateAiBudget(softBudgetCents: number) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('AI usage controls require the canonical data model.');
  }
  const supabase = await createClient();
  const result = await executeOperation(
    supabase,
    'workspace.ai-budget.v1',
    { softBudgetCents },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/settings/ai');
  revalidatePath('/activity');
  return result;
}
