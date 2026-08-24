import { NextResponse } from 'next/server';
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
  type AiUsageDetails,
  type RequestContext,
} from '@/lib/api/ai-route';
import {
  buildEvidenceCatalog,
  resolveClaims,
  resolveEvidence,
  type AssistantClaim,
  type AssistantEvidence,
  type EvidenceReference,
} from '@/lib/assistant/evidence';
import {
  assistantModelOutputSchema,
  assistantManagedResponseSchema,
  assistantProposalRisk,
  buildAssistantSystemPrompt,
  validateAssistantProposal,
} from '@/lib/assistant/policy';
import {
  assistantReadOperationIdForToolName,
  assistantExplicitReadOperation,
  assistantReadTools,
  executeAssistantReadOperation,
  mergeAssistantReadRecords,
  parseAssistantReadOperation,
} from '@/lib/assistant/read-operations';
import {
  assistantContextScopes,
  assistantSelectionForRoute,
  boundedSelectedNoteContext,
  type AssistantSelection,
} from '@/lib/assistant/context';
import { executeOperation } from '@/lib/operations';
import {
  completeManagedText,
  GROQ_PRICING_VERSION,
  GROQ_PROVIDER,
  GROQ_TEXT_MODEL,
  managedChatUsage,
  managedProviderIdentityForError,
  OPENAI_PROVIDER,
} from '@/lib/ai/provider';
import { createClient } from '@/lib/supabase/server';
import { serializeUntrustedAiData } from '@/lib/ai/untrusted-data';
import { assistantSafetyIntercept } from '@/lib/assistant/safety';

const MAX_JSON_BYTES = 48_000;
const MODEL_ID = GROQ_TEXT_MODEL;
const PROMPT_VERSION = 'assistant-v11';
const messageSchema = z
  .object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4_000) })
  .strict();
