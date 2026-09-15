import 'server-only';

import { ApiProblem } from '@/lib/api/ai-route';
import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The restricted proposal-worker capability.
 *
 * `ai_jobs` grants signed-in people nothing but `select`. These three calls are
 * the only write path, and each one derives the actor from the verified JWT and
 * the Workspace from ownership inside the database, so nothing here can assert
 * an identity on the caller's behalf. That is the whole reason the AI proposal
 * routes no longer need a service-role client.
 *
 * All three routes share this module so job status policy cannot drift between
 * them, which is what the EH-01 register asks for.
 */
export type StartAiJobInput =
  | {
      operation: 'capture_analysis' | 'initiative_breakdown';
      requestId: string;
      sourceCaptureId: string;
    }
  | {
      operation: 'review_analysis';
      requestId: string;
      kind: 'weekly' | 'monthly' | 'quarterly';
      startsOn: string;
      endsOn: string;
    };

export async function startAiJob(
  supabase: ServerClient,
  input: StartAiJobInput,
  unavailableMessage: string
): Promise<string> {
  const args =
    input.operation === 'review_analysis'
      ? {
          p_operation: input.operation,
          p_request_id: input.requestId,
          p_source_capture_id: null,
          p_source_review_kind: input.kind,
          p_source_starts_on: input.startsOn,
          p_source_ends_on: input.endsOn,
        }
      : {
          p_operation: input.operation,
          p_request_id: input.requestId,
          p_source_capture_id: input.sourceCaptureId,
          p_source_review_kind: null,
          p_source_starts_on: null,
          p_source_ends_on: null,
        };

  const { data, error } = await supabase.rpc('start_ai_job', args);
  if (error || !data) {
    throw new ApiProblem(503, 'job_status_unavailable', unavailableMessage);
  }
  return String(data);
}

export async function completeAiJob(
  supabase: ServerClient,
  jobId: string,
  resultTargetId: string,
  unavailableMessage: string
): Promise<void> {
  const { error } = await supabase.rpc('complete_ai_job', {
    p_job_id: jobId,
    p_result_target_id: resultTargetId,
  });
  if (error) {
    throw new ApiProblem(503, 'job_status_unavailable', unavailableMessage);
  }
}

/**
 * Best effort, by design. This runs on the failure path, where the response the
 * person sees is already decided; a job-status write that cannot land must not
 * replace the real error with a worse one.
 */
export async function failAiJob(
  supabase: ServerClient,
  jobId: string,
  errorCode: string
): Promise<void> {
  try {
    await supabase.rpc('fail_ai_job', { p_job_id: jobId, p_error_code: errorCode });
  } catch {
    // The primary error response stays stable if status persistence is unavailable.
  }
}
