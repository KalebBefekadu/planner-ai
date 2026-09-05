'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { CoachingIntensity } from '@/lib/coaching';
import { dateInTimezone } from '@/lib/date';
import { executeOperation } from '@/lib/operations';
import { currentLongReviewPeriod, type LongReviewPeriod } from '@/lib/reviews/periods';
import { parsePersistedReviewProposal, type ResolvedReviewProposal } from '@/lib/review-proposals';
import { createClient } from '@/lib/supabase/server';

export type WeeklyReviewAction = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'blocked';
  version: number;
  scheduledOn: string | null;
  horizonStartsOn: string;
  goalTitle: string | null;
};

export type WeeklyReviewData = {
  startsOn: string;
  endsOn: string;
  timezone: string;
  coachingIntensity: CoachingIntensity;
  actions: WeeklyReviewAction[];
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
  resolution: 'done' | 'next_week' | 'blocked' | 'dropped' | 'left_overdue';
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

function currentWeek(timezone: string) {
  const localDate = new Date(`${dateInTimezone(timezone)}T00:00:00Z`);
  const day = localDate.getUTCDay();
  localDate.setUTCDate(localDate.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const end = new Date(localDate);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    startsOn: localDate.toISOString().slice(0, 10),
    endsOn: end.toISOString().slice(0, 10),
  };
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
    .select('id,timezone,coaching_intensity')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !workspace) throw new Error('Unable to load your workspace.');
  return {
    supabase,
    workspaceId: workspace.id as string,
    timezone: workspace.timezone as string,
    coachingIntensity: workspace.coaching_intensity as CoachingIntensity,
  };
}

export async function getWeeklyReviewData(): Promise<WeeklyReviewData> {
  const { supabase, workspaceId, timezone, coachingIntensity } = await reviewClient();
  const { startsOn, endsOn } = currentWeek(timezone);
  const [actionsResult, reviewsResult, proposalResult, jobResult] = await Promise.all([
    supabase
      .from('actions')
      .select(
        'id,title,status,version,scheduled_on,planning_horizons!inner(kind,starts_on),goals(title)'
      )
      .eq('workspace_id', workspaceId)
      .eq('planning_horizons.kind', 'week')
      .lte('planning_horizons.starts_on', endsOn)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on'),
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
  if (actionsResult.error || reviewsResult.error || proposalResult.error || jobResult.error) {
    throw new Error('Unable to load Weekly Review.');
  }
  return {
    startsOn,
    endsOn,
    timezone,
    coachingIntensity,
    actions: (actionsResult.data ?? []).map((action) => {
      const horizon = action.planning_horizons as unknown as { starts_on: string };
      const goal = action.goals as unknown as { title: string } | null;
      return {
        id: action.id as string,
        title: action.title as string,
        status: action.status as WeeklyReviewAction['status'],
        version: Number(action.version),
        scheduledOn: action.scheduled_on as string | null,
        horizonStartsOn: horizon.starts_on,
        goalTitle: goal?.title ?? null,
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
}) {
  const { supabase } = await reviewClient();
  const result = await executeOperation(supabase, 'review.complete-weekly.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/');
  revalidatePath('/planner');
  revalidatePath('/review');
  revalidatePath('/activity');
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
}) {
  const { supabase } = await reviewClient();
  const result = await executeOperation(supabase, 'review.complete-period.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/review');
  revalidatePath('/activity');
  return result;
}
