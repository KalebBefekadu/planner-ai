import { notFound } from 'next/navigation';
import { getWeeklyWorksheet } from '@/app/planner/week/actions';
import { WeeklyWorksheetUI } from '@/components/planning/weekly-worksheet-ui';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/* Which week, and how it is grouped, are in the address: a week is a thing
   people link to, come back to, and reach with the back button. An unreadable
   value falls back to this week rather than rendering an empty one. */
export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; by?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const { week, by } = await searchParams;
  const data = await getWeeklyWorksheet(
    week && DATE_ONLY.test(week) ? week : null,
    by === 'area' ? 'area' : 'day'
  );
  return <WeeklyWorksheetUI data={data} />;
}
