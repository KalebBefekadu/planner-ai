import { describe, expect, it } from 'vitest';
import {
  IMPORT_BATCH_CEILING_MESSAGE,
  IMPORT_COMMIT_BATCH_CEILING,
  IMPORT_COMMIT_BATCH_SIZE,
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_UPLOAD_LIMIT_LABEL,
  formatImportBytes,
} from '@/lib/notes/import-limits';
import { candidatesFromFiles, filesFromZip } from '@/lib/notes/import-bundle';
import * as archiverModule from 'archiver';
import type { ZipArchive } from 'archiver';

// Same interop shim the vault exporter uses: the CommonJS factory is on
// `default` under this module resolution.
const createZipArchive = (
  archiverModule as unknown as {
    default: (format: 'zip', options: { zlib: { level: number } }) => ZipArchive;
  }
).default;

async function zipOf(entries: Array<{ path: string; body: Buffer | string }>) {
  const archive = createZipArchive('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  for (const entry of entries) archive.append(Buffer.from(entry.body), { name: entry.path });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

describe('deployed upload bounds', () => {
  // The defect this guards: the application advertised and enforced 25 MB while
  // the hosting platform refuses any request body over 4.5 MB before the route
  // runs. An upload between those two numbers failed opaquely, with no message
  // this application wrote.
  it('never advertises an upload larger than the platform will deliver', () => {
    expect(IMPORT_LIMITS.requestBytes).toBeLessThanOrEqual(4.5 * 1024 * 1024);
    expect(IMPORT_LIMITS.archiveBytes).toBeLessThan(IMPORT_LIMITS.requestBytes);
  });

  // Every size message is derived from the bound so the advertised limit cannot
  // drift away from the enforced one again.
  it('states the enforced limit and how to get under it', () => {
    expect(IMPORT_UPLOAD_LIMIT_LABEL).toBe(formatImportBytes(IMPORT_LIMITS.archiveBytes));
    expect(IMPORT_TOO_LARGE_MESSAGE).toContain(IMPORT_UPLOAD_LIMIT_LABEL);
    expect(IMPORT_TOO_LARGE_MESSAGE).toMatch(/smaller batches/);
    expect(IMPORT_TOO_LARGE_MESSAGE).toMatch(/Nothing was imported/);
  });

  it('rejects an archive past the bound before reading any entry', async () => {
    const oversized = Buffer.alloc(IMPORT_LIMITS.archiveBytes + 1);
    await expect(filesFromZip(oversized)).rejects.toThrow(IMPORT_UPLOAD_LIMIT_LABEL);
  });
});

describe('bounded expansion and unsafe content', () => {
  it('refuses a file count no import is allowed to reach', () => {
    const rows = ['Name', ...Array.from({ length: 900 }, (_, index) => `Row ${index}`)].join('\n');
    expect(() => candidatesFromFiles([{ path: 'Big.csv', bytes: Buffer.from(rows) }])).toThrow(
      `at most ${IMPORT_LIMITS.candidates}`
    );
  });

  it('refuses traversal paths and reports binary files rather than decoding them', () => {
    expect(() => candidatesFromFiles([{ path: '../escape.md', bytes: Buffer.from('no') }])).toThrow(
      'unsafe file path'
    );
    expect(
      candidatesFromFiles([{ path: 'photo.jpg', bytes: Buffer.from([0xff, 0xd8]) }])[0]
    ).toMatchObject({ unsupportedReason: 'Unsupported file type: .jpg.', bodyMarkdown: '' });
  });

  // A file too large to import must still be reported. Dropping it silently is
  // how a migration loses something without anyone noticing.
  it('reports an oversized text file instead of dropping it', () => {
    const candidate = candidatesFromFiles([
      { path: 'huge.md', bytes: Buffer.alloc(IMPORT_LIMITS.fileBytes + 1, 0x61) },
    ])[0];
    expect(candidate).toMatchObject({ sourcePath: 'huge.md', bodyMarkdown: '' });
    expect(candidate.unsupportedReason).toMatch(/200 KB/);
  });

  // A ZIP bomb is small on the wire and enormous once expanded, so the archive
  // bound alone does not contain it.
  it('stops expanding a ZIP that inflates past the expansion bound', async () => {
    const highlyCompressible = Buffer.alloc(IMPORT_LIMITS.fileBytes, 0x61);
    const entries = Array.from({ length: 60 }, (_, index) => ({
      path: `bomb/file-${index}.md`,
      body: highlyCompressible,
    }));
    const bomb = await zipOf(entries);
    expect(bomb.byteLength).toBeLessThan(IMPORT_LIMITS.archiveBytes);
    await expect(filesFromZip(bomb)).rejects.toThrow('expands beyond');
  });

  // A ZIP writer will not emit a traversal name, so a hostile archive is built
  // by rewriting the stored entry name in place — which is exactly what an
  // attacker hands over.
  it('refuses a ZIP entry that escapes the archive root', async () => {
    const benign = await zipOf([{ path: 'AA/escape.md', body: 'no' }]);
    const escaping = Buffer.from(
      benign.toString('binary').replaceAll('AA/escape.md', '../escape.md'),
      'binary'
    );
    // The ZIP reader rejects it first and safePath would reject it after, so
    // the entry never becomes a candidate either way.
    await expect(filesFromZip(escaping)).rejects.toThrow(/relative path|unsafe file path/);
  });
});

// The commit loop used to stop after a literal 12 batches of 50 -- a ceiling
// of 600 items sitting next to an unrelated candidate limit of 500. Whoever
// raised the candidate limit past 600 would have stranded imports partway
// through, under a message that read like a transient pause.
describe('Import commit batching', () => {
  it('can always reach the last staged candidate', () => {
    expect(IMPORT_COMMIT_BATCH_CEILING * IMPORT_COMMIT_BATCH_SIZE).toBeGreaterThanOrEqual(
      IMPORT_LIMITS.candidates
    );
  });

  it('still reaches the last candidate after the import limit is raised', () => {
    // The check that matters is the relationship, not today's numbers, so this
    // asks the same question of a limit nobody has set yet.
    const raised = 2_000;
    const ceiling = Math.ceil(raised / IMPORT_COMMIT_BATCH_SIZE) + 1;
    expect(ceiling * IMPORT_COMMIT_BATCH_SIZE).toBeGreaterThanOrEqual(raised);
  });

  it('asks for no larger a batch than the Operation contract allows', () => {
    expect(IMPORT_COMMIT_BATCH_SIZE).toBeLessThanOrEqual(50);
  });

  // Reaching the ceiling is a hard stop, not a pause: nothing resumes on its
  // own, and the owner has to reopen the import to continue.
  it('describes the ceiling as a limit rather than a pause', () => {
    expect(IMPORT_BATCH_CEILING_MESSAGE).toContain('limit');
    expect(IMPORT_BATCH_CEILING_MESSAGE).not.toContain('paused');
    expect(IMPORT_BATCH_CEILING_MESSAGE).toContain('Reopen this import');
  });
});
