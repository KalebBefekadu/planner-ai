'use server';

import { randomUUID } from 'node:crypto';
import { executeOperation } from '@/lib/operations';
import { revalidatePlannerViews } from '@/lib/planner-revalidation';
import {
  requireAuthenticatedUser,
  requireOwnedWorkspaceId,
} from '@/lib/supabase/authenticated-context';

export type VisionView = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
};

const canonicalEnabled = process.env.PLANNER_DATA_MODEL === 'canonical';

function validateVision(content: string) {
  const trimmed = content.trim();
  if (trimmed.length < 3) throw new Error('Please write at least three characters.');
  if (trimmed.length > 50_000) throw new Error('Keep this item under 50,000 characters.');
  return trimmed;
}

export async function getActiveVision(): Promise<VisionView | null> {
  if (canonicalEnabled) {
    const { supabase, workspaceId } = await requireOwnedWorkspaceId();
    const { data, error } = await supabase
      .from('visions')
      .select('*')
      /* The overall life Vision, which is the one with no area. Areas hold
         their own now, and without this the screen asks for one row and gets
         as many as the person has written. */
      .is('area_id', null)
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null)
      .maybeSingle();
    if (error) throw new Error('Unable to load your vision.');
    if (!data) return null;
    return {
      id: data.id as string,
      content: data.body_markdown as string,
      created_at: data.created_at as string,
      updated_at: data.updated_at as string,
      deleted_at: null,
      version: Number(data.version),
    };
  }

  const { supabase, user } = await requireAuthenticatedUser();
  const { data, error } = await supabase
    .from('visions')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Unable to load your vision.');
  return data ? ({ ...data, version: 1 } as VisionView) : null;
}

export async function saveVision(content: string) {
  const bodyMarkdown = validateVision(content);
  if (canonicalEnabled) {
    const { supabase } = await requireAuthenticatedUser();
    await executeOperation(
      supabase,
      'vision.upsert.v1',
      { bodyMarkdown },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
  } else {
    const { supabase, user } = await requireAuthenticatedUser();
    const currentVision = await getActiveVision();
    const query = currentVision
      ? supabase
          .from('visions')
          .update({ content: bodyMarkdown })
          .eq('id', currentVision.id)
          .eq('user_id', user.id)
      : supabase.from('visions').insert({ user_id: user.id, content: bodyMarkdown });
    const { error } = await query;
    if (error) throw new Error('Unable to save your vision.');
  }
  revalidatePlannerViews();
}
