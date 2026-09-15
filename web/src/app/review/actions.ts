'use server';

import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { periodBounds } from '@/lib/planning-period';
import { ReviewIntentError, reviewCompletionKey } from '@/lib/reviews/completion-intent';
import type { CoachingIntensity } from '@/lib/coaching';
import { dateInTimezone } from '@/lib/date';
import { executeOperation, OperationFailure } from '@/lib/operations';
import { currentLongReviewPeriod, type LongReviewPeriod } from '@/lib/reviews/periods';
import {
  countCheckpointsSince,
  FINISHED_LIST_LIMIT,
  WEEKLY_CHECKPOINT_WINDOW,
} from '@/lib/reviews/checkpoints';
import { parsePersistedReviewProposal, type ResolvedReviewProposal } from '@/lib/review-proposals';
import { createClient } from '@/lib/supabase/server';

export type WeeklyReviewAction = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'blocked';
  version: number;
  scheduledOn: string | null;
  horizonStartsOn: string;
  goalId: string | null;
  goalTitle: string | null;
  /**
   * How many completed Weekly Reviews this Action has outlived. Zero means it
   * has never been carried, which is a different statement from "one week old"
   * -- an Action created on Friday has survived nothing by Sunday.
   */
  weeksCarried: number;
  /**
   * This came round again rather than being new work nobody did. Left in the
   * open list rather than pulled into a section of its own -- it still needs
   * acting on, and splitting it out makes the week look emptier than it was.
   */
  fromTemplate: boolean;
};

/**
 * A Goal the week has work under, with the two things the screen needs that an
 * Action cannot tell it: whether the container itself is a standing concern,
 * and whether the container has stopped moving.
 */
export type WeeklyReviewGoal = {
  id: string;
  title: string;
  version: number;
  kind: 'outcome' | 'initiative';
  status: string;
  /** What good looks like here, quoted at the moment work is dropped. */
  definitionOfDone: string | null;
  /**
   * The ancestors this work answers to, outermost first. "Why am I doing this"
   * should be on screen at the moment of deciding, not reconstructable from
   * three other pages afterwards.
   */
  directionChain: string[];
  /**
   * Checkpoints since anything under this Goal was last completed. A task can
   * be stuck; so can a whole project, and that is a different problem with a
   * different answer -- pause the initiative rather than drop its tasks one by
   * one.
   */
  quietCheckpoints: number;
};

/**
 * What closed. The Review has never shown this, and it is the first thing the
 * week is opened to find out.
 */
export type WeeklyReviewFinishedAction = {
  id: string;
  title: string;
  completedAt: string;
  goalId: string | null;
  goalTitle: string | null;
  fromTemplate: boolean;
};

/**
 * Work that resets every period rather than being carried. Stated once as a
 * template instead of retyped every week, which is one of the three different
 * things "start from last week" was asking for.
 */
export type WeeklyReviewRecurrence = {
  id: string;
  title: string;
  cadence: 'weekly' | 'monthly';
  nextOccurrenceOn: string;
  goalId: string | null;
};

export type WeeklyReviewData = {
  startsOn: string;
  endsOn: string;
  timezone: string;
  coachingIntensity: CoachingIntensity;
  actions: WeeklyReviewAction[];
  finished: WeeklyReviewFinishedAction[];
  /**
   * The moment the last week was closed. Completions are counted from here
   * rather than from Monday, so a fortnight with one review reports fourteen
   * days of work instead of hiding seven of them.
   */
  finishedSince: string;
  /** True when that boundary is the calendar week because no Review exists yet. */
  finishedSinceIsFallback: boolean;
  goals: WeeklyReviewGoal[];
  recurring: WeeklyReviewRecurrence[];
  recentReviews: Array<{
    id: string;
    completedAt: string;
    reflectionMarkdown: string;
    itemCount: number;
    priorityCount: number;
  }>;
  aiProposal: ReviewAiProposalView | null;
  analysisJob: ReviewAnalysisJobView | null;
};

export type ReviewAiProposalView = {
  id: string;
  proposal: ResolvedReviewProposal;
  modelId: string;
  promptVersion: string;
  createdAt: string;
};

export type ReviewAnalysisJobView = {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  errorCode: string | null;
  createdAt: string;
};

export type WeeklyReviewDecision = {
  actionId: string;
  expectedVersion: number;
  /**
   * 'keep' means "I looked at this and it stays": it records the decision and
   * may carry a priority, but changes nothing about the Action. It is what
   * makes a priority attachable to work that needs no other answer.
   */
  resolution: 'done' | 'next_week' | 'keep' | 'blocked' | 'dropped' | 'left_overdue';
  reason: string | null;
  priority: boolean;
};

