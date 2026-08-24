import { notFound } from 'next/navigation';
import { getPeriodReviewData, getWeeklyReviewData } from '@/app/review/actions';
import { PeriodReview } from '@/components/period-review';
import { WeeklyReview } from '@/components/weekly-review';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const period = (await searchParams).period;
  if (period === 'month' || period === 'quarter') {
    const data = await getPeriodReviewData(period);
    return <PeriodReview data={data} />;
  }
  const data = await getWeeklyReviewData();
  return <WeeklyReview data={data} />;
}
