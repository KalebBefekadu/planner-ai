'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NoteImportDialog } from '@/components/note-import-dialog';
import { NotesWorkspace } from '@/components/notes-workspace';
import type { NoteKnowledgeContext, NoteView } from '@/app/notes/actions';
import type { InspectorView } from '@/components/notes-workspace';

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
  favorites,
  selectedId,
  activeKey,
  query,
  knowledge,
  initialImportOpen = false,
}: {
  notes: NoteView[];
  favorites: NoteView[];
  selectedId: string | null;
  activeKey: string;
  query: string;
  knowledge: NoteKnowledgeContext | null;
  initialImportOpen?: boolean;
}) {
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(initialImportOpen);
  /**
   * Which inspector pane is open is a decision about what someone is currently
   * doing, not about the Note they are doing it to. It lives here rather than
   * inside the workspace because the workspace is remounted per Note: held
   * there, following a link snapped the pane back to Properties and hid the
   * backlink the person had just navigated to.
   */
  const [inspectorView, setInspectorView] = useState<InspectorView>('properties');

  return (
    <>
      <NotesWorkspace
        key={activeKey}
        notes={notes}
        favorites={favorites}
        selectedId={selectedId}
        query={query}
        knowledge={knowledge}
        inspectorView={inspectorView}
        onInspectorViewChange={setInspectorView}
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
