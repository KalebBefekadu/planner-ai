'use client';

import { useMemo, useState, useTransition } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AsyncStatus } from '@/components/async-status';
import {
  completeGuidedOnboarding,
  type OnboardingProfile,
  type WorkspacePreferences,
} from '@/app/onboarding/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const steps = ['About you', 'Your rhythm'];
const avatarColors = ['emerald', 'blue', 'violet', 'amber', 'rose'] as const;
type AvatarColor = (typeof avatarColors)[number];

function todayIn(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0] || 'Planner AI';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase();
}

export function OnboardingWizard({
  initial,
  profile,
}: {
  initial: WorkspacePreferences;
  profile: OnboardingProfile;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(profile.avatarColor);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(initial.weekStartsOn);
  const [weeklyReviewDay, setWeeklyReviewDay] = useState(initial.weeklyReviewDay);
  const [coachingIntensity, setCoachingIntensity] = useState(initial.coachingIntensity);
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [error, setError] = useState<string | null>(null);

  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return supported.includes(initial.timezone) ? supported : [initial.timezone, ...supported];
  }, [initial.timezone]);

  function finish() {
    setError(null);
    startTransition(async () => {
      try {
        await completeGuidedOnboarding({
          displayName: displayName.trim(),
          avatarColor,
          timezone,
          weekStartsOn,
          weeklyReviewDay,
          coachingIntensity,
          aiEnabled,
          today: todayIn(timezone),
          visionText: null,
          goalTitle: null,
          actionTitle: null,
          captureText: null,
        });
        router.push('/');
        router.refresh();
      } catch (caught) {
        setError(actionFailureMessage(caught, 'Workspace setup could not be completed.'));
      }
    });
  }

  return (
    <div className="onboarding-wizard">
      <ol className="onboarding-progress onboarding-progress-short" aria-label="Setup progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index ? 'step' : undefined}>
            <span>{index < step ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="onboarding-step onboarding-identity">
          <section className="preference-section" aria-labelledby="onboarding-identity">
            <div className="preference-heading">
              <p className="eyebrow">About you</p>
              <h2 id="onboarding-identity">Make this workspace yours</h2>
              <p>Planner AI uses your name to make prompts and planning feel personal.</p>
            </div>
            <div className="onboarding-profile-row">
              {profile.avatarUrl ? (
                // Provider images are already selected by the person in their identity account.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="onboarding-avatar" src={profile.avatarUrl} alt="Your profile" />
              ) : (
                <span
                  className={`onboarding-avatar onboarding-avatar-${avatarColor}`}
                  aria-hidden="true"
                >
                  {initials(displayName, profile.email)}
                </span>
              )}
              <label className="onboarding-name-field">
                What should we call you?
                <input
                  className="input-field"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Your name"
                  required
                />
              </label>
            </div>
            {!profile.avatarUrl ? (
              <fieldset className="avatar-color-picker">
                <legend>Choose an avatar color</legend>
                <div>
                  {avatarColors.map((color) => (
                    <label key={color} className={`avatar-color avatar-color-${color}`}>
                      <input
                        type="radio"
                        name="avatarColor"
                        value={color}
                        checked={avatarColor === color}
                        onChange={() => setAvatarColor(color)}
                      />
                      <span className="visually-hidden">{color}</span>
                    </label>
                  ))}
                </div>
                <p>A connected identity-provider photo is used automatically when available.</p>
              </fieldset>
            ) : null}
          </section>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="onboarding-step">
          <section className="preference-section" aria-labelledby="onboarding-rhythm">
            <div className="preference-heading">
              <p className="eyebrow">Planning rhythm</p>
              <h2 id="onboarding-rhythm">Set your working week</h2>
              <p>These defaults organize Today, This Week, and your reviews.</p>
            </div>
            <div className="preference-fields">
              <label>
                Time zone
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
                Weekly Review
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

          <section className="preference-section" aria-labelledby="onboarding-coaching">
            <div className="preference-heading">
              <p className="eyebrow">Assistant</p>
              <h2 id="onboarding-coaching">Choose a coaching tone</h2>
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

          <section className="preference-section ai-consent-section" aria-labelledby="setup-ai">
            <div className="ai-consent-copy">
              <span className="preference-icon" aria-hidden="true">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2 id="setup-ai">AI processing</h2>
                <p>Relevant content is sent to the configured provider only when AI is used.</p>
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
        </div>
      ) : null}

      <AsyncStatus message={isPending ? 'Finishing your workspace setup.' : ''} />
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="onboarding-actions">
        <div>
          {step > 0 ? (
            <button
              className="btn-secondary button-with-icon"
              type="button"
              onClick={() => setStep(0)}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          ) : null}
        </div>
        <div>
          {step === 0 ? (
            <button
              className="btn-primary button-with-icon"
              type="button"
              disabled={!displayName.trim()}
              onClick={() => setStep(1)}
            >
              Continue <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button className="btn-primary" type="button" disabled={isPending} onClick={finish}>
              {isPending ? 'Finishing setup...' : 'Enter Planner AI'}
            </button>
          )}
        </div>
      </div>
      <p className="onboarding-change-note">You can change these preferences later in Settings.</p>
    </div>
  );
}
