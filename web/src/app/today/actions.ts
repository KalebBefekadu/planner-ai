'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import type { CoachingIntensity } from '@/lib/coaching';
import { dateInTimezone } from '@/lib/date';
import { executeOperation, operationFailureMessage } from '@/lib/operations';
import {
  nextFocusIds,
  planTodayAction,
  TodayComposerInputError,
  type TodayComposerInput,
  type TodayFocusOutcome,
} from '@/lib/today-composer';
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

export type TodayGoalOption = {
  id: string;
  title: string;
};

export type TodayData = {
  localDate: string;
  timezone: string;
  /** 0 = Sunday. A stored workspace preference, not an assumption. */
  weekStartsOn: number;
  coachingIntensity: CoachingIntensity;
  focusActionIds: string[];
  actions: TodayAction[];
  goals: TodayGoalOption[];
  recentCaptures: Array<{ id: string; rawText: string; createdAt: string }>;
  /** The Notes touched most recently, so the day can start where it stopped. */
  recentNotes: Array<{ id: string; title: string; updatedAt: string }>;
};

export type CreateTodayActionResult = {
  action: TodayAction;
  localDate: string;
  focusActionIds: string[];
  focusOutcome: TodayFocusOutcome;
  focusFailureMessage: string | null;
};

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Today execution requires the canonical data model.');
  }
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
    .select('id,timezone,week_starts_on,coaching_intensity')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !workspace) throw new Error('Unable to load your Workspace.');
  return {
    supabase,
    workspaceId: workspace.id as string,
    timezone: workspace.timezone as string,
    weekStartsOn: Number(workspace.week_starts_on),
    coachingIntensity: workspace.coaching_intensity as CoachingIntensity,
  };
}

async function readFocusIds(
  supabase: Awaited<ReturnType<typeof todayClient>>['supabase'],
  workspaceId: string,
  focusOn: string
) {
  const { data, error } = await supabase
    .from('daily_focus_items')
    .select('action_id,sort_order')
    .eq('workspace_id', workspaceId)
    .eq('focus_on', focusOn)
    .order('sort_order');
  if (error) throw new Error('Unable to load today\u2019s focus.');
  return (data ?? []).map((row) => row.action_id as string);
}

