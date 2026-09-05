export type ExperienceV2Mode = 'disabled' | 'enabled' | 'cohort';

type RolloutEnvironment = {
  PLANNER_UI_V2?: string;
  PLANNER_UI_V2_COHORT_OWNER_IDS?: string;
};

function rolloutMode(value: string | undefined): ExperienceV2Mode {
  if (value === 'enabled' || value === 'cohort') return value;
  return 'disabled';
}

function cohortOwnerIds(value: string | undefined) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((ownerId) => ownerId.trim())
      .filter(Boolean)
  );
}

/**
 * The canonical model has one owner per workspace, so the owner id is a
 * stable, data-free cohort key until workspace-level release settings arrive.
 * Unknown configuration deliberately falls back to the established shell.
 */
export function experienceV2EnabledForOwner(
  ownerUserId: string,
  environment: RolloutEnvironment = {
    PLANNER_UI_V2: process.env.PLANNER_UI_V2,
    PLANNER_UI_V2_COHORT_OWNER_IDS: process.env.PLANNER_UI_V2_COHORT_OWNER_IDS,
  }
) {
  const mode = rolloutMode(environment.PLANNER_UI_V2);
  if (mode === 'enabled') return true;
  if (mode === 'cohort')
    return cohortOwnerIds(environment.PLANNER_UI_V2_COHORT_OWNER_IDS).has(ownerUserId);
  return false;
}
