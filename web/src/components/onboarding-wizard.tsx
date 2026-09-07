'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileInput,
  ListTodo,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AsyncStatus } from '@/components/async-status';
import { completeGuidedOnboarding, type WorkspacePreferences } from '@/app/onboarding/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const steps = ['Rhythm', 'Direction', 'First moves'];

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

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

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Workspace setup could not be completed.');
}

export function OnboardingWizard({ initial }: { initial: WorkspacePreferences }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(initial.weekStartsOn);
  const [weeklyReviewDay, setWeeklyReviewDay] = useState(initial.weeklyReviewDay);
  const [coachingIntensity, setCoachingIntensity] = useState(initial.coachingIntensity);
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [visionText, setVisionText] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [captureText, setCaptureText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return supported.includes(initial.timezone) ? supported : [initial.timezone, ...supported];
  }, [initial.timezone]);

  function finish(destination: '/' | '/notes?import=1') {
    setError(null);
    startTransition(async () => {
      try {
        await completeGuidedOnboarding({
          timezone,
          weekStartsOn,
          weeklyReviewDay,
          coachingIntensity,
          aiEnabled,
          today: todayIn(timezone),
          visionText: optional(visionText),
          goalTitle: optional(visionText) ? optional(goalTitle) : null,
          actionTitle: optional(actionTitle),
          captureText: captureText.trim() ? captureText : null,
        });
        router.push(destination);
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="onboarding-wizard">
      <ol className="onboarding-progress" aria-label="Setup progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index ? 'step' : undefined}>
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="onboarding-step">
          <section className="preference-section" aria-labelledby="onboarding-rhythm">
            <div className="preference-heading">
              <p className="eyebrow">Planning rhythm</p>
              <h2 id="onboarding-rhythm">Set your working week</h2>
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
                <p>
                  Planner AI supports adult planning. It is not medical, legal, financial, or crisis
                  care.
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
        </div>
      ) : null}

      {step === 1 ? (
        <div className="onboarding-step onboarding-direction">
          <label>
            <span>
              <Sparkles size={16} /> Vision
            </span>
            <textarea
              value={visionText}
              onChange={(event) => {
                setVisionText(event.target.value);
                if (!event.target.value.trim()) setGoalTitle('');
              }}
              rows={7}
              maxLength={50_000}
              placeholder="What kind of life or work are you building?"
            />
          </label>
          <label>
            <span>
              <Target size={16} /> First yearly Goal
            </span>
            <input
              value={goalTitle}
              onChange={(event) => setGoalTitle(event.target.value)}
              maxLength={1_000}
              placeholder={visionText.trim() ? 'A measurable outcome' : 'Add a Vision first'}
              disabled={!visionText.trim()}
            />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="onboarding-step onboarding-first-moves">
          <label>
            <span>
              <ListTodo size={16} /> First Action
            </span>
            <input
              value={actionTitle}
              onChange={(event) => setActionTitle(event.target.value)}
              maxLength={1_000}
              placeholder="One concrete next move"
            />
          </label>
          <label>
            <span>
              <FileInput size={16} /> First Capture
            </span>
            <textarea
              value={captureText}
              onChange={(event) => setCaptureText(event.target.value)}
              rows={6}
              maxLength={60_000}
              placeholder="Anything you do not want to lose"
            />
          </label>
        </div>
      ) : null}

      <AsyncStatus message={isPending ? 'Creating your workspace. This takes a moment.' : ''} />

      {step === steps.length - 1 && (visionText.trim() || goalTitle.trim()) ? (
        <ol className="onboarding-recap" aria-label="What you have written so far">
          {visionText.trim() ? (
            <li>
              <span>Vision</span>
              <p>{visionText.trim()}</p>
            </li>
          ) : null}
          {goalTitle.trim() ? (
            <li>
              <span>Goal</span>
              <p>{goalTitle.trim()}</p>
            </li>
          ) : null}
        </ol>
      ) : null}

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
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
          ) : (
            <button
              className="btn-secondary"
              type="button"
              disabled={isPending}
              onClick={() => finish('/')}
            >
              Skip setup
            </button>
          )}
        </div>
        <div>
          {step < steps.length - 1 ? (
            <button
              className="btn-primary button-with-icon"
              type="button"
              onClick={() => setStep(step + 1)}
            >
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <>
              <button
                className="btn-secondary button-with-icon"
                type="button"
                disabled={isPending}
                onClick={() => finish('/notes?import=1')}
              >
                <FileInput size={16} /> Import Notes
              </button>
              <button
                className="btn-primary"
                type="button"
                disabled={isPending}
                onClick={() => finish('/')}
              >
                {isPending ? 'Creating workspace...' : 'Enter workspace'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
