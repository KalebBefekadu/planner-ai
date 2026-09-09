'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { nextParentMove, nextSiblingMove, placeUnderParent } from '@/lib/notes/sibling-order';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export type NoteView = {
  id: string;
  parentNoteId: string | null;
  title: string;
  bodyMarkdown: string;
  sortKey: number;
  aiExcluded: boolean;
  // The instant this Note was marked a favourite, or null when it is not one.
  // The instant rather than a flag, because the favourites list has an order a
  // person builds up, and Undo restores the exact prior instant rather than
  // guessing one.
  favoritedAt: string | null;
  version: number;
  updatedAt: string;
  /**
   * Whether this Note is a search result, as opposed to an ancestor carried
   * alongside one so the result can say where it is filed. Undefined when no
   * search is running, because then every Note is simply itself.
   */
  matchesQuery?: boolean;
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
    mediaType: string;
    scanState: 'quarantined' | 'approved' | 'rejected';
    // Present only while a removed attachment is still inside its retention
    // window, which is exactly when a person can still take the removal back.
    removedAt: string | null;
    purgeAfter: string | null;
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
    favoritedAt: (note.favorited_at as string | null) ?? null,
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
  const matches = (data ?? []).map((note) => mapNote(note as Record<string, unknown>));
  if (!normalizedQuery) return matches;

  // A result is identified by where it is filed, so the Notes that say where
  // that is have to come back with it. Without them a match filed two levels
  // down has no path to show and, once opened, no ancestors to name -- which is
  // precisely the case a search is for.
  //
  // The chain is walked a level at a time rather than a Note at a time, so a
  // deep vault costs one round trip per level of depth rather than one per
  // ancestor.
  const byId = new Map(matches.map((note) => [note.id, note]));
  let wanted = [
    ...new Set(
      matches
        .map((note) => note.parentNoteId)
        .filter((parentId): parentId is string => parentId !== null && !byId.has(parentId))
    ),
  ];
  while (wanted.length) {
    const { data: parents, error: parentError } = await supabase
      .from('notes')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('id', wanted);
    if (parentError) throw new Error('Unable to load Notes.');
    if (!parents?.length) break;
    const next = new Set<string>();
    for (const row of parents) {
      const mapped = mapNote(row as Record<string, unknown>);
      byId.set(mapped.id, mapped);
      if (mapped.parentNoteId && !byId.has(mapped.parentNoteId)) next.add(mapped.parentNoteId);
    }
    wanted = [...next];
  }

  // Ancestors travel with the results but are not results themselves; marking
  // them keeps the decision about what to render with the caller.
  const matchIds = new Set(matches.map((match) => match.id));
  return [...byId.values()].map((note) => ({ ...note, matchesQuery: matchIds.has(note.id) }));
}

