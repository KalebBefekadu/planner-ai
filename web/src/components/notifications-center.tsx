'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { BellOff, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  dismissNotificationAction,
  markNotificationReadAction,
  refreshNotificationsAction,
  type NotificationView,
} from '@/app/notifications/actions';

function formatVisibleAt(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function NotificationsCenter({
  initialNotifications,
  inAppEnabled,
}: {
  initialNotifications: NotificationView[];
  inAppEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    startTransition(async () => {
      const result = await refreshNotificationsAction();
      setError(result.ok ? null : (result.error ?? 'Refresh failed.'));
      if (result.ok) router.refresh();
    });
  }

  function change(kind: 'read' | 'dismiss', notification: NotificationView) {
    startTransition(async () => {
      const result =
        kind === 'read'
          ? await markNotificationReadAction(notification.id, notification.version)
          : await dismissNotificationAction(notification.id, notification.version);
      setError(result.ok ? null : (result.error ?? 'Notification update failed.'));
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="notification-center">
      <div className="notification-toolbar">
        <p>{initialNotifications.filter((notification) => !notification.readAt).length} unread</p>
        <button
          className="btn-secondary button-with-icon"
          type="button"
          disabled={pending || !inAppEnabled}
          onClick={refresh}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {pending ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {!inAppEnabled ? (
        <div className="empty-state notification-empty">
          <BellOff size={24} aria-hidden="true" />
          <h2>In-app notifications are off</h2>
          <p>Turn them on in Workspace preferences.</p>
          <Link className="btn-secondary" href="/settings/preferences">
            Open preferences
          </Link>
        </div>
      ) : initialNotifications.length ? (
        <section className="notification-list" aria-label="Current notifications">
          {initialNotifications.map((notification) => (
            <article
              className={`notification-row${notification.readAt ? '' : ' notification-unread'}`}
              key={notification.id}
            >
              <span className="notification-status" aria-hidden="true" />
              <div className="notification-copy">
                <h2>{notification.title}</h2>
                <p>{notification.body}</p>
                <time dateTime={notification.visibleAt}>
                  {formatVisibleAt(notification.visibleAt)}
                </time>
              </div>
              <div className="notification-actions">
                <Link
                  className="icon-button"
                  href={notification.href}
                  title="Open related view"
                  aria-label={`Open ${notification.title}`}
                >
                  <ExternalLink size={16} />
                </Link>
                {!notification.readAt ? (
                  <button
                    className="icon-button"
                    type="button"
                    title="Mark as read"
                    aria-label={`Mark ${notification.title} as read`}
                    disabled={pending}
                    onClick={() => change('read', notification)}
                  >
                    <Check size={16} />
                  </button>
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  title="Dismiss"
                  aria-label={`Dismiss ${notification.title}`}
                  disabled={pending}
                  onClick={() => change('dismiss', notification)}
                >
                  <X size={16} />
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="empty-state notification-empty">
          <Check size={24} aria-hidden="true" />
          <h2>You are caught up</h2>
          <p>No planning signals need your attention.</p>
        </div>
      )}
    </div>
  );
}
