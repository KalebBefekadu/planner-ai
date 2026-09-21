'use server';

import { randomUUID } from 'node:crypto';
import { executeOperation } from '@/lib/operations';
import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { requireOwnedWorkspaceId } from '@/lib/supabase/authenticated-context';
import { dateInTimezone } from '@/lib/date';
import {
  groupWeeklyItems,
  needsDecision,
  weekBounds,
  weeklyProgress,
  weekQuarterLabel,
  type WeeklyGrouping,
  type WeeklyItem,
  type WeekBounds,
} from '@/lib/planning/weekly-worksheet';

export type WeeklyPlanState = 'draft' | 'committed' | 'reviewed';

export type WeeklyCandidate = {
  actionId: string;
  title: string;
  scheduledOn: string | null;
  areaName: string | null;
};

export type WeeklyRoutine = {
  templateId: string;
  title: string;
  target: number;
  done: number;
  paused: boolean;
  /** True once every slot in this week is taken. */
  met: boolean;
};

export type WeeklyHistoryRow = {
  planId: string;
  startsOn: string;
  endsOn: string;
  quarter: string;
  state: WeeklyPlanState;
  baselineCount: number | null;
  completedCount: number | null;
  lateAdditionCount: number | null;
};

export type WeeklyWorksheet = {
  bounds: WeekBounds;
  quarter: string;
  today: string;
  weekStartsOn: number;
  grouping: WeeklyGrouping;
  planId: string | null;
  planVersion: number | null;
  state: WeeklyPlanState;
  intention: string | null;
  capacityHours: number | null;
  items: WeeklyItem[];
  groups: ReturnType<typeof groupWeeklyItems>;
  progress: ReturnType<typeof weeklyProgress>;
  openDecisions: WeeklyItem[];
  /** Work scheduled in this week that has not been put in the plan. */
  candidates: WeeklyCandidate[];
  /** Routines counted rather than scheduled, and how the week is going. */
  routines: WeeklyRoutine[];
  /** Present only once the week is closed. Null means "not closed yet". */
  record: {
    closedAt: string;
    baselineCount: number;
    completedCount: number;
    lateAdditionCount: number;
  } | null;
  history: WeeklyHistoryRow[];
};

async function weekContext() {
  const { supabase, workspaceId } = await requireOwnedWorkspaceId();
  const { data, error } = await supabase
    .from('workspaces')
    .select('timezone,week_starts_on')
    .eq('id', workspaceId)
    .single();
  if (error || !data) throw new Error('Unable to load your workspace.');
  return {
    supabase,
    workspaceId,
    timezone: data.timezone as string,
    weekStartsOn: Number(data.week_starts_on),
  };
}

