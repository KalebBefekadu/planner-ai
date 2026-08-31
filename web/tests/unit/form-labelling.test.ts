import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Every form control needs an accessible name. A placeholder is not one — it
   disappears the moment someone types, and screen readers are not required to
   announce it.

   This is a source scan rather than a rendered check because most of these
   surfaces sit behind the auth wall, where the axe suite cannot reach them.
   It found three unlabelled editors when first written: the voice capture
   box, the goal composer, and the Markdown note editor. */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/* JSX attributes routinely contain `>` inside arrow functions and strings, so
   the end of a tag cannot be found by scanning for the next `>`. */
function tagEnd(source: string, from: number) {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return i;
  }
  return -1;
}

function insideOpenLabel(source: string, index: number) {
  const before = source.slice(0, index);
  const opened = before.match(/<label\b/g)?.length ?? 0;
  const closed = before.match(/<\/label>/g)?.length ?? 0;
  return opened > closed;
}

function unlabelledControls(file: string) {
  const source = readFileSync(file, 'utf8');
  const findings: string[] = [];
  for (const match of source.matchAll(/<(input|select|textarea)\b/g)) {
    const start = match.index ?? 0;
    const end = tagEnd(source, start + match[0].length);
    if (end < 0) continue;
    const attributes = source.slice(start + match[0].length, end);
    if (attributes.includes('type="hidden"')) continue;
    if (/\b(aria-label|aria-labelledby|id)\s*=/.test(attributes)) continue;
    if (insideOpenLabel(source, start)) continue;
    findings.push(`${file}:${source.slice(0, start).split('\n').length} <${match[1]}>`);
  }
  return findings;
}

describe('form labelling', () => {
  const files = walk('src');

  it('scans a meaningful number of components', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('gives every form control an accessible name', () => {
    const findings = files.flatMap(unlabelledControls);
    expect(findings).toEqual([]);
  });

  it('detects a control that has only a placeholder', () => {
    // guards the scanner itself: a placeholder must not satisfy it
    const fixture = '<textarea placeholder="Write something" value={x} onChange={(e) => set(e)} />';
    expect(/\b(aria-label|aria-labelledby|id)\s*=/.test(fixture)).toBe(false);
  });

  it('reads past a > inside an arrow function in the attributes', () => {
    const source = '<input onChange={(event) => setValue(event)} aria-label="Named" />';
    const end = tagEnd(source, '<input'.length);
    expect(source.slice(0, end)).toContain('aria-label="Named"');
  });
});
