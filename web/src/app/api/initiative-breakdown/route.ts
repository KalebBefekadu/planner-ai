import { z } from 'zod';
import {
  aiError,
  aiSuccess,
  ApiProblem,
  authorizeAiRequest,
  consumeAiQuota,
  readJson,
  recordAiUsage,
  stableAiErrorCode,
  type RequestContext,
} from '@/lib/api/ai-route';
import {
  breakdownCaptureText,
  breakdownToAnalysis,
  buildBreakdownMessages,
  validateBreakdown,
} from '@/lib/planner/breakdown';
import {
  completeManagedText,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TEXT_MODEL,
  managedChatUsage,
  managedProviderIdentityForError,
} from '@/lib/ai/provider';
import { executeOperation } from '@/lib/operations';
import { periodBounds } from '@/lib/planning-period';
import { dateInTimezone } from '@/lib/date';
import { completeAiJob, failAiJob, startAiJob } from '@/lib/ai/job-status';
import { createClient } from '@/lib/supabase/server';

const MAX_JSON_BYTES = 2_000;
const PROMPT_VERSION = 'initiative-breakdown-v1';
// A handful of short titles. Nothing here should fund prose.
const MAX_BREAKDOWN_COMPLETION_TOKENS = 500;
const inputSchema = z.object({ goalId: z.uuid() }).strict();

/**
 * A first list of tasks for a new initiative, as a reviewable proposal batch.
 *
 * Nothing about this is a new mechanism. The batch is persisted by the same RPC
 * the Capture flow uses, reviewed in the same Action Inbox, and applied by the
 * same atomic path. What is new is the prompt and the fact that the model's
 * only influence is a list of titles: every identifier, date and horizon is
 * computed here from the initiative, and each resulting input is validated
 * against action.create.v1's own schema before it is written.
 *
 * An initiative is fully usable without ever calling this. It is an offer, not
 * a step.
 */
export async function POST(request: Request) {
  let context: RequestContext | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;
  let jobId: string | null = null;
  let quotaConsumed = false;
  let providerIdentity = {
    provider: GROQ_PROVIDER,
    modelId: GROQ_TEXT_MODEL,
    pricingVersion: GROQ_PRICING_VERSION,
  };
  try {
    context = await authorizeAiRequest(request, 'capture_analysis', MAX_JSON_BYTES, {
      deferQuota: true,
    });
    if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
      throw new ApiProblem(409, 'canonical_model_required', 'Breakdowns are not ready yet.');
    }
    const { goalId } = await readJson(request, inputSchema, MAX_JSON_BYTES);
    supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ApiProblem(401, 'authentication_required', 'Sign in to continue.');
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id,timezone,week_starts_on')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) throw new ApiProblem(404, 'workspace_not_found', 'Workspace not found.');

    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select('id,title,kind,definition_of_done')
      .eq('id', goalId)
      .eq('workspace_id', workspace.id)
      .is('archived_at', null)
      .is('trashed_at', null)
      .single();
    if (goalError || !goal) throw new ApiProblem(404, 'goal_not_found', 'Initiative not found.');
    if (goal.kind !== 'initiative') {
      throw new ApiProblem(
        409,
        'not_an_initiative',
        'A breakdown is offered for an ongoing initiative, not a dated Goal.'
      );
    }

    // The Capture is not bookkeeping. A batched ai_proposal requires one, and
    // "break this down" is a thought the owner had -- recording it gives the
    // proposal a provenance and puts it in Activity like every other AI write.
    const capture = await executeOperation(
      supabase,
      'capture.create.v1',
      {
        rawText: breakdownCaptureText({
          title: String(goal.title),
          definitionOfDone: (goal.definition_of_done as string | null) ?? null,
        }),
        source: 'typed',
      },
      { idempotencyKey: `breakdown-${goalId}-${context.requestId}`, surface: 'ui' }
    );
    const captureId = String((capture as { id: string }).id);

    await consumeAiQuota(context, true);
    quotaConsumed = true;
    jobId = await startAiJob(
      supabase,
      {
        operation: 'initiative_breakdown',
        requestId: context.requestId,
        sourceCaptureId: captureId,
      },
      'The breakdown could not be started.'
    );

    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: MAX_BREAKDOWN_COMPLETION_TOKENS,
      messages: buildBreakdownMessages({
        title: String(goal.title),
        definitionOfDone: (goal.definition_of_done as string | null) ?? null,
      }),
    });
    providerIdentity = result;
    const raw = JSON.parse(result.completion.choices[0]?.message?.content ?? '{}');
    const tasks = validateBreakdown(raw);
    if (!tasks) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI could not produce a safe breakdown. Try again.'
      );
    }

    // The week the owner is actually in, in their own timezone and with their
    // own week start. A breakdown that lands in the wrong seven days is not a
    // cosmetic error: it decides which week has to resolve the work.
    const { startsOn, endsOn } = periodBounds(
      'week',
      dateInTimezone(String(workspace.timezone)),
      Number(workspace.week_starts_on)
    );
    const analysis = breakdownToAnalysis(tasks, { goalId, startsOn, endsOn });

    const { data: batchId, error: persistenceError } = await supabase.rpc(
      'persist_capture_proposal_analysis_job',
      {
        p_capture_id: captureId,
        p_job_id: jobId,
        p_analysis: analysis,
        p_model_id: providerIdentity.modelId,
        p_prompt_version: PROMPT_VERSION,
      }
    );
    if (persistenceError || !batchId) {
      throw new ApiProblem(503, 'proposal_persistence_failed', 'The breakdown could not be saved.');
    }
    await completeAiJob(supabase, jobId, String(batchId), 'Breakdown status could not be saved.');
    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess({ batchId, jobId, captureId, proposed: analysis.proposals.length }, context);
  } catch (error) {
    if (jobId && supabase) {
      await failAiJob(supabase, jobId, stableAiErrorCode(error));
    }
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
