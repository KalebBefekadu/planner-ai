import { describe, expect, it } from 'vitest';
import { candidatesFromVaultOrFiles, filesFromZip } from '@/lib/notes/import-bundle';
import {
  type ExportAttachment,
  type ExportNote,
  type ExportRelations,
  zipNotes,
} from '@/lib/notes/export-vault';
import {
  describeReconciliation,
  reconcileVault,
  type VaultManifest,
} from '@/lib/notes/vault-reconcile';

function note(index: number, overrides: Partial<ExportNote> = {}): ExportNote {
  return {
    id: `${String(index).repeat(8)}-1111-1111-1111-111111111111`.slice(0, 36),
    parent_note_id: null,
    title: `Note ${index}`,
    body_markdown: `Body ${index}`,
    sort_key: index * 1000,
    ai_excluded: false,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

async function exportVault(
  notes: ExportNote[],
  attachments: ExportAttachment[] = [],
  relations: ExportRelations = {}
) {
  const archive = await zipNotes(
    notes,
    attachments,
    async () => ({ available: true as const, bytes: Buffer.from('bytes') }),
    relations
  );
  const files = await filesFromZip(archive);
  const manifestFile = files.find((file) => file.path === 'planner-ai-vault.json');
  return {
    manifest: JSON.parse(manifestFile!.bytes.toString('utf8')) as VaultManifest,
    candidates: candidatesFromVaultOrFiles(files),
  };
}

// The restore path identifies a rebuilt Note by the vault id in its source path.
function restoredFromCandidates(candidates: Awaited<ReturnType<typeof exportVault>>['candidates']) {
  return candidates.map((candidate) => ({
    vaultNoteId: candidate.sourcePath.replace('planner-ai-vault/', ''),
    title: candidate.title,
    parentVaultNoteId: candidate.parentSourcePath
      ? candidate.parentSourcePath.replace('planner-ai-vault/', '')
      : null,
    sortKey: candidate.sourceSortKey ?? null,
    aiExcluded: candidate.aiExcluded ?? false,
  }));
}

describe('vault restore reconciliation', () => {
  // The owner's whole reason for exporting is that this comparison can be made.
  // A restore that is only counted, not compared, can lose AI Exclusion or
  // sibling order without anyone noticing.
  it('reports a Notes-only vault as completely restored when every item matches', async () => {
    const parent = note(1, { title: 'Parent' });
    const { manifest, candidates } = await exportVault([
      parent,
      note(2, { title: 'Child', parent_note_id: parent.id, ai_excluded: true }),
      note(3, { title: 'Reordered', sort_key: 1500.5 }),
    ]);

    const result = reconcileVault(manifest, { notes: restoredFromCandidates(candidates) });

    expect(result.differences).toEqual([]);
    expect(result.restoredNotes).toBe(3);
    expect(result.complete).toBe(true);
    expect(describeReconciliation(result)).toBe(
      'Restored all 3 Notes from this vault with no differences.'
    );
  });

  it('names the Note that did not arrive rather than reporting a smaller success', async () => {
    const { manifest, candidates } = await exportVault([note(1), note(2, { title: 'Lost' })]);
    const restored = restoredFromCandidates(candidates).filter((item) => item.title !== 'Lost');

    const result = reconcileVault(manifest, { notes: restored });

    expect(result.complete).toBe(false);
    expect(result.differences).toEqual([
      expect.objectContaining({ title: 'Lost', field: 'presence', actual: 'missing' }),
    ]);
  });

  // An AI-excluded Note returning to retrieval is a privacy regression, so it
  // must surface as a failed restore and not as a cosmetic difference.
  it('reports a restored Note that lost its AI Exclusion', async () => {
    const { manifest, candidates } = await exportVault([note(1, { ai_excluded: true })]);
    const restored = restoredFromCandidates(candidates).map((item) => ({
      ...item,
      aiExcluded: false,
    }));

    const result = reconcileVault(manifest, { notes: restored });

    expect(result.complete).toBe(false);
    expect(result.differences[0]).toMatchObject({
      field: 'aiExcluded',
      expected: 'true',
      actual: 'false',
    });
  });

  it('reports a restored Note whose sibling order changed', async () => {
    const { manifest, candidates } = await exportVault([note(1, { sort_key: 1500.5 })]);
    const restored = restoredFromCandidates(candidates).map((item) => ({ ...item, sortKey: 1 }));

    expect(reconcileVault(manifest, { notes: restored }).differences[0]).toMatchObject({
      field: 'sortKey',
      expected: '1500.5',
      actual: '1',
    });
  });

  // This is the finding that matters most for IM-04: the vault carries the
  // attachment bytes, but the current importer reads only the manifest's Notes,
  // so a restore rebuilds the Notes and silently drops every attachment. The
  // test exists so that loss is recorded as a known limitation rather than
  // discovered by an owner who no longer has the original Workspace.
  it('reports attachments carried by the vault that the current restore does not rebuild', async () => {
    const source = note(1, { title: 'Decision record' });
    const { manifest, candidates } = await exportVault(
      [source],
      [
        {
          id: '22222222-2222-2222-2222-222222222222',
          note_id: source.id,
          object_key: 'key',
          original_name: 'evidence.pdf',
          media_type: 'application/pdf',
          byte_size: 5,
          scan_state: 'approved',
          checksum_sha256: 'a'.repeat(64),
        },
      ]
    );

    // The importer produces one candidate per manifest Note and nothing at all
    // for the attachment entries in the archive.
    expect(candidates).toHaveLength(1);

    const result = reconcileVault(manifest, { notes: restoredFromCandidates(candidates) });

    expect(result.complete).toBe(false);
    expect(result.unrestoredAttachments).toEqual(['evidence.pdf']);
    expect(describeReconciliation(result)).toContain('1 attachments were not restored.');
  });

  // Tags and links are now carried by the vault, so a restore that ignores
  // them must be reported as incomplete rather than treated as a match.
  it('reports tags and Note links carried by the vault that the restore did not rebuild', async () => {
    const first = note(1);
    const second = note(2);
    const { manifest, candidates } = await exportVault([first, second], [], {
      tags: [{ note_id: first.id, name: 'decisions' }],
      links: [{ source_note_id: first.id, target_note_id: second.id, relation_type: 'supports' }],
    });

    const result = reconcileVault(manifest, { notes: restoredFromCandidates(candidates) });

    expect(result.complete).toBe(false);
    expect(result.unrestoredLinks).toBe(1);
    expect(result.differences).toEqual([
      expect.objectContaining({ field: 'tags', expected: 'decisions', actual: '' }),
    ]);
  });

  // Vaults downloaded before this ticket carry no tag or AI Exclusion fields in
  // their manifest. Reconciling one must not invent differences for metadata
  // the vault never claimed to hold.
  it('does not report differences for metadata an older vault never recorded', () => {
    const manifest: VaultManifest = {
      format: 'planner-ai-notes-vault',
      schemaVersion: 1,
      notes: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          parentNoteId: null,
          path: 'Notes/Old.md',
          title: 'Old',
          sortKey: 1000,
        },
      ],
    };

    const result = reconcileVault(manifest, {
      notes: [
        {
          vaultNoteId: '11111111-1111-1111-1111-111111111111',
          title: 'Old',
          parentVaultNoteId: null,
          sortKey: 1000,
          aiExcluded: true,
          tags: ['added-later'],
        },
      ],
    });

    expect(result.complete).toBe(true);
  });
});