export async function getWeeklyWorksheet(
  anyDateInWeek: string | null,
  grouping: WeeklyGrouping
): Promise<WeeklyWorksheet> {
  const { supabase, workspaceId, timezone, weekStartsOn } = await weekContext();
  const today = dateInTimezone(timezone);
  const bounds = weekBounds(anyDateInWeek ?? today, weekStartsOn);

  const [planResult, scheduledResult, historyResult, routineResult, sessionResult] =
    await Promise.all([
      supabase
        .from('weekly_plans')
        .select(
          'id,state,intention,capacity_hours,version,planning_horizons!inner(starts_on,ends_on)'
        )
        .eq('workspace_id', workspaceId)
        .eq('planning_horizons.starts_on', bounds.startsOn)
        .maybeSingle(),
      /* Work already scheduled in these seven days, so the worksheet can offer
       it rather than asking the person to retype what they already planned. */
      supabase
        .from('actions')
        .select('id,title,scheduled_on,primary_area_id,life_areas(name)')
        .eq('workspace_id', workspaceId)
        .gte('scheduled_on', bounds.startsOn)
        .lte('scheduled_on', bounds.endsOn)
        .in('status', ['open', 'in_progress', 'blocked'])
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('scheduled_on')
        .limit(200),
      supabase
        .from('weekly_plans')
        .select(
          'id,state,planning_horizons!inner(starts_on,ends_on),weekly_plan_snapshots(baseline_count,completed_count,late_addition_count)'
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(26),
      /* Weekly targets only. A monthly target is not a claim about this week,
       and showing one here would invite a person to answer for a period they
       are only part way through. */
      supabase
        .from('action_templates')
        .select('id,title,status,occurrences_per_period')
        .eq('workspace_id', workspaceId)
        .eq('cadence', 'weekly')
        .not('occurrences_per_period', 'is', null)
        .is('archived_at', null)
        .order('created_at')
        .limit(100),
      supabase
        .from('actions')
        .select('recurrence_template_id')
        .eq('workspace_id', workspaceId)
        .eq('occurrence_period_start', bounds.startsOn)
        .not('occurrence_slot', 'is', null)
        .is('trashed_at', null)
        .limit(1000),
    ]);
  if (
    planResult.error ||
    scheduledResult.error ||
    historyResult.error ||
    routineResult.error ||
    sessionResult.error
  ) {
    throw new Error('Unable to load this week.');
  }

  const sessionCounts = new Map<string, number>();
  for (const row of sessionResult.data ?? []) {
    const key = row.recurrence_template_id as string;
    sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1);
  }
  const routines: WeeklyRoutine[] = (routineResult.data ?? []).map((row) => {
    const target = Number(row.occurrences_per_period);
    const done = sessionCounts.get(row.id as string) ?? 0;
    return {
      templateId: row.id as string,
      title: row.title as string,
      target,
      done,
      paused: row.status !== 'active',
      met: done >= target,
    };
  });

  const plan = planResult.data;
  let items: WeeklyItem[] = [];
  let record: WeeklyWorksheet['record'] = null;

  if (plan) {
    const [itemsResult, snapshotResult] = await Promise.all([
      supabase
        .from('weekly_plan_items')
        .select(
          'action_id,in_baseline,disposition,sort_key,actions!inner(title,status,version,scheduled_on,completed_at,primary_area_id,life_areas(name))'
        )
        .eq('workspace_id', workspaceId)
        .eq('plan_id', plan.id as string)
        .order('sort_key')
        .limit(500),
      supabase
        .from('weekly_plan_snapshots')
        .select('closed_at,baseline_count,completed_count,late_addition_count')
        .eq('plan_id', plan.id as string)
        .maybeSingle(),
    ]);
    if (itemsResult.error || snapshotResult.error) throw new Error('Unable to load this week.');
    items = (itemsResult.data ?? []).map((row) => {
      const action = row.actions as unknown as {
        title: string;
        status: WeeklyItem['status'];
        version: number;
        scheduled_on: string | null;
        completed_at: string | null;
        primary_area_id: string | null;
        life_areas: { name: string } | null;
      };
      return {
        actionId: row.action_id as string,
        title: action.title,
        version: Number(action.version),
        status: action.status,
        scheduledOn: action.scheduled_on,
        completedAt: action.completed_at,
        areaId: action.primary_area_id,
        areaName: action.life_areas?.name ?? null,
        inBaseline: Boolean(row.in_baseline),
        disposition: (row.disposition as WeeklyItem['disposition']) ?? null,
      };
    });
    if (snapshotResult.data) {
      record = {
        closedAt: snapshotResult.data.closed_at as string,
        baselineCount: Number(snapshotResult.data.baseline_count),
        completedCount: Number(snapshotResult.data.completed_count),
        lateAdditionCount: Number(snapshotResult.data.late_addition_count),
      };
    }
  }

  const chosen = new Set(items.map((item) => item.actionId));
  const candidates = (scheduledResult.data ?? [])
    .filter((row) => !chosen.has(row.id as string))
    .map((row) => ({
      actionId: row.id as string,
      title: row.title as string,
      scheduledOn: (row.scheduled_on as string | null) ?? null,
      areaName: (row.life_areas as unknown as { name: string } | null)?.name ?? null,
    }));

  const history = (historyResult.data ?? []).map((row) => {
    const horizon = row.planning_horizons as unknown as { starts_on: string; ends_on: string };
    const snapshot = (
      Array.isArray(row.weekly_plan_snapshots)
        ? row.weekly_plan_snapshots[0]
        : row.weekly_plan_snapshots
    ) as { baseline_count: number; completed_count: number; late_addition_count: number } | null;
    const rowBounds = { startsOn: horizon.starts_on, endsOn: horizon.ends_on };
    return {
      planId: row.id as string,
      startsOn: horizon.starts_on,
      endsOn: horizon.ends_on,
      quarter: weekQuarterLabel(rowBounds),
      state: row.state as WeeklyPlanState,
      baselineCount: snapshot ? Number(snapshot.baseline_count) : null,
      completedCount: snapshot ? Number(snapshot.completed_count) : null,
      lateAdditionCount: snapshot ? Number(snapshot.late_addition_count) : null,
    };
  });
  history.sort((left, right) => right.startsOn.localeCompare(left.startsOn));

  return {
    bounds,
    quarter: weekQuarterLabel(bounds),
    today,
    weekStartsOn,
    grouping,
    planId: (plan?.id as string) ?? null,
    planVersion: plan ? Number(plan.version) : null,
    state: ((plan?.state as WeeklyPlanState) ?? 'draft') as WeeklyPlanState,
    intention: (plan?.intention as string | null) ?? null,
    capacityHours: plan?.capacity_hours == null ? null : Number(plan.capacity_hours),
    items,
    groups: groupWeeklyItems(items, bounds, grouping),
    progress: weeklyProgress(items, bounds),
    openDecisions: needsDecision(items, bounds),
    candidates,
    routines,
    record,
    history,
  };
}

