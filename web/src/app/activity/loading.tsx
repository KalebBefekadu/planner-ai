import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton rows={6} layout="list" label="Loading recent activity" />;
}
