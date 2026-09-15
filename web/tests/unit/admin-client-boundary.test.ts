import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve('src');
const adminModule = '@/lib/supabase/admin';
const adminConstructor = 'src/lib/supabase/admin.ts';

const lifecycleAllowlist = [
  'src/app/api/internal/account-deletions/route.ts',
  'src/app/api/internal/note-attachment-purge/route.ts',
  'src/app/api/internal/note-import-purge/route.ts',
  'src/app/api/internal/notifications/route.ts',
] as const;

// These are migration liabilities, not approved service-role consumers. Remove
// an entry as soon as its route moves to user-scoped Operations, a restricted
// worker, or a narrowly granted capability.
const migrationExceptions = [
  'src/app/api/capture-proposals/route.ts',
  'src/app/api/health/route.ts',
  'src/app/api/initiative-breakdown/route.ts',
  'src/app/api/mcp/route.ts',
  'src/app/api/notes/attachments/route.ts',
  'src/app/api/notes/export/route.ts',
  'src/app/api/review-proposals/route.ts',
  'src/app/auth/actions.ts',
] as const;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolutePath);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
    })
  );
  return files.flat();
}

function relativeSourcePath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

async function filesContaining(pattern: string) {
  const matches: string[] = [];
  for (const file of await sourceFiles(sourceRoot)) {
    if ((await readFile(file, 'utf8')).includes(pattern)) {
      matches.push(relativeSourcePath(file));
    }
  }
  return matches.sort();
}

describe('Supabase admin client boundary', () => {
  it('freezes admin imports to lifecycle jobs and named migration exceptions', async () => {
    const importers = await filesContaining(adminModule);
    const expected = [...lifecycleAllowlist, ...migrationExceptions].sort();

    expect(importers).toEqual(expected);
    expect(lifecycleAllowlist.every((file) => file.startsWith('src/app/api/internal/'))).toBe(true);
  });

  it('keeps the service-role key behind the single server-only constructor', async () => {
    expect(await filesContaining('SUPABASE_SERVICE_ROLE_KEY')).toEqual([adminConstructor]);

    const constructorSource = await readFile(path.resolve(adminConstructor), 'utf8');
    expect(constructorSource).toMatch(/^import 'server-only';/);
    expect(constructorSource).toContain('export function createAdminClient()');
  });
});
