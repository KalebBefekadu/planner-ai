'use server';

import { randomUUID } from 'node:crypto';

import { dateInTimezone } from '@/lib/date';
import { executeOperation } from '@/lib/operations';
import { revalidatePlannerViews } from '@/lib/planner-revalidation';
import {
  requireAuthenticatedUser as requireUser,
  requireOwnedWorkspaceId as requireWorkspaceId,
} from '@/lib/supabase/authenticated-context';

export type ActionTemplateView = {
  id: string;
  goalId: string | null;
  title: string;
  descriptionMarkdown: string | null;
  cadence: 'weekly' | 'monthly';
  nextOccurrenceOn: string;
  status: 'active' | 'paused';
  /** Null is a dated routine. A number is a target counted over the period. */
  occurrencesPerPeriod: number | null;
  version: number;
};

const canonicalEnabled = process.env.PLANNER_DATA_MODEL === 'canonical';

function validateTitle(title: string, maxLength = 1_000) {
  const trimmed = title.trim();
  if (trimmed.length < 3) throw new Error('Please write at least three characters.');
  if (trimmed.length > maxLength)
    throw new Error(`Keep this item under ${maxLength.toLocaleString()} characters.`);
  return trimmed;
}

export async function getActionTemplates(): Promise<ActionTemplateView[] | null> {
  if (!canonicalEnabled) return null;
  const { supabase, workspaceId } = await requireWorkspaceId();
  const { data, error } = await supabase
    .from('action_templates')
    .select(
      'id,goal_id,title,description_markdown,cadence,next_occurrence_on,status,occurrences_per_period,version'
    )
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('next_occurrence_on')
    .order('created_at');
  if (error) throw new Error('Unable to load recurring Actions.');
  return (data ?? []).map((template) => ({
    id: template.id as string,
    goalId: (template.goal_id as string | null) ?? null,
    title: template.title as string,
    descriptionMarkdown: (template.description_markdown as string | null) ?? null,
    cadence: template.cadence as 'weekly' | 'monthly',
    nextOccurrenceOn: template.next_occurrence_on as string,
    status: template.status as 'active' | 'paused',
    occurrencesPerPeriod:
      template.occurrences_per_period === null ? null : Number(template.occurrences_per_period),
    version: Number(template.version),
  }));
}

export async function createActionTemplate(input: {
  title: string;
  descriptionMarkdown: string | null;
  goalId: string | null;
  cadence: 'weekly' | 'monthly';
  firstOccurrenceOn: string;
}) {
  const title = validateTitle(input.title);
  if (input.cadence === 'monthly' && Number(input.firstOccurrenceOn.slice(8, 10)) > 28) {
    throw new Error('Monthly templates must use day 1 through 28.');
  }
  const { supabase } = await requireUser();
  const result = await executeOperation(
    supabase,
    'action-template.create.v1',
    { ...input, title },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
  return result;
}

export async function updateActionTemplate(input: {
  id: string;
  expectedVersion: number;
  title: string;
  descriptionMarkdown: string | null;
  goalId: string | null;
  cadence: 'weekly' | 'monthly';
  nextOccurrenceOn: string;
}) {
  const title = validateTitle(input.title);
  if (input.cadence === 'monthly' && Number(input.nextOccurrenceOn.slice(8, 10)) > 28) {
    throw new Error('Monthly templates must use day 1 through 28.');
  }
  const { supabase } = await requireUser();
  const result = await executeOperation(
    supabase,
    'action-template.update.v1',
    { ...input, title },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
  return result;
}

export async function setActionTemplateStatus(
  id: string,
  expectedVersion: number,
  status: 'active' | 'paused'
) {
  const { supabase } = await requireUser();
  const result = await executeOperation(
    supabase,
    'action-template.status.v1',
    { id, expectedVersion, status },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
  return result;
}

export async function materializeActionTemplate(id: string, expectedVersion: number) {
  const { supabase, workspaceId } = await requireWorkspaceId();
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspaceId)
    .single();
  if (error || !workspace) throw new Error('Unable to load your Workspace time settings.');
  const result = await executeOperation(
    supabase,
    'action-template.materialize.v1',
    { id, expectedVersion, throughOn: dateInTimezone(workspace.timezone as string) },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
  return result;
}

/**
 * Turn a routine into a target, or back into a dated one.
 *
 * Changing the target shapes the periods counted after it. The sessions
 * already logged keep the slots they took, so last week still reports what
 * last week was.
 */
export async function setActionTemplateFrequency(
  id: string,
  expectedVersion: number,
  occurrencesPerPeriod: number | null
) {
  if (occurrencesPerPeriod !== null && (occurrencesPerPeriod < 1 || occurrencesPerPeriod > 28)) {
    throw new Error('Choose between 1 and 28 times per period.');
  }
  const { supabase } = await requireUser();
  const result = await executeOperation(
    supabase,
    'action-template.frequency.v1',
    { id, expectedVersion, occurrencesPerPeriod },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
  return result;
}

/** Record that a frequency routine happened, on the day it happened. */
export async function logRoutineOccurrence(id: string, on: string | null) {
  const { supabase, workspaceId } = await requireWorkspaceId();
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspaceId)
    .single();
  if (error || !workspace) throw new Error('Unable to load your Workspace time settings.');
  const day = on ?? dateInTimezone(workspace.timezone as string);
  const result = await executeOperation(
    supabase,
    'action-template.log-occurrence.v1',
    { id, on: day },
    {
      /* Stable per routine and day: a double-tap on a phone records one
         session, and the second request answers with the first one. */
      idempotencyKey: `routine-log:${id}:${day}`,
      surface: 'ui',
    }
  );
  revalidatePlannerViews();
  return result;
}

export async function archiveActionTemplate(id: string, expectedVersion: number) {
  const { supabase } = await requireUser();
  await executeOperation(
    supabase,
    'action-template.archive.v1',
    { id, expectedVersion },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerViews();
}
