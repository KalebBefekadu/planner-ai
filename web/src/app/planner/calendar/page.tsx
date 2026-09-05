import { notFound } from 'next/navigation';
import { getTodayData } from '@/app/today/actions';
import { PlannerCalendar } from '@/components/planner-calendar';

export default async function PlannerCalendarPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  return <PlannerCalendar data={await getTodayData()} />;
}
