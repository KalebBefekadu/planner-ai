'use client';

import { useState, useTransition } from 'react';
import { Bell, Mail, Save } from 'lucide-react';
import {
  saveNotificationPreferences,
  type NotificationPreferences,
} from '@/app/notifications/actions';

function hourLabel(hour: number) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric' }).format(
    new Date(Date.UTC(2026, 0, 1, hour))
  );
}

export function NotificationPreferencesForm({ initial }: { initial: NotificationPreferences }) {
  const [inAppEnabled, setInAppEnabled] = useState(initial.inAppEnabled);
  const [emailEnabled, setEmailEnabled] = useState(initial.emailEnabled);
  const [emailHour, setEmailHour] = useState(initial.emailHour);
  const [quietHoursStart, setQuietHoursStart] = useState(initial.quietHoursStart);
  const [quietHoursEnd, setQuietHoursEnd] = useState(initial.quietHoursEnd);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setNotice(null);
    setError(null);
    if (quietHoursStart === quietHoursEnd) {
      setError('Quiet hours must have different start and end times.');
      return;
    }
    startTransition(async () => {
      const result = await saveNotificationPreferences({
        inAppEnabled,
        emailEnabled,
        emailHour,
        quietHoursStart,
        quietHoursEnd,
      });
      if (result.ok) setNotice('Notification preferences saved.');
      else setError(result.error ?? 'Notification preferences could not be saved.');
    });
  }

  return (
    <section className="preference-section notification-preferences" aria-labelledby="reminders">
      <div className="preference-heading">
        <p className="eyebrow">Reminders</p>
        <h2 id="reminders">Choose how Planner AI gets your attention</h2>
      </div>
      <div className="notification-toggle-grid">
        <div className="notification-toggle-row">
          <span className="preference-icon" aria-hidden="true">
            <Bell size={18} />
          </span>
          <div>
            <strong>In-app notifications</strong>
            <p>Show overdue Actions, recurring work, and Weekly Review signals.</p>
          </div>
          <label className="switch-control">
            <input
              type="checkbox"
              checked={inAppEnabled}
              onChange={(event) => setInAppEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>{inAppEnabled ? 'Enabled' : 'Disabled'}</strong>
          </label>
        </div>
        <div className="notification-toggle-row">
          <span className="preference-icon notification-email-icon" aria-hidden="true">
            <Mail size={18} />
          </span>
          <div>
            <strong>Email reminder</strong>
            <p>Send one generic daily count without including private planning content.</p>
          </div>
          <label className="switch-control">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(event) => setEmailEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>{emailEnabled ? 'Enabled' : 'Disabled'}</strong>
          </label>
        </div>
      </div>
      <div className="preference-fields notification-time-fields">
        <label>
          Email after
          <select
            className="input-field"
            value={emailHour}
            disabled={!emailEnabled}
            onChange={(event) => setEmailHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quiet hours start
          <input
            className="input-field"
            type="time"
            value={quietHoursStart}
            onChange={(event) => setQuietHoursStart(event.target.value)}
          />
        </label>
        <label>
          Quiet hours end
          <input
            className="input-field"
            type="time"
            value={quietHoursEnd}
            onChange={(event) => setQuietHoursEnd(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      <div className="preference-actions">
        <button
          className="btn-primary button-with-icon"
          type="button"
          disabled={pending}
          onClick={submit}
        >
          <Save size={16} />
          {pending ? 'Saving...' : 'Save reminders'}
        </button>
      </div>
    </section>
  );
}
