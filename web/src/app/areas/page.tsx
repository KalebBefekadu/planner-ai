import { notFound } from 'next/navigation';
import { getAreaTree } from '@/app/areas/actions';
import { AreaIndex } from '@/components/areas/area-index';

export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const [{ archived }, { tree }] = await Promise.all([searchParams, getAreaTree()]);
  return <AreaIndex tree={tree} showArchived={archived === '1'} />;
}
