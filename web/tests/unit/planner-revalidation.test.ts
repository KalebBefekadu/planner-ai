import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANNER_VIEW_PATHS, RECORD_VIEW_PATHS } from '@/lib/planner-revalidation';

// Planner navigation links to the scoped aliases, not the roots, so a route
// missing from this list is a route that keeps showing an Action a person
// already completed, deferred or blocked. That failure is invisible in a
// component test -- the component is right, the cache is stale -- so what is
// worth pinning is the list itself and the fact that nothing hand-rolls its
// own version of it.

const appDir = join(__dirname, '..', '..', 'src', 'app');

function serverActionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return serverActionFiles(path);
    return entry === 'actions.ts' ? [path] : [];
  });
}

describe('planner view revalidation', () => {
  it('names every route that renders an Action or the plan around it', () => {
    // The scoped Planner aliases are the entire point: '/planner' does not
    // invalidate '/planner/today', which is where Planner navigation sends
    // people.
    expect([...PLANNER_VIEW_PATHS]).toEqual([
      '/',
      '/planner',
      '/planner/today',
      '/planner/calendar',
      '/planner/inbox',
      '/inbox',
      '/goals',
      '/vision',
      '/review',
    ]);
    expect([...RECORD_VIEW_PATHS]).toEqual(['/activity', '/search']);
  });

  it('leaves no server action revalidating a planner route by hand', () => {
    // The layout-scoped form, revalidatePath('/', 'layout'), is deliberately
    // not matched: it invalidates everything below the root layout, aliases
    // included, so it cannot be partially right the way a path list can.
    const plannerRoute = /revalidatePath\(\s*'(\/|\/planner[^']*|\/goals|\/vision|\/review)'\s*\)/;
    const offenders = serverActionFiles(appDir)
      .filter((path) => plannerRoute.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(appDir.length + 1));

    // A hand-rolled call is how the aliases went missing in the first place:
    // it looks complete at the call site and silently covers less than it
    // reads as covering.
    expect(offenders).toEqual([]);
  });
});
