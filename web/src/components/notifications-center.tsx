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
import { TabList } from '@/components/shell/tab-list';

/* The reference groups the queue by what a signal is about, because a backlog
   is read one concern at a time: overdue work is a different decision from a
   review being ready. The kinds are the ones the notification data already
   carries, so this names existing information rather than inventing a
   taxonomy. The list is already in memory, so unlike workspace search this
   filters in place rather than through the address. */
const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'overdue_actions', label: 'Planning' },
  { id: 'weekly_review', label: 'Review' },
  { id: 'recurring_actions', label: 'Recurring' },
  { id: 'system', label: 'System' },
] as const;

type KindFilter = (typeof KINDS)[number]['id'];

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
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

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

  // Counts describe the whole queue, not the current filter, so a tab that
  // would show nothing says so before it is chosen.
  const countFor = (id: KindFilter) =>
    id === 'all'
      ? initialNotifications.length
      : initialNotifications.filter((notification) => notification.kind === id).length;
  const visible =
    kindFilter === 'all'
      ? initialNotifications
      : initialNotifications.filter((notification) => notification.kind === kindFilter);
  const activeKindLabel = KINDS.find((kind) => kind.id === kindFilter)!.label;

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
      {inAppEnabled && initialNotifications.length ? (
        <TabList
          label="Filter notifications by kind"
          className="notification-kinds"
          activeClassName="notification-kind-active"
          value={kindFilter}
          onChange={setKindFilter}
          items={KINDS.map((kind) => ({
            id: kind.id,
            label: `${kind.label} ${countFor(kind.id)}`,
          }))}
        />
      ) : null}
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
      ) : visible.length ? (
        <section
          className="notification-list"
          aria-label="Current notifications"
          role="tabpanel"
          id={`tabpanel-${kindFilter}`}
          aria-labelledby={`tab-${kindFilter}`}
        >
          {visible.map((notification) => (
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
      ) : initialNotifications.length ? (
        <div
          className="empty-state notification-empty"
          role="tabpanel"
          id={`tabpanel-${kindFilter}`}
          aria-labelledby={`tab-${kindFilter}`}
        >
          <Check size={24} aria-hidden="true" />
          <h2>Nothing here</h2>
          <p>
            No {activeKindLabel.toLowerCase()} signals need your attention.{' '}
            <button className="link-button" type="button" onClick={() => setKindFilter('all')}>
              Show all {initialNotifications.length}
            </button>
          </p>
        </div>
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
