'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import {
  closeWeek,
  commitWeek,
  recordWeekDisposition,
  saveWeekIntention,
  setWeekSelection,
  type WeeklyWorksheet,
} from '@/app/planner/week/actions';
import { createTodayAction, setTodayActionStatus } from '@/app/today/actions';
import { logRoutineOccurrence } from '@/app/planner/templates/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { progressLabel, shiftWeek } from '@/lib/planning/weekly-worksheet';

const DISPOSITIONS = [
  { id: 'kept', label: 'Keep it open' },
  { id: 'moved', label: 'Move it' },
  { id: 'paused', label: 'Pause it' },
  { id: 'dropped', label: 'Drop it' },
] as const;

function readableRange(startsOn: string, endsOn: string) {
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${value}T12:00:00Z`)
    );
  return `${format(startsOn)} – ${format(endsOn)}`;
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

export function WeeklyWorksheetUI({ data }: { data: WeeklyWorksheet }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [intention, setIntention] = useState(data.intention ?? '');
  const [capacity, setCapacity] = useState(
    data.capacityHours === null ? '' : String(data.capacityHours)
  );
  const [taskTitle, setTaskTitle] = useState('');
  /* A controlled checkbox whose value only changes after a server round-trip
     reverts under the cursor and reads as a dead control. The tick moves when
     it is clicked; the server is still the authority, and a refusal puts it
     back with the reason beside it. */
  const [completedHere, setCompletedHere] = useState<Record<string, boolean>>({});
  /* A proposed week, held until it is applied or dismissed. Nothing about it
     is written on arrival. */
  const [proposal, setProposal] = useState<{
    intention: string | null;
    picks: Array<{ id: string; title: string; reason: string }>;
    candidates: number;
  } | null>(null);
  const [proposing, setProposing] = useState(false);

  const previous = shiftWeek(data.bounds, -1);
  const next = shiftWeek(data.bounds, 1);
  const closed = data.state === 'reviewed';

  function run(work: () => Promise<void>, fallback: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (caught) {
        setError(actionFailureMessage(caught, fallback));
        // Whatever was shown ahead of the server goes back to what the server
        // last said, so the screen never keeps a change that did not happen.
        setCompletedHere({});
        router.refresh();
      }
    });
  }

  function weekHref(startsOn: string, grouping = data.grouping) {
    const params = new URLSearchParams({ week: startsOn });
    if (grouping !== 'day') params.set('by', grouping);
    return `/planner/week?${params.toString()}`;
  }

  /* Saving the intention is what opens the plan, so a week nobody has written
     anything about has no row and no half-made state behind it. */
  async function ensurePlanId() {
    if (data.planId) return data.planId;
    const saved = await saveWeekIntention({
      startsOn: data.bounds.startsOn,
      endsOn: data.bounds.endsOn,
      intention: intention.trim() || null,
      capacityHours: capacity.trim() ? Number(capacity) : null,
    });
    return saved.planId;
  }

  return (
    <div className="page week-page">
      <header className="page-heading week-heading">
        <div>
          <p className="eyebrow">{data.quarter}</p>
          <h1>This week</h1>
        </div>
        <nav className="week-stepper" aria-label="Choose a week">
          <Link href={weekHref(previous.startsOn)} aria-label="Previous week">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <strong>{readableRange(data.bounds.startsOn, data.bounds.endsOn)}</strong>
          <Link href={weekHref(next.startsOn)} aria-label="Next week">
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </nav>
      </header>

      {error ? (
        <p className="area-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="area-notice" role="status">
          {notice}
        </p>
      ) : null}

      {closed ? (
        <section className="week-record" aria-label="Week record">
          <div className="section-heading">
            <h2>This week is closed</h2>
            <Lock size={16} aria-hidden="true" />
          </div>
          {data.record ? (
            <p>
              <strong>{progressLabel(data.progress)}</strong> of the work you committed to was
              finished by the end of the week: {data.record.completedCount} of{' '}
              {data.record.baselineCount}. {data.record.lateAdditionCount} other{' '}
              {data.record.lateAdditionCount === 1 ? 'item' : 'items'} passed through the week.
              Later changes to any of them do not change this record.
            </p>
          ) : (
            <p>Unavailable — this week was closed without a record.</p>
          )}
        </section>
      ) : null}

      {data.aiEnabled && !closed && data.state === 'draft' ? (
        <section className="week-intention" aria-label="Help me plan this week">
          <div className="section-heading">
            <h2>Help me plan this week</h2>
          </div>
          {proposal === null ? (
            <>
              <p className="area-empty">
                A proposed week, selected from work already scheduled in these seven days. It cannot
                add anything new, and nothing is saved until you apply it.
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={proposing || pending}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setProposing(true);
                  void (async () => {
                    try {
                      const response = await fetch('/api/plan-week', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          startsOn: data.bounds.startsOn,
                          endsOn: data.bounds.endsOn,
                        }),
                      });
                      const body = (await response.json().catch(() => null)) as {
                        data?: {
                          intention?: string | null;
                          picks?: Array<{ id: string; title: string; reason: string }>;
                          candidates?: number;
                        };
                        detail?: string;
                      } | null;
                      if (!response.ok) {
                        throw new Error(body?.detail ?? 'No week could be proposed.');
                      }
                      setProposal({
                        intention: body?.data?.intention ?? null,
                        picks: body?.data?.picks ?? [],
                        candidates: body?.data?.candidates ?? 0,
                      });
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : String(caught));
                    } finally {
                      setProposing(false);
                    }
                  })();
                }}
              >
                {proposing ? 'Thinking...' : 'Propose a week'}
              </button>
            </>
          ) : proposal.picks.length === 0 && !proposal.intention ? (
            <>
              <p className="area-empty">
                {proposal.candidates === 0
                  ? 'Everything scheduled this week is already in the plan.'
                  : 'No confident proposal from what is scheduled. Choose for yourself below.'}
              </p>
              <button type="button" className="btn-secondary" onClick={() => setProposal(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              {proposal.intention ? (
                <p>
                  <strong>Suggested intention:</strong> {proposal.intention}
                </p>
              ) : null}
              <ul className="area-list">
                {proposal.picks.map((pick) => (
                  <li key={pick.id}>
                    <span className="area-list-title">{pick.title}</span>
                    <span className="area-list-meta">{pick.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="week-intention-row">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pending}
                  onClick={() => setProposal(null)}
                >
                  Dismiss
                </button>
                {/* Applied one selection at a time through the same Operation
                    the checkboxes below use. The suggested sentence is put in
                    the box rather than saved, so it is edited before it counts
                    as the person's own words. */}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={pending || !proposal.picks.length}
                  onClick={() =>
                    run(async () => {
                      const planId = await ensurePlanId();
                      for (const pick of proposal.picks) {
                        await setWeekSelection({
                          planId,
                          actionId: pick.id,
                          selected: true,
                        });
                      }
                      if (proposal.intention) setIntention(proposal.intention);
                      setProposal(null);
                      setNotice(
                        `${proposal.picks.length} added to this week. The suggested sentence is in the box for you to edit or replace.`
                      );
                    }, 'Planner AI could not apply this plan.')
                  }
                >
                  Add these to the week
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="week-intention" aria-label="This week’s intention">
        <div className="section-heading">
          <h2>What matters this week?</h2>
        </div>
        <textarea
          aria-label="What matters this week"
          rows={3}
          value={intention}
          disabled={pending || closed}
          placeholder="A sentence about the week, or the two things that would make it a good one…"
          onChange={(event) => setIntention(event.target.value)}
        />
        <div className="week-intention-row">
          <label>
            Hours you expect to have
            <input
              type="number"
              min={0}
              max={168}
              value={capacity}
              disabled={pending || closed}
              placeholder="Optional"
              onChange={(event) => setCapacity(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || closed}
            onClick={() =>
              run(async () => {
                await saveWeekIntention({
                  startsOn: data.bounds.startsOn,
                  endsOn: data.bounds.endsOn,
                  intention: intention.trim() || null,
                  capacityHours: capacity.trim() ? Number(capacity) : null,
                });
                setNotice('Saved.');
              }, 'Planner AI could not save this week.')
            }
          >
            Save
          </button>
        </div>
        {data.capacityHours === null && !closed ? (
          <p className="area-empty">
            Leave the hours empty if you do not know them. Nothing here guesses at time you have not
            stated.
          </p>
        ) : null}
      </section>

      {data.routines.length ? (
        <section className="week-routines" aria-label="Routines this week">
          <div className="section-heading">
            <h2>Routines</h2>
          </div>
          <p className="area-empty">
            Counted, not scheduled. Three runs in a week is three runs, whichever days they happen
            on.
          </p>
          <ul className="goal-list">
            {data.routines.map((routine) => (
              <li key={routine.templateId} className="goal-row">
                <div className="goal-row-main">
                  <span className="goal-title">{routine.title}</span>
                  <span className="goal-meta">
                    <span className="goal-span">
                      {routine.done} of {routine.target} this week
                    </span>
                    {routine.paused ? <span className="enum-label">paused</span> : null}
                    {routine.met ? <span className="goal-continues">Done</span> : null}
                  </span>
                  {!routine.met && !routine.paused && !closed ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await logRoutineOccurrence(routine.templateId, data.today);
                          setNotice(`Recorded a session of ${routine.title}.`);
                        }, 'Planner AI could not record this session.')
                      }
                    >
                      Record today
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="week-tasks" aria-label="This week's tasks">
        <div className="section-heading">
          <h2>Tasks</h2>
          <span className="week-grouping">
            <Link
              className={data.grouping === 'day' ? 'area-scope-active' : undefined}
              href={weekHref(data.bounds.startsOn, 'day')}
            >
              By day
            </Link>
            <Link
              className={data.grouping === 'area' ? 'area-scope-active' : undefined}
              href={weekHref(data.bounds.startsOn, 'area')}
            >
              By life area
            </Link>
          </span>
        </div>

        {!closed ? (
          <form
            className="area-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              const title = taskTitle.trim();
              if (title.length < 3) return;
              run(async () => {
                const planId = await ensurePlanId();
                const created = await createTodayAction({
                  title,
                  goalId: null,
                  areaId: null,
                  // The first day of the week being planned, which is what
                  // "this week" means when no day has been chosen yet.
                  scheduledOn: data.bounds.startsOn,
                  focus: false,
                  requestKey: `${data.bounds.startsOn}-${Date.now()}`,
                });
                await setWeekSelection({
                  planId,
                  actionId: created.action.id,
                  selected: true,
                });
                setTaskTitle('');
              }, 'Planner AI could not add this task.');
            }}
          >
            <label className="visually-hidden" htmlFor="week-task">
              What needs doing this week?
            </label>
            <input
              id="week-task"
              value={taskTitle}
              disabled={pending}
              placeholder="What needs doing this week?"
              onChange={(event) => setTaskTitle(event.target.value)}
            />
            <button
              type="submit"
              className="btn-primary button-with-icon"
              disabled={pending || taskTitle.trim().length < 3}
            >
              <Plus size={15} aria-hidden="true" />
              Add task
            </button>
          </form>
        ) : null}

        {data.items.length ? (
          <div className="week-groups">
            {data.groups
              .filter((group) => group.items.length || data.grouping === 'day')
              .map((group) => (
                <div className="week-group" key={group.key || 'unscheduled'}>
                  <h3>
                    {data.grouping === 'day' && group.key ? dayLabel(group.key) : group.label}
                  </h3>
                  {group.items.length ? (
                    <ul className="area-list">
                      {group.items.map((item) => (
                        <li key={item.actionId}>
                          <span className="area-list-title">
                            {!closed ? (
                              <input
                                type="checkbox"
                                aria-label={`Complete ${item.title}`}
                                checked={completedHere[item.actionId] ?? item.status === 'done'}
                                disabled={pending}
                                onChange={() => {
                                  const done = !(
                                    completedHere[item.actionId] ?? item.status === 'done'
                                  );
                                  setCompletedHere((current) => ({
                                    ...current,
                                    [item.actionId]: done,
                                  }));
                                  run(async () => {
                                    /* The version comes with the row, so a
                                       click against a stale worksheet is
                                       refused rather than overwriting whatever
                                       the task has become. */
                                    await setTodayActionStatus(
                                      item.actionId,
                                      item.version,
                                      done ? 'done' : 'open'
                                    );
                                  }, 'Planner AI could not change this task.');
                                }}
                              />
                            ) : null}
                            {item.title}
                          </span>
                          <span className="area-list-meta">
                            {item.inBaseline ? 'Committed' : 'Added later'}
                            {item.areaName ? ` · ${item.areaName}` : ''}
                            {item.disposition ? ` · ${item.disposition}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="area-empty">Nothing.</p>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <p className="area-empty">
            Nothing is in this week yet. Add a task above, or choose from the work already scheduled
            for these days.
          </p>
        )}
      </section>

      {!closed && data.candidates.length ? (
        <section className="week-candidates" aria-label="Already scheduled this week">
          <div className="section-heading">
            <h2>Already scheduled these days</h2>
          </div>
          <ul className="area-list">
            {data.candidates.map((candidate) => (
              <li key={candidate.actionId}>
                <span className="area-list-title">{candidate.title}</span>
                <span className="area-list-meta">
                  {candidate.scheduledOn ?? 'No day'}
                  {candidate.areaName ? ` · ${candidate.areaName}` : ''}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const planId = await ensurePlanId();
                      await setWeekSelection({
                        planId,
                        actionId: candidate.actionId,
                        selected: true,
                      });
                    }, 'Planner AI could not put this in the week.')
                  }
                >
                  Put in the week
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.state === 'draft' && data.items.length ? (
        <section className="week-commit" aria-label="Commit this week">
          <p>
            Committing freezes what this week is a promise about. You can still add, move and drop
            work afterwards — that is recorded separately, and the promise stays as it was.
          </p>
          <button
            type="button"
            className="btn-primary button-with-icon"
            disabled={pending}
            onClick={() =>
              run(async () => {
                if (!data.planId || data.planVersion === null) return;
                await commitWeek({ planId: data.planId, expectedVersion: data.planVersion });
                setNotice('This week is committed.');
              }, 'Planner AI could not commit this week.')
            }
          >
            <Check size={15} aria-hidden="true" />
            Commit this week
          </button>
        </section>
      ) : null}

      {data.state === 'committed' ? (
        <section className="week-close" aria-label="Close this week">
          <div className="section-heading">
            <h2>What needs a decision?</h2>
          </div>
          {data.openDecisions.length ? (
            <ul className="area-list">
              {data.openDecisions.map((item) => (
                <li key={item.actionId}>
                  <span className="area-list-title">{item.title}</span>
                  <span className="week-dispositions">
                    {DISPOSITIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="btn-secondary"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            if (!data.planId) return;
                            await recordWeekDisposition({
                              planId: data.planId,
                              actionId: item.actionId,
                              disposition: option.id,
                              note: null,
                            });
                          }, 'Planner AI could not record this decision.')
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="area-empty">
              Nothing is waiting on a decision. A thoughtful review of unfinished work is still a
              completed review.
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                if (!data.planId || data.planVersion === null) return;
                await closeWeek({ planId: data.planId, expectedVersion: data.planVersion });
                setNotice('This week is closed and its record is saved.');
              }, 'Planner AI could not close this week.')
            }
          >
            Close this week
          </button>
        </section>
      ) : null}

      <section className="week-history" aria-label="Previous weeks">
        <div className="section-heading">
          <h2>Previous weeks</h2>
        </div>
        {data.history.length ? (
          <div className="week-history-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  <th scope="col">Quarter</th>
                  <th scope="col">Review</th>
                  <th scope="col">Planned</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Planned tasks completed</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.planId}>
                    <th scope="row">
                      <Link href={weekHref(row.startsOn)}>
                        {readableRange(row.startsOn, row.endsOn)}
                      </Link>
                    </th>
                    <td>{row.quarter}</td>
                    <td>{row.state === 'reviewed' ? 'Done' : 'Open'}</td>
                    {/* An open week has no record yet, and a closed one with no
                        baseline has no percentage. Neither is a zero. */}
                    <td>{row.baselineCount ?? '—'}</td>
                    <td>{row.completedCount ?? '—'}</td>
                    <td>
                      {row.baselineCount
                        ? `${Math.round(((row.completedCount ?? 0) / row.baselineCount) * 100)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="area-empty">No weeks have been planned yet.</p>
        )}
      </section>
    </div>
  );
}
