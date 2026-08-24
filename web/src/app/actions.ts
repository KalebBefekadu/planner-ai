'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';
import type { GoalStatus } from '@/types/supabase';

export type GoalType = 'yearly' | 'quarterly' | 'monthly' | 'weekly';
export type VisionView = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
};
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
  vision_id?: string;
  yearly_id?: string;
  quarterly_id?: string;
  monthly_id?: string;
};
export type CaptureView = {
  id: string;
  raw_text: string;
  source: 'typed' | 'voice' | 'import';
  state: 'new' | 'proposed' | 'reviewed' | 'archived';
  created_at: string;
  archived_at: string | null;
};
export type GoalsData = {
  vision: VisionView;
  yearly: GoalView[];
  quarterly: GoalView[];
  monthly: GoalView[];
  weekly: GoalView[];
};
export type ActionTemplateView = {
  id: string;
  goalId: string | null;
  title: string;
  descriptionMarkdown: string | null;
  cadence: 'weekly' | 'monthly';
  nextOccurrenceOn: string;
  status: 'active' | 'paused';
  version: number;
};

type GoalInput = { type: GoalType; parentId: string; content: string };
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
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  planning_horizons: { kind: 'year' | 'quarter' };
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
  planning_horizons: { kind: 'month' | 'week' };
};

const canonicalEnabled = process.env.PLANNER_DATA_MODEL === 'canonical';

function validateContent(content: string, maxLength = 1_000) {
  const trimmed = content.trim();
  if (trimmed.length < 3) throw new Error('Please write at least three characters.');
  if (trimmed.length > maxLength)
    throw new Error(`Keep this item under ${maxLength.toLocaleString()} characters.`);
  return trimmed;
}

function validateRawCapture(rawText: string) {
  if (rawText.trim().length < 3) throw new Error('Please write at least three characters.');
  if (rawText.length > 60_000) throw new Error('Keep this capture under 60,000 characters.');
  return rawText;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  return { supabase, user };
}

async function requireWorkspaceId() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load your workspace.');
  return { supabase, user, workspaceId: data.id as string };
}

function revalidatePlanner() {
  revalidatePath('/');
  revalidatePath('/vision');
  revalidatePath('/goals');
}

