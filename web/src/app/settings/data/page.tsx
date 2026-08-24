import { notFound } from 'next/navigation';
import { getPendingAccountDeletion } from '@/app/settings/data/actions';
import { DataSettings } from '@/components/data-settings';
import { SettingsTabs } from '@/components/settings-tabs';
import { createClient } from '@/lib/supabase/server';

export default async function DataSettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const [assurance, deletionRequest] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getPendingAccountDeletion(),
  ]);
  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Data and portability</h1>
          <p className="lede">Take a complete copy of the records you own in Planner AI.</p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <DataSettings
        assuranceLevel={assurance.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'}
        deletionRequest={deletionRequest}
      />
    </div>
  );
}
