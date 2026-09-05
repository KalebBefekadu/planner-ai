import { describe, expect, it } from 'vitest';
import {
  experienceAreaForPath,
  experienceNavigationForPath,
  isExperienceNavItemActive,
} from '@/lib/experience-navigation';

describe('experience navigation', () => {
  it('keeps Planner routes in a Planner-specific navigation surface', () => {
    expect(experienceAreaForPath('/planner')).toBe('planner');
    expect(experienceAreaForPath('/planner/calendar')).toBe('planner');
    expect(experienceAreaForPath('/vision')).toBe('planner');
    expect(experienceAreaForPath('/review')).toBe('planner');

    const navigation = experienceNavigationForPath('/planner', true);
    expect(navigation.title).toBe('Planner');
    expect(navigation.subtitle).toBe('Direction to today');
    expect(navigation.items.map((item) => item.label)).toEqual([
      'Today',
      'Plan',
      'Calendar',
      'Vision',
      'Weekly review',
    ]);
    expect(navigation.subtitle).not.toContain('Personal workspace');
  });

  it('keeps Workspace and Settings destinations separate', () => {
    expect(experienceNavigationForPath('/notes', true).title).toBe('Workspace');
    expect(experienceNavigationForPath('/search', true).title).toBe('Search');
    expect(experienceNavigationForPath('/settings/mcp', true).title).toBe('Settings');
    expect(
      experienceNavigationForPath('/settings/mcp', true).items.map((item) => item.label)
    ).toContain('MCP');
  });

  it('omits canonical-only destinations while the legacy model is active', () => {
    expect(experienceNavigationForPath('/inbox', false).items.map((item) => item.label)).toEqual([
      'Capture inbox',
    ]);
    expect(
      experienceNavigationForPath('/settings/security', false).items.map((item) => item.label)
    ).toEqual(['Security', 'Safety']);
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
