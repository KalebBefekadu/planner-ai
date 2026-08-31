import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton rows={3} layout="list" label="Loading memory settings" />;
}