/* `/planner/week` is in PLANNER_VIEW_PATHS, so the shared helper covers it.
   A hand-rolled call beside it is how the scoped aliases went missing before:
   it reads as complete and silently covers less. */
function revalidateWeek() {
  revalidatePlannerAndRecords();
}

export async function saveWeekIntention(input: {
  startsOn: string;
  endsOn: string;
  intention: string | null;
  capacityHours: number | null;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const plan = await executeOperation(supabase, 'week.plan.v1', input, {
    // Stable for the week, so opening the worksheet twice opens one plan.
    idempotencyKey: `week-plan:${input.startsOn}`,
    surface: 'ui',
  });
  revalidateWeek();
  return { planId: plan.id, version: plan.version, state: plan.state };
}

export async function setWeekSelection(input: {
  planId: string;
  actionId: string;
  selected: boolean;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const plan = await executeOperation(supabase, 'week.select.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateWeek();
  return { version: plan.version };
}

export async function commitWeek(input: { planId: string; expectedVersion: number }) {
  const { supabase } = await requireOwnedWorkspaceId();
  const plan = await executeOperation(supabase, 'week.commit.v1', input, {
    idempotencyKey: `week-commit:${input.planId}`,
    surface: 'ui',
  });
  revalidateWeek();
  return { version: plan.version, state: plan.state };
}

export async function recordWeekDisposition(input: {
  planId: string;
  actionId: string;
  disposition: 'kept' | 'moved' | 'paused' | 'dropped';
  note: string | null;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const plan = await executeOperation(supabase, 'week.disposition.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateWeek();
  return { version: plan.version };
}

export async function closeWeek(input: { planId: string; expectedVersion: number }) {
  const { supabase } = await requireOwnedWorkspaceId();
  /* Stable per plan: a retried close returns the record already written
     rather than writing a second, differently-counted one. */
  const plan = await executeOperation(supabase, 'week.close.v1', input, {
    idempotencyKey: `week-close:${input.planId}`,
    surface: 'ui',
  });
  revalidateWeek();
  return { version: plan.version, state: plan.state };
}