// Favourites are read on their own rather than filtered out of the tree query.
// The sidebar tree narrows to matches while a search is running, and pulling
// favourites from that same list made a person's pinned pages disappear the
// moment they typed -- exactly when a shortcut out of the results is most
// useful. This read is bounded by the number of favourites, not the vault.
export async function getFavoriteNotes(): Promise<NoteView[]> {
  const { supabase, workspaceId } = await notesClient();
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .not('favorited_at', 'is', null)
    .order('favorited_at');
  if (error) throw new Error('Unable to load your favourite Notes.');
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
    // Removed attachments are still listed while they can be restored. Hiding
    // them made the undo live only in the tab that did the removal: a reload
    // left the file present in storage, recoverable for another thirty days,
    // and invisible to the only person who could recover it.
    supabase
      .from('note_attachments')
      .select('id,original_name,byte_size,media_type,scan_state,removed_at,purge_after')
      .eq('workspace_id', workspaceId)
      .eq('note_id', noteId)
      .or(`removed_at.is.null,purge_after.gt.${new Date().toISOString()}`)
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
      mediaType: attachment.media_type,
      scanState: attachment.scan_state as NoteKnowledgeContext['attachments'][number]['scanState'],
      removedAt: attachment.removed_at,
      purgeAfter: attachment.purge_after,
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

// Marking a favourite goes through the same versioned Operation as every other
// change to a Note, so it survives a version conflict, is recorded in Activity,
// and can be undone. Holding it in the page instead would have lost it on the
// next reload and on every other device.
export async function setNoteFavorite(id: string, favorite: boolean, expectedVersion: number) {
  const { supabase } = await notesClient();
  const note = await executeOperation(
    supabase,
    'note.favorite.v1',
    { id, favorite, expectedVersion },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

// Sibling order is a deliberate decision a person makes, and until now it could
// only be changed through the assistant or MCP. Moving a Note writes the
// midpoint between its new neighbours rather than renumbering the whole level,
// so one move touches one Note and stays reversible.
export async function moveNoteWithinParent(input: {
  id: string;
  direction: 'up' | 'down';
  expectedVersion: number;
}) {
  const { supabase, workspaceId } = await notesClient();
  const { data: current, error: currentError } = await supabase
    .from('notes')
    .select('id,parent_note_id,sort_key')
    .eq('workspace_id', workspaceId)
    .eq('id', input.id)
    .is('archived_at', null)
    .is('trashed_at', null)
    .single();
  if (currentError || !current) throw new Error('This Note is no longer available.');

  const parentId = current.parent_note_id as string | null;
  let siblingRequest = supabase
    .from('notes')
    .select('id,sort_key')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('sort_key');
  siblingRequest =
    parentId === null
      ? siblingRequest.is('parent_note_id', null)
      : siblingRequest.eq('parent_note_id', parentId);
  const { data: siblings, error: siblingsError } = await siblingRequest;
  if (siblingsError || !siblings) throw new Error('Unable to read the surrounding Notes.');

  const move = nextSiblingMove(
    siblings.map((sibling) => ({
      id: sibling.id as string,
      sortKey: Number(sibling.sort_key),
    })),
    input.id,
    input.direction
  );
  // A Note already at the edge of its level has nowhere to go. That is not an
  // error; the control is simply unavailable.
  if (move.outcome === 'edge') return null;
  if (move.outcome === 'exhausted') {
    throw new Error('There is no room left between these Notes. Move a neighbour first.');
  }

  const note = await executeOperation(
    supabase,
    'note.move.v1',
    {
      id: input.id,
      parentNoteId: parentId,
      sortKey: move.sortKey,
      expectedVersion: input.expectedVersion,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

// Where a Note sits in the hierarchy, as distinct from its order among its
// siblings. Like ordering, this could previously only be changed through the
// assistant or MCP, so the shape of a person's own knowledge base was an
// agent-only decision.
export async function moveNoteToNewParent(input: {
  id: string;
  direction: 'indent' | 'outdent';
  expectedVersion: number;
}) {
  const { supabase, workspaceId } = await notesClient();
  // Indent and outdent both depend on Notes outside the current level: the Note
  // above and its existing children, or the parent and what follows it. The
  // whole live tree is the smallest correct input.
  const { data: tree, error: treeError } = await supabase
    .from('notes')
    .select('id,parent_note_id,sort_key')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('sort_key');
  if (treeError || !tree) throw new Error('Unable to read the surrounding Notes.');

  const move = nextParentMove(
    tree.map((note) => ({
      id: note.id as string,
      parentNoteId: note.parent_note_id as string | null,
      sortKey: Number(note.sort_key),
    })),
    input.id,
    input.direction
  );
  // A Note with nothing above it cannot be indented, and a root Note has no
  // parent to leave. Neither is an error; the control is simply unavailable.
  if (move.outcome === 'edge') return null;
  if (move.outcome === 'exhausted') {
    throw new Error('There is no room left beside this Note. Move a neighbour first.');
  }

  const note = await executeOperation(
    supabase,
    'note.move.v1',
    {
      id: input.id,
      parentNoteId: move.parentNoteId,
      sortKey: move.sortKey,
      expectedVersion: input.expectedVersion,
    },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidatePath('/notes');
  return mapNote(note);
}

// Filing a Note anywhere in the hierarchy, rather than only under the Note
// above it or out to its grandparent. The destination is chosen explicitly, so
// this is the move that reaches a Note in another branch entirely.
export async function fileNoteUnder(input: {
  id: string;
  parentNoteId: string | null;
  expectedVersion: number;
}) {
  const { supabase, workspaceId } = await notesClient();
  const { data: tree, error: treeError } = await supabase
    .from('notes')
    .select('id,parent_note_id,sort_key')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('sort_key');
  if (treeError || !tree) throw new Error('Unable to read the surrounding Notes.');

  // The destination is re-checked here against the live tree rather than
  // trusted from the page. A stale page could otherwise ask to file a Note
  // under something that has since become its own descendant, which would take
  // that whole branch out of the tree.
  const move = placeUnderParent(
    tree.map((note) => ({
      id: note.id as string,
      parentNoteId: note.parent_note_id as string | null,
      sortKey: Number(note.sort_key),
    })),
    input.id,
    input.parentNoteId
  );
  if (move.outcome === 'edge') throw new Error('This Note cannot be filed there.');
  if (move.outcome === 'exhausted') {
    throw new Error('There is no room left beside this Note. Move a neighbour first.');
  }

  const note = await executeOperation(
    supabase,
    'note.move.v1',
    {
      id: input.id,
      parentNoteId: move.parentNoteId,
      sortKey: move.sortKey,
      expectedVersion: input.expectedVersion,
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
