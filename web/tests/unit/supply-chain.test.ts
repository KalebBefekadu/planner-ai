import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// The same helper the generator script uses, so the file and the check that
// guards it can never be built from different logic.
import { buildDependencyInventory } from '../../scripts/dependency-inventory.mjs';

const repoRoot = path.resolve('..');
const workflowDir = path.join(repoRoot, '.github/workflows');
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
};

/* A dependency is pinned here because of what it can reach, not because of how
   popular it is. These hold a credential, talk to something outside the
   process, or parse bytes a person did not write -- an imported vault, a
   pasted CSV, Markdown from somewhere else. A range on any of them means a
   future `npm install` may resolve code we have never looked at into the path
   that handles exactly those things. */
const mustBeExact = [
  '@supabase/ssr',
  '@supabase/supabase-js',
  'archiver',
  'csv-parse',
  'groq-sdk',
  'next',
  'react-markdown',
  'remark-gfm',
  'resend',
  'yauzl',
  'zod',
];

function workflowFiles() {
  return readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, text: readFileSync(path.join(workflowDir, name), 'utf8') }));
}

describe('GitHub Actions', () => {
  /* A tag is a pointer, and the person who owns the action repository can move
     it. Anything `uses:` resolves to runs inside our workflow with our
     permissions and our secrets, so the version has to be a commit, which
     cannot be repointed. */
  it('pins every action to a commit rather than a movable tag', () => {
    const unpinned = workflowFiles().flatMap(({ name, text }) =>
      [...text.matchAll(/uses:\s*(\S+)/g)]
        .map((match) => match[1])
        .filter((reference) => !/@[0-9a-f]{40}$/.test(reference))
        .map((reference) => `${name}: ${reference}`)
    );
    expect(unpinned).toEqual([]);
  });

  /* A commit alone says nothing about which release it is, so the next person
     to read the workflow cannot tell whether it is current without asking
     GitHub. The comment is what makes the pin reviewable. */
  it('records which release each pinned commit is', () => {
    const uncommented = workflowFiles().flatMap(({ name, text }) =>
      text
        .split('\n')
        .filter((line) => /uses:\s*\S+@[0-9a-f]{40}/.test(line))
        .filter((line) => !/#\s*v?\d+\.\d+\.\d+/.test(line))
        .map((line) => `${name}: ${line.trim()}`)
    );
    expect(uncommented).toEqual([]);
  });

  it('finds workflows to check at all', () => {
    expect(workflowFiles().length).toBeGreaterThan(0);
  });
});

describe('production dependencies', () => {
  it('pins every dependency that holds a credential or reads untrusted input', () => {
    const ranged = mustBeExact.filter((name) => !/^\d/.test(manifest.dependencies[name] ?? ''));
    expect(ranged).toEqual([]);
  });

  it('declares every package named above', () => {
    const absent = mustBeExact.filter((name) => !(name in manifest.dependencies));
    expect(absent).toEqual([]);
  });

  /* One registry. A second one appearing is a change of where code comes from,
     which is a different kind of change from upgrading a package, and it
     should not be able to arrive unremarked in a lockfile diff. */
  it('resolves the whole production closure from one registry', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { dev?: boolean; devOptional?: boolean; resolved?: string }>;
    };
    const registries = new Set(
      Object.entries(lock.packages)
        .filter(([location]) => location.startsWith('node_modules/'))
        .filter(([, entry]) => !entry.dev && !entry.devOptional && entry.resolved)
        .map(([, entry]) => new URL(entry.resolved as string).host)
    );
    expect([...registries]).toEqual(['registry.npmjs.org']);
  });
});

describe('the release dependency inventory', () => {
  it('matches the lockfile it was generated from', () => {
    const current = readFileSync(
      path.join(repoRoot, 'docs/engineering/dependency-inventory.md'),
      'utf8'
    );
    expect(current).toBe(buildDependencyInventory('package.json', 'package-lock.json'));
  });
});
