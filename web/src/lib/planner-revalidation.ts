import { revalidatePath } from 'next/cache';

// The same Action is rendered by several routes, and Planner navigation links
// to the scoped aliases rather than the roots. Invalidating '/planner' does
// not invalidate '/planner/today', so completing something on Today used to
// leave the route a person actually navigates to showing the stale row.
//
// Listing the routes in one place is what keeps that from drifting again: a
// new surface that renders Actions is added here once instead of being
// remembered at every call site.

/** Every route that renders Actions, Goals, or the plan around them. */
export const PLANNER_VIEW_PATHS = [
  '/',
  '/planner',
  '/planner/today',
  '/planner/calendar',
  '/planner/inbox',
  '/inbox',
  '/goals',
  '/vision',
  '/review',
] as const;

/** Routes that record what happened rather than the current plan. */
export const RECORD_VIEW_PATHS = ['/activity', '/search'] as const;

export function revalidatePlannerViews() {
  for (const path of PLANNER_VIEW_PATHS) revalidatePath(path);
}

export function revalidatePlannerAndRecords() {
  revalidatePlannerViews();
  for (const path of RECORD_VIEW_PATHS) revalidatePath(path);
}
