import { z } from 'zod';
import {
  aiError,
  aiSuccess,
  ApiProblem,
  authorizeAiRequest,
  readJson,
  recordAiUsage,
  stableAiErrorCode,
  type RequestContext,
} from '@/lib/api/ai-route';
import {
  completeManagedText,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TEXT_MODEL,
  managedChatUsage,
  managedProviderIdentityForError,
} from '@/lib/ai/provider';
import {
  buildReviewProposalMessages,
  validateReviewProposal,
  type ReviewEvidence,
  type ResolvedReviewProposal,
} from '@/lib/review-proposals';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const MAX_JSON_BYTES = 2_000;
const PROMPT_VERSION = 'review-analysis-v1';
// Reviews are short, evidence-backed recommendations rather than generated reports.
const MAX_REVIEW_ANALYSIS_COMPLETION_TOKENS = 1_200;
const inputSchema = z
  .object({
    kind: z.enum(['weekly', 'monthly', 'quarterly']),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  })
  .strict()
  .refine((value) => value.endsOn >= value.startsOn);

function persistencePayload(proposal: ResolvedReviewProposal) {
  return proposal;
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  let jobId: string | null = null;
  let providerIdentity = {
    provider: GROQ_PROVIDER,
    modelId: GROQ_TEXT_MODEL,
    pricingVersion: GROQ_PRICING_VERSION,
  };
  try {
    context = await authorizeAiRequest(request, 'review_analysis', MAX_JSON_BYTES);
    if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
      throw new ApiProblem(409, 'canonical_model_required', 'AI Review is not ready yet.');
    }
    const input = await readJson(request, inputSchema, MAX_JSON_BYTES);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ApiProblem(401, 'authentication_required', 'Sign in to continue.');
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id,timezone')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) throw new ApiProblem(404, 'workspace_not_found', 'Workspace not found.');

    let actionsQuery = supabase
      .from('actions')
      .select(
        'id,title,status,scheduled_on,version,goals(title),planning_horizons!inner(starts_on)'
      )
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on')
      .limit(40);
    actionsQuery =
      input.kind === 'weekly'
        ? actionsQuery.lte('planning_horizons.starts_on', input.endsOn)
        : actionsQuery.gte('scheduled_on', input.startsOn).lte('scheduled_on', input.endsOn);
    const [actionsResult, goalsResult, reviewsResult] = await Promise.all([
      actionsQuery,
      supabase
        .from('goals')
        .select('id,title,status,current_value,target_value,unit,due_on,version')
        .eq('workspace_id', workspace.id)
        .is('archived_at', null)
        .is('trashed_at', null)
        .limit(20),
      supabase
        .from('reviews')
        .select('id,kind,completed_at')
        .eq('workspace_id', workspace.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(8),
    ]);
    if (actionsResult.error || goalsResult.error || reviewsResult.error) {
      throw new ApiProblem(503, 'review_context_unavailable', 'Review evidence is unavailable.');
    }
    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin
      .from('ai_jobs')
      .insert({
        workspace_id: workspace.id,
        actor_user_id: user.id,
        operation: 'review_analysis',
        source_capture_id: null,
        source_review_kind: input.kind,
        source_starts_on: input.startsOn,
        source_ends_on: input.endsOn,
        request_id: context.requestId,
        status: 'running',
      })
      .select('id')
      .single();
    if (jobError || !job) {
      throw new ApiProblem(
        503,
        'job_status_unavailable',
        'Review analysis could not start safely.'
      );
    }
    jobId = String(job.id);
    const actions = actionsResult.data ?? [];
    const goals = goalsResult.data ?? [];
    const reviews = reviewsResult.data ?? [];
    const catalog: ReviewEvidence[] = [
      ...actions.map((action) => ({
        type: 'action' as const,
        id: String(action.id),
        label: String(action.title).slice(0, 120),
        href: '/',
      })),
      ...goals.map((goal) => ({
        type: 'goal' as const,
        id: String(goal.id),
        label: String(goal.title).slice(0, 120),
        href: '/planner',
      })),
      ...reviews.map((review) => ({
        type: 'review' as const,
        id: String(review.id),
        label: `${String(review.kind)} review ${String(review.completed_at).slice(0, 10)}`,
        href: '/review',
      })),
    ];
    const availableActionIds = actions
      .filter((action) => !['done', 'dropped'].includes(String(action.status)))
      .map((action) => String(action.id));
    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: MAX_REVIEW_ANALYSIS_COMPLETION_TOKENS,
      messages: buildReviewProposalMessages({
        period: input,
        actions,
        goals,
        recentReviews: reviews,
        evidenceCatalog: catalog,
      }),
    });
    providerIdentity = result;
    const { completion } = result;
    const proposal = validateReviewProposal(
      JSON.parse(completion.choices[0]?.message?.content ?? '{}'),
      catalog,
      input.kind === 'weekly' ? availableActionIds : []
    );
    if (!proposal) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI returned an unsafe Review proposal.'
      );
    }
    const { data: proposalId, error: persistenceError } = await admin.rpc(
      'persist_review_ai_proposal_job',
      {
        p_owner_user_id: user.id,
        p_job_id: jobId,
        p_kind: input.kind,
        p_starts_on: input.startsOn,
        p_ends_on: input.endsOn,
        p_payload: persistencePayload(proposal),
        p_model_id: providerIdentity.modelId,
        p_prompt_version: PROMPT_VERSION,
      }
    );
    if (persistenceError?.message.includes('analysis_superseded')) {
      throw new ApiProblem(
        409,
        'analysis_superseded',
        'A newer Review analysis replaced this one.'
      );
    }
    if (persistenceError || !proposalId) {
      throw new ApiProblem(
        503,
        'proposal_persistence_failed',
        'Review proposal could not be saved.'
      );
    }
    const { error: completionError } = await admin
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        result_target_id: proposalId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running');
    if (completionError) {
      throw new ApiProblem(
        503,
        'job_status_unavailable',
        'Review analysis status could not be saved.'
      );
    }
    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess(
      { proposalId, proposal, modelId: providerIdentity.modelId, promptVersion: PROMPT_VERSION },
      context
    );
  } catch (error) {
    if (jobId) {
      try {
        await createAdminClient()
          .from('ai_jobs')
          .update({
            status: 'failed',
            error_code: stableAiErrorCode(error),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
          .eq('status', 'running');
      } catch {
        // The primary error remains stable if job-status persistence is unavailable.
      }
    }
    if (context) {
      providerIdentity = managedProviderIdentityForError(error, providerIdentity);
      await recordAiUsage(context, {
        providerRole: 'structured_analysis',
        ...providerIdentity,
        outcome: 'failed',
        errorCode: stableAiErrorCode(error),
      });
    }
    return aiError(error, 'review_analysis');
  }
}