function todayInTimezone(timezone: string) {
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

export async function getActiveVision(): Promise<VisionView | null> {
  if (canonicalEnabled) {
    const { supabase, workspaceId } = await requireWorkspaceId();
    const { data, error } = await supabase
      .from('visions')
      .select('*')
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

  const { supabase, user } = await requireUser();
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
  const bodyMarkdown = validateContent(content, 50_000);
  if (canonicalEnabled) {
    const { supabase } = await requireUser();
    await executeOperation(
      supabase,
      'vision.upsert.v1',
      { bodyMarkdown },
      {
        idempotencyKey: randomUUID(),
        surface: 'ui',
      }
    );
  } else {
    const { supabase, user } = await requireUser();
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
  revalidatePlanner();
}

export async function getGoalsHierarchy(): Promise<GoalsData | null> {
  const vision = await getActiveVision();
  if (!vision) return null;

  if (canonicalEnabled) {
    const { supabase, workspaceId } = await requireWorkspaceId();
    const [goalsResult, actionsResult] = await Promise.all([
      supabase
        .from('goals')
        .select('*, planning_horizons!inner(kind)')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('created_at'),
      supabase
        .from('actions')
        .select('*, planning_horizons!inner(kind)')
        .eq('workspace_id', workspaceId)
        .is('archived_at', null)
        .is('trashed_at', null)
        .order('created_at'),
    ]);
    if (goalsResult.error || actionsResult.error) throw new Error('Unable to load your plan.');
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
      yearly_id: goal.parent_goal_id ?? undefined,
      created_at: goal.created_at,
      updated_at: goal.updated_at,
      deleted_at: goal.archived_at,
    });
    const mapAction = (action: CanonicalAction): GoalView => ({
      id: action.id,
      content: action.title,
      status: toGoalStatus(action.status),
      version: action.version,
      description: action.description_markdown,
      scheduled_on: action.scheduled_on,
      parent_action_id: action.parent_action_id,
      quarterly_id: action.goal_id ?? undefined,
      monthly_id: action.parent_action_id ?? undefined,
      created_at: action.created_at,
      updated_at: action.updated_at,
      deleted_at: action.archived_at,
    });
    return {
      vision,
      yearly: goals.filter((goal) => goal.planning_horizons.kind === 'year').map(mapGoal),
      quarterly: goals.filter((goal) => goal.planning_horizons.kind === 'quarter').map(mapGoal),
      monthly: actions.filter((action) => action.planning_horizons.kind === 'month').map(mapAction),
      weekly: actions.filter((action) => action.planning_horizons.kind === 'week').map(mapAction),
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
  return {
    vision,
    yearly: withVersion(yearly.data),
    quarterly: withVersion(quarterly.data),
    monthly: withVersion(monthly.data),
    weekly: withVersion(weekly.data),
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

export async function getActionTemplates(): Promise<ActionTemplateView[] | null> {
  if (!canonicalEnabled) return null;
  const { supabase, workspaceId } = await requireWorkspaceId();
  const { data, error } = await supabase
    .from('action_templates')
    .select('id,goal_id,title,description_markdown,cadence,next_occurrence_on,status,version')
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
  const title = validateContent(input.title);
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
  revalidatePlanner();
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
  const title = validateContent(input.title);
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
  revalidatePlanner();
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
  revalidatePlanner();
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
    { id, expectedVersion, throughOn: todayInTimezone(workspace.timezone as string) },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePlanner();
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
}) {
  if (!canonicalEnabled) throw new Error('Action editing requires the canonical data model.');
  const { supabase } = await requireUser();
  const result = await executeOperation(supabase, 'action.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePlanner();
  revalidatePath('/review');
  revalidatePath('/activity');
  return result;
}

export async function movePlanAction(input: {
  type: 'monthly' | 'weekly';
  id: string;
  expectedVersion: number;
  targetParentId: string;
}) {
  if (!canonicalEnabled) throw new Error('Action moving requires the canonical data model.');
  const { supabase, user } = await requireUser();
  const range = input.type === 'monthly' ? rangeFor('monthly') : rangeFor('weekly');
  let goalId = input.targetParentId;
  let parentActionId: string | null = null;
  if (input.type === 'weekly') {
    const workspace = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    const parent = await supabase
      .from('actions')
      .select('goal_id')
      .eq('id', input.targetParentId)
      .eq('workspace_id', workspace.data?.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .single();
    if (!parent.data?.goal_id) throw new Error('The destination monthly Action is unavailable.');
    goalId = parent.data.goal_id as string;
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
  revalidatePlanner();
  revalidatePath('/review');
  revalidatePath('/activity');
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

export async function getTranscripts(limit = 7): Promise<CaptureView[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  if (canonicalEnabled) {
    const { supabase, workspaceId } = await requireWorkspaceId();
    const { data, error } = await supabase
      .from('captures')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('trashed_at', null)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw new Error('Unable to load your recent captures.');
    return (data ?? []).map((capture) => ({
      id: capture.id as string,
      raw_text: capture.raw_text as string,
      source: capture.source as CaptureView['source'],
      state: capture.state as CaptureView['state'],
      created_at: capture.created_at as string,
      archived_at: capture.archived_at as string | null,
    }));
  }
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('Unable to load your recent captures.');
  return (data ?? []).map((capture) => ({
    id: capture.id,
    raw_text: capture.raw_text,
    source: 'typed',
    state: 'new',
    created_at: capture.created_at,
    archived_at: capture.deleted_at,
  }));
}

export async function saveTranscript(
  rawText: string,
  source: CaptureView['source'] = 'typed',
  idempotencyKey: string = randomUUID()
) {
  const exactText = validateRawCapture(rawText);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
  ) {
    throw new Error('This capture cannot be retried safely.');
  }
  if (canonicalEnabled) {
    const { supabase } = await requireUser();
    const saved = await executeOperation(
      supabase,
      'capture.create.v1',
      {
        rawText: exactText,
        source,
      },
      { idempotencyKey, surface: 'ui' }
    );
    revalidatePath('/');
    return {
      id: saved.id,
      raw_text: saved.raw_text,
      source: saved.source,
      state: saved.state,
      created_at: saved.created_at,
      archived_at: saved.archived_at,
    } satisfies CaptureView;
  }
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('transcripts')
    .insert({ user_id: user.id, raw_text: exactText })
    .select()
    .single();
  if (error) throw new Error('Unable to save your capture.');
  revalidatePath('/');
  return {
    id: data.id,
    raw_text: data.raw_text,
    source,
    state: 'new',
    created_at: data.created_at,
    archived_at: data.deleted_at,
  } satisfies CaptureView;
}
