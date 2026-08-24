import { notFound } from 'next/navigation';
import { MemoryManager, type MemoryView } from '@/components/memory-manager';
import { SettingsTabs } from '@/components/settings-tabs';
import { createClient } from '@/lib/supabase/server';

export default async function MemorySettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('memories')
    .select('id,statement,source_type,source_id,version,updated_at')
    .is('trashed_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw new Error('Unable to load assistant Memory.');

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Assistant Memory</h1>
          <p className="lede">
            Inspect and control what Planner AI may remember across conversations.
          </p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <MemoryManager memories={(data ?? []) as unknown as MemoryView[]} />
    </div>
  );
}