export type PeriodReviewData = {
  kind: LongReviewPeriod;
  startsOn: string;
  endsOn: string;
  timezone: string;
  coachingIntensity: CoachingIntensity;
  actionCounts: {
    planned: number;
    completed: number;
    active: number;
    blocked: number;
    dropped: number;
  };
  weeklyReviewsCompleted: number;
  goals: Array<{
    id: string;
    title: string;
    status: string;
    currentValue: number | null;
    targetValue: number | null;
    unit: string | null;
    dueOn: string | null;
  }>;
  completedReview: {
    id: string;
    reflectionMarkdown: string;
    completedAt: string;
  } | null;
  aiProposal: ReviewAiProposalView | null;
  analysisJob: ReviewAnalysisJobView | null;
};

function reviewProposalView(row: Record<string, unknown> | null): ReviewAiProposalView | null {
  if (!row) return null;
  const proposal = parsePersistedReviewProposal(row.payload);
  if (!proposal) return null;
  return {
    id: String(row.id),
    proposal,
    modelId: String(row.model_id),
    promptVersion: String(row.prompt_version),
    createdAt: String(row.created_at),
  };
}

function reviewAnalysisJobView(row: Record<string, unknown> | null): ReviewAnalysisJobView | null {
  if (!row) return null;
  const stale =
    row.status === 'running' && Date.now() - new Date(String(row.created_at)).getTime() > 120_000;
  return {
    id: String(row.id),
    status: stale ? 'failed' : (row.status as ReviewAnalysisJobView['status']),
    errorCode: stale ? 'job_interrupted' : row.error_code ? String(row.error_code) : null,
    createdAt: String(row.created_at),
  };
}

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Review is unavailable until the canonical data migration is complete.');
  }
}

// The week under review is the person's week, not a hard-coded Monday one.
// week_starts_on is a stored, editable preference, and reviewing the wrong
// seven days is not a cosmetic error: it decides which unfinished work the
// person is asked to resolve.
function currentWeek(timezone: string, weekStartsOn: number) {
  return periodBounds('week', dateInTimezone(timezone), weekStartsOn);
}

async function reviewClient() {
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
  if (error || !workspace) throw new Error('Unable to load your workspace.');
  return {
    supabase,
    workspaceId: workspace.id as string,
    timezone: workspace.timezone as string,
    weekStartsOn: Number(workspace.week_starts_on),
    coachingIntensity: workspace.coaching_intensity as CoachingIntensity,
  };
}

