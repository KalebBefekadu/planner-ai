'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import type { CoachingIntensity } from '@/lib/coaching';
import { createClient } from '@/lib/supabase/server';

export type TodayAction = {
  id: string;
  title: string;
  descriptionMarkdown: string | null;
  status: 'open' | 'in_progress' | 'blocked';
  version: number;
  scheduledOn: string | null;
  goalTitle: string | null;
};

export type TodayData = {
  localDate: string;
  timezone: string;
  coachingIntensity: CoachingIntensity;
  focusActionIds: string[];
  actions: TodayAction[];
  recentCaptures: Array<{ id: string; rawText: string; createdAt: string }>;
};

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Today execution requires the canonical data model.');
  }
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function todayClient() {
  ensureCanonical();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id,timezone,coaching_intensity')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !workspace) throw new Error('Unable to load your Workspace.');
  return {
    supabase,
    workspaceId: workspace.id as string,
    timezone: workspace.timezone as string,
    coachingIntensity: workspace.coaching_intensity as CoachingIntensity,
  };
}

export async function getTodayData(): Promise<TodayData> {
  const { supabase, workspaceId, timezone, coachingIntensity } = await todayClient();
  const localDate = dateInTimezone(timezone);
  const [actionsResult, focusResult, capturesResult] = await Promise.all([
    supabase
      .from('actions')
      .select('id,title,description_markdown,status,version,scheduled_on,goals(title)')
      .eq('workspace_id', workspaceId)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on', { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from('daily_focus_items')
      .select('action_id,sort_order')
      .eq('workspace_id', workspaceId)
      .eq('focus_on', localDate)
      .order('sort_order'),
    supabase
      .from('captures')
      .select('id,raw_text,created_at')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);
  if (actionsResult.error || focusResult.error || capturesResult.error) {
    throw new Error('Unable to load Today.');
  }

  const focusActionIds = (focusResult.data ?? []).map((item) => item.action_id as string);
  const focusOrder = new Map(focusActionIds.map((id, index) => [id, index]));
  const actions = (actionsResult.data ?? []).map((action) => {
    const goal = action.goals as unknown as { title: string } | null;
    return {
      id: action.id as string,
      title: action.title as string,
      descriptionMarkdown: action.description_markdown as string | null,
      status: action.status as TodayAction['status'],
      version: Number(action.version),
      scheduledOn: action.scheduled_on as string | null,
      goalTitle: goal?.title ?? null,
    };
  });
  actions.sort((left, right) => {
    const leftFocus = focusOrder.get(left.id);
    const rightFocus = focusOrder.get(right.id);
    if (leftFocus !== undefined || rightFocus !== undefined) {
      if (leftFocus === undefined) return 1;
      if (rightFocus === undefined) return -1;
      return leftFocus - rightFocus;
    }
    if (left.scheduledOn && right.scheduledOn) {
      return left.scheduledOn.localeCompare(right.scheduledOn);
    }
    return left.scheduledOn ? -1 : right.scheduledOn ? 1 : left.title.localeCompare(right.title);
  });

  return {
    localDate,
    timezone,
    coachingIntensity,
    focusActionIds,
    actions,
    recentCaptures: (capturesResult.data ?? []).map((capture) => ({
      id: capture.id as string,
      rawText: capture.raw_text as string,
      createdAt: capture.created_at as string,
    })),
  };
}

export async function saveDailyFocus(focusOn: string, actionIds: string[]) {
  const { supabase } = await todayClient();
  const result = await executeOperation(
    supabase,
    'daily-focus.set.v1',
    { focusOn, actionIds },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/');
  revalidatePath('/activity');
  return result;
}

export async function completeTodayAction(id: string, expectedVersion: number) {
  const { supabase } = await todayClient();
  const result = await executeOperation(
    supabase,
    'action.status.v1',
    { id, expectedVersion, status: 'done' },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/');
  revalidatePath('/goals');
  revalidatePath('/review');
  revalidatePath('/activity');
  return result;
}

export async function editTodayAction(input: {
  id: string;
  expectedVersion: number;
  title: string;
  descriptionMarkdown: string | null;
  scheduledOn: string | null;
}) {
  const { supabase } = await todayClient();
  const result = await executeOperation(supabase, 'action.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/');
  revalidatePath('/goals');
  revalidatePath('/review');
  revalidatePath('/activity');
  return result;
}
