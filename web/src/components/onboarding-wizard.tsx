'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
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
import {
  draftHasWrittenWork,
  draftStorageKey,
  parseDraft,
  type OnboardingDraft,
} from '@/app/onboarding/draft';

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

/* Reading `localStorage` is reading an external store, and the server has no
   such store. `useSyncExternalStore` is the one hook that models that honestly:
   it renders the server's answer (no draft) during SSR and hydration, then
   re-renders with the browser's answer once hydration finishes. Restoring in an
   effect instead would set state during a cascading second render, and would
   race the first keystroke of anyone who started typing immediately.

   A draft is read once and never watched. `subscribe` is therefore a no-op:
   this wizard is the only writer, and re-reading on its own writes would fight
   the fields the person is typing into. */
function subscribe() {
  return () => {};
}

function readStoredDraft(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    // Private browsing and locked-down profiles throw on access rather than
    // returning null. Treat that as "no draft" and start cleanly.
    return null;
  }
}

export function OnboardingWizard({
  initial,
  ownerId,
}: {
  initial: WorkspacePreferences;
  ownerId: string;
}) {
  const storageKey = draftStorageKey(ownerId);
  const fallback: OnboardingDraft = {
    step: 0,
    timezone: initial.timezone,
    weekStartsOn: initial.weekStartsOn,
    weeklyReviewDay: initial.weeklyReviewDay,
    coachingIntensity: initial.coachingIntensity,
    aiEnabled: initial.aiEnabled,
    visionText: '',
    goalTitle: '',
    actionTitle: '',
    captureText: '',
  };
  /* Three states, not two. `undefined` means "the browser has not answered
     yet", which is what the server renders and what hydration replays; `null`
     means the browser answered and there is no draft. Collapsing those two into
     one was a real data-loss bug: the pre-hydration render would persist its
     own empty fields over the draft the person came back for, so resuming
     destroyed exactly the work it was meant to protect. */
  const storedRaw = useSyncExternalStore(
    subscribe,
    () => readStoredDraft(storageKey),
    () => undefined
  );

  /* The fields below are seeded from whichever draft this render knows about,
     so the form is remounted once the browser's answer replaces the server's.
     Keying on the presence of a draft -- not on its contents -- means the
     remount happens at most once, and never while someone is typing. A person
     who starts typing before hydration is on the `fresh` key either way, so
     their keystrokes are not thrown away by that transition. */
  return (
    <WizardForm
      key={storedRaw ? 'resumed' : 'fresh'}
      initial={initial}
      storageKey={storageKey}
      persist={storedRaw !== undefined}
      restored={parseDraft(storedRaw ?? null, fallback)}
    />
  );
}

function WizardForm({
  initial,
  storageKey,
  persist,
  restored,
}: {
  initial: WorkspacePreferences;
  storageKey: string;
  persist: boolean;
  restored: OnboardingDraft;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(restored.step);
  const [timezone, setTimezone] = useState(restored.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(restored.weekStartsOn);
  const [weeklyReviewDay, setWeeklyReviewDay] = useState(restored.weeklyReviewDay);
  const [coachingIntensity, setCoachingIntensity] = useState(restored.coachingIntensity);
  const [aiEnabled, setAiEnabled] = useState(restored.aiEnabled);
  const [visionText, setVisionText] = useState(restored.visionText);
  const [goalTitle, setGoalTitle] = useState(restored.goalTitle);
  const [actionTitle, setActionTitle] = useState(restored.actionTitle);
  const [captureText, setCaptureText] = useState(restored.captureText);
  const [error, setError] = useState<string | null>(null);
  // Announced once per resumed session, from the draft this form was seeded
  // with, so it does not reappear after the person edits the restored text.
  const resumed = draftHasWrittenWork(restored);

  const draft: OnboardingDraft = {
    step,
    timezone,
    weekStartsOn,
    weeklyReviewDay,
    coachingIntensity,
    aiEnabled,
    visionText,
    goalTitle,
    actionTitle,
    captureText,
  };

  function clearDraft() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // A browser with storage denied still completes setup; it just cannot resume.
    }
  }

  const serialized = JSON.stringify(draft);
  useEffect(() => {
    // Never write before the stored draft has been read back, or this effect
    // overwrites it with the empty fields of the pre-hydration render.
    if (!persist) return;
    try {
      window.localStorage.setItem(storageKey, serialized);
    } catch {
      // Storage can be full or denied. Losing the ability to resume is not a
      // reason to interrupt someone in the middle of setup.
    }
  }, [persist, storageKey, serialized]);

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
        // The draft has been committed through the Operation, so the scratch
        // copy must go: otherwise a later visit to /onboarding, or the next
        // person to use this device, would meet stale half-finished text.
        clearDraft();
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

      {resumed ? (
        <p className="status-message onboarding-resumed" role="status">
          We kept what you had already written. Pick up where you left off.
        </p>
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
