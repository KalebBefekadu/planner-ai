'use server';

import type { GoalType } from '@/lib/planner/horizon-labels';
import { selectAll } from '@/lib/supabase/select-all';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { ancestorDepth, indexActions, nearestMonthlyAncestor } from '@/lib/planner/nesting';
import { revalidatePlannerAndRecords, revalidatePlannerViews } from '@/lib/planner-revalidation';
import { periodBounds, type HorizonKind, type PeriodBounds } from '@/lib/planning-period';
import { dateInTimezone } from '@/lib/date';
import { executeOperation } from '@/lib/operations';
import { requireAuthenticatedUser as requireUser } from '@/lib/supabase/authenticated-context';
import type { GoalStatus } from '@/types/supabase';
import { getActiveVision, type VisionView } from '@/app/vision/actions';

export type { GoalType };
export type GoalView = {
  id: string;
  content: string;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  description?: string | null;
  due_on?: string | null;
  target_value?: number | null;
  current_value?: number | null;
  unit?: string | null;
  scheduled_on?: string | null;
  parent_action_id?: string | null;
  /** How many Actions this one sits under. Zero for a root. */
  depth?: number;
  vision_id?: string;
  /**
   * 'initiative' is a standing concern that never finishes -- a business, a
   * project. It carries no deadline and may hang under a yearly Goal.
   */
  kind?: 'outcome' | 'initiative';
  definition_of_done?: string | null;
  yearly_id?: string;
  quarterly_id?: string;
  monthly_id?: string;
  /** Bounds of the Planning Horizon this item belongs to, when it has one. */
  horizon_starts_on?: string | null;
  horizon_ends_on?: string | null;
};
export type GoalsData = {
  vision: VisionView;
  yearly: GoalView[];
  quarterly: GoalView[];
  monthly: GoalView[];
  weekly: GoalView[];
  /** The periods the person is actually in, in their own timezone. */
  currentPeriods: Record<HorizonKind, PeriodBounds>;
  localDate: string;
  weekStartsOn: number;
  /** Whether a breakdown can be offered. An initiative works without one. */
  aiEnabled?: boolean;
};
type GoalInput = {
  type: GoalType;
  parentId: string;
  content: string;
  /**
   * A yearly item may be a standing concern rather than an outcome -- a
   * business, a project, the thing a weekly folder is named after. It never
   * finishes, so it carries no deadline and is never asked whether it was
   * achieved. Only meaningful for 'yearly'.
   */
  kind?: 'outcome' | 'initiative';
};
type CanonicalGoal = {
  id: string;
  vision_id: string;
  parent_goal_id: string | null;
  title: string;
  description_markdown: string | null;
  status: 'draft' | 'active' | 'paused' | 'achieved' | 'abandoned';
  version: number;
  target_value: number | null;
  current_value: number | null;
  unit: string | null;
  due_on: string | null;
  kind: 'outcome' | 'initiative';
  definition_of_done: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  starts_on: string | null;
  planning_horizons: {
    kind: 'year' | 'quarter';
    starts_on: string | null;
    ends_on: string | null;
  } | null;
};
type CanonicalAction = {
  id: string;
  goal_id: string | null;
  parent_action_id: string | null;
  title: string;
  description_markdown: string | null;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'dropped';
  version: number;
  scheduled_on: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  planning_horizons: { kind: 'month' | 'week'; starts_on: string | null; ends_on: string | null };
};

const canonicalEnabled = process.env.PLANNER_DATA_MODEL === 'canonical';

function validateContent(content: string, maxLength = 1_000) {
  const trimmed = content.trim();
  if (trimmed.length < 3) throw new Error('Please write at least three characters.');
  if (trimmed.length > maxLength)
    throw new Error(`Keep this item under ${maxLength.toLocaleString()} characters.`);
  return trimmed;
}

async function requireWorkspaceId() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id,timezone,week_starts_on,ai_enabled')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load your workspace.');
  return {
    supabase,
    user,
    workspaceId: data.id as string,
    timezone: data.timezone as string,
    weekStartsOn: Number(data.week_starts_on),
    aiEnabled: Boolean(data.ai_enabled),
  };
}

function revalidatePlanner() {
  revalidatePlannerViews();
}

