import { notFound } from 'next/navigation';
import { TrashManager, type TrashBatchView } from '@/components/trash-manager';
import { createClient } from '@/lib/supabase/server';

type TrashBatchRow = Omit<TrashBatchView, 'affectedCount'> & {
  trash_batch_items: Array<{ count: number }>;
};

export default async function TrashPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('trash_batches')
    .select('id,root_item_type,root_label,created_at,trash_batch_items(count)')
    .is('restored_at', null)
    .is('emptied_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Unable to load Trash.');
  /* Eligibility is decided here rather than in the client component: this is
     an async server component, so it renders once per request and there is no
     client re-render to disagree with it. */
  const RETENTION_MS = 30 * 86_400_000;
  const now = new Date().getTime();
  const batches = ((data ?? []) as unknown as TrashBatchRow[]).map((batch) => ({
    id: batch.id,
    root_item_type: batch.root_item_type,
    root_label: batch.root_label,
    created_at: batch.created_at,
    affectedCount: batch.trash_batch_items[0]?.count ?? 0,
    emptyEligible: new Date(batch.created_at).getTime() + RETENTION_MS <= now,
  }));

  return (
    <div className="page trash-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Recovery</p>
          <h1>Trash</h1>
          <p className="lede">Restore grouped changes before their retention period ends.</p>
        </div>
      </header>
      <TrashManager batches={batches} />
    </div>
  );
}
