'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarCheck2,
  Check,
  Inbox,
  Pencil,
  Plus,
  Save,
  Target,
  X,
} from 'lucide-react';
import {
  completeTodayAction,
  createTodayAction,
  editTodayAction,
  saveDailyFocus,
  type CreateTodayActionResult,
  type TodayAction,
  type TodayData,
} from '@/app/today/actions';
import { CoachingCue } from '@/components/coaching-cue';
import { todayCoachingCue } from '@/lib/coaching';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { TODAY_FOCUS_CAPACITY } from '@/lib/today-composer';

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Today could not be updated.');
}

function dateLabel(value: string | null, today: string) {
  if (!value) return 'Unscheduled';
  if (value === today) return 'Today';
  if (value < today) return 'Overdue';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T12:00:00Z`)
  );
}

// The composer keeps one key per attempt so a double submission or a retry
// after a failed commitment resolves to the Action that was already created.
function newRequestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `today-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function focusOutcomeMessage(result: CreateTodayActionResult) {
  const title = result.action.title;
  switch (result.focusOutcome) {
    case 'committed':
    case 'already-committed':
      return `"${title}" is saved and committed to today.`;
    case 'other-day':
      return `"${title}" is saved for ${result.action.scheduledOn}. Focus only holds today's Actions.`;
    case 'full':
      return `"${title}" is saved. Today's focus is already full at ${TODAY_FOCUS_CAPACITY}, so nothing was replaced.`;
    case 'failed':
      return `"${title}" is saved, but committing it to today did not go through. ${result.focusFailureMessage ?? ''} Use its focus button to try again.`.trim();
    default:
      return `"${title}" is saved to your open Actions.`;
  }
}

export function TodayWorkspace({ data }: { data: TodayData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [focusIds, setFocusIds] = useState(data.focusActionIds);
  const [actions, setActions] = useState(data.actions);
  const [editing, setEditing] = useState<TodayAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGoalId, setDraftGoalId] = useState('');
  const [draftDate, setDraftDate] = useState(data.localDate);
  const [draftFocus, setDraftFocus] = useState(true);
  const requestKey = useRef<string | null>(null);
  const focus = focusIds
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is TodayAction => Boolean(action));
  const candidates = actions.filter((action) => !focusIds.includes(action.id));
  const overdueCount = actions.filter(
    (action) => action.scheduledOn && action.scheduledOn < data.localDate
  ).length;
  const dueTodayCount = actions.filter((action) => action.scheduledOn === data.localDate).length;
  const blockedCount = actions.filter((action) => action.status === 'blocked').length;
  const directionGoal =
    focus.find((action) => action.goalTitle)?.goalTitle ??
    actions.find((action) => action.goalTitle)?.goalTitle ??
    null;
  const readableDate = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${data.localDate}T12:00:00Z`)),
    [data.localDate]
  );

  function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    setNotice(null);
    // Reuse the key of a failed attempt so a retry cannot create a second
    // Action for the same submission.
    if (!requestKey.current) requestKey.current = newRequestKey();
    const key = requestKey.current;
    const title = draftTitle;
    const goalId = draftGoalId || null;
    const scheduledOn = draftDate;
    const focus = draftFocus;
    startTransition(async () => {
      try {
        const result = await createTodayAction({
          title,
          goalId,
          scheduledOn,
          focus,
          requestKey: key,
        });
        setActions((current) =>
          current.some((item) => item.id === result.action.id)
            ? current.map((item) => (item.id === result.action.id ? result.action : item))
            : [result.action, ...current]
        );
        setFocusIds(result.focusActionIds);
        setNotice(focusOutcomeMessage(result));
        // Only a saved Action clears the draft; a rejected one keeps every
        // word the person typed.
        requestKey.current = null;
        setDraftTitle('');
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function changeFocus(nextIds: string[]) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await saveDailyFocus(data.localDate, nextIds);
        setFocusIds(result.actionIds);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function complete(action: TodayAction) {
    setError(null);
    startTransition(async () => {
      try {
        await completeTodayAction(action.id, action.version);
        setActions((current) => current.filter((item) => item.id !== action.id));
        setFocusIds((current) => current.filter((id) => id !== action.id));
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function saveEdit(formData: FormData) {
    if (!editing) return;
    setError(null);
    const title = String(formData.get('title') ?? '');
    const description = String(formData.get('description') ?? '');
    const scheduledOn = String(formData.get('scheduledOn') ?? '');
    startTransition(async () => {
      try {
        const result = await editTodayAction({
          id: editing.id,
          expectedVersion: editing.version,
          title,
          descriptionMarkdown: description || null,
          scheduledOn: scheduledOn || null,
        });
        setActions((current) =>
          current.map((action) =>
            action.id === editing.id
              ? {
                  ...action,
                  title: result.title,
                  descriptionMarkdown: result.description_markdown ?? null,
                  scheduledOn: result.scheduled_on ?? null,
                  version: result.version,
                }
              : action
          )
        );
        setEditing(null);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function actionRow(action: TodayAction, focused: boolean) {
    const label = dateLabel(action.scheduledOn, data.localDate);
    return (
      <article className="today-action-row" key={action.id}>
        <button
          className="action-complete-button"
          type="button"
          onClick={() => complete(action)}
          disabled={isPending}
          aria-label={`Complete ${action.title}`}
          title="Complete Action"
        >
          <Check size={16} />
        </button>
        <div className="today-action-copy">
          <strong>{action.title}</strong>
          <div>
            {action.goalTitle ? <span>{action.goalTitle}</span> : null}
            <span className={label === 'Overdue' ? 'date-overdue' : undefined}>{label}</span>
            {action.status === 'blocked' ? <span>Blocked</span> : null}
          </div>
        </div>
        <div className="today-action-tools">
          <button
            className="icon-button"
            type="button"
            onClick={() => setEditing(action)}
            disabled={isPending}
            aria-label={`Edit ${action.title}`}
            title="Edit Action"
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() =>
              changeFocus(
                focused
                  ? focusIds.filter((id) => id !== action.id)
                  : [...focusIds, action.id].slice(0, TODAY_FOCUS_CAPACITY)
              )
            }
            disabled={isPending || (!focused && focusIds.length >= TODAY_FOCUS_CAPACITY)}
            aria-label={focused ? `Remove ${action.title} from focus` : `Focus ${action.title}`}
            title={focused ? 'Remove from focus' : 'Add to focus'}
          >
            {focused ? <X size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="page canonical-today-page">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{readableDate}</p>
          <h1>Make today count</h1>
          <p className="lede">
            {focus.length
              ? `${focus.length} committed ${focus.length === 1 ? 'outcome' : 'outcomes'}. Enough space to do them well.`
              : 'Choose a few outcomes. Leave enough space to do them well.'}
          </p>
        </div>
        <Link className="btn-primary button-with-icon" href="/planner/inbox">
          <Plus size={16} aria-hidden="true" />
          Capture an action
        </Link>
      </header>

      <nav className="planner-today-tabs" aria-label="Planning views">
        <Link href="/planner/today" aria-current="page">
          Today
        </Link>
        <Link href="/planner">This week</Link>
        <Link href="/planner/calendar">
          <CalendarDays size={15} aria-hidden="true" /> Calendar
        </Link>
        <Link href="/goals">Goals</Link>
        <Link href="/vision">Vision</Link>
      </nav>

      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="today-composer" aria-labelledby="today-composer-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Add</p>
            <h2 id="today-composer-heading">New Action</h2>
          </div>
        </div>
        <form className="today-composer-form" onSubmit={submitDraft}>
          <label className="today-composer-title">
            What needs doing
            <input
              className="input-field"
              name="title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Draft the quarterly summary"
              minLength={3}
              maxLength={1000}
              required
            />
          </label>
          <label>
            Goal
            <select
              className="input-field"
              name="goalId"
              value={draftGoalId}
              onChange={(event) => setDraftGoalId(event.target.value)}
            >
              <option value="">No goal yet</option>
              {data.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scheduled date
            <input
              className="input-field"
              type="date"
              name="scheduledOn"
              value={draftDate}
              onChange={(event) => setDraftDate(event.target.value)}
              required
            />
          </label>
          <label className="today-composer-focus">
            <input
              type="checkbox"
              name="focus"
              checked={draftFocus}
              onChange={(event) => setDraftFocus(event.target.checked)}
            />
            Commit to today&apos;s focus
          </label>
          <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
            <Plus size={16} aria-hidden="true" />
            {isPending ? 'Saving...' : 'Add Action'}
          </button>
        </form>
        <p className="status-message" role="status">
          {notice ?? ''}
        </p>
      </section>

      <CoachingCue
        cue={todayCoachingCue(data.coachingIntensity, {
          focusCount: focus.length,
          overdueCount,
          blockedCount,
        })}
      />

      <section className="today-metrics" aria-label="Today summary">
        <div className="metric-block">
          <Target size={18} aria-hidden="true" />
          <div>
            <strong>{focus.length}</strong>
            <span>Focused</span>
          </div>
        </div>
        <div className="metric-block">
          <CalendarCheck2 size={18} aria-hidden="true" />
          <div>
            <strong>{dueTodayCount}</strong>
            <span>Due today</span>
          </div>
        </div>
        <div className="metric-block">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{overdueCount}</strong>
            <span>Overdue</span>
          </div>
        </div>
      </section>

      <div className="today-execution-grid">
        <section className="today-section" aria-labelledby="today-committed-actions">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Focus</p>
              <h2 id="today-committed-actions">Committed Actions</h2>
            </div>
            <span className="focus-capacity">
              {focus.length} / {TODAY_FOCUS_CAPACITY}
            </span>
          </div>
          <div className="today-action-list">
            {focus.map((action) => actionRow(action, true))}
            {!focus.length ? (
              <div className="inline-empty">
                <p>No Actions are committed yet.</p>
                <span>Choose from the available list.</span>
              </div>
            ) : null}
          </div>
        </section>

        <section
          className="today-section available-actions-section"
          aria-labelledby="today-open-actions"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Available</p>
              <h2 id="today-open-actions">Open Actions</h2>
            </div>
            <Link href="/planner" aria-label="Open plan" title="Open Plan">
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="today-action-list today-action-scroll">
            {candidates.map((action) => actionRow(action, false))}
            {!candidates.length ? (
              <div className="inline-empty">
                <p>No more open Actions.</p>
                <Link href="/planner">Open Plan</Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="direction-band today-direction-band" aria-labelledby="today-direction">
        <div>
          <p className="eyebrow">Direction</p>
          <h2 id="today-direction">{directionGoal ?? 'Connect today to a meaningful goal'}</h2>
        </div>
        <p>
          {directionGoal
            ? 'Your focused work advances this goal. Review the larger plan before adding more.'
            : 'Link an Action to a Goal so today has a visible line back to what matters.'}
        </p>
        <Link className="btn-secondary" href="/goals">
          {directionGoal ? 'Open goal' : 'Choose direction'}
        </Link>
      </section>

      {/* A section with no accessible name is not exposed as a landmark, so
          this block was unreachable by landmark navigation while every other
          region on the page was named. */}
      <section
        className="today-section today-capture-strip"
        aria-labelledby="today-recent-captures"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Inbox</p>
            <h2 id="today-recent-captures">Recent captures</h2>
          </div>
          <Link href="/planner/inbox" aria-label="Open Inbox" title="Open Inbox">
            <Inbox size={18} />
          </Link>
        </div>
        <div className="capture-preview-list">
          {data.recentCaptures.map((capture) => (
            <article className="capture-preview" key={capture.id}>
              <p>{capture.rawText}</p>
              <time dateTime={capture.createdAt}>
                {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
                  new Date(capture.createdAt)
                )}
              </time>
            </article>
          ))}
          {!data.recentCaptures.length ? (
            <div className="inline-empty">
              <p>Your unstructured thoughts will land here.</p>
              <Link href="/planner/inbox">Make a capture</Link>
            </div>
          ) : null}
        </div>
      </section>

      {editing ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setEditing(null)}>
          <section
            className="action-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-action-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">Action</p>
                <h2 id="edit-action-title">Edit Action</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close editor"
                title="Close"
              >
                <X size={17} />
              </button>
            </header>
            <form action={saveEdit}>
              <label>
                Title
                <input
                  className="input-field"
                  name="title"
                  defaultValue={editing.title}
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </label>
              <label>
                Scheduled date
                <input
                  className="input-field"
                  type="date"
                  name="scheduledOn"
                  defaultValue={editing.scheduledOn ?? ''}
                />
              </label>
              <label>
                Details
                <textarea
                  className="input-field"
                  name="description"
                  defaultValue={editing.descriptionMarkdown ?? ''}
                  maxLength={50_000}
                  rows={6}
                />
              </label>
              <div className="dialog-actions">
                <button className="btn-secondary" type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
                  <Save size={16} />
                  {isPending ? 'Saving...' : 'Save Action'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