function toGoalStatus(status: CanonicalGoal['status'] | CanonicalAction['status']): GoalStatus {
  if (status === 'achieved' || status === 'done') return 'completed';
  if (status === 'active' || status === 'in_progress' || status === 'blocked') return 'in_progress';
  return 'pending';
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeFor(
  type: 'yearly',
  now?: Date
): { horizonKind: 'year'; startsOn: string; endsOn: string };
function rangeFor(
  type: 'quarterly',
  now?: Date
): { horizonKind: 'quarter'; startsOn: string; endsOn: string };
function rangeFor(
  type: 'monthly',
  now?: Date
): { horizonKind: 'month'; startsOn: string; endsOn: string };
function rangeFor(
  type: 'weekly',
  now?: Date
): { horizonKind: 'week'; startsOn: string; endsOn: string };
function rangeFor(type: GoalType, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (type === 'yearly') {
    return { horizonKind: 'year' as const, startsOn: `${year}-01-01`, endsOn: `${year}-12-31` };
  }
  if (type === 'quarterly') {
    const startMonth = Math.floor(month / 3) * 3;
    return {
      horizonKind: 'quarter' as const,
      startsOn: dateOnly(new Date(Date.UTC(year, startMonth, 1))),
      endsOn: dateOnly(new Date(Date.UTC(year, startMonth + 3, 0))),
    };
  }
  if (type === 'monthly') {
    return {
      horizonKind: 'month' as const,
      startsOn: dateOnly(new Date(Date.UTC(year, month, 1))),
      endsOn: dateOnly(new Date(Date.UTC(year, month + 1, 0))),
    };
  }
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const starts = new Date(Date.UTC(year, month, now.getUTCDate() + mondayOffset));
  const ends = new Date(starts);
  ends.setUTCDate(starts.getUTCDate() + 6);
  return { horizonKind: 'week' as const, startsOn: dateOnly(starts), endsOn: dateOnly(ends) };
}

export async function getGoalsHierarchy(): Promise<GoalsData | null> {
  const vision = await getActiveVision();
  if (!vision) return null;

  if (canonicalEnabled) {
    const { supabase, workspaceId, timezone, weekStartsOn, aiEnabled } = await requireWorkspaceId();
    /* Paged: PostgREST caps a response at max_rows without saying so, and a
       plan that has accumulated for a few years passes a thousand rows without
       being remarkable. Truncated, the screen would show part of the plan as
       though it were all of it -- and unlike a list, a hierarchy with missing
       parents silently drops their children too. The id tiebreaks created_at,
       which is not unique. */
    const [goalsResult, actionsResult] = await Promise.all([
      selectAll((from, to) =>
        supabase
          .from('goals')
          /* Left, not inner. A Goal created with its own dates has no horizon,
             and an inner join dropped it from the plan silently -- the one
             failure a hierarchy cannot show, because a missing parent takes
             its children with it. */
          .select('*, planning_horizons(kind,starts_on,ends_on)')
          .eq('workspace_id', workspaceId)
          .is('archived_at', null)
          .is('trashed_at', null)
          .order('created_at')
          .order('id')
          .range(from, to)
      ),
      selectAll((from, to) =>
        supabase
          .from('actions')
          .select('*, planning_horizons!inner(kind,starts_on,ends_on)')
          .eq('workspace_id', workspaceId)
          .is('archived_at', null)
          .is('trashed_at', null)
          .order('created_at')
          .order('id')
          .range(from, to)
      ),
    ]);
    if (goalsResult.error || actionsResult.error) throw new Error('Unable to load your plan.');
    const localDate = dateInTimezone(timezone);
    const goals = (goalsResult.data ?? []) as unknown as CanonicalGoal[];
    const actions = (actionsResult.data ?? []) as unknown as CanonicalAction[];
    const mapGoal = (goal: CanonicalGoal): GoalView => ({
      id: goal.id,
      content: goal.title,
      status: toGoalStatus(goal.status),
      version: goal.version,
      description: goal.description_markdown,
      due_on: goal.due_on,
      target_value: goal.target_value === null ? null : Number(goal.target_value),
      current_value: goal.current_value === null ? null : Number(goal.current_value),
      unit: goal.unit,
      vision_id: goal.vision_id,
      kind: goal.kind ?? 'outcome',
      definition_of_done: goal.definition_of_done ?? null,
      yearly_id: goal.parent_goal_id ?? undefined,
      created_at: goal.created_at,
      updated_at: goal.updated_at,
      deleted_at: goal.archived_at,
      /* The Goal's own dates first, and the horizon it was filed under only
         when it has none. Both mean the same thing to the reader: when this
         runs. */
      horizon_starts_on: goal.starts_on ?? goal.planning_horizons?.starts_on ?? null,
      horizon_ends_on: goal.due_on ?? goal.planning_horizons?.ends_on ?? null,
    });
    // parent_action_id now means "sits under", at any depth, so the monthly
    // rollup has to be walked to rather than read off the column. Reading it
    // directly reported a sibling task as the month the moment a weekly Action
    // had a weekly parent.
    const actionIndex = indexActions(
      actions.map((action) => ({
        id: action.id,
        parentActionId: action.parent_action_id,
        horizonKind: action.planning_horizons.kind,
      }))
    );
    const mapAction = (action: CanonicalAction): GoalView => ({
      id: action.id,
      content: action.title,
      status: toGoalStatus(action.status),
      version: action.version,
      description: action.description_markdown,
      scheduled_on: action.scheduled_on,
      parent_action_id: action.parent_action_id,
      quarterly_id: action.goal_id ?? undefined,
      monthly_id: nearestMonthlyAncestor(action.id, actionIndex) ?? undefined,
      depth: ancestorDepth(action.id, actionIndex),
      created_at: action.created_at,
      updated_at: action.updated_at,
      deleted_at: action.archived_at,
      horizon_starts_on: action.planning_horizons.starts_on ?? null,
      horizon_ends_on: action.planning_horizons.ends_on ?? null,
    });
    return {
      vision,
      /* A Goal with no horizon has no horizon kind, and the planner's two
         levels are really "nothing above it" and "something above it". That
         is what the horizon kind always stood for, so a dated Goal is placed
         by its shape rather than dropped for lacking a column. */
      yearly: goals
        .filter((goal) =>
          goal.planning_horizons
            ? goal.planning_horizons.kind === 'year'
            : goal.parent_goal_id === null
        )
        .map(mapGoal),
      quarterly: goals
        .filter((goal) =>
          goal.planning_horizons
            ? goal.planning_horizons.kind === 'quarter'
            : goal.parent_goal_id !== null
        )
        .map(mapGoal),
      monthly: actions.filter((action) => action.planning_horizons.kind === 'month').map(mapAction),
      weekly: actions.filter((action) => action.planning_horizons.kind === 'week').map(mapAction),
      localDate,
      weekStartsOn,
      // Whether to offer a breakdown at all. An initiative has to be fully
      // usable with an empty list, so this hides an offer rather than a step.
      aiEnabled,
      currentPeriods: {
        year: periodBounds('year', localDate, weekStartsOn),
        quarter: periodBounds('quarter', localDate, weekStartsOn),
        month: periodBounds('month', localDate, weekStartsOn),
        week: periodBounds('week', localDate, weekStartsOn),
      },
    };
  }

  const { supabase, user } = await requireUser();
  const [yearly, quarterly, monthly, weekly] = await Promise.all([
    supabase
      .from('yearly_goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('vision_id', vision.id)
      .is('deleted_at', null)
      .order('created_at'),
    supabase
      .from('quarterly_goals')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at'),
    supabase
      .from('monthly_tasks')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at'),
    supabase
      .from('weekly_actions')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at'),
  ]);
  if (yearly.error || quarterly.error || monthly.error || weekly.error)
    throw new Error('Unable to load your plan.');
  const withVersion = (items: readonly Record<string, unknown>[]) =>
    items.map((item) => ({ ...item, version: 1 })) as GoalView[];
  // The legacy model has no Planning Horizons to bound, so every item reads as
  // outside the current period and the planner falls back to showing all of
  // it. That is the honest answer for data that never recorded a period.
  const legacyDate = new Date().toISOString().slice(0, 10);
  return {
    vision,
    yearly: withVersion(yearly.data),
    quarterly: withVersion(quarterly.data),
    monthly: withVersion(monthly.data),
    weekly: withVersion(weekly.data),
    localDate: legacyDate,
    weekStartsOn: 1,
    currentPeriods: {
      year: periodBounds('year', legacyDate),
      quarter: periodBounds('quarter', legacyDate),
      month: periodBounds('month', legacyDate),
      week: periodBounds('week', legacyDate),
    },
  };
}

export async function createGoal(input: GoalInput) {
  const content = validateContent(input.content);
  if (canonicalEnabled) {
    const { supabase, user } = await requireUser();
    if (input.type === 'yearly' || input.type === 'quarterly') {
      const range: {
        horizonKind: 'year' | 'quarter';
        startsOn: string;
        endsOn: string;
      } = input.type === 'yearly' ? rangeFor('yearly') : rangeFor('quarterly');
      await executeOperation(
        supabase,
        'goal.create.v1',
        {
          title: content,
          ...range,
          parentGoalId: input.type === 'quarterly' ? input.parentId : null,
          ...(input.type === 'yearly' && input.kind === 'initiative'
            ? { kind: 'initiative' as const }
            : {}),
        },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
    } else {
      const range: {
        horizonKind: 'month' | 'week';
        startsOn: string;
        endsOn: string;
      } = input.type === 'monthly' ? rangeFor('monthly') : rangeFor('weekly');
      let goalId = input.parentId;
      if (input.type === 'weekly') {
        const { data } = await supabase
          .from('actions')
          .select('goal_id')
          .eq('id', input.parentId)
          .eq(
            'workspace_id',
            (await supabase.from('workspaces').select('id').eq('owner_user_id', user.id).single())
              .data?.id
          )
          .is('trashed_at', null)
          .maybeSingle();
        if (!data?.goal_id) throw new Error('The selected monthly Action no longer exists.');
        goalId = data.goal_id as string;
      }
      await executeOperation(
        supabase,
        'action.create.v1',
        {
          title: content,
          ...range,
          goalId,
          parentActionId: input.type === 'weekly' ? input.parentId : null,
          scheduledOn: range.startsOn,
        },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
    }
    revalidatePlanner();
    return;
  }

  const { supabase, user } = await requireUser();
  if (input.type === 'yearly') {
    const { data: parent } = await supabase
      .from('visions')
      .select('id')
      .eq('id', input.parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!parent) throw new Error('The selected vision no longer exists.');
    const { error } = await supabase
      .from('yearly_goals')
      .insert({ user_id: user.id, vision_id: parent.id, content });
    if (error) throw new Error('Unable to create the yearly goal.');
  } else if (input.type === 'quarterly') {
    const { data: parent } = await supabase
      .from('yearly_goals')
      .select('id')
      .eq('id', input.parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!parent) throw new Error('The selected yearly goal no longer exists.');
    const { error } = await supabase
      .from('quarterly_goals')
      .insert({ user_id: user.id, yearly_id: parent.id, content });
    if (error) throw new Error('Unable to create the quarterly goal.');
  } else if (input.type === 'monthly') {
    const { data: parent } = await supabase
      .from('quarterly_goals')
      .select('id')
      .eq('id', input.parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!parent) throw new Error('The selected quarterly goal no longer exists.');
    const { error } = await supabase
      .from('monthly_tasks')
      .insert({ user_id: user.id, quarterly_id: parent.id, content });
    if (error) throw new Error('Unable to create the monthly action.');
  } else {
    const { data: parent } = await supabase
      .from('monthly_tasks')
      .select('id')
      .eq('id', input.parentId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!parent) throw new Error('The selected monthly action no longer exists.');
    const { error } = await supabase
      .from('weekly_actions')
      .insert({ user_id: user.id, monthly_id: parent.id, content });
    if (error) throw new Error('Unable to create the weekly action.');
  }
  revalidatePlanner();
}

export async function updateGoalStatus(
  type: GoalType,
  id: string,
  status: GoalStatus,
  expectedVersion = 1
) {
  const { supabase, user } = await requireUser();
  if (canonicalEnabled) {
    if (type === 'yearly' || type === 'quarterly') {
      await executeOperation(
        supabase,
        'goal.status.v1',
        {
          id,
          expectedVersion,
          status:
            status === 'completed' ? 'achieved' : status === 'in_progress' ? 'active' : 'draft',
        },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
    } else {
      await executeOperation(
        supabase,
        'action.status.v1',
        {
          id,
          expectedVersion,
          status:
            status === 'completed' ? 'done' : status === 'in_progress' ? 'in_progress' : 'open',
        },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
    }
  } else {
    const table =
      type === 'yearly'
        ? 'yearly_goals'
        : type === 'quarterly'
          ? 'quarterly_goals'
          : type === 'monthly'
            ? 'monthly_tasks'
            : 'weekly_actions';
    const { error } = await supabase
      .from(table)
      .update({ status })
      .eq('id', id)
      .eq('user_id', user.id)
      .is('deleted_at', null);
    if (error) throw new Error('Unable to update this item.');
  }
  revalidatePlanner();
}

export async function updatePlanGoal(input: {
  id: string;
  expectedVersion: number;
  title: string;
  descriptionMarkdown: string | null;
  parentGoalId: string | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  dueOn: string | null;
  definitionOfDone?: string;
}) {
  if (!canonicalEnabled) throw new Error('Goal editing requires the canonical data model.');
  const { supabase } = await requireUser();
  const result = await executeOperation(supabase, 'goal.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePlanner();
  revalidatePath('/activity');
  return result;
}

export async function updatePlanAction(input: {
  id: string;
  expectedVersion: number;
  title: string;
  descriptionMarkdown: string | null;
  scheduledOn: string | null;
  /** Omitted leaves the deadline alone; null clears it. */
  dueOn?: string | null;
}) {
  if (!canonicalEnabled) throw new Error('Action editing requires the canonical data model.');
  const { supabase } = await requireUser();
  const result = await executeOperation(supabase, 'action.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePlannerAndRecords();
  return result;
}

export async function movePlanAction(input: {
  type: 'monthly' | 'weekly';
  id: string;
  expectedVersion: number;
  /** Null moves a weekly Action back to the top level, which is where Today puts it. */
  targetParentId: string | null;
}) {
  if (!canonicalEnabled) throw new Error('Action moving requires the canonical data model.');
  const { supabase, user } = await requireUser();
  const range = input.type === 'monthly' ? rangeFor('monthly') : rangeFor('weekly');
  let goalId: string | null = input.targetParentId;
  let parentActionId: string | null = null;
  if (input.type === 'weekly') {
    const workspace = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    // A child inherits its parent's Goal, including not having one. Outdenting
    // to the top has no parent to inherit from, so the Action keeps its own.
    const source = await supabase
      .from('actions')
      .select('goal_id')
      .eq('id', input.targetParentId ?? input.id)
      .eq('workspace_id', workspace.data?.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .maybeSingle();
    if (!source.data) throw new Error('The destination Action is unavailable.');
    goalId = (source.data.goal_id as string | null) ?? null;
    parentActionId = input.targetParentId;
  }
  const result = await executeOperation(
    supabase,
    'action.move.v1',
    {
      id: input.id,
      expectedVersion: input.expectedVersion,
      goalId,
      parentActionId,
      ...range,
      scheduledOn: range.startsOn,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlannerAndRecords();
  return result;
}

export async function archiveGoal(type: GoalType, id: string, expectedVersion = 1) {
  const { supabase, user } = await requireUser();
  if (canonicalEnabled) {
    const operation =
      type === 'yearly' || type === 'quarterly' ? 'goal.archive.v1' : 'action.archive.v1';
    await executeOperation(
      supabase,
      operation,
      { id, expectedVersion },
      {
        idempotencyKey: randomUUID(),
        surface: 'ui',
      }
    );
    revalidatePlanner();
    return;
  }

  const archivedAt = new Date().toISOString();
  const table =
    type === 'yearly'
      ? 'yearly_goals'
      : type === 'quarterly'
        ? 'quarterly_goals'
        : type === 'monthly'
          ? 'monthly_tasks'
          : 'weekly_actions';
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: archivedAt })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw new Error('Unable to archive this item.');
  revalidatePlanner();
}