const inputSchema = z
  .object({
    message: z.string().trim().min(1).max(4_000).optional(),
    history: z.array(messageSchema).max(12).optional(),
    route: z.string().startsWith('/').max(200),
    selection: z
      .object({ type: z.literal('note'), id: z.uuid() })
      .strict()
      .optional(),
    conversationId: z.uuid().optional(),
    approvedProposalId: z.uuid().optional(),
    dismissedProposalId: z.uuid().optional(),
    undoReceiptId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (input) =>
      [
        Boolean(input.message),
        Boolean(input.approvedProposalId),
        Boolean(input.dismissedProposalId),
        Boolean(input.undoReceiptId),
      ].filter(Boolean).length === 1,
    'Send one message or one proposal decision.'
  );

function dateInTimezone(timezone: string) {
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

function hydrateMessageClaims(message: {
  claims?: unknown;
  sources?: unknown;
  [key: string]: unknown;
}) {
  const sources = Array.isArray(message.sources) ? (message.sources as AssistantEvidence[]) : [];
  const sourceByKey = new Map(sources.map((source) => [`${source.type}:${source.id}`, source]));
  const claims = Array.isArray(message.claims) ? (message.claims as AssistantClaim[]) : [];
  return {
    ...message,
    sources,
    claims: claims.flatMap((claim) => {
      if (!claim || !Array.isArray(claim.evidence)) return [];
      const evidence = claim.evidence.flatMap((reference) => {
        const source = sourceByKey.get(`${reference.type}:${reference.id}`);
        return source ? [source] : [];
      });
      if (evidence.length !== claim.evidence.length) return [];
      return [{ ...claim, evidence }];
    }),
  };
}

async function readMinimalContext(route: string, requestedSelection?: AssistantSelection) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (process.env.PLANNER_DATA_MODEL === 'canonical') {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, timezone, coaching_intensity')
      .eq('owner_user_id', user.id)
      .single();
    if (!workspace) return null;
    const workspaceId = workspace.id as string;
    const localDate = dateInTimezone(workspace.timezone as string);
    const scopes = assistantContextScopes(route);
    const selection = assistantSelectionForRoute(route, requestedSelection);
    const [
      vision,
      goals,
      actions,
      focus,
      actionTemplates,
      notifications,
      notes,
      memories,
      conversations,
      captureProposalBatches,
    ] = await Promise.all([
      scopes.has('vision')
        ? supabase
            .from('visions')
            .select('id, body_markdown, version')
            .eq('workspace_id', workspaceId)
            .is('archived_at', null)
            .is('trashed_at', null)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      scopes.has('goals')
        ? supabase
            .from('goals')
            .select('id, title, status, version')
            .eq('workspace_id', workspaceId)
            .is('archived_at', null)
            .is('trashed_at', null)
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('actions')
        ? supabase
            .from('actions')
            .select('id, title, status, scheduled_on, version')
            .eq('workspace_id', workspaceId)
            .is('archived_at', null)
            .is('trashed_at', null)
            .limit(30)
        : Promise.resolve({ data: [] }),
      scopes.has('todayFocus')
        ? supabase
            .from('daily_focus_items')
            .select('sort_order,actions(id,title,status,scheduled_on,version)')
            .eq('workspace_id', workspaceId)
            .eq('focus_on', localDate)
            .order('sort_order')
        : Promise.resolve({ data: [] }),
      scopes.has('actionTemplates')
        ? supabase
            .from('action_templates')
            .select('id,title,cadence,status,next_occurrence_on,version')
            .eq('workspace_id', workspaceId)
            .is('archived_at', null)
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('notifications')
        ? supabase
            .from('notifications')
            .select('id,kind,title,href,read_at,version')
            .eq('workspace_id', workspaceId)
            .is('dismissed_at', null)
            .lte('visible_at', new Date().toISOString())
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('notes')
        ? supabase
            .from('notes')
            .select('id, title, version')
            .eq('workspace_id', workspaceId)
            .eq('ai_excluded', false)
            .is('archived_at', null)
            .is('trashed_at', null)
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('memories')
        ? supabase
            .from('memories')
            .select('id, statement, version')
            .eq('workspace_id', workspaceId)
            .is('trashed_at', null)
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('conversations')
        ? supabase
            .from('conversations')
            .select('id,title,status,version,updated_at')
            .eq('workspace_id', workspaceId)
            .is('trashed_at', null)
            .order('updated_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      scopes.has('captureProposalBatches')
        ? supabase
            .from('capture_proposal_batches')
            .select('id,source_capture_id,analysis_summary,status,version,updated_at')
            .eq('workspace_id', workspaceId)
            .eq('status', 'pending')
            .order('updated_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);
    const selectedNote = selection
      ? await supabase
          .from('notes')
          .select('id,title,body_markdown,version')
          .eq('workspace_id', workspaceId)
          .eq('id', selection.id)
          .eq('ai_excluded', false)
          .is('archived_at', null)
          .is('trashed_at', null)
          .maybeSingle()
      : { data: null };
    const boundedSelectedNote = boundedSelectedNoteContext(selectedNote.data);
    const noteRecords = boundedSelectedNote
      ? [
          boundedSelectedNote,
          ...(notes.data ?? []).filter((note) => note.id !== selectedNote.data?.id),
        ]
      : (notes.data ?? []);
    return {
      timezone: workspace.timezone,
      coachingIntensity: workspace.coaching_intensity,
      today: localDate,
      vision: vision.data ?? null,
      goals: goals.data ?? [],
      actions: actions.data ?? [],
      todayFocus: (focus.data ?? []).map((item) => item.actions),
      actionTemplates: actionTemplates.data ?? [],
      notifications: notifications.data ?? [],
      noteTitles: noteRecords,
      explicitMemories: memories.data ?? [],
      conversations: conversations.data ?? [],
      captureProposalBatches: captureProposalBatches.data ?? [],
    };
  }

  const [vision, yearly, quarterly, monthly, weekly] = await Promise.all([
    supabase
      .from('visions')
      .select('content')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('yearly_goals')
      .select('id, content, status')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .limit(10),
    supabase
      .from('quarterly_goals')
      .select('id, content, status')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .limit(10),
    supabase
      .from('monthly_tasks')
      .select('id, content, status')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .limit(15),
    supabase
      .from('weekly_actions')
      .select('id, content, status')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .limit(15),
  ]);
  return {
    vision: vision.data?.content ?? null,
    goals: [...(yearly.data ?? []), ...(quarterly.data ?? [])],
    actions: [...(monthly.data ?? []), ...(weekly.data ?? [])],
    noteTitles: [],
  };
}

async function persistedHistory(conversationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw new Error('Conversation history is unavailable.');
  return ((data ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return NextResponse.json({ conversations: [], messages: [], proposal: null });
  }

  const conversationId = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get('conversationId'));
  const conversationsResult = await supabase
    .from('conversations')
    .select('id,title,status,updated_at')
    .eq('status', 'active')
    .is('trashed_at', null)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (conversationsResult.error) {
    return NextResponse.json({ error: 'Conversations are unavailable.' }, { status: 503 });
  }
  if (!conversationId.success) {
    return NextResponse.json({
      conversations: conversationsResult.data ?? [],
      messages: [],
      proposal: null,
    });
  }
  const { data: activeConversation, error: activeConversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId.data)
    .eq('status', 'active')
    .is('trashed_at', null)
    .maybeSingle();
  if (activeConversationError || !activeConversation) {
    return NextResponse.json({ error: 'Conversation is unavailable.' }, { status: 404 });
  }
  const [messagesResult, proposalResult] = await Promise.all([
    supabase
      .from('conversation_messages')
      .select('id,role,content,sources,claims,created_at')
      .eq('conversation_id', conversationId.data)
      .order('created_at'),
    supabase
      .from('ai_proposals')
      .select('id,operation_id,input_json,summary,risk_class,status')
      .eq('conversation_id', conversationId.data)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (messagesResult.error || proposalResult.error) {
    return NextResponse.json({ error: 'Conversation is unavailable.' }, { status: 404 });
  }
  const proposal = proposalResult.data
    ? {
        id: proposalResult.data.id,
        operationId: proposalResult.data.operation_id,
        input: proposalResult.data.input_json,
        summary: proposalResult.data.summary,
        risk: proposalResult.data.risk_class,
      }
    : null;
  return NextResponse.json({
    conversations: conversationsResult.data ?? [],
    messages: (messagesResult.data ?? []).map(hydrateMessageClaims),
    proposal,
  });
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  let usageIdentity: Pick<
    AiUsageDetails,
    'providerRole' | 'provider' | 'modelId' | 'pricingVersion'
  > = {
    providerRole: 'agent',
    provider: GROQ_PROVIDER,
    modelId: MODEL_ID,
    pricingVersion: GROQ_PRICING_VERSION,
  };
  try {
    context = await authorizeAiRequest(request, 'assistant', MAX_JSON_BYTES, { deferQuota: true });
    const input = await readJson(request, inputSchema, MAX_JSON_BYTES);
    const supabase = await createClient();
    const canonical = process.env.PLANNER_DATA_MODEL === 'canonical';

    const safetyIntercept = input.message ? assistantSafetyIntercept(input.message) : null;
    if (safetyIntercept) {
      usageIdentity = {
        providerRole: 'internal',
        provider: 'planner-ai',
        modelId: 'safety-policy',
        pricingVersion: 'internal-v1',
      };
      let conversationId = input.conversationId;
      if (canonical) {
        const { data, error } = await supabase.rpc('record_assistant_turn', {
          p_conversation_id: input.conversationId ?? null,
          p_user_content: input.message as string,
          p_assistant_content: safetyIntercept.reply,
          p_route: input.route,
          p_proposal: null,
          p_model_id: 'safety-policy',
          p_prompt_version: 'safety-v1',
          p_sources: [],
          p_claims: [],
        });
        if (error) throw new Error('Conversation persistence failed.');
        conversationId = data.conversationId;
      }
      await recordAiUsage(context, { ...usageIdentity, outcome: 'succeeded' });
      return aiSuccess(
        {
          reply: safetyIntercept.reply,
          evidence: [],
          claims: [],
          conversationId,
          proposal: null,
        },
        context
      );
    }

    if (input.undoReceiptId) {
      usageIdentity = {
        providerRole: 'internal',
        provider: 'planner-ai',
        modelId: 'operation-service',
        pricingVersion: 'internal-v1',
      };
      if (!canonical) {
        return aiSuccess(
          { reply: 'Undo is not available until the secure data migration is complete.' },
          context,
          409
        );
      }
      await executeOperation(
        supabase,
        'operation.undo.v1',
        { receiptId: input.undoReceiptId },
        { idempotencyKey: context.requestId, surface: 'ui' }
      );
      await recordAiUsage(context, { ...usageIdentity, outcome: 'succeeded' });
      return aiSuccess(
        { reply: 'Undone.', conversationId: input.conversationId, undoableReceiptId: null },
        context
      );
    }

    if (input.approvedProposalId) {
      usageIdentity = {
        providerRole: 'internal',
        provider: 'planner-ai',
        modelId: 'operation-service',
        pricingVersion: 'internal-v1',
      };
      if (!canonical) {
        return aiSuccess(
          { reply: 'That change is not available until the secure data migration is complete.' },
          context,
          409
        );
      }
      const { data, error } = await supabase.rpc('execute_assistant_proposal', {
        p_proposal_id: input.approvedProposalId,
      });
      if (error) throw new Error('Proposal execution failed.');
      const conversationClosed =
        Boolean(data.result?.deleted) || data.result?.status === 'archived';
      await recordAiUsage(context, { ...usageIdentity, outcome: 'succeeded' });
      return aiSuccess(
        {
          reply: `Applied: ${data.summary}`,
          conversationId: conversationClosed ? null : data.conversationId,
          conversationClosed,
          undoableReceiptId: data.undoableReceiptId,
        },
        context
      );
    }
    if (input.dismissedProposalId) {
      usageIdentity = {
        providerRole: 'internal',
        provider: 'planner-ai',
        modelId: 'proposal-service',
        pricingVersion: 'internal-v1',
      };
      if (canonical) {
        const { error } = await supabase.rpc('dismiss_assistant_proposal', {
          p_proposal_id: input.dismissedProposalId,
        });
        if (error) throw new Error('Proposal dismissal failed.');
      }
      await recordAiUsage(context, { ...usageIdentity, outcome: 'succeeded' });
      return aiSuccess(
        { reply: 'Proposal dismissed.', conversationId: input.conversationId },
        context
      );
    }

    await consumeAiQuota(context, canonical);
    const baseProductContext = await readMinimalContext(input.route, input.selection);
    let productContext: Record<string, unknown> | null = baseProductContext
      ? { ...baseProductContext, activeConversationId: input.conversationId ?? null }
      : null;
    const explicitRead = canonical ? assistantExplicitReadOperation(input.message as string) : null;
    if (explicitRead) {
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('id')
        .maybeSingle();
      if (workspaceError || !workspace) {
        throw new ApiProblem(503, 'context_unavailable', 'Workspace context is unavailable.');
      }
      const records = await executeAssistantReadOperation(
        supabase,
        String(workspace.id),
        explicitRead
      );
      productContext = mergeAssistantReadRecords(productContext, records);
    }
    let evidenceCatalog = buildEvidenceCatalog(productContext);
    const history =
      canonical && input.conversationId
        ? await persistedHistory(input.conversationId)
        : (input.history ?? []);
    let systemPrompt = buildAssistantSystemPrompt({
      canonical,
      route: input.route,
      productContext,
      evidenceCatalog,
    });
    const turnMessages = [
      ...history.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user' as const, content: input.message as string },
    ];
    const firstResult = await completeManagedText('agent', {
      messages: [{ role: 'system', content: systemPrompt }, ...turnMessages],
      response_format: { type: 'json_object' },
      managed_response_schema: assistantManagedResponseSchema(canonical),
      temperature: 0.2,
      max_completion_tokens: 1_600,
      tools: canonical && !explicitRead ? assistantReadTools() : undefined,
    });
    usageIdentity = {
      providerRole: 'agent',
      provider: firstResult.provider,
      modelId: firstResult.modelId,
      pricingVersion: firstResult.pricingVersion,
    };
    const servedProvider =
      firstResult.provider === OPENAI_PROVIDER ? OPENAI_PROVIDER : GROQ_PROVIDER;
    let completion = firstResult.completion;
    let totalUsage = managedChatUsage(firstResult);
    const toolCalls = completion.choices[0]?.message?.tool_calls ?? [];
    if (toolCalls.length > 1) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI requested too many read Operations.'
      );
    }
    if (toolCalls.length === 1) {
      const call = toolCalls[0];
      if (call.type !== 'function') {
        throw new ApiProblem(
          502,
          'invalid_provider_output',
          'Planner AI requested an invalid read.'
        );
      }
      const operationId = assistantReadOperationIdForToolName(call.function.name);
      const operation = operationId
        ? parseAssistantReadOperation(operationId, JSON.parse(call.function.arguments))
        : null;
      if (!operation) {
        throw new ApiProblem(
          502,
          'invalid_provider_output',
          'Planner AI requested an invalid read.'
        );
      }
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('id')
        .maybeSingle();
      if (workspaceError || !workspace) {
        throw new ApiProblem(503, 'context_unavailable', 'Workspace context is unavailable.');
      }
      const records = await executeAssistantReadOperation(
        supabase,
        String(workspace.id),
        operation
      );
      productContext = mergeAssistantReadRecords(productContext, records);
      evidenceCatalog = buildEvidenceCatalog(productContext);
      systemPrompt = buildAssistantSystemPrompt({
        canonical,
        route: input.route,
        productContext,
        evidenceCatalog,
      });
      const secondResult = await completeManagedText(
        'agent',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            ...turnMessages,
            completion.choices[0].message,
            {
              role: 'tool',
              tool_call_id: call.id,
              content: serializeUntrustedAiData('workspace_record', {
                operationId: operation.operationId,
                records,
              }),
            },
          ],
          response_format: { type: 'json_object' },
          managed_response_schema: assistantManagedResponseSchema(canonical),
          temperature: 0.2,
          max_completion_tokens: 1_600,
        },
        { provider: servedProvider }
      );
      completion = secondResult.completion;
      const secondUsage = managedChatUsage(secondResult);
      totalUsage = {
        inputTokens: totalUsage.inputTokens + secondUsage.inputTokens,
        outputTokens: totalUsage.outputTokens + secondUsage.outputTokens,
        estimatedCostMicros: totalUsage.estimatedCostMicros + secondUsage.estimatedCostMicros,
      };
    }
    const modelOutput = assistantModelOutputSchema.parse(
      JSON.parse(completion.choices[0]?.message?.content ?? '{}')
    );
    const evidence = resolveEvidence(modelOutput.evidence as EvidenceReference[], evidenceCatalog);
    if (evidence.length !== modelOutput.evidence.length) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI cited unavailable evidence.'
      );
    }
    const claims = resolveClaims(modelOutput.claims, evidenceCatalog);
    if (!claims) {
      throw new ApiProblem(
        502,
        'invalid_provider_output',
        'Planner AI cited unavailable evidence.'
      );
    }
    const validatedProposal = validateAssistantProposal(modelOutput.proposal);
    const persistedSources = resolveEvidence(
      [...modelOutput.evidence, ...modelOutput.claims.flatMap((claim) => claim.evidence)],
      evidenceCatalog
    );

    let conversationId = input.conversationId;
    let proposalId: string | null = null;
    if (canonical) {
      const { data, error } = await supabase.rpc('record_assistant_turn', {
        p_conversation_id: input.conversationId ?? null,
        p_user_content: input.message as string,
        p_assistant_content: modelOutput.reply,
        p_route: input.route,
        p_proposal: validatedProposal,
        p_model_id: usageIdentity.modelId,
        p_prompt_version: PROMPT_VERSION,
        p_sources: persistedSources.map(({ type, id }) => ({ type, id })),
        p_claims: modelOutput.claims,
      });
      if (error) throw new Error('Conversation persistence failed.');
      conversationId = data.conversationId;
      proposalId = data.proposalId;
    }
    await recordAiUsage(context, {
      ...usageIdentity,
      outcome: 'succeeded',
      ...totalUsage,
    });
    return aiSuccess(
      {
        reply: modelOutput.reply,
        evidence: persistedSources,
        claims,
        conversationId,
        proposal: validatedProposal
          ? {
              id: proposalId,
              ...validatedProposal,
              risk: assistantProposalRisk(validatedProposal.operationId),
            }
          : null,
      },
      context
    );
  } catch (error) {
    if (context) {
      const failedIdentity = managedProviderIdentityForError(error, usageIdentity);
      usageIdentity = { providerRole: 'agent', ...failedIdentity };
      await recordAiUsage(context, {
        ...usageIdentity,
        outcome: 'failed',
        errorCode: stableAiErrorCode(error),
      });
    }
    return aiError(error, 'assistant');
  }
}
