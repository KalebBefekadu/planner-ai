import { describe, expect, it } from 'vitest';
import { experienceV2EnabledForOwner } from '@/lib/experience-rollout';

describe('experienceV2EnabledForOwner', () => {
  it('fails closed for missing or invalid configuration', () => {
    expect(experienceV2EnabledForOwner('owner-a', {})).toBe(false);
    expect(experienceV2EnabledForOwner('owner-a', { PLANNER_UI_V2: 'sometimes' })).toBe(false);
  });

  it('enables the shell for every owner only when explicitly enabled', () => {
    expect(experienceV2EnabledForOwner('owner-a', { PLANNER_UI_V2: 'enabled' })).toBe(true);
  });

  it('limits the cohort mode to configured owner ids', () => {
    const environment = {
      PLANNER_UI_V2: 'cohort',
      PLANNER_UI_V2_COHORT_OWNER_IDS: ' owner-a,owner-b ,, owner-c ',
    };

    expect(experienceV2EnabledForOwner('owner-b', environment)).toBe(true);
    expect(experienceV2EnabledForOwner('owner-z', environment)).toBe(false);
  });
});
