'use server';

import { randomUUID } from 'node:crypto';
import { executeOperation } from '@/lib/operations';
import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { requireOwnedWorkspaceId } from '@/lib/supabase/authenticated-context';
import { dateInTimezone } from '@/lib/date';
import { areaScopeIds, type AreaRow } from '@/lib/areas/tree';
import { quietGoals, type QuietGoal } from '@/lib/planner/quiet-goals';
import {
  goalPeriodGroups,
  periodContaining,
  shiftPeriod,
  type GoalRecord,
  type Period,
  type PeriodKind,
  type PeriodGroups,
} from '@/lib/planning/goal-periods';

export type GoalAreaOption = { id: string; name: string };

export type GoalsView = {
  today: string;
  period: Period;
  previous: Period;
  next: Period;
  groups: PeriodGroups;
  areas: GoalAreaOption[];
  areaId: string | null;
  /** Every Goal that could be a parent: the ones nothing else sits above. */
  parents: { id: string; title: string }[];
};

type GoalRow = {
  id: string;
  title: string;
  status: GoalRecord['status'];
  kind: GoalRecord['kind'] | null;
  parent_goal_id: string | null;
  primary_area_id: string | null;
  starts_on: string | null;
  due_on: string | null;
  version: number;
  planning_horizons: { starts_on: string; ends_on: string } | null;
};

export async function getGoalsView(
  kind: PeriodKind,
  anchor: string | null,
  areaId: string | null
): Promise<GoalsView> {
  const { supabase, workspaceId } = await requireOwnedWorkspaceId();
  const workspace = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspaceId)
    .single();
  if (workspace.error || !workspace.data) throw new Error('Unable to load your workspace.');
  const today = dateInTimezone(workspace.data.timezone as string);
  const period = periodContaining(kind, anchor ?? today);

  /* Left, not inner. A Goal that carries its own dates has no horizon, and an
     inner join here would have shown a plan with its newest work missing and
     no sign that anything was hidden. */
  const [goalsResult, areasResult] = await Promise.all([
    supabase
      .from('goals')
      .select(
        'id,title,status,kind,parent_goal_id,primary_area_id,starts_on,due_on,version,planning_horizons(starts_on,ends_on)'
      )
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('created_at')
      .limit(1000),
    supabase
      .from('life_areas')
      .select('id,name,parent_area_id')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .order('sort_key')
      .limit(1000),
  ]);
  if (goalsResult.error || areasResult.error) throw new Error('Unable to load your goals.');

  const rows = (goalsResult.data ?? []) as unknown as GoalRow[];
  const goals: GoalRecord[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    kind: row.kind ?? 'outcome',
    parentGoalId: row.parent_goal_id,
    primaryAreaId: row.primary_area_id,
    version: Number(row.version),
    startsOn: row.starts_on,
    dueOn: row.due_on,
    horizonStartsOn: row.planning_horizons?.starts_on ?? null,
    horizonEndsOn: row.planning_horizons?.ends_on ?? null,
  }));

  const areaRows = (areasResult.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    parentAreaId: (row.parent_area_id as string | null) ?? null,
  }));
  const areas = areaRows.map((row) => ({ id: row.id, name: row.name }));
  /* Descendant scope, so choosing Health shows the work filed under Movement
     as well -- an area with nothing directly in it and three busy subareas is
     not an empty view. */
  const areaScope = areaId
    ? new Set(areaScopeIds(areaRows as unknown as AreaRow[], areaId, 'descendants'))
    : undefined;

  return {
    today,
    period,
    previous: shiftPeriod(period, -1),
    next: shiftPeriod(period, 1),
    groups: goalPeriodGroups(goals, period, areaScope ? { areaScope } : {}),
    areas,
    areaId,
    parents: goals
      .filter((goal) => goal.parentGoalId === null && goal.kind === 'outcome')
      .map((goal) => ({ id: goal.id, title: goal.title })),
  };
}

/**
 * Which goals have had no recorded work lately.
 *
 * Asked for, never volunteered: the page does not open with a list of things
 * you have not done. Read on demand, computed from dates and counts rather
 * than from a model, and phrased at the call site as an observation about what
 * has been written down.
 */
export async function getQuietGoals(): Promise<{ today: string; goals: QuietGoal[] }> {
  const { supabase, workspaceId } = await requireOwnedWorkspaceId();
  const workspace = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspaceId)
    .single();
  if (workspace.error || !workspace.data) throw new Error('Unable to load your workspace.');
  const today = dateInTimezone(workspace.data.timezone as string);

  const [goalsResult, workResult] = await Promise.all([
    supabase
      .from('goals')
      .select('id,title,status')
      .eq('workspace_id', workspaceId)
      .in('status', ['draft', 'active'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .limit(200),
    /* Bounded, and ordered so the newest rows are the ones that survive the
       limit: the question is when something last happened, so the oldest rows
       are the ones that can be dropped without changing the answer. */
    supabase
      .from('actions')
      .select('goal_id,updated_at,scheduled_on,completed_at')
      .eq('workspace_id', workspaceId)
      .not('goal_id', 'is', null)
      .is('trashed_at', null)
      .order('updated_at', { ascending: false })
      .limit(2_000),
  ]);
  if (goalsResult.error || workResult.error) throw new Error('Unable to read your goals.');

  const latest = new Map<string, string>();
  const upcoming = new Set<string>();
  for (const row of workResult.data ?? []) {
    const goalId = row.goal_id as string;
    const touched = [row.updated_at as string | null, row.completed_at as string | null]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    if (touched && (latest.get(goalId) ?? '') < touched) latest.set(goalId, touched);
    const scheduledOn = row.scheduled_on as string | null;
    if (scheduledOn && scheduledOn >= today) upcoming.add(goalId);
  }

  return {
    today,
    goals: quietGoals(
      (goalsResult.data ?? []).map((row) => ({
        id: row.id as string,
        title: row.title as string,
        status: row.status as string,
        lastActivityAt: latest.get(row.id as string) ?? null,
        hasUpcomingWork: upcoming.has(row.id as string),
      })),
      today
    ),
  };
}

export async function createGoal(input: {
  title: string;
  startsOn: string | null;
  targetOn: string | null;
  areaId: string | null;
  parentGoalId: string | null;
  kind: 'outcome' | 'initiative';
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const goal = await executeOperation(supabase, 'goal.create.v2', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePlannerAndRecords();
  return { id: goal.id, version: goal.version };
}

export async function scheduleGoal(input: {
  id: string;
  expectedVersion: number;
  startsOn: string | null;
  targetOn: string | null;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const goal = await executeOperation(supabase, 'goal.schedule.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePlannerAndRecords();
  return { version: goal.version };
}
