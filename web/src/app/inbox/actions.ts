'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  CaptureFilingInputError,
  captureFilingKey,
  planCaptureAction,
  planCaptureNote,
  type CaptureFilingTarget,
} from '@/lib/capture-filing';
import { validateCaptureProposalItem } from '@/lib/capture-proposals';
import { dateInTimezone } from '@/lib/date';
import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type CaptureProposalItemView = {
  id: string;
  batchId: string;
  operationId: string;
  input: Record<string, unknown>;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  version: number;
};

export type CaptureProposalBatchView = {
  id: string;
  captureId: string;
  summary: string;
  insights: Array<{ kind: 'blocker' | 'reflection'; text: string }>;
  modelId: string;
  promptVersion: string;
  version: number;
  createdAt: string;
  items: CaptureProposalItemView[];
};

export type CaptureProposalActionResult = { ok: boolean; error?: string };
export type CaptureAnalysisJobView = {
  id: string;
  captureId: string;
  status: 'running' | 'succeeded' | 'failed';
  errorCode: string | null;
  createdAt: string;
};

async function authenticatedClient() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Capture Proposals require the canonical data model.');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  return supabase;
}

export async function getCaptureProposalQueue(): Promise<CaptureProposalBatchView[]> {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') return [];
  const supabase = await authenticatedClient();
  const { data: batches, error } = await supabase
    .from('capture_proposal_batches')
    .select(
      'id,source_capture_id,analysis_summary,insights_json,model_id,prompt_version,version,created_at'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error('Unable to load Capture Proposals.');
  const batchIds = (batches ?? []).map((batch) => String(batch.id));
  const { data: items, error: itemsError } = batchIds.length
    ? await supabase
        .from('ai_proposals')
        .select('id,batch_id,operation_id,input_json,summary,risk_class,version,sort_order')
        .in('batch_id', batchIds)
        .eq('status', 'pending')
        .order('sort_order')
    : { data: [], error: null };
  if (itemsError) throw new Error('Unable to load Capture Proposal items.');
  return (batches ?? []).map((batch) => ({
    id: String(batch.id),
    captureId: String(batch.source_capture_id),
    summary: String(batch.analysis_summary),
    insights: (batch.insights_json ?? []) as CaptureProposalBatchView['insights'],
    modelId: String(batch.model_id),
    promptVersion: String(batch.prompt_version),
    version: Number(batch.version),
    createdAt: String(batch.created_at),
    items: (items ?? [])
      .filter((item) => item.batch_id === batch.id)
      .map((item) => ({
        id: String(item.id),
        batchId: String(item.batch_id),
        operationId: String(item.operation_id),
        input: item.input_json as Record<string, unknown>,
        summary: String(item.summary),
        risk: item.risk_class as CaptureProposalItemView['risk'],
        version: Number(item.version),
      })),
  }));
}

export async function getCaptureAnalysisJobs(): Promise<CaptureAnalysisJobView[]> {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') return [];
  const supabase = await authenticatedClient();
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('id,source_capture_id,status,error_code,created_at')
    .eq('operation', 'capture_analysis')
    .not('source_capture_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Unable to load Capture analysis status.');
  const seen = new Set<string>();
  return (data ?? []).flatMap((job) => {
    const captureId = String(job.source_capture_id);
    if (seen.has(captureId)) return [];
    seen.add(captureId);
    const stale =
      job.status === 'running' && Date.now() - new Date(String(job.created_at)).getTime() > 120_000;
    return [
      {
        id: String(job.id),
        captureId,
        status: stale ? 'failed' : (job.status as CaptureAnalysisJobView['status']),
        errorCode: stale ? 'job_interrupted' : job.error_code ? String(job.error_code) : null,
        createdAt: String(job.created_at),
      },
    ];
  });
}

function refreshQueue() {
  revalidatePath('/inbox');
  revalidatePath('/', 'layout');
  revalidatePath('/activity');
}

export async function updateCaptureProposalItemAction(input: {
  id: string;
  batchId: string;
  expectedVersion: number;
  operationInput: Record<string, unknown>;
  summary: string;
}): Promise<CaptureProposalActionResult> {
  const identity = z
    .object({
      id: z.uuid(),
      batchId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      summary: z.string().trim().min(1).max(300),
    })
    .safeParse(input);
  if (!identity.success) return { ok: false, error: 'Check the proposed change.' };
  try {
    const supabase = await authenticatedClient();
    const { data: item, error } = await supabase
      .from('ai_proposals')
      .select('operation_id')
      .eq('id', input.id)
      .eq('batch_id', input.batchId)
      .eq('status', 'pending')
      .single();
    if (error || !item)
      return { ok: false, error: 'This Proposal changed. Refresh and try again.' };
    const validated = validateCaptureProposalItem({
      operationId: item.operation_id,
      input: input.operationInput,
      summary: identity.data.summary,
    });
    if (!validated) return { ok: false, error: 'The edited fields are not valid for this change.' };
    await executeOperation(
      supabase,
      'capture-proposal.item-update.v1',
      {
        id: identity.data.id,
        batchId: identity.data.batchId,
        expectedVersion: identity.data.expectedVersion,
        input: validated.input,
        summary: validated.summary,
      },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    refreshQueue();
    return { ok: true };
  } catch {
    return { ok: false, error: 'This Proposal changed. Refresh and try again.' };
  }
}

async function decideBatch(
  operationId: 'capture-proposal.dismiss.v1' | 'capture-proposal.apply.v1',
  id: string,
  expectedVersion: number
): Promise<CaptureProposalActionResult> {
  const parsed = z
    .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
    .safeParse({ id, expectedVersion });
  if (!parsed.success) return { ok: false, error: 'This Proposal is no longer valid.' };
  try {
    const supabase = await authenticatedClient();
    await executeOperation(supabase, operationId, parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshQueue();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        operationId === 'capture-proposal.apply.v1'
          ? 'Nothing was applied. Review the current records and try again.'
          : 'This Proposal changed. Refresh and try again.',
    };
  }
}

export async function dismissCaptureProposalBatchAction(id: string, expectedVersion: number) {
  return decideBatch('capture-proposal.dismiss.v1', id, expectedVersion);
}

export async function applyCaptureProposalBatchAction(id: string, expectedVersion: number) {
  return decideBatch('capture-proposal.apply.v1', id, expectedVersion);
}

export type CaptureFilingResult =
  | { ok: true; target: CaptureFilingTarget }
  | { ok: false; error: string };

async function readCaptureText(
  supabase: Awaited<ReturnType<typeof authenticatedClient>>,
  id: string
) {
  const { data, error } = await supabase
    .from('captures')
    .select('raw_text')
    .eq('id', id)
    .is('archived_at', null)
    .is('trashed_at', null)
    .single();
  if (error || !data) throw new Error('That Capture is no longer available.');
  // Read the words from the row rather than accepting them from the page. The
  // Capture is immutable server-side, so this is the only copy that is
  // guaranteed to be the one the person actually recorded.
  return String(data.raw_text);
}

async function workspaceClock(supabase: Awaited<ReturnType<typeof authenticatedClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('timezone,week_starts_on')
    .eq('owner_user_id', user?.id ?? '')
    .single();
  if (error || !data) throw new Error('Unable to load your Workspace.');
  return {
    localDate: dateInTimezone(String(data.timezone)),
    weekStartsOn: Number(data.week_starts_on),
  };
}

export async function fileCaptureAsNoteAction(captureId: string): Promise<CaptureFilingResult> {
  const parsed = z.uuid().safeParse(captureId);
  if (!parsed.success) return { ok: false, error: 'That Capture is no longer available.' };
  try {
    const supabase = await authenticatedClient();
    const rawText = await readCaptureText(supabase, parsed.data);
    const plan = planCaptureNote(rawText);
    const note = await executeOperation(supabase, 'note.create.v1', plan, {
      idempotencyKey: captureFilingKey(parsed.data, 'note'),
      surface: 'ui',
    });
    // The link is a second Operation so that a Note created but not yet linked
    // is recoverable by retrying rather than orphaned.
    await executeOperation(
      supabase,
      'capture.file-to-note.v1',
      { captureId: parsed.data, noteId: String(note.id) },
      { idempotencyKey: captureFilingKey(parsed.data, 'note-link'), surface: 'ui' }
    );
    refreshQueue();
    revalidatePath('/notes');
    return { ok: true, target: 'note' };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof CaptureFilingInputError
          ? caught.message
          : 'Nothing was filed. Your Capture is unchanged -- try again.',
    };
  }
}

export async function fileCaptureAsActionAction(captureId: string): Promise<CaptureFilingResult> {
  const parsed = z.uuid().safeParse(captureId);
  if (!parsed.success) return { ok: false, error: 'That Capture is no longer available.' };
  try {
    const supabase = await authenticatedClient();
    const rawText = await readCaptureText(supabase, parsed.data);
    const { localDate, weekStartsOn } = await workspaceClock(supabase);
    const plan = planCaptureAction(parsed.data, rawText, localDate, weekStartsOn);
    // One Operation, not two. The Action, the link back to the Capture and the
    // Capture's move to reviewed either all land or none of them do, so there
    // is no window in which an Action exists with no record of where it came
    // from -- which was the whole defect.
    await executeOperation(supabase, 'capture.file-to-action.v1', plan, {
      idempotencyKey: captureFilingKey(parsed.data, 'action'),
      surface: 'ui',
    });
    refreshQueue();
    // Every planner surface renders this Action, and they are listed in one
    // place precisely so a new caller cannot cover fewer of them than it looks.
    revalidatePlannerAndRecords();
    return { ok: true, target: 'action' };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof CaptureFilingInputError
          ? caught.message
          : 'Nothing was filed. Your Capture is unchanged -- try again.',
    };
  }
}
