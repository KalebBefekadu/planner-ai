const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateOnlyToUtc(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error('Expected a date in YYYY-MM-DD format.');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('Expected a valid calendar date.');
  return date;
}

export function addCalendarDays(value: string, days: number) {
  const date = dateOnlyToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The first day of the week containing `value`.
 *
 * `weekStartsOn` is a stored workspace preference (0 = Sunday) rather than a
 * constant: a person whose week starts on Sunday and a person whose week
 * starts on Monday disagree about which week a Sunday belongs to, and both
 * are right about their own plan.
 */
export function plannerWeekStart(value: string, weekStartsOn = 1) {
  const date = dateOnlyToUtc(value);
  const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return addCalendarDays(value, -offset);
}

export function plannerWeek(value: string, weekStartsOn = 1) {
  const start = plannerWeekStart(value, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

export function isDateInPlannerWeek(value: string | null, weekStart: string) {
  if (!value) return false;
  const weekEnd = addCalendarDays(weekStart, 6);
  return value >= weekStart && value <= weekEnd;
}
