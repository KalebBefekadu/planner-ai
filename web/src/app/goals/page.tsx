import { notFound } from 'next/navigation';
import { getGoalsView } from '@/app/goals/actions';
import { GoalsHorizonUI } from '@/components/planning/goals-horizon-ui';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Which period, how long it is, and which part of life it is narrowed to are
   all in the address, so a view is a thing to link to and come back to. An
   unreadable value falls back to the period containing today rather than
   rendering an empty one. */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; on?: string; area?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const { view, on, area } = await searchParams;
  const data = await getGoalsView(
    view === 'year' ? 'year' : 'quarter',
    on && DATE_ONLY.test(on) ? on : null,
    area && UUID.test(area) ? area : null
  );
  return <GoalsHorizonUI data={data} />;
}
