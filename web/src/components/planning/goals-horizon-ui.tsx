'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { createGoal, getQuietGoals, scheduleGoal, type GoalsView } from '@/app/goals/actions';
import type { QuietGoal } from '@/lib/planner/quiet-goals';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { spanNote, type PeriodGoal } from '@/lib/planning/goal-periods';

function readableDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function spanLabel(goal: PeriodGoal) {
  if (goal.startsOn && goal.dueOn) {
    return `${readableDate(goal.startsOn)} – ${readableDate(goal.dueOn)}`;
  }
  if (goal.dueOn) return `By ${readableDate(goal.dueOn)}`;
  if (goal.startsOn) return `From ${readableDate(goal.startsOn)}`;
  if (goal.horizonStartsOn && goal.horizonEndsOn) {
    return `${readableDate(goal.horizonStartsOn)} – ${readableDate(goal.horizonEndsOn)}`;
  }
  return null;
}

export function GoalsHorizonUI({ data }: { data: GoalsView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [parentGoalId, setParentGoalId] = useState('');
  const [details, setDetails] = useState(false);
  /* Null until asked for. The page does not open with a list of what you have
     not done, and nothing is fetched to build one. */
  const [quiet, setQuiet] = useState<QuietGoal[] | null>(null);
  /* Which unscheduled Goal is being given dates. One at a time: the form is
     the decision, and two open at once invites saving the wrong one. */
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [schedulingDates, setSchedulingDates] = useState({ startsOn: '', targetOn: '' });

  const { period, groups } = data;

  function run(work: () => Promise<void>, fallback: string) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (caught) {
        setError(actionFailureMessage(caught, fallback));
        router.refresh();
      }
    });
  }

  function viewHref(overrides: { kind?: string; on?: string; area?: string | null }) {
    const params = new URLSearchParams();
    const kind = overrides.kind ?? period.kind;
    if (kind !== 'quarter') params.set('view', kind);
    if (overrides.on) params.set('on', overrides.on);
    const area = overrides.area === undefined ? data.areaId : overrides.area;
    if (area) params.set('area', area);
    const query = params.toString();
    return query ? `/goals?${query}` : '/goals';
  }

  function renderGoal(goal: PeriodGoal, depth = 0) {
    const note = spanNote(goal);
    const span = spanLabel(goal);
    return (
      <li key={goal.id} className="goal-row" data-depth={depth}>
        <div className="goal-row-main">
          <span className="goal-title">{goal.title}</span>
          <span className="goal-meta">
            {span ? <span className="goal-span">{span}</span> : null}
            {note ? <span className="goal-continues">{note}</span> : null}
            {/* `enum-label` and not a class of its own: capitalising is only
                ever right for a machine value, and the shared class is what
                keeps that distinction checkable. */}
            {goal.status !== 'active' ? <span className="enum-label">{goal.status}</span> : null}
          </span>
        </div>
        {goal.children.length ? (
          <ul className="goal-children">
            {goal.children.map((child) => renderGoal(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="page goals-page">
      <header className="page-heading goals-heading">
        <div>
          <p className="eyebrow">Goals</p>
          <h1>{period.label}</h1>
        </div>
        <nav className="week-stepper" aria-label="Choose a period">
          <Link href={viewHref({ on: data.previous.startsOn })} aria-label="Previous period">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <strong>
            {readableDate(period.startsOn)} – {readableDate(period.endsOn)}
          </strong>
          <Link href={viewHref({ on: data.next.startsOn })} aria-label="Next period">
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <div className="goals-filters">
        <div className="week-grouping" role="group" aria-label="Period length">
          <Link
            className={period.kind === 'quarter' ? 'area-scope-active' : undefined}
            href={viewHref({ kind: 'quarter', on: period.startsOn })}
          >
            Quarter
          </Link>
          <Link
            className={period.kind === 'year' ? 'area-scope-active' : undefined}
            href={viewHref({ kind: 'year', on: period.startsOn })}
          >
            Year
          </Link>
        </div>
        {data.areas.length ? (
          <div className="week-grouping" role="group" aria-label="Filter by life area">
            <Link
              className={data.areaId === null ? 'area-scope-active' : undefined}
              href={viewHref({ area: null, on: period.startsOn })}
            >
              All of life
            </Link>
            {data.areas.map((area) => (
              <Link
                key={area.id}
                className={data.areaId === area.id ? 'area-scope-active' : undefined}
                href={viewHref({ area: area.id, on: period.startsOn })}
              >
                {area.name}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="area-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="goals-section" aria-label={`Goals in ${period.label}`}>
        <div className="section-heading">
          <h2>In {period.label}</h2>
        </div>
        <form
          className="area-quick-add"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = title.trim();
            if (trimmed.length < 3) return;
            run(async () => {
              await createGoal({
                title: trimmed,
                /* No dates typed means the period on screen, because that is
                   what adding a Goal here says. The disclosure is there when
                   the answer is something else. */
                startsOn: startsOn || (details ? null : period.startsOn),
                targetOn: targetOn || (details ? null : period.endsOn),
                areaId: data.areaId,
                parentGoalId: parentGoalId || null,
                kind: 'outcome',
              });
              setTitle('');
              setStartsOn('');
              setTargetOn('');
              setParentGoalId('');
            }, 'Planner AI could not add this goal.');
          }}
        >
          <label className="visually-hidden" htmlFor="goal-title">
            What do you want to be true?
          </label>
          <input
            id="goal-title"
            value={title}
            disabled={pending}
            placeholder="What do you want to be true?"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="submit"
            className="btn-primary button-with-icon"
            disabled={pending || title.trim().length < 3}
          >
            <Plus size={16} aria-hidden="true" />
            Add goal
          </button>
        </form>
        <details open={details} onToggle={(event) => setDetails(event.currentTarget.open)}>
          <summary>Dates and where it sits</summary>
          <div className="goal-detail-row">
            <label>
              Starts
              <input
                type="date"
                value={startsOn}
                disabled={pending}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label>
              Target
              <input
                type="date"
                value={targetOn}
                disabled={pending}
                onChange={(event) => setTargetOn(event.target.value)}
              />
            </label>
            <label>
              Under
              <select
                value={parentGoalId}
                disabled={pending}
                onChange={(event) => setParentGoalId(event.target.value)}
              >
                <option value="">Nothing above it</option>
                {data.parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="area-empty">
            Leave the dates empty and the goal is unscheduled — something you mean to do, with no
            date claimed for it.
          </p>
        </details>

        {groups.scheduled.length ? (
          <ul className="goal-list">{groups.scheduled.map((goal) => renderGoal(goal))}</ul>
        ) : (
          <p className="area-empty">Nothing is running in {period.label} yet.</p>
        )}
      </section>

      {groups.unscheduled.length ? (
        <section className="goals-section" aria-label="Unscheduled goals">
          <div className="section-heading">
            <h2>No dates yet</h2>
          </div>
          <p className="area-empty">
            These are not in {period.label}, or in any other period. Give one dates and it appears
            in every period it runs through.
          </p>
          <ul className="goal-list">
            {groups.unscheduled.map((goal) => (
              <li key={goal.id} className="goal-row">
                <div className="goal-row-main">
                  <span className="goal-title">{goal.title}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => {
                      setScheduling(scheduling === goal.id ? null : goal.id);
                      setSchedulingDates({
                        startsOn: period.startsOn,
                        targetOn: period.endsOn,
                      });
                    }}
                  >
                    Give it dates
                  </button>
                </div>
                {scheduling === goal.id ? (
                  <form
                    className="goal-detail-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(async () => {
                        await scheduleGoal({
                          id: goal.id,
                          expectedVersion: goal.version,
                          startsOn: schedulingDates.startsOn || null,
                          targetOn: schedulingDates.targetOn || null,
                        });
                        setScheduling(null);
                      }, 'Planner AI could not schedule this goal.');
                    }}
                  >
                    <label>
                      Starts
                      <input
                        type="date"
                        value={schedulingDates.startsOn}
                        disabled={pending}
                        onChange={(event) =>
                          setSchedulingDates((current) => ({
                            ...current,
                            startsOn: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Target
                      <input
                        type="date"
                        value={schedulingDates.targetOn}
                        disabled={pending}
                        onChange={(event) =>
                          setSchedulingDates((current) => ({
                            ...current,
                            targetOn: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button type="submit" className="btn-primary" disabled={pending}>
                      Save dates
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="goals-section" aria-label="Quiet goals">
        <div className="section-heading">
          <h2>What has gone quiet</h2>
        </div>
        {quiet === null ? (
          <>
            <p className="area-empty">
              Goals with no work recorded against them lately. Asked for rather than shown, because
              a list of what you have not done is not a useful thing to open a page with.
            </p>
            <button
              className="btn-secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    const result = await getQuietGoals();
                    setQuiet(result.goals);
                  } catch (caught) {
                    setError(actionFailureMessage(caught, 'Planner AI could not read your goals.'));
                  }
                });
              }}
            >
              Check
            </button>
          </>
        ) : quiet.length === 0 ? (
          <p className="area-empty">
            Every active goal has had work recorded against it, or has work already scheduled.
          </p>
        ) : (
          <>
            {/* The honest caveat, said once and in plain words. Work done and
                never written down looks exactly like work not done, and this
                list cannot tell them apart. */}
            <p className="area-empty">
              This is what has been written down, not what has happened. Work you did without
              recording it looks the same here as work you did not do.
            </p>
            <ul className="goal-list">
              {quiet.map((goal) => (
                <li key={goal.id} className="goal-row">
                  <div className="goal-row-main">
                    <span className="goal-title">{goal.title}</span>
                    <span className="goal-meta">
                      {goal.quietForDays === null
                        ? 'No work recorded yet'
                        : `No work recorded in ${goal.quietForDays} days`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {groups.initiatives.length ? (
        <section className="goals-section" aria-label="Ongoing initiatives">
          <div className="section-heading">
            <h2>Ongoing</h2>
          </div>
          <p className="area-empty">
            Standing concerns. They have no dates because they are never finished, so they belong to
            no period.
          </p>
          <ul className="goal-list">
            {groups.initiatives.map((goal) => (
              <li key={goal.id} className="goal-row">
                <div className="goal-row-main">
                  <span className="goal-title">{goal.title}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
