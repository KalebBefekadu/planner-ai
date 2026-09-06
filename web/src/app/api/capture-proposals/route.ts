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
  buildCaptureProposalMessages,
  requiresExpensiveCaptureConfirmation,
  validateCaptureProposalAnalysis,
} from '@/lib/capture-proposals';
import {
  completeManagedText,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TEXT_MODEL,
  managedChatUsage,
  managedProviderIdentityForError,
} from '@/lib/ai/provider';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const MAX_JSON_BYTES = 2_000;
const PROMPT_VERSION = 'capture-analysis-v2';
// This supports a concise multi-item proposal batch without funding long prose.
const MAX_CAPTURE_ANALYSIS_COMPLETION_TOKENS = 1_600;
const inputSchema = z
  .object({ captureId: z.uuid(), confirmExpensive: z.literal(true).optional() })
  .strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
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
      throw new ApiProblem(
        409,
        'canonical_model_required',
        'Capture organization is not ready yet.'
      );
    }
    const { captureId, confirmExpensive } = await readJson(request, inputSchema, MAX_JSON_BYTES);
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
    const [{ data: capture, error: captureError }, { data: goals }, { data: notes }] =
      await Promise.all([
        supabase
          .from('captures')
          .select('id,raw_text,source,state,created_at')
          .eq('id', captureId)
          .eq('workspace_id', workspace.id)
          .is('archived_at', null)
          .is('trashed_at', null)
          .single(),
        supabase
          .from('goals')
          .select('id,title,status,version')
          .eq('workspace_id', workspace.id)
          .is('archived_at', null)
          .is('trashed_at', null)
          .limit(20),
        supabase
          .from('notes')
          .select('id,title,version')
          .eq('workspace_id', workspace.id)
          .eq('ai_excluded', false)
          .is('archived_at', null)
          .is('trashed_at', null)
          .limit(20),
      ]);
    if (captureError || !capture) {
      throw new ApiProblem(404, 'capture_not_found', 'Capture not found.');
    }
    if (requiresExpensiveCaptureConfirmation(String(capture.raw_text), Boolean(confirmExpensive))) {
      throw new ApiProblem(
        409,
        'expensive_analysis_confirmation_required',
        'This long Capture may use substantially more AI processing. Confirm to organize it.'
      );
    }
    await consumeAiQuota(context, true);
    quotaConsumed = true;
    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin
      .from('ai_jobs')
      .insert({
        workspace_id: workspace.id,
        actor_user_id: user.id,
        operation: 'capture_analysis',
        source_capture_id: captureId,
        request_id: context.requestId,
        status: 'running',
      })
      .select('id')
      .single();
    if (jobError || !job) {
      throw new ApiProblem(503, 'job_status_unavailable', 'Analysis could not be started safely.');
    }
    jobId = String(job.id);
    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: MAX_CAPTURE_ANALYSIS_COMPLETION_TOKENS,
      messages: buildCaptureProposalMessages({
        captureText: String(capture.raw_text),
        today: new Intl.DateTimeFormat('en-CA', {
          timeZone: String(workspace.timezone),
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
        goals: goals ?? [],
        noteTitles: notes ?? [],
      }),
    });
    providerIdentity = result;
    const { completion } = result;
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    const analysis = validateCaptureProposalAnalysis(raw);
    if (!analysis) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI could not produce a safe proposal. Try again.'
      );
    }
    const { data: batchId, error: persistenceError } = await admin.rpc(
      'persist_capture_proposal_analysis_job',
      {
        p_owner_user_id: user.id,
        p_capture_id: captureId,
        p_job_id: jobId,
        p_analysis: analysis,
        p_model_id: providerIdentity.modelId,
        p_prompt_version: PROMPT_VERSION,
      }
    );
    if (persistenceError?.message.includes('analysis_superseded')) {
      throw new ApiProblem(
        409,
        'analysis_superseded',
        'A newer analysis request replaced this one.'
      );
    }
    if (persistenceError || !batchId) {
      throw new ApiProblem(503, 'proposal_persistence_failed', 'Proposal could not be saved.');
    }
    const { error: completionError } = await admin
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        result_target_id: batchId,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running');
    if (completionError) {
      throw new ApiProblem(503, 'job_status_unavailable', 'Analysis status could not be saved.');
    }
    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess({ batchId, jobId }, context);
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
        // The primary error response remains stable if status persistence is unavailable.
      }
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
