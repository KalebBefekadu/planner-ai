import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountSummary } from '@/components/account-summary';
import { settingsRelatedLinks } from '@/components/settings-tabs';

/* Settings was one of the screens the preview inventory could only call
   `visual`: the screens existed and resembled the reference, and nothing said
   what they contained. These cases name the two things a screenshot cannot
   check — that Account reports the signed-in owner's real record rather than a
   fixture, and that each section points at the section that owns changing it. */

const account = {
  email: 'sam.rivera@example.com',
  workspaceName: 'Personal workspace',
  timezone: 'America/New_York',
  createdAt: '2026-02-14T09:30:00.000Z',
};

describe('account section', () => {
  const html = renderToStaticMarkup(createElement(AccountSummary, { account }));

  it('shows the address the person actually signed in with', () => {
    expect(html).toContain('sam.rivera@example.com');
  });

  it('names the workspace rather than a hard-coded product string', () => {
    expect(html).toContain('Personal workspace');
    expect(html).not.toContain('My Workspace');
  });

  it('reports the workspace time zone, which is what planning dates use', () => {
    expect(html).toContain('America/New_York');
  });

  // Rendering the join date in the viewer's local zone would show a different
  // day either side of midnight for the same stored instant.
  it('renders the join date in a fixed zone so it cannot drift by a day', () => {
    expect(html).toContain('February 14, 2026');
  });

  it('survives a record with no join date instead of printing "Invalid Date"', () => {
    const broken = renderToStaticMarkup(
      createElement(AccountSummary, { account: { ...account, createdAt: '' } })
    );
    expect(broken).not.toContain('Invalid Date');
    expect(broken).toContain('Unknown');
  });

  it('derives the avatar from the address, and keeps it out of the a11y tree', () => {
    expect(html).toMatch(/aria-hidden="true"[^>]*>\s*SR\s*</);
  });

  /* This is the whole reason the section is not a second place to edit things.
     Every changeable fact links to the section that already owns the change,
     so nothing here is an inert control. */
  it('sends each changeable fact to the section that owns changing it', () => {
    expect(html).toContain('href="/settings/security"');
    expect(html).toContain('href="/settings/preferences"');
    expect(html).not.toContain('<input');
  });

  it('uses a description list, so each label is bound to its value', () => {
    expect(html).toContain('<dl');
    expect(html.match(/<dt>/g)).toHaveLength(4);
    expect(html.match(/<dd>/g)).toHaveLength(4);
  });

  /* A dl may only contain dt/dd pairs, optionally inside a plain div. An
     earlier draft put the "change it here" link beside the dd rather than
     inside it, which axe reports as a serious 1.3.1 violation. */
  it('keeps the change link inside the value it describes, not beside it', () => {
    expect(html).not.toMatch(/<\/dd><a/);
    expect(html).toMatch(/<dd>[\s\S]*?account-fact-link[\s\S]*?<\/dd>/);
  });

  it('has no h1 of its own, because the page heading already provides one', () => {
    expect(html).not.toContain('<h1');
  });
});

describe('related settings cross-links', () => {
  const sections = [
    '/settings/account',
    '/settings/preferences',
    '/settings/ai',
    '/settings/security',
    '/settings/safety',
    '/settings/mcp',
    '/settings/memory',
    '/settings/data',
  ];

  it('gives every settings section somewhere related to go', () => {
    for (const section of sections) {
      expect(settingsRelatedLinks(section, true).length).toBeGreaterThan(0);
    }
  });

  it('never links a section back to itself', () => {
    for (const section of sections) {
      expect(settingsRelatedLinks(section, true).map((link) => link.href)).not.toContain(section);
    }
  });

  /* A bare list of the other sections would only repeat the tab bar. The reason
     is the part the tab bar cannot carry, so an empty one is a bug. */
  it('says why the two sections are related, not just that they are', () => {
    for (const section of sections) {
      for (const link of settingsRelatedLinks(section, true)) {
        expect(link.reason.length).toBeGreaterThan(10);
        expect(link.label).not.toBe(link.href);
      }
    }
  });

  it('offers only the sections the legacy model actually serves', () => {
    for (const section of sections) {
      for (const link of settingsRelatedLinks(section, false)) {
        expect(['/settings/security', '/settings/safety']).toContain(link.href);
      }
    }
    // Security and Safety are the only two sections the legacy model serves, so
    // they must still reach each other rather than being left with no footer.
    expect(settingsRelatedLinks('/settings/security', false).map((link) => link.href)).toEqual([
      '/settings/safety',
    ]);
    expect(settingsRelatedLinks('/settings/safety', false).map((link) => link.href)).toEqual([
      '/settings/security',
    ]);
  });

  it('returns nothing for a path that is not a settings section', () => {
    expect(settingsRelatedLinks('/planner', true)).toEqual([]);
  });
});