export async function getWeeklyReviewData(): Promise<WeeklyReviewData> {
  const { supabase, workspaceId, timezone, weekStartsOn, coachingIntensity } = await reviewClient();
  const { startsOn, endsOn } = currentWeek(timezone, weekStartsOn);

  // Every completed Weekly Review, most recent first. Two things are derived
  // from this one list, and both are the reason it is read before anything
  // else: where the "finished" window starts, and how many checkpoints each
  // open Action has outlived.
  //
  // The obvious source for that second number is action_schedule_history, and
  // it is the wrong one. Those rows are written per submitted decision, so the
  // moment the Review stops demanding a decision on every item the count
  // silently stops counting. Checkpoints are a property of the week, not of
  // what the person did in it.
  const checkpointsResult = await supabase
    .from('reviews')
    .select('completed_at')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'weekly')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(WEEKLY_CHECKPOINT_WINDOW);
  if (checkpointsResult.error) throw new Error('Unable to load Weekly Review.');
  const checkpoints = (checkpointsResult.data ?? []).map((row) => String(row.completed_at));
  const finishedSinceIsFallback = checkpoints.length === 0;
  const finishedSince = finishedSinceIsFallback ? `${startsOn}T00:00:00.000Z` : checkpoints[0];

  const unfinished =
    'id,title,status,version,scheduled_on,created_at,recurrence_template_id,planning_horizons!inner(kind,starts_on),goals(id,title,version,kind,status,definition_of_done,parent_goal_id)';
  const [
    weekHorizonResult,
    scheduledIntoWeekResult,
    finishedResult,
    momentumResult,
    recurringResult,
    goalTreeResult,
    reviewsResult,
    proposalResult,
    jobResult,
  ] = await Promise.all([
    supabase
      .from('actions')
      .select(unfinished)
      .eq('workspace_id', workspaceId)
      .eq('planning_horizons.kind', 'week')
      .lte('planning_horizons.starts_on', endsOn)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on'),
    // Work planned at a longer horizon and scheduled into these seven days
    // is unfinished work of this week. This list and the Operation's own
    // eligibility rule have to agree exactly -- the Operation rejects a
    // decision set that is missing an eligible Action or names an
    // ineligible one -- so the two predicates are deliberately identical.
    supabase
      .from('actions')
      .select(unfinished)
      .eq('workspace_id', workspaceId)
      .neq('planning_horizons.kind', 'week')
      .gte('scheduled_on', startsOn)
      .lte('scheduled_on', endsOn)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on'),
    // What closed since the last checkpoint. Ordered by completion rather
    // than by horizon: an Action planned in June and finished on Tuesday is
    // part of this week's work, and its horizon still says June.
    supabase
      .from('actions')
      .select('id,title,completed_at,recurrence_template_id,goals(id,title)')
      .eq('workspace_id', workspaceId)
      .eq('status', 'done')
      .gte('completed_at', finishedSince)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('completed_at', { ascending: true })
      .limit(FINISHED_LIST_LIMIT),
    // The most recent completion under each Goal, regardless of when. This is
    // how the screen tells an initiative that has gone quiet from one task
    // inside it that is stuck: the window above stops at the last checkpoint
    // and would report every Goal as silent.
    supabase
      .from('actions')
      .select('goal_id,completed_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'done')
      .not('goal_id', 'is', null)
      .not('completed_at', 'is', null)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('completed_at', { ascending: false })
      .limit(FINISHED_LIST_LIMIT),
    // Every Goal, so an ancestor chain can be walked without a recursive query.
    // A personal workspace has tens of these, not thousands.
    supabase
      .from('action_templates')
      .select('id,title,cadence,next_occurrence_on,goal_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .is('archived_at', null)
      .order('next_occurrence_on'),
    supabase
      .from('goals')
      .select('id,title,parent_goal_id')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null),
    supabase
      .from('reviews')
      .select('id,completed_at,reflection_markdown,review_action_items(priority)')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'weekly')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(8),
    supabase
      .from('review_ai_proposals')
      .select('id,payload,model_id,prompt_version,created_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'weekly')
      .eq('starts_on', startsOn)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ai_jobs')
      .select('id,status,error_code,created_at')
      .eq('operation', 'review_analysis')
      .eq('source_review_kind', 'weekly')
      .eq('source_starts_on', startsOn)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (
    weekHorizonResult.error ||
    scheduledIntoWeekResult.error ||
    finishedResult.error ||
    momentumResult.error ||
    recurringResult.error ||
    goalTreeResult.error ||
    reviewsResult.error ||
    proposalResult.error ||
    jobResult.error
  ) {
    throw new Error('Unable to load Weekly Review.');
  }
  // Two reads, one list. An Action can only be asked about once, and a
  // duplicate decision is rejected by the Operation as duplicate_review_action.
  const actionRows = [
    ...(weekHorizonResult.data ?? []),
    ...(scheduledIntoWeekResult.data ?? []),
  ].filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
  // The last time anything closed under each Goal, from the whole history
  // rather than this week's window.
  const lastCompletionByGoal = new Map<string, string>();
  for (const row of momentumResult.data ?? []) {
    const goalId = row.goal_id as string | null;
    if (!goalId || lastCompletionByGoal.has(goalId)) continue;
    lastCompletionByGoal.set(goalId, String(row.completed_at));
  }
  const parentOf = new Map<string, { title: string; parentGoalId: string | null }>();
  for (const row of goalTreeResult.data ?? []) {
    parentOf.set(String(row.id), {
      title: String(row.title),
      parentGoalId: (row.parent_goal_id as string | null) ?? null,
    });
  }
  // Outermost ancestor first, and the Goal itself left off -- the chain says
  // what this sits under, and the header already says what it is. A malformed
  // parent link would loop forever, so the walk is bounded by the tree.
  function directionChainFor(goalId: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([goalId]);
    let cursor = parentOf.get(goalId)?.parentGoalId ?? null;
    while (cursor && !seen.has(cursor) && chain.length < parentOf.size) {
      const node = parentOf.get(cursor);
      if (!node) break;
      chain.unshift(node.title);
      seen.add(cursor);
      cursor = node.parentGoalId;
    }
    return chain;
  }

  const goals = new Map<string, WeeklyReviewGoal>();
  for (const action of actionRows) {
    const goal = action.goals as unknown as {
      id: string;
      title: string;
      version: number;
      kind: 'outcome' | 'initiative';
      status: string;
      definition_of_done: string | null;
    } | null;
    if (!goal || goals.has(goal.id)) continue;
    const lastCompletion = lastCompletionByGoal.get(goal.id);
    goals.set(goal.id, {
      id: goal.id,
      title: goal.title,
      version: Number(goal.version),
      kind: goal.kind ?? 'outcome',
      status: goal.status,
      definitionOfDone: goal.definition_of_done ?? null,
      directionChain: directionChainFor(goal.id),
      // Nothing has ever closed here, so every checkpoint has been quiet.
      quietCheckpoints: lastCompletion
        ? countCheckpointsSince(checkpoints, lastCompletion)
        : checkpoints.length,
    });
  }

  return {
    startsOn,
    endsOn,
    timezone,
    coachingIntensity,
    finishedSince,
    finishedSinceIsFallback,
    goals: [...goals.values()],
    recurring: (recurringResult.data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      cadence: row.cadence as 'weekly' | 'monthly',
      nextOccurrenceOn: String(row.next_occurrence_on),
      goalId: (row.goal_id as string | null) ?? null,
    })),
    actions: actionRows.map((action) => {
      const horizon = action.planning_horizons as unknown as { starts_on: string };
      const goal = action.goals as unknown as { id: string; title: string } | null;
      return {
        id: action.id as string,
        title: action.title as string,
        status: action.status as WeeklyReviewAction['status'],
        version: Number(action.version),
        scheduledOn: action.scheduled_on as string | null,
        horizonStartsOn: horizon.starts_on,
        goalId: goal?.id ?? null,
        goalTitle: goal?.title ?? null,
        weeksCarried: countCheckpointsSince(checkpoints, String(action.created_at)),
        fromTemplate: Boolean(action.recurrence_template_id),
      };
    }),
    finished: (finishedResult.data ?? []).map((action) => {
      const goal = action.goals as unknown as { id: string; title: string } | null;
      return {
        id: action.id as string,
        title: action.title as string,
        completedAt: String(action.completed_at),
        goalId: goal?.id ?? null,
        goalTitle: goal?.title ?? null,
        fromTemplate: Boolean(action.recurrence_template_id),
      };
    }),
    recentReviews: (reviewsResult.data ?? []).map((review) => {
      const items = (review.review_action_items ?? []) as Array<{ priority: boolean }>;
      return {
        id: review.id as string,
        completedAt: review.completed_at as string,
        reflectionMarkdown: review.reflection_markdown as string,
        itemCount: items.length,
        priorityCount: items.filter((item) => item.priority).length,
      };
    }),
    aiProposal: reviewProposalView(proposalResult.data as Record<string, unknown> | null),
    analysisJob: reviewAnalysisJobView(jobResult.data as Record<string, unknown> | null),
  };
}

