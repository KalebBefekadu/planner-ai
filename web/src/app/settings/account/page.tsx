import { notFound } from 'next/navigation';
import { getAccountOverview } from '@/app/settings/account/actions';
import { AccountSummary } from '@/components/account-summary';
import { SettingsTabs } from '@/components/settings-tabs';

export default async function AccountSettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const account = await getAccountOverview();

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Account</h1>
          <p className="lede">Who this workspace belongs to, and where each detail is changed.</p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <AccountSummary account={account} />
    </div>
  );
}
