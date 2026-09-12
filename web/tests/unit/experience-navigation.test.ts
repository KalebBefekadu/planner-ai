import { describe, expect, it } from 'vitest';
import {
  activeExperienceNavHref,
  experienceAreaForPath,
  experienceCommands,
  filterExperienceCommands,
  experienceNavItems,
  experienceNavigationForPath,
  experienceRailItems,
  isExperienceNavItemActive,
} from '@/lib/experience-navigation';

describe('experience navigation', () => {
  it('keeps Planner routes in a Planner-specific navigation surface', () => {
    expect(experienceAreaForPath('/planner')).toBe('planner');
    expect(experienceAreaForPath('/planner/today')).toBe('planner');
    expect(experienceAreaForPath('/planner/inbox')).toBe('planner');
    expect(experienceAreaForPath('/planner/calendar')).toBe('planner');
    expect(experienceAreaForPath('/goals')).toBe('planner');
    expect(experienceAreaForPath('/vision')).toBe('planner');
    expect(experienceAreaForPath('/review')).toBe('planner');

    const navigation = experienceNavigationForPath('/planner', true);
    expect(navigation.title).toBe('Planner');
    expect(navigation.subtitle).toBe('Direction to today');
    expect(navigation.sections.map((section) => section.label)).toEqual(['Plan', 'Align']);
    expect(experienceNavItems(navigation).map((item) => item.label)).toEqual([
      'Today',
      'This week',
      'Calendar',
      'Action inbox',
      'Weekly review',
      'Goals & horizons',
      'Vision',
    ]);
    expect(navigation.subtitle).not.toContain('Personal workspace');
    expect(
      experienceNavItems(navigation).every((item) => experienceAreaForPath(item.href) === 'planner')
    ).toBe(true);
  });

  it('keeps Workspace and Settings destinations separate', () => {
    expect(experienceNavigationForPath('/notes', true).title).toBe('Workspace');
    expect(experienceNavigationForPath('/search', true).title).toBe('Search');
    expect(experienceNavigationForPath('/settings/mcp', true).title).toBe('Settings');
    expect(
      experienceNavItems(experienceNavigationForPath('/settings/mcp', true)).map(
        (item) => item.label
      )
    ).toContain('AI connections');
  });

  it('names each Settings destination the way its page and tab bar do', () => {
    // The sidebar, the settings tab bar and the page heading were three
    // different names for the same place: "AI and agents" opened a page titled
    // "AI usage", and "MCP" opened "AI connections".
    const labels = experienceNavItems(experienceNavigationForPath('/settings/ai', true)).map(
      (item) => item.label
    );
    expect(labels).toContain('AI usage');
    expect(labels).toContain('AI connections');
    expect(labels).toContain('Data and portability');
    expect(labels).not.toContain('AI and agents');
    expect(labels).not.toContain('Data and offline');
    expect(labels).not.toContain('MCP');
  });

  it('omits canonical-only destinations while the legacy model is active', () => {
    expect(
      experienceNavItems(experienceNavigationForPath('/inbox', false)).map((item) => item.label)
    ).toEqual(['Capture inbox']);
    expect(
      experienceNavItems(experienceNavigationForPath('/settings/security', false)).map(
        (item) => item.label
      )
    ).toEqual(['Security', 'Safety']);
  });

  it('keeps rail placement explicit when destinations are added', () => {
    const rail = experienceRailItems(true, 3);
    expect(rail.filter((item) => item.placement === 'main').map((item) => item.area)).toEqual([
      'home',
      'planner',
      'workspace',
      'search',
    ]);
    expect(rail.filter((item) => item.placement === 'footer').map((item) => item.area)).toEqual([
      'notifications',
      'settings',
    ]);
    expect(rail.find((item) => item.area === 'notifications')?.count).toBe(3);
  });

  it('uses exact matching for Today and prefix matching for nested settings', () => {
    expect(isExperienceNavItemActive('/inbox', { label: 'Today', href: '/', match: 'exact' })).toBe(
      false
    );
    expect(
      isExperienceNavItemActive('/settings/security/details', {
        label: 'Security',
        href: '/settings/security',
        match: 'prefix',
      })
    ).toBe(true);
  });
});