export async function completeWeeklyReview(input: {
  startsOn: string;
  endsOn: string;
  reflectionMarkdown: string;
  decisions: WeeklyReviewDecision[];
  /** Identifies one submission, so a transport retry replays it. */
  intentId: string;
}) {
  const { supabase } = await reviewClient();
  const { intentId, ...operationInput } = input;
  let idempotencyKey: string;
  try {
    idempotencyKey = reviewCompletionKey('weekly', input.startsOn, intentId);
  } catch (error) {
    throw new OperationFailure(
      'invalid_review_intent',
      error instanceof ReviewIntentError
        ? error.message
        : 'This review cannot be submitted safely. Reload and try again.'
    );
  }
  const result = await executeOperation(supabase, 'review.complete-weekly.v1', operationInput, {
    idempotencyKey,
    surface: 'ui',
  });
  revalidatePlannerAndRecords();
  return result;
}

/**
 * Stop an initiative appearing in the weekly pass without losing anything filed
 * under it.
 *
 * This is the "clean it up" step of the ritual, made explicit and reversible. It
 * is deliberately not archive: archiving cascades to every Action underneath,
 * and a project that has gone quiet for a month is not a project whose work was
 * wrong. 'paused' has been a Goal status since the first migration and nothing
 * had ever offered it.
 */
export async function pauseInitiative(input: { goalId: string; expectedVersion: number }) {
  const { supabase } = await reviewClient();
  const result = await executeOperation(
    supabase,
    'goal.status.v1',
    { id: input.goalId, status: 'paused', expectedVersion: input.expectedVersion },
    { idempotencyKey: `pause-${input.goalId}-${input.expectedVersion}`, surface: 'ui' }
  );
  revalidatePlannerAndRecords();
  return result;
}

