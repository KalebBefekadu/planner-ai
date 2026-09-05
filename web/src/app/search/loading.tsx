import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton rows={4} layout="list" label="Loading search" />;
}
