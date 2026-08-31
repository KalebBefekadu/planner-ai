import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton rows={3} layout="split" label="Loading your review" />;
}
