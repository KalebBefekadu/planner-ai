import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Comments sit between rules, so they have to go before selectors are read.
const css = readFileSync('src/app/globals.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function sources(dir: string) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(dir, entry))
    .filter((file) => /\.tsx?$/.test(file));
}

describe('what a person wrote reaches the screen as they wrote it', () => {
  it('only capitalises elements that carry a machine value', () => {
    /* text-transform: capitalize is for enums -- a status, a source type, a
       result kind. Applied to a whole line it also rewrites whatever the owner
       typed: a Goal titled "Ship the private beta to ten invited people."
       was being displayed as "Ship The Private Beta To Ten Invited People."
       This pins the selectors allowed to carry it, so the next one has to be
       a deliberate choice rather than a line that happened to include a name. */
    const allowed = new Set([
      '.enum-label',
      '.scope-option strong',
      '.capture-proposal-insights strong',
      '.workspace-search-result-kind',
    ]);

    const offenders: string[] = [];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = rule.exec(css))) {
      if (!/text-transform:\s*capitalize/.test(match[2])) continue;
      for (const selector of match[1].split(',')) {
        const trimmed = selector.trim().replace(/\s+/g, ' ');
        if (!trimmed || trimmed.startsWith('@')) continue;
        if (!allowed.has(trimmed)) offenders.push(trimmed);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('has no component uppercasing text in JavaScript instead', () => {
    // toUpperCase on a whole value is the same defect wearing a different hat.
    const offenders = sources('src')
      .filter((file) => !file.endsWith('.test.tsx') && !file.endsWith('.test.ts'))
      .filter((file) =>
        /\b(title|statement|rawText|content|body)\w*\.toUpperCase\(\)/.test(
          readFileSync(file, 'utf8')
        )
      );

    expect(offenders).toEqual([]);
  });
});
