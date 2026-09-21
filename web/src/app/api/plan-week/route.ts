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
  buildPlanWeekMessages,
  resolveWeekProposal,
  type WeekCandidate,
} from '@/lib/planner/plan-week';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_JSON_BYTES = 1_000;
const MAX_PLAN_WEEK_COMPLETION_TOKENS = 700;
const MAX_CANDIDATES = 40;

/* The week, not the plan. A plan row does not exist until someone commits to
   one, and asking for a suggestion must not be what creates it: proposing is a
   read, and a read that writes is a surprise. */
const inputSchema = z.object({ startsOn: z.iso.date(), endsOn: z.iso.date() }).strict();

/**
 * Propose a week by selecting from work already scheduled in it.
 *
 * Writes nothing. Applying a proposal goes through the same `week.select.v1`
 * and `week.plan.v1` the worksheet's own controls use, from explicit presses.
 */
export async function POST(request: Request) {
  let context: RequestContext | undefined;
  let quotaConsumed = false;
  let providerIdentity = {
    provider: GROQ_PROVIDER,
    modelId: GROQ_TEXT_MODEL,
    pricingVersion: GROQ_PRICING_VERSION,
  };
  try {
    context = await authorizeAiRequest(request, 'capture_analysis', MAX_JSON_BYTES);
    quotaConsumed = true;
    if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
      throw new ApiProblem(409, 'canonical_model_required', 'This is not ready yet.');
    }
    const { startsOn, endsOn } = await readJson(request, inputSchema, MAX_JSON_BYTES);
    if (endsOn < startsOn) throw new ApiProblem(400, 'invalid_input', 'That is not a week.');
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ApiProblem(401, 'authentication_required', 'Sign in to continue.');
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) throw new ApiProblem(404, 'workspace_not_found', 'Workspace not found.');

    /* A plan may not exist yet, and that is the ordinary case for a week
       nobody has started. No plan means nothing is selected and the week is a
       draft, which is exactly the state a proposal is for. */
    const { data: plan } = await supabase
      .from('weekly_plans')
      .select('id,state,capacity_hours,planning_horizons!inner(starts_on)')
      .eq('workspace_id', workspace.id)
      .eq('planning_horizons.starts_on', startsOn)
      .maybeSingle();

    /* Only while the week is still a draft. After it is committed the baseline
       is frozen and anything added is a late addition -- a deliberate decision
       about a week already underway, not a planning exercise to hand to a
       model. */
    if (plan && plan.state !== 'draft') {
      throw new ApiProblem(
        409,
        'weekly_plan_not_draft',
        'This week is already committed. Adding to it now is a late addition, which is a decision to make yourself.'
      );
    }

    /* Work scheduled inside these seven days that is not in the plan yet. The
       same set the worksheet already offers by hand, so the proposal can only
       reach what the person could have picked themselves. */
    const { data: rows, error } = await supabase
      .from('actions')
      .select('id,title,scheduled_on,life_areas(name)')
      .eq('workspace_id', workspace.id)
      .gte('scheduled_on', startsOn)
      .lte('scheduled_on', endsOn)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on')
      .limit(MAX_CANDIDATES);
    if (error) throw new ApiProblem(503, 'read_failed', 'This week could not be read.');

    /* Which of those are already in the plan. Asked only about the rows just
       read, so this is bounded by MAX_CANDIDATES rather than by how large the
       plan happens to be. */
    const scheduledIds = (rows ?? []).map((row) => row.id as string);
    const already = new Set<string>();
    if (plan && scheduledIds.length > 0) {
      const { data: selected } = await supabase
        .from('weekly_plan_items')
        .select('action_id')
        .eq('workspace_id', workspace.id)
        .eq('plan_id', plan.id)
        .in('action_id', scheduledIds)
        .limit(MAX_CANDIDATES);
      for (const row of selected ?? []) already.add(row.action_id as string);
    }

    const candidates: WeekCandidate[] = (rows ?? [])
      .filter((row) => !already.has(row.id as string))
      .map((row) => ({
        id: row.id as string,
        title: row.title as string,
        scheduledOn: (row.scheduled_on as string | null) ?? null,
        areaName: (row.life_areas as unknown as { name: string } | null)?.name ?? null,
      }));

    if (candidates.length === 0) {
      await recordAiUsage(context, {
        providerRole: 'structured_analysis',
        ...providerIdentity,
        outcome: 'succeeded',
      });
      return aiSuccess({ intention: null, picks: [], candidates: 0 }, context);
    }

    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: MAX_PLAN_WEEK_COMPLETION_TOKENS,
      messages: buildPlanWeekMessages({
        candidates,
        startsOn,
        endsOn,
        capacityHours:
          plan?.capacity_hours === null || plan?.capacity_hours === undefined
            ? null
            : Number(plan.capacity_hours),
      }),
    });
    providerIdentity = result;
    const raw = JSON.parse(result.completion.choices[0]?.message?.content ?? '{}');
    const proposal = resolveWeekProposal(raw, candidates);
    if (!proposal) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI could not produce a safe plan. Try again.'
      );
    }

    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess({ ...proposal, candidates: candidates.length }, context);
  } catch (error) {
    if (context && quotaConsumed) {
      providerIdentity = managedProviderIdentityForError(error, providerIdentity);
      await recordAiUsage(context, {
        providerRole: 'structured_analysis',
        ...providerIdentity,
        outcome: 'failed',
        errorCode: stableAiErrorCode(error),
      });
    }
    return aiError(error, 'capture_analysis');
  }
}
