'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type MemoryActionResult = { ok: boolean; error?: string };

export async function createMemoryAction(statement: string): Promise<MemoryActionResult> {
  const parsed = z.string().trim().min(1).max(2_000).safeParse(statement);
  if (!parsed.success) return { ok: false, error: 'Write between 1 and 2,000 characters.' };
  try {
    const supabase = await createClient();
    await executeOperation(
      supabase,
      'memory.create.v1',
      { statement: parsed.data, sourceType: 'user', sourceId: null },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    revalidatePath('/settings/memory');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Planner AI could not save this Memory.' };
  }
}

export async function updateMemoryAction(
  id: string,
  statement: string,
  expectedVersion: number
): Promise<MemoryActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      statement: z.string().trim().min(1).max(2_000),
      expectedVersion: z.int().positive(),
    })
    .safeParse({ id, statement, expectedVersion });
  if (!parsed.success) return { ok: false, error: 'This Memory is not valid.' };
  try {
    const supabase = await createClient();
    await executeOperation(supabase, 'memory.update.v1', parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    revalidatePath('/settings/memory');
    return { ok: true };
  } catch {
    return { ok: false, error: 'This Memory changed elsewhere. Refresh and try again.' };
  }
}

export async function trashMemoryAction(
  id: string,
  expectedVersion: number
): Promise<MemoryActionResult> {
  const parsed = z.object({ id: z.uuid(), expectedVersion: z.int().positive() }).safeParse({
    id,
    expectedVersion,
  });
  if (!parsed.success) return { ok: false, error: 'This Memory is not valid.' };
  try {
    const supabase = await createClient();
    await executeOperation(
      supabase,
      'trash.move.v1',
      { itemType: 'memory', ...parsed.data },
      {
        idempotencyKey: randomUUID(),
        surface: 'ui',
      }
    );
    revalidatePath('/settings/memory');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Planner AI could not move this Memory to Trash.' };
  }
}
