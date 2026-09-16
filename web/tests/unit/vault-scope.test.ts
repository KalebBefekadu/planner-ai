import { describe, expect, it } from 'vitest';
import { filesFromZip } from '@/lib/notes/import-bundle';
import { VAULT_MANIFEST_PATH } from '@/lib/notes/vault-format';
import { VAULT_SCOPE, zipNotes, type ExportNote } from '@/lib/notes/export-vault';

/* The vault's manifest carries a `scope` object, and the README beside it says
   the same thing in prose: this is what your archive contains, and this is what
   importing it will put back. That is a statement to an owner about their own
   data, made at the moment they are leaving with it.

   A statement like that is only worth making if something fails when it stops
   being true. It already had: the declaration was written when a Note was its
   body, hierarchy, order, tags, AI Exclusion and links. Appearance and
   favourites were added to the vault afterwards, and the declaration went on
   listing seven things while the archive carried nine -- understating what the
   owner was holding.

   These assertions are the thing that fails next time. */

const noAttachments = () => Promise.reject(new Error('No attachment was expected.'));

/* Identity and timestamps are how the archive refers to itself. They are not a
   claim about what the owner gets back, so they are not scope entries -- but
   they are listed rather than pattern-matched, so a genuinely new field cannot
   arrive disguised as bookkeeping. */
const BOOKKEEPING = ['id', 'path', 'createdAt', 'updatedAt'];

/* What each field in the manifest is the evidence for. A field that appears in
   the archive with no entry here fails the test below, which is the point: the
   export and the promise about the export move together or not at all. */
const FIELD_MEANS: Record<string, string> = {
  title: 'noteBodies',
  parentNoteId: 'noteHierarchy',
  sortKey: 'noteSortOrder',
  tags: 'noteTags',
  aiExcluded: 'aiExclusion',
  iconEmoji: 'noteAppearance',
  coverKey: 'noteAppearance',
  coverPosition: 'noteAppearance',
  favoritedAt: 'favourites',
};

function note(overrides: Partial<ExportNote> = {}): ExportNote {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    parent_note_id: null,
    title: 'A Note',
    body_markdown: 'Body',
    sort_key: 1000,
    ai_excluded: false,
    icon_emoji: null,
    cover_key: null,
    cover_position: 50,
    favorited_at: null,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

async function manifestOf(notes: ExportNote[]) {
  const files = await filesFromZip(await zipNotes(notes, [], noAttachments));
  const found = files.find((file) => file.path === VAULT_MANIFEST_PATH);
  if (!found) throw new Error('The vault has no manifest.');
  return JSON.parse(found.bytes.toString('utf8')) as {
    scope: typeof VAULT_SCOPE;
    notes: Record<string, unknown>[];
  };
}

describe('what the vault says it contains', () => {
  it('declares every Note field it actually ships', async () => {
    const manifest = await manifestOf([note()]);
    const undeclared = Object.keys(manifest.notes[0]).filter(
      (field) => !BOOKKEEPING.includes(field) && !FIELD_MEANS[field]
    );
    expect(undeclared).toEqual([]);
  });

  /* The assertion above only catches a field nobody thought about. The way this
     declaration actually went stale was the other direction: the field was
     shipped, someone knew what it meant, and the scope list was simply never
     told. So the archive has to be read back and every meaning it carries
     checked against what the owner is told they have. */
  it('leaves nothing it ships out of what it tells the owner', async () => {
    const manifest = await manifestOf([note()]);
    const claimed = manifest.scope.included as readonly string[];
    const shippedButUnclaimed = Object.keys(manifest.notes[0])
      .filter((field) => FIELD_MEANS[field])
      .map((field) => FIELD_MEANS[field])
      .filter((meaning) => !claimed.includes(meaning));
    expect([...new Set(shippedButUnclaimed)]).toEqual([]);
  });

  it('makes no claim it cannot show in the archive', async () => {
    const manifest = await manifestOf([note()]);
    const fields = Object.keys(manifest.notes[0]);
    /* Links and attachment files are carried outside the per-Note entries, so
       they are evidenced by their own manifest sections rather than a field. */
    const carriedElsewhere = ['noteLinks', 'attachmentFiles'];
    for (const claim of VAULT_SCOPE.included) {
      if (carriedElsewhere.includes(claim)) continue;
      const evidence = fields.filter((field) => FIELD_MEANS[field] === claim);
      expect(evidence.length, `"${claim}" is claimed but nothing carries it`).toBeGreaterThan(0);
    }
  });

  /* Attachments travel as files and are not re-attached on import. Claiming
     otherwise would be the one error here that costs an owner something real:
     they would believe their Notes came back whole. */
  it('does not promise to restore the attachments it carries', async () => {
    expect(VAULT_SCOPE.included).toContain('attachmentFiles');
    expect(VAULT_SCOPE.restoredByImport).not.toContain('attachmentFiles');
  });

  it('promises to restore everything else it carries', async () => {
    const notRestored = VAULT_SCOPE.included.filter(
      (entry) => !(VAULT_SCOPE.restoredByImport as readonly string[]).includes(entry)
    );
    expect(notRestored).toEqual(['attachmentFiles']);
  });

  it('ships the declaration with the archive, not only in the source', async () => {
    const manifest = await manifestOf([note()]);
    expect(manifest.scope.included).toEqual([...VAULT_SCOPE.included]);
    expect(manifest.scope.restoredByImport).toEqual([...VAULT_SCOPE.restoredByImport]);
  });

  /* The excluded list is the other half of the promise, and the one an owner
     relies on when deciding whether this archive is enough on its own. */
  it('names the planning data it leaves behind, and where to get it', async () => {
    for (const planning of ['vision', 'goals', 'actions', 'reviews']) {
      expect(VAULT_SCOPE.excluded).toContain(planning);
    }
    expect(VAULT_SCOPE.excludedAvailableFrom).toMatch(/Workspace export/);
  });
});
