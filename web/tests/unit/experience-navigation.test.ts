import { describe, expect, it } from 'vitest';
import {
  experienceAreaForPath,
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
    ).toContain('MCP');
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
