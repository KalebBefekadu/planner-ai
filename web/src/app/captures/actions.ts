'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { executeOperation, OperationFailure } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type CaptureView = {
  id: string;
  raw_text: string;
  source: 'typed' | 'voice' | 'import';
  state: 'new' | 'proposed' | 'reviewed' | 'archived';
  created_at: string;
  archived_at: string | null;
  operation_receipt_id?: string;
};

export type CaptureSyncResult = { ok: true; capture: CaptureView } | { ok: false; code: string };

const canonicalEnabled = process.env.PLANNER_DATA_MODEL === 'canonical';

function validateRawCapture(rawText: string) {
  if (rawText.trim().length < 3) throw new Error('Please write at least three characters.');
  if (rawText.length > 60_000) throw new Error('Keep this capture under 60,000 characters.');
  return rawText;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new OperationFailure('authentication_required', 'Please sign in to continue.');
  return { supabase, user };
}

async function requireWorkspaceId() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Unable to load your workspace.');
  return { supabase, workspaceId: data.id as string };
}

export async function getTranscripts(limit = 7): Promise<CaptureView[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  if (canonicalEnabled) {
    const { supabase, workspaceId } = await requireWorkspaceId();
    const { data, error } = await supabase
      .from('captures')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('trashed_at', null)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw new Error('Unable to load your recent captures.');
    return (data ?? []).map((capture) => ({
      id: capture.id as string,
      raw_text: capture.raw_text as string,
      source: capture.source as CaptureView['source'],
      state: capture.state as CaptureView['state'],
      created_at: capture.created_at as string,
      archived_at: capture.archived_at as string | null,
    }));
  }
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('Unable to load your recent captures.');
  return (data ?? []).map((capture) => ({
    id: capture.id,
    raw_text: capture.raw_text,
    source: 'typed',
    state: 'new',
    created_at: capture.created_at,
    archived_at: capture.deleted_at,
  }));
}

export async function saveTranscript(
  rawText: string,
  source: CaptureView['source'] = 'typed',
  idempotencyKey: string = randomUUID()
) {
  const exactText = validateRawCapture(rawText);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
  ) {
    throw new Error('This capture cannot be retried safely.');
  }
  if (canonicalEnabled) {
    const { supabase } = await requireUser();
    const saved = await executeOperation(
      supabase,
      'capture.create.v1',
      { rawText: exactText, source },
      { idempotencyKey, surface: 'ui' }
    );
    let operationReceiptId: string | undefined;
    if (process.env.PLANNER_OPERATION_JOURNAL_CAPTURE === 'enabled') {
      const { data: receipt, error: receiptError } = await supabase
        .from('operation_receipts')
        .select('id')
        .eq('operation_id', 'capture.create.v1')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (receiptError || !receipt) {
        throw new Error('Capture saved, but its acceptance receipt is temporarily unavailable.');
      }
      operationReceiptId = receipt.id;
    }
    revalidatePlannerAndRecords();
    return {
      id: saved.id,
      raw_text: saved.raw_text,
      source: saved.source,
      state: saved.state,
      created_at: saved.created_at,
      archived_at: saved.archived_at,
      operation_receipt_id: operationReceiptId,
    } satisfies CaptureView;
  }
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('transcripts')
    .insert({ user_id: user.id, raw_text: exactText })
    .select()
    .single();
  if (error) throw new Error('Unable to save your capture.');
  revalidatePlannerAndRecords();
  return {
    id: data.id,
    raw_text: data.raw_text,
    source,
    state: 'new',
    created_at: data.created_at,
    archived_at: data.deleted_at,
  } satisfies CaptureView;
}

export async function syncTranscript(
  rawText: string,
  source: CaptureView['source'],
  idempotencyKey: string
): Promise<CaptureSyncResult> {
  try {
    return { ok: true, capture: await saveTranscript(rawText, source, idempotencyKey) };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof OperationFailure ? error.code : 'service_unavailable',
    };
  }
}
