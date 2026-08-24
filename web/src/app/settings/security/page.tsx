import { createClient } from '@/lib/supabase/server';
import { MfaSettings } from '@/components/mfa-settings';
import { SettingsTabs } from '@/components/settings-tabs';

export default async function SecuritySettingsPage() {
  const supabase = await createClient();
  const [factorsResult, assuranceResult] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const factors = (factorsResult.data?.totp ?? [])
    .filter((factor) => factor.status === 'verified')
    .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? 'Authenticator' }));

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Account security</h1>
          <p className="lede">
            Manage the authenticators that protect sensitive Planner AI actions.
          </p>
        </div>
      </header>
      <SettingsTabs showCanonical={process.env.PLANNER_DATA_MODEL === 'canonical'} />
      <MfaSettings
        factors={factors}
        assuranceLevel={assuranceResult.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'}
      />
    </div>
  );
}
