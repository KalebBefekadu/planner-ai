/* What a weekly worksheet shows, as functions over plain rows.
 *
 * The arithmetic here is the part a person will later be asked to trust, so
 * none of it happens inside a component and none of it happens in a model.
 * Two rules carry most of the weight:
 *
 *   The denominator is the baseline, and the baseline is what was committed
 *   and not yet finished at the moment of committing. A week with nothing
 *   committed has no percentage -- it shows an em dash, not 0% and not 100%.
 *
 *   Completion counts by the end of the period, not by now. A review written
 *   on the following Tuesday must not count Tuesday's work as last week's.
 */

import { addCalendarDays, plannerWeekStart } from '@/lib/planner-calendar';

export type WeeklyItem = {
  actionId: string;
  title: string;
  /** Carried with the row so completing from here is version-checked. */
  version: number;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'dropped';
  scheduledOn: string | null;
  completedAt: string | null;
  areaId: string | null;
  areaName: string | null;
  inBaseline: boolean;
  disposition: 'kept' | 'moved' | 'paused' | 'dropped' | null;
};

export type WeekBounds = { startsOn: string; endsOn: string };

export function weekBounds(anyDateInWeek: string, weekStartsOn = 1): WeekBounds {
  const startsOn = plannerWeekStart(anyDateInWeek, weekStartsOn);
  return { startsOn, endsOn: addCalendarDays(startsOn, 6) };
}

export function shiftWeek(bounds: WeekBounds, weeks: number): WeekBounds {
  const startsOn = addCalendarDays(bounds.startsOn, weeks * 7);
  return { startsOn, endsOn: addCalendarDays(startsOn, 6) };
}

/**
 * Finished, and finished in time.
 *
 * `endsOn` is a calendar date, so the period runs until the start of the day
 * after it. Comparing against the end date itself would discard everything
 * done on the final day.
 */
export function completedByPeriodEnd(item: WeeklyItem, bounds: WeekBounds) {
  if (item.status !== 'done' || !item.completedAt) return false;
  return item.completedAt < `${addCalendarDays(bounds.endsOn, 1)}T00:00:00.000Z`;
}

export type WeeklyProgress = {
  baselineCount: number;
  completedCount: number;
  lateAdditionCount: number;
  /** Null when there is no baseline. The screen shows an em dash for null. */
  percentage: number | null;
};

export function weeklyProgress(items: readonly WeeklyItem[], bounds: WeekBounds): WeeklyProgress {
  const baseline = items.filter((item) => item.inBaseline);
  const completed = baseline.filter((item) => completedByPeriodEnd(item, bounds));
  return {
    baselineCount: baseline.length,
    completedCount: completed.length,
    lateAdditionCount: items.filter((item) => !item.inBaseline).length,
    percentage: baseline.length
      ? Math.round((completed.length / baseline.length) * 100)
      : /* No planned work is not zero per cent, and it is not a hundred. */
        null,
  };
}

/** What the percentage should read as. */
export function progressLabel(progress: WeeklyProgress) {
  return progress.percentage === null ? '—' : `${progress.percentage}%`;
}

export type WeeklyGrouping = 'day' | 'area';

export type WeeklyGroup = { key: string; label: string; items: WeeklyItem[] };

/**
 * Group the week's work for reading.
 *
 * Unscheduled work is a labelled group rather than a silent omission: a task
 * committed to this week with no day chosen is still committed, and a
 * worksheet that drops it is lying about the week.
 */
export function groupWeeklyItems(
  items: readonly WeeklyItem[],
  bounds: WeekBounds,
  grouping: WeeklyGrouping
): WeeklyGroup[] {
  if (grouping === 'area') {
    const groups = new Map<string, WeeklyGroup>();
    for (const item of items) {
      const key = item.areaId ?? '';
      const existing = groups.get(key);
      if (existing) existing.items.push(item);
      else groups.set(key, { key, label: item.areaName ?? 'No area', items: [item] });
    }
    return [...groups.values()].sort((left, right) => {
      if (!left.key) return 1;
      if (!right.key) return -1;
      return left.label.localeCompare(right.label);
    });
  }

  const days = Array.from({ length: 7 }, (_, index) => addCalendarDays(bounds.startsOn, index));
  const groups: WeeklyGroup[] = days.map((day) => ({ key: day, label: day, items: [] }));
  const unscheduled: WeeklyGroup = { key: '', label: 'No day chosen', items: [] };
  for (const item of items) {
    const group = item.scheduledOn ? groups.find((entry) => entry.key === item.scheduledOn) : null;
    (group ?? unscheduled).items.push(item);
  }
  return [...groups, ...(unscheduled.items.length ? [unscheduled] : [])];
}

/**
 * Baseline work that has neither finished nor been decided about.
 *
 * This is the review's second question -- "what needs a decision?" -- and it
 * is deliberately not the same as "unfinished": an item someone has already
 * said they are moving has been decided, and asking again is nagging.
 */
export function needsDecision(items: readonly WeeklyItem[], bounds: WeekBounds) {
  return items.filter(
    (item) =>
      item.inBaseline &&
      !completedByPeriodEnd(item, bounds) &&
      item.disposition === null &&
      item.status !== 'dropped'
  );
}

/** The quarter a week belongs to, keyed on its first day so it never splits. */
export function weekQuarterLabel(bounds: WeekBounds) {
  const [year, month] = bounds.startsOn.split('-').map(Number);
  return `${year} Q${Math.floor((month - 1) / 3) + 1}`;
}
