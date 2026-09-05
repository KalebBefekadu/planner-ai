import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton rows={4} layout="split" label="Loading your calendar" />;
}
