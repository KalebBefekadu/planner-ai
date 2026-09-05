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

export function plannerWeekStart(value: string) {
  const date = dateOnlyToUtc(value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(value, -daysSinceMonday);
}

export function plannerWeek(value: string) {
  const start = plannerWeekStart(value);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

export function isDateInPlannerWeek(value: string | null, weekStart: string) {
  if (!value) return false;
  const weekEnd = addCalendarDays(weekStart, 6);
  return value >= weekStart && value <= weekEnd;
}
