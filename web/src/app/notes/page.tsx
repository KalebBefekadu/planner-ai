import { notFound } from 'next/navigation';
import { getNoteKnowledgeContext, getNotes } from '@/app/notes/actions';
import { NotesWorkspace } from '@/components/notes-workspace';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; q?: string; import?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const { note: selectedId, q, import: importRequested } = await searchParams;
  const notes = await getNotes(q);
  const activeId = selectedId ?? notes[0]?.id ?? null;
  const knowledge = activeId ? await getNoteKnowledgeContext(activeId) : null;
  return (
    <NotesWorkspace
      key={activeId}
      notes={notes}
      selectedId={activeId}
      query={q ?? ''}
      knowledge={knowledge}
      initialImportOpen={importRequested === '1'}
    />
  );
}
