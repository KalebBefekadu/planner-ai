/* The vault is the owner's way out of the product, so the writer and the
 * reader have to agree about what one is. They used to say so separately: the
 * format name and the schema version were literals in export-vault.ts and
 * again in import-bundle.ts.
 *
 * That disagreement fails quietly rather than loudly. A reader that does not
 * recognise the manifest returns null, which means "this ZIP is not a vault" --
 * so the import falls back to treating it as loose Markdown. The owner would
 * get their words back but not their structure: no ids, no parents, no
 * appearance, no links. Nothing would say a restore had been downgraded.
 *
 * Deliberately free of Node-only imports, so the reader can use it in the
 * browser without pulling the ZIP writer into the client bundle. */

export const VAULT_FORMAT = 'planner-ai-notes-vault';

/** Bumping this requires deciding what the reader does with older vaults. */
export const VAULT_SCHEMA_VERSION = 1;

export const VAULT_MANIFEST_PATH = 'planner-ai-vault.json';

/** True when a manifest is a vault this build knows how to restore. */
export function isSupportedVaultManifest(manifest: {
  format?: string;
  schemaVersion?: number;
}): boolean {
  return manifest.format === VAULT_FORMAT && manifest.schemaVersion === VAULT_SCHEMA_VERSION;
}
