import { notFound } from 'next/navigation';
import { getNotificationCenter } from '@/app/notifications/actions';
import { getWorkspacePreferences } from '@/app/onboarding/actions';
import { NotificationPreferencesForm } from '@/components/notification-preferences-form';
import { SettingsTabs } from '@/components/settings-tabs';
import { WorkspacePreferencesForm } from '@/components/workspace-preferences-form';

export default async function PreferencesSettingsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const [preferences, notificationCenter] = await Promise.all([
    getWorkspacePreferences(),
    getNotificationCenter(),
  ]);
  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Workspace preferences</h1>
          <p className="lede">Control planning dates, review cadence, and assistant processing.</p>
        </div>
      </header>
      <SettingsTabs showCanonical />
      <WorkspacePreferencesForm initial={preferences} mode="settings" />
      <NotificationPreferencesForm initial={notificationCenter.preferences} />
    </div>
  );
}
