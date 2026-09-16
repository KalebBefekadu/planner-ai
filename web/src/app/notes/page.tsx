import { notFound } from 'next/navigation';
import {
  getFavoriteNotes,
  getNoteDocument,
  getNoteKnowledgeContext,
  getNotes,
  type NoteView,
} from '@/app/notes/actions';
import { NotesShell } from '@/components/notes-shell';

/* The tree and the favourites list carry titles and structure, not text. The
   body of the one Note being read is fetched on its own and put back here, so
   the workspace still receives whole Notes and nothing downstream has to know
   that the rest of them arrived without their Markdown. */
function withDocument(notes: NoteView[], id: string | null, bodyMarkdown: string | null) {
  if (!id || bodyMarkdown === null) return notes;
  return notes.map((note) => (note.id === id ? { ...note, bodyMarkdown } : note));
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; q?: string; import?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const { note: selectedId, q, import: importRequested } = await searchParams;
  const [notes, favorites] = await Promise.all([getNotes(q), getFavoriteNotes()]);
  const activeId = selectedId ?? notes[0]?.id ?? null;
  /* A Note is reachable from the tree and from the favourites list, and the
     editor reads whichever one holds it, so the text has to go back into both.
     Fetching once and merging twice keeps that from becoming a second read of
     the same row. */
  const [knowledge, document] = await Promise.all([
    activeId ? getNoteKnowledgeContext(activeId) : null,
    activeId ? getNoteDocument(activeId) : null,
  ]);
  return (
    <NotesShell
      activeKey={activeId ?? 'none'}
      notes={withDocument(notes, activeId, document)}
      favorites={withDocument(favorites, activeId, document)}
      selectedId={activeId}
      query={q ?? ''}
      knowledge={knowledge}
      initialImportOpen={importRequested === '1'}
    />
  );
}
