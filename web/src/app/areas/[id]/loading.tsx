import { PageSkeleton } from '@/components/page-skeleton';

export default function Loading() {
  return <PageSkeleton layout="split" rows={6} label="Loading this life area" />;
}
