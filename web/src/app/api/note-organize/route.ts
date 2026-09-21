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
  buildOrganizeMessages,
  contentLines,
  validateOrganizeProposal,
} from '@/lib/notes/organize';
import {
  completeManagedText,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TEXT_MODEL,
  managedChatUsage,
  managedProviderIdentityForError,
} from '@/lib/ai/provider';
import { excludedAreaIds, withAreaExclusion } from '@/lib/areas/ai-exclusion';
import { createClient } from '@/lib/supabase/server';

const MAX_JSON_BYTES = 2_000;
const PROMPT_VERSION = 'note-organize-v1';
/* Headings and copied lines. Nothing here should fund prose, and a completion
   long enough to rewrite the page is a completion that has stopped sorting. */
const MAX_ORGANIZE_COMPLETION_TOKENS = 1_500;
const inputSchema = z
  .object({ noteId: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();

/**
 * A proposed arrangement of a page the owner already wrote.
 *
 * Nothing is written here. The route returns Markdown for the person to read,
 * accept or discard, and accepting goes through `note.update.v1` like any
 * other edit -- which keeps the previous revision, so the original survives
 * being accepted as well as being refused.
 *
 * The version travels with the request and is checked again against the row.
 * A proposal built from writing that has since changed is refused rather than
 * offered, because accepting it would silently discard the newer edit.
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
    context = await authorizeAiRequest(request, 'capture_analysis', MAX_JSON_BYTES, {
      deferQuota: true,
    });
    if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
      throw new ApiProblem(409, 'canonical_model_required', 'Organising is not ready yet.');
    }
    const { noteId, expectedVersion } = await readJson(request, inputSchema, MAX_JSON_BYTES);
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

    /* Exclusion is resolved before the page is fetched, and it is the same
       resolver every other path uses. Asking for a page to be organised is not
       consent to send a page that was excluded from AI. */
    const excludedAreas = await excludedAreaIds(supabase, String(workspace.id));
    const { data: note } = await withAreaExclusion(
      supabase
        .from('notes')
        .select('id,title,body_markdown,version')
        .eq('id', noteId)
        .eq('workspace_id', workspace.id)
        .eq('ai_excluded', false)
        .is('archived_at', null)
        .is('trashed_at', null),
      excludedAreas
    ).maybeSingle();
    if (!note) throw new ApiProblem(404, 'note_not_found', 'This page is not available to AI.');
    if (Number(note.version) !== expectedVersion) {
      throw new ApiProblem(
        409,
        'note_changed',
        'This page changed while the suggestion was being prepared. Open it again.'
      );
    }
    const body = String(note.body_markdown ?? '');
    if (contentLines(body).length < 2) {
      throw new ApiProblem(
        409,
        'nothing_to_organize',
        'There is not enough written here to arrange yet.'
      );
    }

    await consumeAiQuota(context, true);
    quotaConsumed = true;

    const result = await completeManagedText('structured_analysis', {
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: MAX_ORGANIZE_COMPLETION_TOKENS,
      messages: buildOrganizeMessages({ title: String(note.title), bodyMarkdown: body }),
    });
    providerIdentity = result;
    const raw = JSON.parse(result.completion.choices[0]?.message?.content ?? '{}');
    const proposal = validateOrganizeProposal(raw, body);
    if (!proposal) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI could not produce a safe arrangement. Your page is unchanged.'
      );
    }

    await recordAiUsage(context, {
      providerRole: 'structured_analysis',
      ...providerIdentity,
      outcome: 'succeeded',
      ...managedChatUsage(result),
    });
    return aiSuccess(
      {
        noteId: String(note.id),
        version: Number(note.version),
        promptVersion: PROMPT_VERSION,
        markdown: proposal.markdown,
        unsorted: proposal.unsorted.length,
        /* Reported rather than hidden. A person deciding whether to accept an
           arrangement should know the model tried to add something. */
        invented: proposal.invented,
        questions: proposal.questions,
      },
      context
    );
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
