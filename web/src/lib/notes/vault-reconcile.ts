// A restore is only trustworthy if it is checked item for item. Counting Notes
// is not enough: a vault whose Notes all arrived but whose AI Exclusion, sibling
// order or tags did not is a restore that quietly changed the owner's Workspace.
// This module compares a vault's own manifest against what a Workspace actually
// holds after a restore and names every difference, including the parts of the
// vault that the current importer is known not to consume.

export type VaultManifest = {
  format?: string;
  schemaVersion?: number;
  notes?: Array<{
    id: string;
    parentNoteId: string | null;
    path: string;
    title: string;
    sortKey: number;
    aiExcluded?: boolean;
    tags?: string[];
  }>;
  attachments?: Array<{ id: string; noteId: string; originalName: string }>;
  links?: Array<{ sourceNoteId: string; targetNoteId: string; relationType: string }>;
};

// What a Workspace actually contains after the restore, keyed by the vault Note
// id the restore claims to have rebuilt.
export type RestoredNote = {
  vaultNoteId: string;
  title: string;
  parentVaultNoteId: string | null;
  sortKey: number | null;
  aiExcluded: boolean;
  tags?: string[];
};

export type RestoredWorkspace = {
  notes: RestoredNote[];
  attachmentIds?: string[];
  links?: Array<{ sourceNoteId: string; targetNoteId: string; relationType: string }>;
};

export type VaultDifference = {
  vaultNoteId: string;
  title: string;
  field: 'presence' | 'title' | 'parent' | 'sortKey' | 'aiExcluded' | 'tags';
  expected: string;
  actual: string;
};

export type VaultReconciliation = {
  complete: boolean;
  expectedNotes: number;
  restoredNotes: number;
  differences: VaultDifference[];
  unrestoredAttachments: string[];
  unrestoredLinks: number;
};

function tagList(tags: string[] | undefined) {
  return [...(tags ?? [])].sort().join(', ');
}

export function reconcileVault(
  manifest: VaultManifest,
  restored: RestoredWorkspace
): VaultReconciliation {
  const expected = manifest.notes ?? [];
  const byId = new Map(restored.notes.map((note) => [note.vaultNoteId, note]));
  const differences: VaultDifference[] = [];

  for (const item of expected) {
    const actual = byId.get(item.id);
    if (!actual) {
      differences.push({
        vaultNoteId: item.id,
        title: item.title,
        field: 'presence',
        expected: 'restored',
        actual: 'missing',
      });
      continue;
    }
    const checks: Array<[VaultDifference['field'], string, string]> = [
      ['title', item.title, actual.title],
      ['parent', String(item.parentNoteId ?? ''), String(actual.parentVaultNoteId ?? '')],
      ['sortKey', String(item.sortKey), String(actual.sortKey ?? '')],
      // A vault written before AI Exclusion was recorded says nothing about it,
      // and an older vault must not be reported as a failed restore for that.
      ...(item.aiExcluded === undefined
        ? []
        : ([['aiExcluded', String(item.aiExcluded), String(actual.aiExcluded)]] as Array<
            [VaultDifference['field'], string, string]
          >)),
      ...(item.tags === undefined
        ? []
        : ([['tags', tagList(item.tags), tagList(actual.tags)]] as Array<
            [VaultDifference['field'], string, string]
          >)),
    ];
    for (const [field, want, got] of checks) {
      if (want !== got) {
        differences.push({
          vaultNoteId: item.id,
          title: item.title,
          field,
          expected: want,
          actual: got,
        });
      }
    }
  }

  const restoredAttachmentIds = new Set(restored.attachmentIds ?? []);
  const unrestoredAttachments = (manifest.attachments ?? [])
    .filter((attachment) => !restoredAttachmentIds.has(attachment.id))
    .map((attachment) => attachment.originalName);

  const restoredLinks = new Set(
    (restored.links ?? []).map(
      (link) => `${link.sourceNoteId}|${link.targetNoteId}|${link.relationType}`
    )
  );
  const unrestoredLinks = (manifest.links ?? []).filter(
    (link) => !restoredLinks.has(`${link.sourceNoteId}|${link.targetNoteId}|${link.relationType}`)
  ).length;

  return {
    complete:
      differences.length === 0 && unrestoredAttachments.length === 0 && unrestoredLinks === 0,
    expectedNotes: expected.length,
    restoredNotes: expected.filter((item) => byId.has(item.id)).length,
    differences,
    unrestoredAttachments,
    unrestoredLinks,
  };
}

// Written for a person reading a recovery report, not for a log. Silence would
// let a partial restore look like a successful one.
export function describeReconciliation(result: VaultReconciliation) {
  if (result.complete) {
    return `Restored all ${result.expectedNotes} Notes from this vault with no differences.`;
  }
  const parts: string[] = [`Restored ${result.restoredNotes} of ${result.expectedNotes} Notes.`];
  const missing = result.differences.filter((item) => item.field === 'presence').length;
  if (missing) parts.push(`${missing} Notes did not arrive.`);
  const changed = result.differences.length - missing;
  if (changed) parts.push(`${changed} details did not match.`);
  if (result.unrestoredAttachments.length) {
    parts.push(`${result.unrestoredAttachments.length} attachments were not restored.`);
  }
  if (result.unrestoredLinks) parts.push(`${result.unrestoredLinks} Note links were not restored.`);
  return parts.join(' ');
}
