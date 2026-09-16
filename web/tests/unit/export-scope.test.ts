import { describe, expect, it } from 'vitest';

import { exportTables } from '@/app/api/export/route';

/* IM-08 (#186): the Notes vault carries Notes only, and the settings screen now
   tells the owner that their plan lives in the full Workspace export instead.
   That sentence is a promise, and a promise about what a file contains is only
   worth making if something fails when it stops being true.

   These assertions exist so that dropping a planning table from the export is a
   failing test rather than a silent change to what leaving with your data
   means. */

const tableNames = exportTables.map(([table]) => table);

describe('the full Workspace export', () => {
  it('carries the planning half of the workspace, not only the Notes half', () => {
    /* Everything a person builds in the Planner and cannot reconstruct from
       memory: the direction, the work planned against it, when that work was
       scheduled, and the reflection written about it afterwards. */
    for (const table of [
      'visions',
      'goals',
      'actions',
      'action_templates',
      'action_schedule_history',
      'planning_horizons',
      'reviews',
      'review_action_items',
    ]) {
      expect(tableNames, `${table} is part of what the owner leaves with`).toContain(table);
    }
  });

  it('still carries the Notes half, which the vault also covers', () => {
    for (const table of ['notes', 'note_links', 'note_tags', 'tags', 'captures']) {
      expect(tableNames).toContain(table);
    }
  });

  it('names every table exactly once, so nothing is exported twice', () => {
    expect(tableNames).toEqual([...new Set(tableNames)]);
  });
});