/* The command palette was previously verified by opening it and looking at it.
   A screenshot cannot say which destinations the palette offers, so these cases
   name the result set the way a person reaches it: by typing. */
describe('command palette results', () => {
  const commands = experienceCommands(true);

  it('offers every product area as a destination, not only Search', () => {
    expect(commands.map((command) => command.label)).toEqual([
      'Today',
      'This week',
      'Calendar',
      'Weekly review',
      'Goals & horizons',
      'Notes',
      'Conversations',
      'Capture inbox',
      'Search workspace',
      'Account',
      'Notifications',
      'Settings',
    ]);
  });

  it('sends every destination somewhere the shell can resolve to an area', () => {
    for (const command of commands) {
      expect(experienceAreaForPath(command.href)).toBeTruthy();
    }
  });

  it('returns the whole list when nothing has been typed yet', () => {
    expect(filterExperienceCommands(commands, '')).toHaveLength(commands.length);
    expect(filterExperienceCommands(commands, '   ')).toHaveLength(commands.length);
  });

  it('matches the group name too, so "planner" reaches the planning destinations', () => {
    expect(filterExperienceCommands(commands, 'planner').map((command) => command.label)).toEqual([
      'This week',
      'Calendar',
      'Weekly review',
      'Goals & horizons',
    ]);
  });

  it('matches a partial label regardless of case', () => {
    expect(filterExperienceCommands(commands, 'CAL').map((command) => command.href)).toEqual([
      '/planner/calendar',
    ]);
    expect(filterExperienceCommands(commands, 'account').map((command) => command.href)).toEqual([
      '/settings/account',
      '/settings/preferences',
    ]);
  });

  it('returns nothing rather than everything when the query matches no destination', () => {
    expect(filterExperienceCommands(commands, 'zzzz')).toEqual([]);
  });

  it('hides canonical-only destinations while the legacy model is active', () => {
    const legacy = experienceCommands(false).map((command) => command.label);
    expect(legacy).not.toContain('Account');
    expect(legacy).not.toContain('Notes');
    expect(legacy).toContain('Search workspace');
  });
});

describe('settings navigation', () => {
  it('gives the account its own destination instead of hiding it inside Security', () => {
    const items = experienceNavItems(experienceNavigationForPath('/settings/account', true));
    expect(items[0]).toMatchObject({ label: 'Account', href: '/settings/account' });
    expect(isExperienceNavItemActive('/settings/account', items[0])).toBe(true);
  });

  it('keeps the account destination out of the legacy model, which has no workspace row', () => {
    const items = experienceNavItems(experienceNavigationForPath('/settings/security', false));
    expect(items.map((item) => item.href)).not.toContain('/settings/account');
  });

  it('marks the destination that was actually chosen, not the one sharing its path', () => {
    /* "This week" is /planner and "Goals & horizons" is /planner with every
       period. Matching on pathname alone marked both, so the sidebar claimed
       you were somewhere you had not clicked. */
    const items = experienceNavItems(experienceNavigationForPath('/planner', true));
    const thisWeek = items.find((item) => item.label === 'This week')!;
    const goals = items.find((item) => item.label === 'Goals & horizons')!;
    expect(goals.href).toBe('/planner?period=all');

    // The plain address belongs to This week.
    expect(activeExperienceNavHref('/planner', '', items)).toBe(thisWeek.href);

    // The one whose query is satisfied wins over the one naming no query.
    expect(activeExperienceNavHref('/planner', 'period=all', items)).toBe(goals.href);

    // A query neither entry names leaves the plain address current.
    expect(activeExperienceNavHref('/planner', 'horizon=year', items)).toBe(thisWeek.href);

    // A different page marks neither.
    expect(activeExperienceNavHref('/notes', 'period=all', items)).toBe(null);
  });
});
