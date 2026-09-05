'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Inbox,
  Pencil,
  Save,
  Target,
  X,
} from 'lucide-react';
import {
  completeTodayAction,
  editTodayAction,
  type TodayAction,
  type TodayData,
} from '@/app/today/actions';
import { addCalendarDays, isDateInPlannerWeek, plannerWeek } from '@/lib/planner-calendar';

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'The calendar could not be updated.';
}

function formatDay(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`)
  );
}

export function PlannerCalendar({ data }: { data: TodayData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actions, setActions] = useState(data.actions);
  const [weekAnchor, setWeekAnchor] = useState(data.localDate);
  const [selectedDate, setSelectedDate] = useState(data.localDate);
  const [editing, setEditing] = useState<TodayAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const days = useMemo(() => plannerWeek(weekAnchor), [weekAnchor]);
  const weekStart = days[0];
  const weekEnd = days[6];
  const scheduledThisWeek = actions.filter((action) =>
    isDateInPlannerWeek(action.scheduledOn, weekStart)
  );
  const selectedActions = actions.filter((action) => action.scheduledOn === selectedDate);
  const unscheduled = actions.filter((action) => !action.scheduledOn);

  function moveWeek(daysToMove: number) {
    const next = addCalendarDays(weekStart, daysToMove);
    setWeekAnchor(next);
    setSelectedDate(next);
  }

  function returnToToday() {
    setWeekAnchor(data.localDate);
    setSelectedDate(data.localDate);
  }

  function complete(action: TodayAction) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await completeTodayAction(action.id, action.version);
        setActions((current) => current.filter((item) => item.id !== action.id));
        setNotice(`${action.title} completed.`);
        router.refresh();
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function saveSchedule(formData: FormData) {
    if (!editing) return;
    setError(null);
    setNotice(null);
    const scheduledOn = String(formData.get('scheduledOn') ?? '');
    startTransition(async () => {
      try {
        const result = await editTodayAction({
          id: editing.id,
          expectedVersion: editing.version,
          title: editing.title,
          descriptionMarkdown: editing.descriptionMarkdown,
          scheduledOn: scheduledOn || null,
        });
        setActions((current) =>
          current.map((action) =>
            action.id === editing.id
              ? {
                  ...action,
                  scheduledOn: result.scheduled_on ?? null,
                  version: result.version,
                }
              : action
          )
        );
        if (scheduledOn) {
          setWeekAnchor(scheduledOn);
          setSelectedDate(scheduledOn);
          setNotice(
            `${editing.title} scheduled for ${formatDay(scheduledOn, {
              month: 'short',
              day: 'numeric',
            })}.`
          );
        } else {
          setNotice(`${editing.title} moved to Unscheduled.`);
        }
        setEditing(null);
        router.refresh();
      } catch (caught) {
        setError(messageFor(caught));
      }
    });
  }

  function actionRow(action: TodayAction) {
    return (
      <article className="planner-calendar-action" key={action.id}>
        <button
          className="action-complete-button"
          type="button"
          aria-label={`Complete ${action.title}`}
          title="Complete Action"
          disabled={isPending}
          onClick={() => complete(action)}
        >
          <Check size={15} />
        </button>
        <button
          className="planner-calendar-action-copy"
          type="button"
          onClick={() => setEditing(action)}
        >
          <strong>{action.title}</strong>
          <span>{action.goalTitle ?? 'Independent Action'}</span>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`Schedule ${action.title}`}
          title="Schedule Action"
          onClick={() => setEditing(action)}
        >
          <Pencil size={14} />
        </button>
      </article>
    );
  }

  return (
    <div className="page planner-calendar-page">
      <header className="page-heading planner-calendar-heading">
        <div>
          <p className="eyebrow">Planner</p>
          <h1>Calendar</h1>
          <p className="lede">Give each Action a place without overloading the week.</p>
        </div>
        <div className="planner-calendar-heading-actions">
          <Link className="btn-secondary button-with-icon" href="/inbox">
            <Inbox size={15} /> Capture
          </Link>
          <Link className="btn-primary button-with-icon" href="/planner">
            <Target size={15} /> Open Plan
          </Link>
        </div>
      </header>

      {notice ? (
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="planner-calendar-toolbar" aria-label="Calendar controls">
        <div>
          <button
            className="icon-button"
            type="button"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => moveWeek(-7)}
          >
            <ArrowLeft size={16} />
          </button>
          <button className="btn-secondary" type="button" onClick={returnToToday}>
            Today
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Next week"
            title="Next week"
            onClick={() => moveWeek(7)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <strong>
          {formatDay(weekStart, { month: 'short', day: 'numeric' })} -{' '}
          {formatDay(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}
        </strong>
        <span>{scheduledThisWeek.length} scheduled this week</span>
      </section>

      <nav className="planner-week-strip" aria-label="Choose a day">
        {days.map((day) => {
          const count = actions.filter((action) => action.scheduledOn === day).length;
          const active = day === selectedDate;
          const today = day === data.localDate;
          return (
            <button
              className={active ? 'planner-day-active' : undefined}
              type="button"
              key={day}
              aria-pressed={active}
              onClick={() => setSelectedDate(day)}
            >
              <span>{formatDay(day, { weekday: 'short' })}</span>
              <strong>{formatDay(day, { day: 'numeric' })}</strong>
              <small>{count || (today ? 'Today' : 'Free')}</small>
            </button>
          );
        })}
      </nav>

      <div className="planner-calendar-layout">
        <section className="planner-calendar-agenda" aria-labelledby="selected-day-title">
          <header>
            <div>
              <p className="eyebrow">Selected day</p>
              <h2 id="selected-day-title">
                {formatDay(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}
              </h2>
            </div>
            <span>{selectedActions.length} Actions</span>
          </header>
          <div className="planner-calendar-action-list">
            {selectedActions.map(actionRow)}
            {!selectedActions.length ? (
              <div className="inline-empty planner-calendar-empty">
                <CalendarDays size={20} aria-hidden="true" />
                <p>No Actions scheduled.</p>
                <span>Choose an unscheduled Action and give it this date.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="planner-unscheduled" aria-labelledby="unscheduled-title">
          <header>
            <div>
              <p className="eyebrow">Action inbox</p>
              <h2 id="unscheduled-title">Unscheduled</h2>
            </div>
            <span>{unscheduled.length}</span>
          </header>
          <div className="planner-calendar-action-list">
            {unscheduled.slice(0, 12).map(actionRow)}
            {!unscheduled.length ? (
              <div className="inline-empty">
                <p>Every open Action has a date.</p>
              </div>
            ) : null}
          </div>
          {unscheduled.length > 12 ? (
            <Link className="text-button" href="/planner">
              View all {unscheduled.length} Actions
            </Link>
          ) : null}
        </aside>
      </div>

      <footer className="planner-calendar-footer">
        <span>
          <Clock3 size={14} /> Scheduling changes are recorded in Activity and available to Planner
          AI.
        </span>
        <Link href="/review">Open weekly review</Link>
      </footer>

      {editing ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setEditing(null)}>
          <section
            className="action-edit-dialog planner-schedule-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-action-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">Schedule Action</p>
                <h2 id="schedule-action-title">{editing.title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close scheduler"
                title="Close"
                onClick={() => setEditing(null)}
              >
                <X size={17} />
              </button>
            </header>
            <form action={saveSchedule}>
              <label>
                Scheduled date
                <input
                  className="input-field"
                  type="date"
                  name="scheduledOn"
                  defaultValue={editing.scheduledOn ?? selectedDate}
                />
              </label>
              <p>Clear the date to move this Action back to Unscheduled.</p>
              <div className="dialog-actions">
                <button className="btn-secondary" type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn-primary button-with-icon" type="submit" disabled={isPending}>
                  <Save size={15} /> {isPending ? 'Saving...' : 'Save date'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
