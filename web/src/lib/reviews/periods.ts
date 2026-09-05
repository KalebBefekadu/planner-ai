import { dateInTimezone } from '@/lib/date';

export type LongReviewPeriod = 'month' | 'quarter';

export function currentLongReviewPeriod(
  timezone: string,
  kind: LongReviewPeriod,
  now = new Date()
) {
  const localDate = new Date(`${dateInTimezone(timezone, now)}T00:00:00Z`);
  const year = localDate.getUTCFullYear();
  const month = localDate.getUTCMonth();
  const startMonth = kind === 'quarter' ? Math.floor(month / 3) * 3 : month;
  const monthCount = kind === 'quarter' ? 3 : 1;
  const startsOn = new Date(Date.UTC(year, startMonth, 1));
  const endsOn = new Date(Date.UTC(year, startMonth + monthCount, 0));
  return {
    startsOn: startsOn.toISOString().slice(0, 10),
    endsOn: endsOn.toISOString().slice(0, 10),
  };
}
