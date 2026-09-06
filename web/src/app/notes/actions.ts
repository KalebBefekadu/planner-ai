'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type NoteView = {
  id: string;
  parentNoteId: string | null;
  title: string;
  bodyMarkdown: string;
  sortKey: number;
  aiExcluded: boolean;
  version: number;
  updatedAt: string;
};

export type NoteKnowledgeContext = {
  tags: string[];
  links: Array<{
    id: string;
    sourceNoteId: string;
    targetNoteId: string;
    relationType: 'related' | 'supports' | 'contradicts' | 'continues';
  }>;
  revisions: Array<{
    id: string;
    title: string;
    bodyMarkdown: string;
    sourceVersion: number;
    createdAt: string;
  }>;
  captures: Array<{
    id: string;
    rawText: string;
    source: 'typed' | 'voice' | 'import';
    createdAt: string;
  }>;
  goalLinks: string[];
  actionLinks: string[];
  goals: Array<{ id: string; title: string }>;
  actions: Array<{ id: string; title: string }>;
  attachments: Array<{
    id: string;
    originalName: string;
    byteSize: number;
    scanState: 'quarantined' | 'approved' | 'rejected';
  }>;
};

function ensureNotesEnabled() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    throw new Error('Notes are unavailable until the canonical data migration is complete.');
  }
}

async function notesClient() {
  ensureNotesEnabled();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in to continue.');
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !workspace) throw new Error('Unable to load your workspace.');
  return { supabase, workspaceId: workspace.id as string };
}

function mapNote(note: Record<string, unknown>): NoteView {
  return {
    id: note.id as string,
    parentNoteId: note.parent_note_id as string | null,
    title: note.title as string,
    bodyMarkdown: note.body_markdown as string,
    sortKey: Number(note.sort_key),
    aiExcluded: Boolean(note.ai_excluded),
    version: Number(note.version),
    updatedAt: note.updated_at as string,
  };
}

export async function getNotes(query?: string) {
  const { supabase, workspaceId } = await notesClient();
  let request = supabase
    .from('notes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('sort_key');
  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    request = request.textSearch('search_vector', normalizedQuery, {
      config: 'simple',
      type: 'websearch',
    });
  }
  const { data, error } = await request;
  if (error) throw new Error('Unable to load Notes.');
  return (data ?? []).map((note) => mapNote(note as Record<string, unknown>));
}