export async function getTodayData(): Promise<TodayData> {
  const { supabase, workspaceId, timezone, weekStartsOn, coachingIntensity } = await todayClient();
  const localDate = dateInTimezone(timezone);
  const [actionsResult, focusResult, goalsResult, capturesResult, recentNotesResult] =
    await Promise.all([
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
        .from('goals')
        .select('id,title')
        .eq('workspace_id', workspaceId)
        .in('status', ['draft', 'active', 'paused'])
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('title')
        .limit(200),
      supabase
        .from('captures')
        .select('id,raw_text,created_at')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
      /* Picking work back up is how a day usually starts, and the reference puts
       it on this screen. Four rows: enough to recognise where you were,
       few enough that it stays a shortcut rather than a second Notes tree. */
      supabase
        .from('notes')
        .select('id,title,updated_at')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('updated_at', { ascending: false })
        .limit(4),
    ]);
  if (
    actionsResult.error ||
    focusResult.error ||
    goalsResult.error ||
    capturesResult.error ||
    recentNotesResult.error
  ) {
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
    weekStartsOn,
    coachingIntensity,
    focusActionIds,
    actions,
    goals: (goalsResult.data ?? []).map((goal) => ({
      id: goal.id as string,
      title: goal.title as string,
    })),
    recentNotes: (recentNotesResult.data ?? []).map((note) => ({
      id: note.id as string,
      title: (note.title as string) || 'Untitled',
      updatedAt: note.updated_at as string,
    })),
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
  revalidatePlannerAndRecords();
  return result;
}

export async function completeTodayAction(id: string, expectedVersion: number) {
  return setTodayActionStatus(id, expectedVersion, 'done');
}

// Blocked is a decision about the work, not a way of hiding it: a blocked
// Action keeps its place in today's focus so the day still shows what was
// committed to and why it did not move.
export async function setTodayActionStatus(
  id: string,
  expectedVersion: number,
  status: 'open' | 'in_progress' | 'blocked' | 'done'
) {
  const { supabase } = await todayClient();
  const result = await executeOperation(
    supabase,
    'action.status.v1',
    { id, expectedVersion, status },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerAndRecords();
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
  revalidatePlannerAndRecords();
  return result;
}

// Create an Action from Today and, when it belongs to today, commit it to
// focus. The two are separate durable Operations, so this reports the focus
// result rather than failing the whole request: an Action that was saved must
// never look unsaved, and retrying focus must not create a second Action.
export async function createTodayAction(
  input: TodayComposerInput
): Promise<CreateTodayActionResult> {
  const { supabase, timezone } = await todayClient();
  const localDate = dateInTimezone(timezone);

  let plan;
  try {
    plan = planTodayAction(input, localDate);
  } catch (error) {
    if (error instanceof TodayComposerInputError) {
      throw new Error(error.message);
    }
    throw new Error('Check this Action and try again.');
  }

  // A replayed idempotency key returns the originally recorded Action, so a
  // double submission and a retry after a focus failure both resolve to the
  // same row.
  const created = await executeOperation(supabase, 'action.create.v1', plan.create, {
    idempotencyKey: plan.idempotencyKey,
    surface: 'ui',
  });

  let goalTitle: string | null = null;
  if (created.goal_id) {
    const { data: goal } = await supabase
      .from('goals')
      .select('title')
      .eq('id', created.goal_id)
      .maybeSingle();
    goalTitle = (goal?.title as string | undefined) ?? null;
  }

  const action: TodayAction = {
    id: created.id,
    title: created.title,
    descriptionMarkdown: created.description_markdown ?? null,
    status: created.status === 'open' ? 'open' : (created.status as TodayAction['status']),
    version: created.version,
    scheduledOn: created.scheduled_on ?? null,
    goalTitle,
  };

  const currentFocusIds = await readFocusIds(supabase, created.workspace_id, localDate);

  let focusOutcome: TodayFocusOutcome =
    plan.focusIntent === 'commit'
      ? 'committed'
      : plan.focusIntent === 'other-day'
        ? 'other-day'
        : 'not-requested';
  let focusFailureMessage: string | null = null;
  let focusActionIds = currentFocusIds;

  if (plan.focusIntent === 'commit') {
    const next = nextFocusIds(currentFocusIds, action.id);
    if (next === 'present') {
      focusOutcome = 'already-committed';
    } else if (next === 'full') {
      // The existing commitments stay exactly as they are; the new Action is
      // still saved and waiting in the open list.
      focusOutcome = 'full';
    } else {
      try {
        const result = await executeOperation(
          supabase,
          'daily-focus.set.v1',
          { focusOn: localDate, actionIds: next },
          { idempotencyKey: randomUUID(), surface: 'ui' }
        );
        focusActionIds = result.actionIds;
      } catch (caught) {
        focusOutcome = 'failed';
        focusFailureMessage =
          operationFailureMessage(caught) ?? 'Planner AI could not commit this Action to today.';
      }
    }
  }

  revalidatePlannerAndRecords();

  return { action, localDate, focusActionIds, focusOutcome, focusFailureMessage };
}

// Move an Action to another day. A commitment is about one specific day, so
// deferring work out of today also releases today's commitment to it --
// otherwise the focus list keeps claiming the day is spoken for by work that
// is no longer scheduled for it, which is exactly the stale commitment this
// view is supposed to make impossible.
export async function deferTodayAction(input: {
  id: string;
  expectedVersion: number;
  title: string;
  descriptionMarkdown: string | null;
  scheduledOn: string;
}): Promise<{
  id: string;
  title: string;
  descriptionMarkdown: string | null;
  scheduledOn: string | null;
  version: number;
  focusActionIds: string[];
  releasedFromFocus: boolean;
}> {
  const { supabase, workspaceId, timezone } = await todayClient();
  const localDate = dateInTimezone(timezone);

  const updated = await executeOperation(supabase, 'action.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });

  let focusActionIds = await readFocusIds(supabase, workspaceId, localDate);
  let releasedFromFocus = false;
  const stillToday = (updated.scheduled_on ?? null) === localDate;
  if (!stillToday && focusActionIds.includes(updated.id)) {
    const next = focusActionIds.filter((id) => id !== updated.id);
    const result = await executeOperation(
      supabase,
      'daily-focus.set.v1',
      { focusOn: localDate, actionIds: next },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    focusActionIds = result.actionIds;
    releasedFromFocus = true;
  }

  revalidatePlannerAndRecords();
  return {
    id: updated.id,
    title: updated.title,
    descriptionMarkdown: updated.description_markdown ?? null,
    scheduledOn: updated.scheduled_on ?? null,
    version: updated.version,
    focusActionIds,
    releasedFromFocus,
  };
}
