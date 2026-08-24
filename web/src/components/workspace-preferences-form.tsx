'use client';

import { useMemo, useState, useTransition } from 'react';
import { ArrowRight, Save, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { saveWorkspacePreferences, type WorkspacePreferences } from '@/app/onboarding/actions';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Workspace preferences could not be saved.';
}

export function WorkspacePreferencesForm({
  initial,
  mode,
}: {
  initial: WorkspacePreferences;
  mode: 'onboarding' | 'settings';
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(initial.weekStartsOn);
  const [coachingIntensity, setCoachingIntensity] = useState(initial.coachingIntensity);
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [weeklyReviewDay, setWeeklyReviewDay] = useState(initial.weeklyReviewDay);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return supported.includes(initial.timezone) ? supported : [initial.timezone, ...supported];
  }, [initial.timezone]);

  function submit(destination: '/' | null) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await saveWorkspacePreferences({
          timezone,
          weekStartsOn,
          coachingIntensity,
          aiEnabled,
          weeklyReviewDay,
        });
        if (destination) {
          router.push(destination);
          router.refresh();
          return;
        }
        setNotice('Workspace preferences saved.');
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className={mode === 'onboarding' ? 'onboarding-form' : 'preferences-form'}>
      <section className="preference-section" aria-labelledby="calendar-preferences">
        <div className="preference-heading">
          <p className="eyebrow">Planning rhythm</p>
          <h2 id="calendar-preferences">Set your working week</h2>
        </div>
        <div className="preference-fields">
          <label>
            Timezone
            <select
              className="input-field"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Week starts on
            <select
              className="input-field"
              value={weekStartsOn}
              onChange={(event) => setWeekStartsOn(Number(event.target.value))}
            >
              {days.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            Weekly Review day
            <select
              className="input-field"
              value={weeklyReviewDay}
              onChange={(event) => setWeeklyReviewDay(Number(event.target.value))}
            >
              {days.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="preference-section" aria-labelledby="coaching-preferences">
        <div className="preference-heading">
          <p className="eyebrow">Assistant</p>
          <h2 id="coaching-preferences">Choose a coaching tone</h2>
        </div>
        <div className="coaching-options" role="radiogroup" aria-label="Coaching intensity">
          {(
            [
              ['calm', 'Calm', 'Gentle prompts and room to think.'],
              ['direct', 'Direct', 'Clear recommendations and candid tradeoffs.'],
              ['strict', 'Strict', 'Firm accountability and tighter follow-through.'],
            ] as const
          ).map(([value, label, detail]) => (
            <label
              className={
                coachingIntensity === value
                  ? 'coaching-option coaching-option-selected'
                  : 'coaching-option'
              }
              key={value}
            >
              <input
                type="radio"
                name="coachingIntensity"
                value={value}
                checked={coachingIntensity === value}
                onChange={() => setCoachingIntensity(value)}
              />
              <strong>{label}</strong>
              <span>{detail}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="preference-section ai-consent-section" aria-labelledby="ai-processing">
        <div className="ai-consent-copy">
          <span className="preference-icon" aria-hidden="true">
            <ShieldCheck size={19} />
          </span>
          <div>
            <h2 id="ai-processing">AI processing</h2>
            <p>
              Allow Planner AI to send relevant content to the configured AI provider when you ask
              for assistance. Turning this off blocks AI routes on the server.
            </p>
          </div>
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(event) => setAiEnabled(event.target.checked)}
          />
          <span aria-hidden="true" />
          <strong>{aiEnabled ? 'Enabled' : 'Disabled'}</strong>
        </label>
      </section>

      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="status-message">{notice}</p> : null}

      <div className="preference-actions">
        {mode === 'onboarding' ? (
          <button
            className="btn-secondary"
            type="button"
            disabled={isPending}
            onClick={() => submit('/')}
          >
            Keep defaults
          </button>
        ) : null}
        <button
          className="btn-primary button-with-icon"
          type="button"
          disabled={isPending}
          onClick={() => submit(mode === 'onboarding' ? '/' : null)}
        >
          {mode === 'onboarding' ? <ArrowRight size={16} /> : <Save size={16} />}
          {isPending ? 'Saving...' : mode === 'onboarding' ? 'Enter workspace' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}