export async function getPeriodReviewData(kind: LongReviewPeriod): Promise<PeriodReviewData> {
  const { supabase, workspaceId, timezone, coachingIntensity } = await reviewClient();
  const { startsOn, endsOn } = currentLongReviewPeriod(timezone, kind);
  const reviewKind = kind === 'month' ? 'monthly' : 'quarterly';
  const dayAfterPeriod = new Date(`${endsOn}T00:00:00Z`);
  dayAfterPeriod.setUTCDate(dayAfterPeriod.getUTCDate() + 1);
  const [
    actionsResult,
    goalsResult,
    weeklyReviewsResult,
    completedReviewResult,
    proposalResult,
    jobResult,
  ] = await Promise.all([
    supabase
      .from('actions')
      .select('status')
      .eq('workspace_id', workspaceId)
      .gte('scheduled_on', startsOn)
      .lte('scheduled_on', endsOn)
      .is('archived_at', null)
      .is('trashed_at', null),
    supabase
      .from('goals')
      .select('id,title,status,current_value,target_value,unit,due_on')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'paused', 'achieved'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('due_on', { ascending: true, nullsFirst: false })
      .limit(12),
    supabase
      .from('reviews')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'weekly')
      .eq('status', 'completed')
      .gte('completed_at', `${startsOn}T00:00:00Z`)
      .lt('completed_at', dayAfterPeriod.toISOString()),
    supabase
      .from('reviews')
      .select('id,reflection_markdown,completed_at,planning_horizons!inner(starts_on)')
      .eq('workspace_id', workspaceId)
      .eq('kind', reviewKind)
      .eq('status', 'completed')
      .eq('planning_horizons.starts_on', startsOn)
      .maybeSingle(),
    supabase
      .from('review_ai_proposals')
      .select('id,payload,model_id,prompt_version,created_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', reviewKind)
      .eq('starts_on', startsOn)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ai_jobs')
      .select('id,status,error_code,created_at')
      .eq('operation', 'review_analysis')
      .eq('source_review_kind', reviewKind)
      .eq('source_starts_on', startsOn)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (
    actionsResult.error ||
    goalsResult.error ||
    weeklyReviewsResult.error ||
    completedReviewResult.error ||
    proposalResult.error ||
    jobResult.error
  ) {
    throw new Error(`Unable to load ${kind === 'month' ? 'Monthly' : 'Quarterly'} Review.`);
  }
  const statuses = (actionsResult.data ?? []).map((action) => action.status as string);
  const completedReview = completedReviewResult.data;
  return {
    kind,
    startsOn,
    endsOn,
    timezone,
    coachingIntensity,
    actionCounts: {
      planned: statuses.length,
      completed: statuses.filter((status) => status === 'done').length,
      active: statuses.filter((status) => ['open', 'in_progress'].includes(status)).length,
      blocked: statuses.filter((status) => status === 'blocked').length,
      dropped: statuses.filter((status) => status === 'dropped').length,
    },
    weeklyReviewsCompleted: weeklyReviewsResult.data?.length ?? 0,
    goals: (goalsResult.data ?? []).map((goal) => ({
      id: goal.id as string,
      title: goal.title as string,
      status: goal.status as string,
      currentValue: goal.current_value === null ? null : Number(goal.current_value),
      targetValue: goal.target_value === null ? null : Number(goal.target_value),
      unit: goal.unit as string | null,
      dueOn: goal.due_on as string | null,
    })),
    completedReview: completedReview
      ? {
          id: completedReview.id as string,
          reflectionMarkdown: completedReview.reflection_markdown as string,
          completedAt: completedReview.completed_at as string,
        }
      : null,
    aiProposal: reviewProposalView(proposalResult.data as Record<string, unknown> | null),
    analysisJob: reviewAnalysisJobView(jobResult.data as Record<string, unknown> | null),
  };
}

export async function completePeriodReview(input: {
  kind: 'monthly' | 'quarterly';
  startsOn: string;
  endsOn: string;
  reflectionMarkdown: string;
  /** Identifies one submission, so a transport retry replays it. */
  intentId: string;
}) {
  const { supabase } = await reviewClient();
  const { intentId, ...operationInput } = input;
  let idempotencyKey: string;
  try {
    idempotencyKey = reviewCompletionKey(input.kind, input.startsOn, intentId);
  } catch (error) {
    throw new OperationFailure(
      'invalid_review_intent',
      error instanceof ReviewIntentError
        ? error.message
        : 'This review cannot be submitted safely. Reload and try again.'
    );
  }
  const result = await executeOperation(supabase, 'review.complete-period.v1', operationInput, {
    idempotencyKey,
    surface: 'ui',
  });
  revalidatePlannerAndRecords();
  return result;
}
