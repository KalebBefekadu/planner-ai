import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isSupportedVaultManifest,
  VAULT_FORMAT,
  VAULT_MANIFEST_PATH,
  VAULT_SCHEMA_VERSION,
} from '@/lib/notes/vault-format';

const writer = readFileSync('src/lib/notes/export-vault.ts', 'utf8');
const reader = readFileSync('src/lib/notes/import-bundle.ts', 'utf8');

describe('the vault format the writer and the reader share', () => {
  it('accepts what this build writes and refuses what it cannot restore', () => {
    expect(
      isSupportedVaultManifest({ format: VAULT_FORMAT, schemaVersion: VAULT_SCHEMA_VERSION })
    ).toBe(true);

    // A version this build does not know is not a vault it can restore.
    expect(
      isSupportedVaultManifest({ format: VAULT_FORMAT, schemaVersion: VAULT_SCHEMA_VERSION + 1 })
    ).toBe(false);
    expect(isSupportedVaultManifest({ format: 'something-else', schemaVersion: 1 })).toBe(false);
    expect(isSupportedVaultManifest({})).toBe(false);
  });

  it('is stated once, not separately in the writer and the reader', () => {
    /* These were literals in both files. Drift there fails quietly rather than
       loudly: a reader that does not recognise the manifest treats the ZIP as
       loose Markdown, so the owner gets their words back without their
       structure and nothing says the restore was downgraded. */
    for (const [name, source] of [
      ['export-vault.ts', writer],
      ['import-bundle.ts', reader],
    ] as const) {
      expect(source, `${name} hard-codes the format name`).not.toContain(
        "'planner-ai-notes-vault'"
      );
      expect(source, `${name} hard-codes the manifest path`).not.toContain(
        "'planner-ai-vault.json'"
      );
    }
    expect(writer).toContain('VAULT_SCHEMA_VERSION');
    expect(reader).toContain('isSupportedVaultManifest');
  });

  it('keeps the manifest filename the readme and the failure notice refer to', () => {
    // The unavailable-attachment notice inside the vault names this file, and
    // a person opening the ZIP looks for it.
    expect(VAULT_MANIFEST_PATH).toBe('planner-ai-vault.json');
  });
});
