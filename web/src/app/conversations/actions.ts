'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { executeOperation } from '@/lib/operations';
import { formatConversationTranscript, type TranscriptMessage } from '@/lib/conversations';
import { createClient } from '@/lib/supabase/server';

export type ConversationView = {
  id: string;
  title: string;
  status: 'active' | 'archived';
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
  lastMessageAt: string | null;
};

export type ConversationActionResult = { ok: boolean; error?: string; href?: string };

function ensureCanonical() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Conversations require the canonical data model.');
  }
}

async function authenticatedClient() {
  ensureCanonical();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  return supabase;
}

export async function getConversations(
  query: string,
  status: 'active' | 'archived'
): Promise<ConversationView[]> {
  const parsed = z.string().trim().max(100).safeParse(query);
  if (!parsed.success) return [];
  const supabase = await authenticatedClient();
  const { data, error } = await supabase.rpc('search_conversations', {
    p_query: parsed.data,
    p_status: status,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw new Error('Unable to search conversations.');
  return ((data ?? []) as Record<string, unknown>[]).map((conversation) => ({
    id: String(conversation.id),
    title: String(conversation.title),
    status: conversation.status as ConversationView['status'],
    version: Number(conversation.version),
    updatedAt: String(conversation.updated_at),
    archivedAt: conversation.archived_at ? String(conversation.archived_at) : null,
    messageCount: Number(conversation.message_count),
    lastMessageAt: conversation.last_message_at ? String(conversation.last_message_at) : null,
  }));
}

function refreshConversations() {
  revalidatePath('/conversations');
  revalidatePath('/', 'layout');
  revalidatePath('/activity');
}

export async function renameConversationAction(
  id: string,
  expectedVersion: number,
  title: string
): Promise<ConversationActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      title: z.string().trim().min(1).max(200),
    })
    .safeParse({ id, expectedVersion, title });
  if (!parsed.success) return { ok: false, error: 'Enter a title between 1 and 200 characters.' };
  try {
    const supabase = await authenticatedClient();
    await executeOperation(supabase, 'conversation.rename.v1', parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshConversations();
    return { ok: true };
  } catch {
    return { ok: false, error: 'This conversation changed. Refresh and try again.' };
  }
}

export async function changeConversationStatusAction(
  id: string,
  expectedVersion: number,
  status: 'active' | 'archived'
): Promise<ConversationActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      status: z.enum(['active', 'archived']),
    })
    .safeParse({ id, expectedVersion, status });
  if (!parsed.success) return { ok: false, error: 'This conversation is no longer valid.' };
  try {
    const supabase = await authenticatedClient();
    await executeOperation(supabase, 'conversation.status.v1', parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshConversations();
    return { ok: true };
  } catch {
    return { ok: false, error: 'This conversation changed. Refresh and try again.' };
  }
}

export async function deleteConversationAction(
  id: string,
  expectedVersion: number,
  confirmation: string
): Promise<ConversationActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      expectedVersion: z.number().int().positive(),
      confirmation: z.literal('DELETE CONVERSATION'),
    })
    .safeParse({ id, expectedVersion, confirmation });
  if (!parsed.success) return { ok: false, error: 'Type DELETE CONVERSATION to confirm.' };
  try {
    const supabase = await authenticatedClient();
    await executeOperation(supabase, 'conversation.delete.v1', parsed.data, {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    });
    refreshConversations();
    return { ok: true };
  } catch {
    return { ok: false, error: 'The conversation could not be deleted. Refresh and try again.' };
  }
}

export async function promoteConversationAction(
  id: string,
  destination: 'note' | 'capture' | 'memory',
  statement?: string
): Promise<ConversationActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      destination: z.enum(['note', 'capture', 'memory']),
      statement: z.string().trim().max(2_000).optional(),
    })
    .safeParse({ id, destination, statement });
  if (!parsed.success || (destination === 'memory' && !parsed.data.statement)) {
    return { ok: false, error: 'Write the specific fact Planner AI should remember.' };
  }
  try {
    const supabase = await authenticatedClient();
    const [{ data: conversation, error }, { data: messages, error: messagesError }] =
      await Promise.all([
        supabase
          .from('conversations')
          .select('id,title,created_at')
          .eq('id', parsed.data.id)
          .is('trashed_at', null)
          .single(),
        supabase
          .from('conversation_messages')
          .select('role,content,created_at')
          .eq('conversation_id', parsed.data.id)
          .order('created_at', { ascending: true }),
      ]);
    if (error || messagesError || !conversation) {
      return { ok: false, error: 'The conversation could not be loaded.' };
    }
    if (destination === 'memory') {
      await executeOperation(
        supabase,
        'memory.create.v1',
        {
          statement: parsed.data.statement as string,
          sourceType: 'conversation',
          sourceId: parsed.data.id,
        },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
      revalidatePath('/settings/memory');
      return { ok: true, href: '/settings/memory' };
    }
    const body = formatConversationTranscript(
      String(conversation.title),
      (messages ?? []) as TranscriptMessage[]
    );
    if (destination === 'note') {
      if (body.length > 500_000) {
        return {
          ok: false,
          error: 'This conversation is too large for one Note. Export it instead.',
        };
      }
      const note = await executeOperation(
        supabase,
        'note.create.v1',
        { title: String(conversation.title), bodyMarkdown: body, parentNoteId: null },
        { idempotencyKey: randomUUID(), surface: 'ui' }
      );
      revalidatePath('/notes');
      return { ok: true, href: `/notes?note=${note.id}` };
    }
    if (body.length > 60_000) {
      return {
        ok: false,
        error: 'This conversation is too large for one Capture. Export it instead.',
      };
    }
    await executeOperation(
      supabase,
      'capture.create.v1',
      { rawText: body, source: 'import' },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    revalidatePath('/inbox');
    return { ok: true, href: '/inbox' };
  } catch {
    return { ok: false, error: 'The conversation could not be saved there.' };
  }
}
