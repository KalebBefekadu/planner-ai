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
  CircleSlash,
  CornerUpRight,
  FileText,
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
  deferTodayAction,
  editTodayAction,
  saveDailyFocus,
  setTodayActionStatus,
  type CreateTodayActionResult,
  type TodayAction,
  type TodayData,
} from '@/app/today/actions';
import { CoachingCue } from '@/components/coaching-cue';
import { todayCoachingCue } from '@/lib/coaching';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { addCalendarDays } from '@/lib/planner-calendar';
import { TODAY_FOCUS_CAPACITY } from '@/lib/today-composer';

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Today could not be updated.');
}

function dateLabel(value: string | null, today: string) {
  if (!value) return 'Unscheduled';
  if (value === today) return 'Today';
  if (value < today) return 'Overdue';
  return shortDate(value);
}

/* A deadline reads as a deadline, not as another date beside the work date.
   "Due" is said out loud so the row cannot be misread as a reschedule, and a
   deadline already past is named late rather than shown as a bare date. */
function deadlineLabel(value: string | null, today: string) {
  if (!value) return null;
  if (value < today) return 'Was due ' + shortDate(value);
  if (value === today) return 'Due today';
  return 'Due ' + shortDate(value);
}

function shortDate(value: string) {
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
  // The dialog fields are controlled rather than defaulted. A form action
  // resets an uncontrolled form once it settles, which threw away the edit
  // whenever the save was rejected -- the one moment the words typed matter
  // most.
  const [editDraft, setEditDraft] = useState({
    title: '',
    scheduledOn: '',
    dueOn: '',
    description: '',
  });
  /* A deadline is the uncommon case, so the control is not on the form until
     it is wanted. Work that already has one shows it straight away -- hiding
     a date someone set would be worse than the extra control. */
  const [showDeadline, setShowDeadline] = useState(false);
  /* A suggestion is not a plan until someone says so. It lives here until it
     is committed or dismissed, and is never written on arrival. */
  const [suggestion, setSuggestion] = useState<{
    picks: Array<{ id: string; title: string; reason: string }>;
    candidates: number;
  } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A conflict raised while a person is inside the edit dialog has to be
  // readable from inside the dialog. Reported at the top of the page it sits
  // behind the backdrop, and the save looks as though it simply did nothing.
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGoalId, setDraftGoalId] = useState('');
  const [draftAreaId, setDraftAreaId] = useState('');
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
    const areaId = draftAreaId || null;
    const scheduledOn = draftDate;
    const focus = draftFocus;
    startTransition(async () => {
      try {
        const result = await createTodayAction({
          title,
          goalId,
          areaId,
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

  function openEditor(action: TodayAction) {
    setEditing(action);
    setEditError(null);
    setEditDraft({
      title: action.title,
      scheduledOn: action.scheduledOn ?? '',
      dueOn: action.dueOn ?? '',
      description: action.descriptionMarkdown ?? '',
    });
    setShowDeadline(Boolean(action.dueOn));
  }

  function closeEditor() {
    setEditing(null);
    setEditError(null);
  }

  function saveEdit() {
    if (!editing) return;
    setError(null);
    setEditError(null);
    const { title, description, scheduledOn, dueOn } = editDraft;
    startTransition(async () => {
      try {
        const result = await editTodayAction({
          id: editing.id,
          expectedVersion: editing.version,
          title,
          descriptionMarkdown: description || null,
          scheduledOn: scheduledOn || null,
          dueOn: dueOn || null,
        });
        setActions((current) =>
          current.map((action) =>
            action.id === editing.id
              ? {
                  ...action,
                  title: result.title,
                  descriptionMarkdown: result.description_markdown ?? null,
                  scheduledOn: result.scheduled_on ?? null,
                  dueOn: result.due_on ?? null,
                  version: result.version,
                }
              : action
          )
        );
        setEditing(null);
      } catch (caught) {
        // The dialog stays open with every edited field intact, so the retry
        // is one more click rather than retyping the change.
        setEditError(errorMessage(caught));
      }
    });
  }

  // Deferring is a decision about the day, not just a date field. Moving work
  // off today also releases today's commitment to it, and the person is told
  // that happened rather than discovering an emptier focus list.
  function defer(action: TodayAction, toDate: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await deferTodayAction({
          id: action.id,
          expectedVersion: action.version,
          title: action.title,
          descriptionMarkdown: action.descriptionMarkdown,
          scheduledOn: toDate,
        });
        setActions((current) =>
          current.map((item) =>
            item.id === action.id
              ? { ...item, scheduledOn: result.scheduledOn, version: result.version }
              : item
          )
        );
        setFocusIds(result.focusActionIds);
        setNotice(
          result.releasedFromFocus
            ? `"${action.title}" moved to ${result.scheduledOn} and is no longer committed to today.`
            : `"${action.title}" moved to ${result.scheduledOn}.`
        );
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function toggleBlocked(action: TodayAction) {
    setError(null);
    setNotice(null);
    const next = action.status === 'blocked' ? 'open' : 'blocked';
    startTransition(async () => {
      try {
        const result = await setTodayActionStatus(action.id, action.version, next);
        setActions((current) =>
          current.map((item) =>
            item.id === action.id ? { ...item, status: next, version: result.version } : item
          )
        );
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function actionRow(action: TodayAction, focused: boolean) {
    const label = dateLabel(action.scheduledOn, data.localDate);
    const deadline = deadlineLabel(action.dueOn, data.localDate);
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
            {deadline ? (
              <span
                className={
                  action.dueOn && action.dueOn < data.localDate ? 'date-overdue' : undefined
                }
              >
                {deadline}
              </span>
            ) : null}
            {action.status === 'blocked' ? <span>Blocked</span> : null}
          </div>
        </div>
        <div className="today-action-tools">
          <button
            className="icon-button"
            type="button"
            onClick={() => openEditor(action)}
            disabled={isPending}
            aria-label={`Edit ${action.title}`}
            title="Edit Action"
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => defer(action, addCalendarDays(data.localDate, 1))}
            disabled={isPending}
            aria-label={`Defer ${action.title} to tomorrow`}
            title="Defer to tomorrow"
          >
            <CornerUpRight size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => toggleBlocked(action)}
            disabled={isPending}
            aria-label={
              action.status === 'blocked'
                ? `Unblock ${action.title}`
                : `Mark ${action.title} blocked`
            }
            title={action.status === 'blocked' ? 'Unblock' : 'Mark blocked'}
            aria-pressed={action.status === 'blocked'}
          >
            <CircleSlash size={15} />
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

  const todayMetrics = [
    { label: 'Focused', count: focus.length, Icon: Target },
    { label: 'Due today', count: dueTodayCount, Icon: CalendarCheck2 },
    { label: 'Overdue', count: overdueCount, Icon: AlertTriangle },
  ].filter((metric) => metric.count > 0);

  return (
    <div className="page canonical-today-page">
      {/* The date, then the name of the day. "Make today count" was the same
          sentence every morning, and the entry for the thing you came here to
          write was four fields below it. */}
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{readableDate}</p>
          <h1>Today</h1>
        </div>
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

      {/* Title first. "Sort the hallway cupboard" is a whole task, and it
          should take one line and one key. A date, a goal, an area and
          whether it is one of today's few commitments are all real, and all
          optional -- so they are behind a disclosure that remembers nothing
          and asks for nothing. */}
      <section className="today-composer" aria-label="Add a task">
        <form className="today-composer-form" onSubmit={submitDraft}>
          <div className="today-composer-line">
            <label className="visually-hidden" htmlFor="today-task-title">
              What needs doing
            </label>
            <input
              id="today-task-title"
              className="input-field"
              name="title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="What needs doing?"
              minLength={3}
              maxLength={1000}
              required
            />
            <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
              <Plus size={16} aria-hidden="true" />
              {isPending ? 'Saving...' : 'Add task'}
            </button>
          </div>
          <details className="today-composer-details">
            <summary>Details</summary>
            <div className="today-composer-fields">
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
                Life area
                <select
                  className="input-field"
                  name="areaId"
                  value={draftAreaId}
                  onChange={(event) => setDraftAreaId(event.target.value)}
                >
                  <option value="">No area</option>
                  {data.areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.path}
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
            </div>
          </details>
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

      {/* Three counters reading zero told a new account only that it was new.
          Each appears when it has something to report. */}
      {todayMetrics.length ? (
        <section className="today-metrics" aria-label="Today summary">
          {todayMetrics.map((metric) => (
            <div className="metric-block" key={metric.label}>
              <metric.Icon size={18} aria-hidden="true" />
              <div>
                <strong>{metric.count}</strong>
                <span>{metric.label}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {data.aiEnabled ? (
        <section className="today-section" aria-labelledby="today-suggestion">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Optional</p>
              <h2 id="today-suggestion">Help me choose today</h2>
            </div>
          </div>
          {suggestion === null ? (
            <div className="inline-empty">
              <p>A short list drawn from work you have already planned.</p>
              <button
                className="btn-secondary"
                type="button"
                disabled={suggesting || isPending}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setSuggesting(true);
                  void (async () => {
                    try {
                      const response = await fetch('/api/choose-today', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({}),
                      });
                      const body = (await response.json().catch(() => null)) as {
                        data?: {
                          picks?: Array<{ id: string; title: string; reason: string }>;
                          candidates?: number;
                        };
                        detail?: string;
                      } | null;
                      if (!response.ok) {
                        throw new Error(body?.detail ?? 'No suggestion could be produced.');
                      }
                      setSuggestion({
                        picks: body?.data?.picks ?? [],
                        candidates: body?.data?.candidates ?? 0,
                      });
                    } catch (caught) {
                      // The manual list is untouched and still usable.
                      setError(caught instanceof Error ? caught.message : errorMessage(caught));
                    } finally {
                      setSuggesting(false);
                    }
                  })();
                }}
              >
                {suggesting ? 'Thinking...' : 'Suggest a short list'}
              </button>
            </div>
          ) : suggestion.picks.length === 0 ? (
            <div className="inline-empty">
              <p>
                {suggestion.candidates === 0
                  ? 'There is no planned work to choose from yet.'
                  : 'No confident suggestion from what is planned. Choose for yourself below.'}
              </p>
              <button className="btn-secondary" type="button" onClick={() => setSuggestion(null)}>
                Dismiss
              </button>
            </div>
          ) : (
            <div className="today-action-list">
              <ul className="area-list">
                {suggestion.picks.map((pick) => (
                  <li key={pick.id}>
                    <span className="area-list-title">{pick.title}</span>
                    <span className="area-list-meta">{pick.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="dialog-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setSuggestion(null)}
                  disabled={isPending}
                >
                  Dismiss
                </button>
                {/* The write is the same Operation a manual choice uses, from
                    an explicit press. Nothing was committed on arrival. */}
                <button
                  className="btn-primary"
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    const ids = suggestion.picks.map((pick) => pick.id);
                    setError(null);
                    startTransition(async () => {
                      try {
                        await saveDailyFocus(data.localDate, ids);
                        setFocusIds(ids);
                        setSuggestion(null);
                        setNotice(`${ids.length} committed to today. You can change any of them.`);
                        router.refresh();
                      } catch (caught) {
                        setError(errorMessage(caught));
                      }
                    });
                  }}
                >
                  Commit these to today
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

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

      {/* Only when there is a direction to name. "Connect today to a
          meaningful goal" on an empty account is a banner asking the person to
          go and do setup before the screen will be useful to them, which is
          the opposite of what this screen is for. */}
      {directionGoal ? (
        <section className="direction-band today-direction-band" aria-labelledby="today-direction">
          <div>
            <p className="eyebrow">Direction</p>
            <h2 id="today-direction">{directionGoal}</h2>
          </div>
          <p>Your focused work advances this goal. Review the larger plan before adding more.</p>
          <Link className="btn-secondary" href="/goals">
            Open goal
          </Link>
        </section>
      ) : null}

      {/* A section with no accessible name is not exposed as a landmark, so
          this block was unreachable by landmark navigation while every other
          region on the page was named. */}
      {/* Picking work back up is how a day usually starts, and the reference
          puts that on this screen. It is a shortcut into Notes, not a second
          tree: four rows, newest first. */}
      <section className="today-section today-recent-work" aria-labelledby="today-recent-work">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Continue</p>
            <h2 id="today-recent-work">Recent work</h2>
          </div>
          <Link href="/notes">View all</Link>
        </div>
        {data.recentNotes.length ? (
          <div className="recent-work-list">
            {data.recentNotes.map((note) => (
              <Link className="recent-work-item" href={`/notes?note=${note.id}`} key={note.id}>
                <FileText size={16} aria-hidden="true" />
                <span>
                  <strong>{note.title}</strong>
                  <small>
                    Edited{' '}
                    <time dateTime={note.updatedAt}>
                      {new Intl.DateTimeFormat('en-US', {
                        month: 'short',
                        day: 'numeric',
                      }).format(new Date(note.updatedAt))}
                    </time>
                  </small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="inline-empty">
            <p>Pages you write will be waiting here.</p>
            <Link href="/notes">Start a page</Link>
          </div>
        )}
      </section>

      {/* Secondary. A strip promising that thoughts will land here is not
          worth the space on a screen whose job is the next few hours. */}
      {data.recentCaptures.length ? (
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
          </div>
        </section>
      ) : null}

      {editing ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeEditor}>
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
                onClick={closeEditor}
                aria-label="Close editor"
                title="Close"
              >
                <X size={17} />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveEdit();
              }}
            >
              {editError ? (
                <p className="status-message status-message-error" role="alert">
                  {editError}
                </p>
              ) : null}
              <label>
                Title
                <input
                  className="input-field"
                  name="title"
                  value={editDraft.title}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, title: event.target.value }))
                  }
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
                  value={editDraft.scheduledOn}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, scheduledOn: event.target.value }))
                  }
                />
                <span className="field-note">The day you plan to work on this.</span>
              </label>
              {showDeadline ? (
                <label>
                  Deadline
                  <input
                    className="input-field"
                    type="date"
                    name="dueOn"
                    value={editDraft.dueOn}
                    onChange={(event) =>
                      setEditDraft((draft) => ({ ...draft, dueOn: event.target.value }))
                    }
                  />
                  <span className="field-note">
                    The day it has to be finished. Clearing this removes the deadline and leaves the
                    scheduled day alone.
                  </span>
                </label>
              ) : (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setShowDeadline(true)}
                >
                  Add a deadline
                </button>
              )}
              <label>
                Details
                <textarea
                  className="input-field"
                  name="description"
                  value={editDraft.description}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, description: event.target.value }))
                  }
                  maxLength={50_000}
                  rows={6}
                />
              </label>
              <div className="dialog-actions">
                <button className="btn-secondary" type="button" onClick={closeEditor}>
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
