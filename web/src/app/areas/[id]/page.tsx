import { notFound } from 'next/navigation';
import { getAreaPage, type AreaScope } from '@/app/areas/actions';
import { AreaWorkspace } from '@/components/areas/area-workspace';
import { dateInTimezone } from '@/lib/date';
import { requireOwnedWorkspaceId } from '@/lib/supabase/authenticated-context';

const TABS = ['overview', 'plan', 'notes'] as const;
type Tab = (typeof TABS)[number];

/* Tab and scope live in the address rather than in component state, so a
   subarea's plan can be linked to, reopened, and found again with back. Both
   are validated here: an unrecognised value falls back rather than rendering a
   blank section. */
function readTab(value: string | undefined): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : 'overview';
}
function readScope(value: string | undefined): AreaScope {
  return value === 'self' ? 'self' : 'descendants';
}

export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; scope?: string; archived?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const data = await getAreaPage(id, readScope(query.scope));
  if (!data) notFound();

  const { timezone } = await requireOwnedWorkspaceId().then(async ({ supabase, workspaceId }) => {
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('timezone')
      .eq('id', workspaceId)
      .single();
    return { timezone: (workspace?.timezone as string | undefined) ?? 'UTC' };
  });

  return (
    <AreaWorkspace
      data={data}
      tab={readTab(query.tab)}
      showArchived={query.archived === '1'}
      localDate={dateInTimezone(timezone)}
    />
  );
}