export async function getNoteKnowledgeContext(noteId: string): Promise<NoteKnowledgeContext> {
  const { supabase, workspaceId } = await notesClient();
  const [
    noteTags,
    links,
    revisions,
    captures,
    goalLinks,
    actionLinks,
    goals,
    actions,
    attachments,
  ] = await Promise.all([
    supabase
      .from('note_tags')
      .select('tag_id')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId),
    supabase
      .from('note_links')
      .select('id,source_note_id,target_note_id,relation_type')
      .eq('workspace_id', workspaceId)
      .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`)
      .order('created_at', { ascending: false }),
    supabase
      .from('note_revisions')
      .select('id,title,body_markdown,source_version,created_at')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('captures')
      .select('id,raw_text,source,created_at')
      .eq('workspace_id', workspaceId)
      .in('state', ['new', 'proposed'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('note_goal_links')
      .select('goal_id')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId),
    supabase
      .from('note_action_links')
      .select('action_id')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId),
    supabase
      .from('goals')
      .select('id,title')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('title'),
    supabase
      .from('actions')
      .select('id,title')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('title'),
    supabase
      .from('note_attachments')
      .select('id,original_name,byte_size,scan_state')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId)
      .is('removed_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (
    noteTags.error ||
    links.error ||
    revisions.error ||
    captures.error ||
    goalLinks.error ||
    actionLinks.error ||
    goals.error ||
    actions.error ||
    attachments.error
  ) {
    throw new Error('Unable to load Note connections.');
  }

  const tagIds = (noteTags.data ?? []).map((row) => row.tag_id as string);
  const tags = tagIds.length
    ? await supabase
        .from('tags')
        .select('id,name')
        .eq('workspace_id', workspaceId)
        .in('id', tagIds)
        .order('name')
    : { data: [], error: null };
  if (tags.error) throw new Error('Unable to load Note tags.');

  return {
    tags: (tags.data ?? []).map((tag) => tag.name as string),
    links: (links.data ?? []).map((link) => ({
      id: link.id as string,
      sourceNoteId: link.source_note_id as string,
      targetNoteId: link.target_note_id as string,
      relationType: link.relation_type as NoteKnowledgeContext['links'][number]['relationType'],
    })),
    revisions: (revisions.data ?? []).map((revision) => ({
      id: revision.id as string,
      title: revision.title as string,
      bodyMarkdown: revision.body_markdown as string,
      sourceVersion: Number(revision.source_version),
      createdAt: revision.created_at as string,
    })),
    captures: (captures.data ?? []).map((capture) => ({
      id: capture.id as string,
      rawText: capture.raw_text as string,
      source: capture.source as NoteKnowledgeContext['captures'][number]['source'],
      createdAt: capture.created_at as string,
    })),
    goalLinks: (goalLinks.data ?? []).map((link) => link.goal_id as string),
    actionLinks: (actionLinks.data ?? []).map((link) => link.action_id as string),
    goals: (goals.data ?? []).map((goal) => ({
      id: goal.id as string,
      title: goal.title as string,
    })),
    actions: (actions.data ?? []).map((action) => ({
      id: action.id as string,
      title: action.title as string,
    })),
    attachments: (attachments.data ?? []).map((attachment) => ({
      id: attachment.id,
      originalName: attachment.original_name,
      byteSize: attachment.byte_size,
      scanState: attachment.scan_state as NoteKnowledgeContext['attachments'][number]['scanState'],
    })),
  };
}

export async function createNote(parentNoteId: string | null = null) {
  const { supabase } = await notesClient();
  const note = await executeOperation(
    supabase,
    'note.create.v1',
    {
      title: 'Untitled',
      bodyMarkdown: '',
      parentNoteId,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

export async function commitNoteImport(jobId: string, batchSize = 50) {
  const { supabase } = await notesClient();
  const result = await executeOperation(
    supabase,
    'note.import-commit.v1',
    { jobId, batchSize },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  revalidatePath('/activity');
  return result;
}

export async function updateNote(input: {
  id: string;
  title: string;
  bodyMarkdown: string;
  expectedVersion: number;
}) {
  const { supabase } = await notesClient();
  const note = await executeOperation(supabase, 'note.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/notes');
  return mapNote(note);
}

export async function setNoteAiExcluded(id: string, aiExcluded: boolean, expectedVersion: number) {
  const { supabase } = await notesClient();
  const note = await executeOperation(
    supabase,
    'note.ai-exclusion.v1',
    {
      id,
      aiExcluded,
      expectedVersion,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

export async function archiveNote(id: string, expectedVersion: number) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.archive.v1',
    { id, expectedVersion },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}

export async function setNoteTags(noteId: string, tags: string[]) {
  const { supabase } = await notesClient();
  const result = await executeOperation(
    supabase,
    'note.tags.set.v1',
    { noteId, tags },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
  return result;
}

export async function linkNote(input: {
  sourceNoteId: string;
  targetNoteId: string;
  relationType: NoteKnowledgeContext['links'][number]['relationType'];
}) {
  const { supabase } = await notesClient();
  const result = await executeOperation(supabase, 'note.link.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidatePath('/notes');
  return result;
}

export async function unlinkNote(linkId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.unlink.v1',
    { linkId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}

export async function fileCaptureToNote(captureId: string, noteId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'capture.file-to-note.v1',
    { captureId, noteId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
  revalidatePath('/inbox');
}

export async function restoreNoteRevision(input: {
  noteId: string;
  revisionId: string;
  expectedVersion: number;
}) {
  const { supabase, workspaceId } = await notesClient();
  const { data: revision, error } = await supabase
    .from('note_revisions')
    .select('title,body_markdown')
    .eq('workspace_id', workspaceId)
    .eq('note_id', input.noteId)
    .eq('id', input.revisionId)
    .single();
  if (error || !revision) throw new Error('That revision is no longer available.');
  const note = await executeOperation(
    supabase,
    'note.update.v1',
    {
      id: input.noteId,
      title: revision.title as string,
      bodyMarkdown: revision.body_markdown as string,
      expectedVersion: input.expectedVersion,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

export async function linkNoteGoal(noteId: string, goalId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.goal-link.v1',
    { noteId, goalId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}

export async function unlinkNoteGoal(noteId: string, goalId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.goal-unlink.v1',
    { noteId, goalId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}

export async function linkNoteAction(noteId: string, actionId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.action-link.v1',
    { noteId, actionId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}

export async function unlinkNoteAction(noteId: string, actionId: string) {
  const { supabase } = await notesClient();
  await executeOperation(
    supabase,
    'note.action-unlink.v1',
    { noteId, actionId },
    {
      idempotencyKey: randomUUID(),
      surface: 'ui',
    }
  );
  revalidatePath('/notes');
}
