import { notFound } from 'next/navigation';
import { getNotificationCenter } from '@/app/notifications/actions';
import { NotificationsCenter } from '@/components/notifications-center';

export default async function NotificationsPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const center = await getNotificationCenter();

  return (
    <div className="page notifications-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Attention</p>
          <h1>Notifications</h1>
          <p className="lede">Planning signals that need a decision, gathered in one place.</p>
        </div>
      </header>
      <NotificationsCenter
        initialNotifications={center.notifications}
        inAppEnabled={center.preferences.inAppEnabled}
      />
    </div>
  );
}
