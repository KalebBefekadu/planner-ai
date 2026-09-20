'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { executeOperation } from '@/lib/operations';
import { revalidatePlannerAndRecords } from '@/lib/planner-revalidation';
import { requireOwnedWorkspaceId } from '@/lib/supabase/authenticated-context';
import { selectAll } from '@/lib/supabase/select-all';
import {
  areaAncestry,
  areaScopeIds,
  buildAreaTree,
  type AreaRow,
  type AreaNode,
} from '@/lib/areas/tree';

export type AreaScope = 'descendants' | 'self';

export type AreaWorkItem = {
  id: string;
  title: string;
  status: string;
  version: number;
  scheduledOn: string | null;
  areaId: string | null;
};

export type AreaGoalItem = {
  id: string;
  title: string;
  status: string;
  kind: string;
  dueOn: string | null;
  version: number;
  areaId: string | null;
};

export type AreaNoteItem = {
  id: string;
  title: string;
  updatedAt: string;
  isCanonicalPage: boolean;
};

export type AreaPageData = {
  area: AreaRow;
  ancestry: AreaRow[];
  children: AreaRow[];
  tree: AreaNode[];
  scope: AreaScope;
  scopeIds: string[];
  /** Null means this area has not been given a direction of its own. */
  vision: { id: string; bodyMarkdown: string; version: number } | null;
  /** The nearest ancestor's direction, shown as context, never copied down. */
  inheritedVision: { areaId: string; areaName: string; bodyMarkdown: string } | null;
  canonicalNote: { id: string; title: string; bodyMarkdown: string; version: number } | null;
  goals: AreaGoalItem[];
  openWork: AreaWorkItem[];
  notes: AreaNoteItem[];
  /** True when the list was cut short, so the page can say so honestly. */
  moreWork: boolean;
  moreNotes: boolean;
  aiExcludedByAncestor: boolean;
};

/** Bounded, and the same bound the page reports when it is reached. */
const WORK_PAGE_SIZE = 50;
const NOTE_PAGE_SIZE = 50;

