/**
 * How much of the Weekly Review is shown at once.
 *
 * The week is read at three distances: everything, when the week is being
 * worked through; compact, when it is being scanned; and headlines, which is
 * one row per grouping and is the ten-second version. The setting is a reading
 * preference rather than workspace data, so it lives in the browser and is
 * never sent anywhere.
 */
export const REVIEW_DENSITY_KEY = 'planner-review-density';

export const REVIEW_DENSITIES = ['full', 'compact', 'headlines'] as const;

export type ReviewDensity = (typeof REVIEW_DENSITIES)[number];

export const DEFAULT_REVIEW_DENSITY: ReviewDensity = 'full';

export function parseReviewDensity(raw: string | null): ReviewDensity {
  return (REVIEW_DENSITIES as readonly string[]).includes(raw ?? '')
    ? (raw as ReviewDensity)
    : DEFAULT_REVIEW_DENSITY;
}

/** Whether a grouping (a goal, later an initiative) starts open at this density. */
export function groupOpenByDefault(density: ReviewDensity): boolean {
  return density !== 'headlines';
}

/** Whether a band inside a grouping starts open at this density. */
export function bandOpenByDefault(density: ReviewDensity): boolean {
  return density === 'full' || density === 'compact';
}
