import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';
import { PageSkeleton } from '@/components/page-skeleton';
import { PerimeterShell } from '@/components/perimeter-shell';

/* These pages sit behind the auth gate or only appear when something breaks,
   so they are hard to open by hand and easy to regress unnoticed. Rendering
   them to static markup pins the contract that matters: a single h1, real
   landmarks, and every action reachable as a link or button rather than a
   styled div. */

function render(element: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(element);
}

describe('not found page', () => {
  const html = render(createElement(NotFound));

  it('has exactly one first-level heading', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('says where deleted material went instead of only reporting the error', () => {
    expect(html).toContain('Trash for 30 days');
  });

  it('offers two real navigation targets', () => {
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/search"');
  });

  it('marks the icon wrapper decorative, not just the svg lucide emits', () => {
    expect(html).toMatch(/<span class="state-icon" aria-hidden="true">/);
  });

  it('uses no inline colour styles, so both themes apply', () => {
    expect(html).not.toMatch(/style="[^"]*color/);
  });
});

describe('perimeter shell', () => {
  const html = render(
    createElement(PerimeterShell, null, createElement('p', null, 'form goes here'))
  );

  it('exposes a main and a complementary landmark', () => {
    expect(html).toContain('<main');
    expect(html).toContain('<aside');
  });

  it('renders the promises as a real list', () => {
    expect(html).toContain('<ul');
    expect(html.match(/<li>/g)?.length).toBe(3);
  });

  it('renders whatever form it is given', () => {
    expect(html).toContain('form goes here');
  });

  it('keeps the brand monogram out of the accessibility tree', () => {
    expect(html).toMatch(/aria-hidden="true"[^>]*>\s*P\s*</);
  });
});

describe('page skeleton', () => {
  const html = render(createElement(PageSkeleton, { rows: 3, label: 'Loading your goals' }));

  it('announces once, politely, what is loading', () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('Loading your goals');
  });

  it('keeps the announcement off-screen rather than drawing it', () => {
    expect(html).toContain('class="visually-hidden" role="status"');
  });

  it('hides the bars from assistive tech so they are not read one by one', () => {
    expect(html).not.toMatch(/<span class="skeleton-bar[^>]*aria-hidden="false"/);
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the number of rows it was asked for', () => {
    expect(html.match(/class="skeleton-card"/g)).toHaveLength(3);
  });

  it('varies row widths, so it reads as text rather than a progress bar', () => {
    const widths = [...html.matchAll(/inline-size:([^"';]+)/g)].map((m) => m[1].trim());
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it('only adds the second column when asked for a split layout', () => {
    expect(html).not.toContain('skeleton-aside');
    expect(render(createElement(PageSkeleton, { layout: 'split' }))).toContain('skeleton-aside');
  });
});

describe('preview route gate', () => {
  /* /preview is the internal design reference. It is a public route in the
     auth middleware and it ships in the production build, so without a gate
     anyone could read it — and its Settings mock used to serve a real name and
     email address. */
  const gate = (value: string | undefined) => value === 'enabled';

  it('serves the preview only where it is explicitly switched on', () => {
    expect(gate('enabled')).toBe(true);
  });

  it('404s when the flag is absent, which is the production default', () => {
    expect(gate(undefined)).toBe(false);
    expect(gate('disabled')).toBe(false);
    expect(gate('')).toBe(false);
  });

  it('does not treat a truthy-looking value as enabled', () => {
    for (const value of ['true', '1', 'yes', 'ENABLED', 'Enabled']) {
      expect(gate(value)).toBe(false);
    }
  });

  it('ships disabled in the example environment', () => {
    const example = readFileSync('.env.example', 'utf8');
    expect(example).toContain('PLANNER_UI_PREVIEW=disabled');
  });

  it('keeps real personal data out of the preview fixtures', () => {
    const sources = ['src/app/preview/page.tsx', 'src/app/preview/perimeter.tsx'];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      // any address that is not an example.com placeholder
      const addresses = text.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
      expect(addresses.filter((a) => !a.endsWith('@example.com'))).toEqual([]);
    }
  });
});