function toAreaRow(row: Record<string, unknown>): AreaRow {
  return {
    id: row.id as string,
    parentAreaId: (row.parent_area_id as string | null) ?? null,
    name: row.name as string,
    icon: (row.icon as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    sortKey: Number(row.sort_key),
    canonicalNoteId: row.canonical_note_id as string,
    aiExcluded: Boolean(row.ai_excluded),
    version: Number(row.version),
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

async function readAreaRows() {
  const { supabase, workspaceId } = await requireOwnedWorkspaceId();
  /* Navigation has to be complete. A tree that silently stops at PostgREST's
     thousand-row cap is a tree with areas missing from it, and nothing on
     screen would say so. */
  const { data, error } = await selectAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('life_areas')
      .select(
        'id,parent_area_id,name,icon,color,sort_key,canonical_note_id,ai_excluded,version,archived_at'
      )
      .eq('workspace_id', workspaceId)
      .order('sort_key')
      .order('id')
      .range(from, to)
  );
  if (error) throw new Error('Unable to load your life areas.');
  return { supabase, workspaceId, rows: (data ?? []).map(toAreaRow) };
}

/** The tree, for navigation. Archived areas are carried so the page can offer
 *  to show them; `hiddenByAncestor` decides what is visible by default. */
export async function getAreaTree(): Promise<{ rows: AreaRow[]; tree: AreaNode[] }> {
  const { rows } = await readAreaRows();
  return { rows, tree: buildAreaTree(rows) };
}

export async function getAreaPage(areaId: string, scope: AreaScope): Promise<AreaPageData | null> {
  const { supabase, workspaceId, rows } = await readAreaRows();
  const area = rows.find((row) => row.id === areaId);
  if (!area) return null;

  const ancestry = areaAncestry(rows, areaId);
  const scopeIds = areaScopeIds(rows, areaId, scope);

  const [visionResult, noteResult, goalsResult, workResult, notesResult] = await Promise.all([
    supabase
      .from('visions')
      .select('id,body_markdown,version,area_id')
      .eq('workspace_id', workspaceId)
      .in(
        'area_id',
        ancestry.map((row) => row.id)
      )
      .is('archived_at', null)
      .is('trashed_at', null),
    supabase
      .from('notes')
      .select('id,title,body_markdown,version')
      .eq('workspace_id', workspaceId)
      .eq('id', area.canonicalNoteId)
      .is('trashed_at', null)
      .maybeSingle(),
    supabase
      .from('goals')
      .select('id,title,status,kind,due_on,version,primary_area_id')
      .eq('workspace_id', workspaceId)
      .in('primary_area_id', scopeIds)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('due_on', { ascending: true, nullsFirst: false })
      .limit(WORK_PAGE_SIZE + 1),
    supabase
      .from('actions')
      .select('id,title,status,version,scheduled_on,primary_area_id')
      .eq('workspace_id', workspaceId)
      .in('primary_area_id', scopeIds)
      .in('status', ['open', 'in_progress', 'blocked'])
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('scheduled_on', { ascending: true, nullsFirst: false })
      .limit(WORK_PAGE_SIZE + 1),
    supabase
      .from('notes')
      .select('id,title,updated_at')
      .eq('workspace_id', workspaceId)
      .in('primary_area_id', scopeIds)
      .is('archived_at', null)
      .is('trashed_at', null)
      .order('updated_at', { ascending: false })
      .limit(NOTE_PAGE_SIZE + 1),
  ]);

  if (
    visionResult.error ||
    goalsResult.error ||
    workResult.error ||
    notesResult.error ||
    noteResult.error
  ) {
    throw new Error('Unable to load this life area.');
  }

  const visions = visionResult.data ?? [];
  const own = visions.find((row) => row.area_id === areaId) ?? null;
  /* The nearest ancestor that has written one. Shown as context so a subarea
     can see the direction it sits under; never copied into the subarea, which
     would make two editable copies of one sentence. */
  const inheritedRow = [...ancestry]
    .reverse()
    .slice(1)
    .map((row) => ({ row, vision: visions.find((vision) => vision.area_id === row.id) }))
    .find((candidate) => candidate.vision);

  const goals = (goalsResult.data ?? []).slice(0, WORK_PAGE_SIZE).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as string,
    kind: (row.kind as string) ?? 'outcome',
    dueOn: (row.due_on as string | null) ?? null,
    version: Number(row.version),
    areaId: (row.primary_area_id as string | null) ?? null,
  }));
  const openWork = (workResult.data ?? []).slice(0, WORK_PAGE_SIZE).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as string,
    version: Number(row.version),
    scheduledOn: (row.scheduled_on as string | null) ?? null,
    areaId: (row.primary_area_id as string | null) ?? null,
  }));
  const notes = (notesResult.data ?? []).slice(0, NOTE_PAGE_SIZE).map((row) => ({
    id: row.id as string,
    title: (row.title as string) || 'Untitled',
    updatedAt: row.updated_at as string,
    isCanonicalPage: row.id === area.canonicalNoteId,
  }));

  return {
    area,
    ancestry,
    children: rows.filter((row) => row.parentAreaId === areaId),
    tree: buildAreaTree(rows),
    scope,
    scopeIds,
    vision: own
      ? {
          id: own.id as string,
          bodyMarkdown: own.body_markdown as string,
          version: Number(own.version),
        }
      : null,
    inheritedVision:
      inheritedRow && inheritedRow.vision
        ? {
            areaId: inheritedRow.row.id,
            areaName: inheritedRow.row.name,
            bodyMarkdown: inheritedRow.vision.body_markdown as string,
          }
        : null,
    canonicalNote: noteResult.data
      ? {
          id: noteResult.data.id as string,
          title: noteResult.data.title as string,
          bodyMarkdown: noteResult.data.body_markdown as string,
          version: Number(noteResult.data.version),
        }
      : null,
    goals,
    openWork,
    notes,
    moreWork: (workResult.data ?? []).length > WORK_PAGE_SIZE,
    moreNotes: (notesResult.data ?? []).length > NOTE_PAGE_SIZE,
    aiExcludedByAncestor: ancestry.slice(0, -1).some((row) => row.aiExcluded),
  };
}

