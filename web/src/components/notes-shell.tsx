'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NoteImportDialog } from '@/components/note-import-dialog';
import { NotesWorkspace } from '@/components/notes-workspace';
import type { NoteKnowledgeContext, NoteView } from '@/app/notes/actions';

/**
 * Holds the import dialog above the workspace.
 *
 * The workspace is deliberately remounted whenever the active Note changes, so
 * that a different Note's text can never appear over another one's draft.
 * Completing an import refreshes the page, and in a workspace with nothing
 * selected that refresh makes the first imported Note active -- which remounted
 * the workspace and destroyed the dialog reporting what had just been imported.
 * A person could import a vault and never learn how much of it arrived, or
 * which parts were skipped as duplicates or unsupported.
 *
 * Keeping the dialog here means the import report survives the refresh it
 * causes, while the workspace keeps resetting per Note as before.
 */
export function NotesShell({
  notes,
  selectedId,
  activeKey,
  query,
  knowledge,
  initialImportOpen = false,
}: {
  notes: NoteView[];
  selectedId: string | null;
  activeKey: string;
  query: string;
  knowledge: NoteKnowledgeContext | null;
  initialImportOpen?: boolean;
}) {
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(initialImportOpen);

  return (
    <>
      <NotesWorkspace
        key={activeKey}
        notes={notes}
        selectedId={selectedId}
        query={query}
        knowledge={knowledge}
        onRequestImport={() => setImportOpen(true)}
      />
      <NoteImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCompleted={() => router.refresh()}
      />
    </>
  );
}
