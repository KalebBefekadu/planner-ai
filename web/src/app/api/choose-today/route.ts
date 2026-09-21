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
  buildChooseTodayMessages,
  resolveTodayPicks,
  type TodayCandidate,
} from '@/lib/planner/choose-today';
import { dateInTimezone } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_JSON_BYTES = 1_000;
const MAX_CHOOSE_TODAY_COMPLETION_TOKENS = 400;
/* Bounded on the way in, not just on the way out. Forty is more than a week of
   real work and small enough that the prompt stays cheap. */
const MAX_CANDIDATES = 40;

const inputSchema = z
  .object({
    /* Only what the person typed. Absent means they did not say, and the
       prompt is told that rather than left to assume. */
    capacityNote: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

/**
 * Suggest a short list for today from work that already exists.
 *
 * Writes nothing. The answer is a suggestion the person accepts, edits or
 * ignores; committing it goes through the same `daily-focus.set.v1` that a
 * manual choice uses, from an explicit press on the page.
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
    const { capacityNote } = await readJson(request, inputSchema, MAX_JSON_BYTES);
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
    const today = dateInTimezone(String(workspace.timezone));

    /* Work that is already planned: scheduled on or before today, or carrying
       a deadline. Unscheduled someday-work is deliberately not offered -- the
       question is what to do today out of what was already decided, not what
       else could be pulled forward. */
    const { data: rows, error } = await supabase
      .from('actions')
      .select('id,title,scheduled_on,due_on,goals(title)')
      .eq('workspace_id', workspace.id)
      .in('status', ['open', 'in_progress'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .or(`scheduled_on.lte.${today},due_on.not.is.null`)
      .order('scheduled_on', { ascending: true, nullsFirst: false })
      .limit(MAX_CANDIDATES);
    if (error) throw new ApiProblem(503, 'read_failed', 'Your work could not be read.');

    const candidates: TodayCandidate[] = (rows ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      scheduledOn: (row.scheduled_on as string | null) ?? null,
      dueOn: (row.due_on as string | null) ?? null,
      goalTitle: (row.goals as unknown as { title: string } | null)?.title ?? null,
    }));

    /* Nothing to choose from is an answer, and a cheap one. Asking a provider
       to pick from an empty list spends money to be told nothing. */
    if (candidates.length === 0) {
      await recordAiUsage(context, {
        providerRole: 'structured_analysis',
        ...providerIdentity,
        outcome: 'succeeded',
      });
      return aiSuccess({ picks: [], candidates: 0 }, context);
    }

    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: MAX_CHOOSE_TODAY_COMPLETION_TOKENS,
      messages: buildChooseTodayMessages({
        candidates,
        today,
        capacityNote: capacityNote ?? null,
      }),
    });
    providerIdentity = result;
    const raw = JSON.parse(result.completion.choices[0]?.message?.content ?? '{}');
    const picks = resolveTodayPicks(raw, candidates);
    if (!picks) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI could not produce a safe suggestion. Try again.'
      );
    }

    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess({ picks, candidates: candidates.length }, context);
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