function revalidateAreas(areaId?: string) {
  revalidatePath('/areas');
  if (areaId) revalidatePath(`/areas/${areaId}`);
  revalidatePath('/notes');
  revalidatePlannerAndRecords();
}

export async function createArea(input: {
  name: string;
  parentAreaId: string | null;
  existingNoteId?: string | null;
  icon?: string | null;
  color?: string | null;
  /** Stable for one logical attempt, so a double submit is one area. */
  requestKey: string;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const created = await executeOperation(
    supabase,
    'area.create.v1',
    {
      name: input.name,
      parentAreaId: input.parentAreaId,
      existingNoteId: input.existingNoteId ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
    },
    { idempotencyKey: `area-create:${input.requestKey}`, surface: 'ui' }
  );
  revalidateAreas(created.id);
  return { id: created.id, name: created.name, canonicalNoteId: created.canonical_note_id };
}

export async function renameArea(input: {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  renameCanonicalNote: boolean;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const updated = await executeOperation(supabase, 'area.update.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.id);
  return { version: updated.version, name: updated.name, noteTitle: updated.note_title };
}

export async function moveArea(input: {
  id: string;
  parentAreaId: string | null;
  sortKey: number;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const moved = await executeOperation(supabase, 'area.move.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.id);
  return { version: moved.version };
}

export async function setAreaArchived(input: {
  id: string;
  archived: boolean;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const result = await executeOperation(
    supabase,
    input.archived ? 'area.archive.v1' : 'area.restore.v1',
    { id: input.id, expectedVersion: input.expectedVersion },
    { idempotencyKey: randomUUID(), surface: 'ui' }
  );
  revalidateAreas(input.id);
  return { version: result.version, archivedAt: result.archived_at };
}

export async function setAreaAiExclusion(input: {
  id: string;
  aiExcluded: boolean;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const result = await executeOperation(supabase, 'area.ai-exclusion.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.id);
  return { version: result.version, aiExcluded: result.ai_excluded };
}

export async function replaceAreaPage(input: {
  id: string;
  noteId: string;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const result = await executeOperation(supabase, 'area.replace-note.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.id);
  return { version: result.version, canonicalNoteId: result.canonical_note_id };
}

export async function saveAreaVision(input: { areaId: string; bodyMarkdown: string }) {
  const { supabase } = await requireOwnedWorkspaceId();
  const saved = await executeOperation(supabase, 'area.vision.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.areaId);
  return { id: saved.id, version: saved.version };
}

export async function assignToArea(input: {
  itemType: 'goal' | 'action' | 'note';
  id: string;
  areaId: string | null;
  expectedVersion: number;
}) {
  const { supabase } = await requireOwnedWorkspaceId();
  const result = await executeOperation(supabase, 'area.assign.v1', input, {
    idempotencyKey: randomUUID(),
    surface: 'ui',
  });
  revalidateAreas(input.areaId ?? undefined);
  return { version: Number(result.version) };
}

/** Notes that could become an area's page: not already one, not in the bin. */
export async function getAdoptableNotes(query: string) {
  const { supabase, workspaceId } = await requireOwnedWorkspaceId();
  /* Every page already spoken for, so the list offers only pages that are
     free. Complete for the same reason the tree is. */
  const taken = await selectAll<{ canonical_note_id: string }>((from, to) =>
    supabase
      .from('life_areas')
      .select('canonical_note_id')
      .eq('workspace_id', workspaceId)
      .order('canonical_note_id')
      .range(from, to)
  );
  if (taken.error) throw new Error('Unable to load your pages.');
  const takenIds = new Set((taken.data ?? []).map((row) => row.canonical_note_id));

  let request = supabase
    .from('notes')
    .select('id,title,updated_at')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .is('trashed_at', null)
    .order('updated_at', { ascending: false })
    .limit(40);
  const trimmed = query.trim();
  if (trimmed) request = request.ilike('title', `%${trimmed}%`);

  const { data, error } = await request;
  if (error) throw new Error('Unable to load your pages.');
  return (data ?? [])
    .filter((row) => !takenIds.has(row.id as string))
    .slice(0, 20)
    .map((row) => ({ id: row.id as string, title: (row.title as string) || 'Untitled' }));
}
