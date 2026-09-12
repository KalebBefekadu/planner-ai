import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// /preview is a visual reference, not a second product. Two properties keep it
// from becoming one, and both are easy to break by accident: a production
// screen importing a fixture, or the preview stylesheet growing a second set
// of design tokens. Either would only be discovered when someone tried to
// delete the route and found the real app depending on it.
//
// The migration checklist in docs/product/preview-inventory.md asserts both.
// This is what makes that assertion true rather than a claim made once.

const root = join(__dirname, '..', '..', 'src');
const previewDir = join(root, 'app', 'preview');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('preview stays isolated from the real application', () => {
  it('is not imported by any production module', () => {
    const offenders = sourceFiles(root)
      .filter((path) => !path.startsWith(previewDir))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /from\s+['"][^'"]*(app\/preview|preview-data|preview\.module)/.test(source);
      })
      .map((path) => path.slice(root.length + 1));

    expect(offenders).toEqual([]);
  });

  it('reads the shared design tokens instead of declaring its own', () => {
    const stylesheet = readFileSync(join(previewDir, 'preview.module.css'), 'utf8');

    // A CSS module cannot define custom properties on :root, so a second token
    // palette would have to arrive as a block of declarations. Reading the
    // shared ones is exactly what keeps the reference honest.
    expect(stylesheet).toMatch(/var\(--/);
    expect(stylesheet).not.toMatch(/:root\s*\{/);
  });

  it('reaches into production for shared behavior rather than copying it', () => {
    const imports = sourceFiles(previewDir)
      .flatMap((path) => readFileSync(path, 'utf8').match(/from '@\/[^']+'/g) ?? [])
      .map((line) => line.slice(6, -1));

    // The direction of reuse matters: preview may depend on production, never
    // the other way around. This records which modules that currently is, so
    // an unreviewed new dependency shows up as a failure to think about.
    expect([...new Set(imports)].sort()).toEqual([
      '@/components/panel-resizer',
      '@/lib/use-dialog',
    ]);
  });
});
