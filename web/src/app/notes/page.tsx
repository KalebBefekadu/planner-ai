import { notFound } from 'next/navigation';
import {
  getFavoriteNotes,
  getNoteAncestorTitles,
  getNoteKnowledgeContext,
  getNotes,
} from '@/app/notes/actions';
import { NotesShell } from '@/components/notes-shell';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; q?: string; import?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const { note: selectedId, q, import: importRequested } = await searchParams;
  const notes = await getNotes(q);
  // Only a search needs the paths, and only a search pays for reading them.
  const ancestorTitles = q ? await getNoteAncestorTitles() : {};
  const favorites = await getFavoriteNotes();
  const activeId = selectedId ?? notes[0]?.id ?? null;
  const knowledge = activeId ? await getNoteKnowledgeContext(activeId) : null;
  return (
    <NotesShell
      activeKey={activeId ?? 'none'}
      notes={notes}
      selectedId={activeId}
      query={q ?? ''}
      ancestorTitles={ancestorTitles}
      favorites={favorites}
      knowledge={knowledge}
      initialImportOpen={importRequested === '1'}
    />
  );
}
