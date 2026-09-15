'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import Link from 'next/link';
import { AlertCircle, CalendarRange, CheckCircle2, Flag, History } from 'lucide-react';
import {
  completeWeeklyReview,
  pauseInitiative,
  type WeeklyReviewAction,
  type WeeklyReviewData,
  type WeeklyReviewDecision,
} from '@/app/review/actions';
import { newReviewIntent } from '@/lib/reviews/completion-intent';
import { CoachingCue } from '@/components/coaching-cue';
import { CollapsibleSection } from '@/components/collapsible-section';
import { ReviewTabs } from '@/components/review-tabs';
import { ReviewAiProposal } from '@/components/review-ai-proposal';
import { weeklyReviewCoachingCue } from '@/lib/coaching';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { carriedLabel, isStalled, STALLED_AFTER_CHECKPOINTS } from '@/lib/reviews/checkpoints';
import {
  bandOpenByDefault,
  DEFAULT_REVIEW_DENSITY,
  groupOpenByDefault,
  parseReviewDensity,
  REVIEW_DENSITY_KEY,
  type ReviewDensity,
} from '@/lib/reviews/density';

// How much of the week is on screen is a reading preference, so it is read
// through the store rather than restored in an effect -- setting state from an
// effect on mount is both a lint error here and a visible flash of the wrong
// density. Writes notify, so two Review screens in two tabs agree.
let densityListeners: (() => void)[] = [];
let densityCache: ReviewDensity | null = null;
let densityRaw: string | null = null;

function subscribeToDensity(onChange: () => void) {
  densityListeners = [...densityListeners, onChange];
  window.addEventListener('storage', onChange);
  return () => {
    densityListeners = densityListeners.filter((listener) => listener !== onChange);
    window.removeEventListener('storage', onChange);
  };
}

function densitySnapshot(): ReviewDensity {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(REVIEW_DENSITY_KEY);
  } catch {
    raw = null;
  }
  // Cached against the raw text so the snapshot is referentially stable, which
  // useSyncExternalStore requires.
  if (raw !== densityRaw || densityCache === null) {
    densityRaw = raw;
    densityCache = parseReviewDensity(raw);
  }
  return densityCache;
}

function serverDensitySnapshot(): ReviewDensity {
  return DEFAULT_REVIEW_DENSITY;
}

function writeDensity(next: ReviewDensity) {
  try {
    window.localStorage.setItem(REVIEW_DENSITY_KEY, next);
  } catch {
    // A browser that refuses storage still gets the density for this session.
  }
  densityRaw = next;
  densityCache = next;
  for (const listener of densityListeners) listener();
}

const densityLabels: Record<ReviewDensity, string> = {
  full: 'Everything',
  compact: 'Compact',
  headlines: 'Headlines only',
};

const UNFILED = 'unlinked';
const UNFILED_TITLE = 'Not connected to a Goal';

/**
 * Work grouped by what it is for. The ritual being replaced is a folder per
 * business, so the grouping is the feature -- a flat list across four projects
 * is the thing Notion was doing better.
 */
function groupByGoal<T extends { goalId: string | null; goalTitle: string | null }>(
  items: readonly T[]
) {
  const groups = new Map<string, { key: string; title: string; items: T[] }>();
  for (const item of items) {
    const key = item.goalId ?? UNFILED;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, { key, title: item.goalTitle ?? UNFILED_TITLE, items: [item] });
  }
  return [...groups.values()];
}

type Resolution = WeeklyReviewDecision['resolution'];
// A decision nobody made is not a decision -- but that only made forcing one on
// every row the right answer while the week was the only container. An Action
// that rolled over unremarked left no trace anywhere, so the decision was the
// only thing standing between the owner and an invisible backlog.
//
// The age beside each row is that trace now, so the guard moves rather than
// disappearing: an unset row is simply left out of the payload and stays open,
// and only work past three checkpoints still has to be answered before the week
// can close. What is gone is the tax on the nine rows out of ten where the
// answer was always "yes, obviously, still doing that".
type DraftResolution = Resolution | 'unset';

const resolutionLabels: Record<Resolution, string> = {
  done: 'Completed',
  next_week: 'Move to next week',
  keep: 'Keep it open',
  blocked: 'Blocked',
  dropped: 'Drop intentionally',
  left_overdue: 'Leave overdue',
};

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'Weekly Review could not be completed.');
}

export function WeeklyReview({ data }: { data: WeeklyReviewData }) {
  const [isPending, startTransition] = useTransition();
  // Null until this screen submits, and cleared when a submission succeeds, so
  // the next completion of the same period is recognised as a new decision
  // rather than a replay of the one that was undone.
  const intentRef = useRef<string | null>(null);
  const [reflection, setReflection] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<
    Record<string, Omit<WeeklyReviewDecision, 'resolution'> & { resolution: DraftResolution }>
  >(() =>
    Object.fromEntries(
      data.actions.map((action) => [
        action.id,
        {
          actionId: action.id,
          expectedVersion: action.version,
          resolution: 'unset' as DraftResolution,
          reason: null,
          priority: false,
        },
      ])
    )
  );
  const priorityCount = useMemo(
    () => Object.values(decisions).filter((decision) => decision.priority).length,
    [decisions]
  );

  const density = useSyncExternalStore(subscribeToDensity, densitySnapshot, serverDensitySnapshot);
  // A density sets every level at once; a section the person then opens or
  // closes by hand overrides it until the density changes again.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const sectionOpen = useCallback(
    (key: string, level: 'group' | 'band') => {
      const override = openOverrides[key];
      if (typeof override === 'boolean') return override;
      return level === 'group' ? groupOpenByDefault(density) : bandOpenByDefault(density);
    },
    [density, openOverrides]
  );
  function toggleSection(key: string, level: 'group' | 'band') {
    const current = sectionOpen(key, level);
    setOpenOverrides((existing) => ({ ...existing, [key]: !current }));
  }
  function pauseGoal(goalId: string, expectedVersion: number, title: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await pauseInitiative({ goalId, expectedVersion });
        setNotice(`${title} is paused. Everything filed under it is untouched.`);
      } catch (caught) {
        setError(actionFailureMessage(caught, `${title} could not be paused.`));
      }
    });
  }
  function chooseDensity(next: ReviewDensity) {
    // Clearing the overrides is the point of the control: it is how "headlines
    // only" reaches a section that was opened by hand ten minutes ago.
    setOpenOverrides({});
    writeDensity(next);
  }

  // Largest first: the thing that absorbed the week leads the report of it.
  const finishedGroups = useMemo(
    () => groupByGoal(data.finished).sort((a, b) => b.items.length - a.items.length),
    [data.finished]
  );
  const goalsById = useMemo(() => new Map(data.goals.map((goal) => [goal.id, goal])), [data.goals]);
  // Oldest work first. The list is ordered by the one number that says nobody
  // is going to do this, so the items that need an answer are never below the
  // fold behind the ones that do not.
  const openActions = useMemo(
    () => [...data.actions].sort((left, right) => right.weeksCarried - left.weeksCarried),
    [data.actions]
  );
  const stalledCount = useMemo(
    () => data.actions.filter((action) => isStalled(action.weeksCarried)).length,
    [data.actions]
  );
  // The work that has stopped moving leads, because it is the only part of the
  // list that still asks for anything.
  const openGroups = useMemo(() => {
    const stalledIn = (items: readonly { weeksCarried: number }[]) =>
      items.filter((item) => isStalled(item.weeksCarried)).length;
    return groupByGoal(openActions).sort(
      (a, b) => stalledIn(b.items) - stalledIn(a.items) || b.items.length - a.items.length
    );
  }, [openActions]);

  function updateDecision(
    actionId: string,
    change: Partial<Omit<WeeklyReviewDecision, 'resolution'> & { resolution: DraftResolution }>
  ) {
    setDecisions((current) => ({
      ...current,
      [actionId]: { ...current[actionId], ...change },
    }));
  }

  // Only work that has stopped moving still has to be answered. The operation
  // enforces the same rule, against the same threshold, so a screen that let
  // one through would be refused rather than silently accepted.
  const undecidedCount = data.actions.filter(
    (action) => isStalled(action.weeksCarried) && decisions[action.id]?.resolution === 'unset'
  ).length;
  const missingReason = Object.values(decisions).some(
    (decision) => ['blocked', 'dropped'].includes(decision.resolution) && !decision.reason?.trim()
  );
  const decisionsValid = undecidedCount === 0 && !missingReason;

  function completeReview() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        // The same intent for every send of this submission, so a retry
        // replays rather than writing a second review. Undoing and completing
        // again mounts the screen afresh and therefore starts a new intent.
        intentRef.current ??= newReviewIntent();
        const result = await completeWeeklyReview({
          intentId: intentRef.current,
          startsOn: data.startsOn,
          endsOn: data.endsOn,
          reflectionMarkdown: reflection,
          decisions: Object.values(decisions).filter(
            (decision): decision is WeeklyReviewDecision => decision.resolution !== 'unset'
          ),
        });
        intentRef.current = null;
        setNotice(
          `Review completed. ${result.resolvedCount} actions resolved and ${result.priorityCount} priorities committed.`
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  // One row of still-open work. Pulled out of the list so the same row can
  // be rendered inside whichever initiative it belongs to.
  function renderOpenRow(action: WeeklyReviewAction) {
    const decision = decisions[action.id];
    const canPrioritize = !['done', 'dropped'].includes(decision.resolution);
    const stalled = isStalled(action.weeksCarried);
    return (
      <article
        className={`review-action-row${stalled ? ' review-action-stalled' : ''}`}
        key={action.id}
      >
        <div className="review-action-copy">
          <strong>{action.title}</strong>
          {/* The Goal used to be named here because the list was flat. Every
              row now sits inside its own initiative, so repeating it on each
              line is noise. The status is an enum and reads better
              capitalised; nothing the owner wrote may be. */}
          <span>
            <span className="enum-label">{action.status.replace('_', ' ')}</span>
          </span>
        </div>
        {/* The age is the record. It is what lets work stay open
                      without a decision without that being silent. */}
        <span
          className={`review-carry${stalled ? ' review-carry-stalled' : ''}`}
          title={
            action.weeksCarried
              ? `Open through ${action.weeksCarried} completed ${
                  action.weeksCarried === 1 ? 'review' : 'reviews'
                }`
              : 'Created since your last review'
          }
        >
          {carriedLabel(action.weeksCarried)}
        </span>
        <select
          value={decision.resolution}
          aria-label={`Decision for ${action.title}`}
          onChange={(event) => {
            const resolution = event.target.value as DraftResolution;
            updateDecision(action.id, {
              resolution,
              priority: ['done', 'dropped'].includes(resolution) ? false : decision.priority,
            });
          }}
        >
          <option value="unset">{stalled ? 'Decide what happens' : 'Stays open'}</option>
          {Object.entries(resolutionLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {['blocked', 'dropped'].includes(decision.resolution) ? (
          <input
            className="review-reason"
            value={decision.reason ?? ''}
            onChange={(event) => updateDecision(action.id, { reason: event.target.value || null })}
            placeholder={
              decision.resolution === 'blocked' ? 'What is blocking it?' : 'Why drop it?'
            }
            aria-label={`Reason for ${action.title}`}
            maxLength={500}
          />
        ) : null}
        <label className={`review-priority${canPrioritize ? '' : ' review-priority-disabled'}`}>
          <input
            type="checkbox"
            checked={decision.priority}
            disabled={!canPrioritize || (!decision.priority && priorityCount >= 5)}
            onChange={(event) => {
              const priority = event.target.checked;
              // A row with no decision is left out of the payload
              // entirely, and the priority flag rides on the
              // decision. Naming something a priority is itself
              // the statement that it stays, so record it as one.
              updateDecision(action.id, {
                priority,
                resolution:
                  priority && decision.resolution === 'unset' ? 'keep' : decision.resolution,
              });
            }}
          />
          <Flag size={14} aria-hidden="true" />
          Priority
        </label>
      </article>
    );
  }

  return (
    <div className="page review-page">
      <ReviewTabs active="week" />
      <header className="page-heading review-heading">
        <div>
          <p className="eyebrow">Weekly reset</p>
          <h1>Review</h1>
          <p className="lede">
            What you finished, what is still moving, and what has stopped. Nothing is copied forward
            — work that stays open keeps its own history.
          </p>
        </div>
        <div className="review-range" aria-label="Review period">
          <CalendarRange size={17} aria-hidden="true" />
          <span>
            {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
              new Date(`${data.startsOn}T12:00:00Z`)
            )}{' '}
            to{' '}
            {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
              new Date(`${data.endsOn}T12:00:00Z`)
            )}
          </span>
        </div>
      </header>

      <CoachingCue
        cue={weeklyReviewCoachingCue(data.coachingIntensity, {
          actionCount: data.actions.length,
          blockedCount: data.actions.filter((action) => action.status === 'blocked').length,
          stalledCount,
        })}
      />

      <ReviewAiProposal
        initial={data.aiProposal}
        kind="weekly"
        startsOn={data.startsOn}
        endsOn={data.endsOn}
        job={data.analysisJob}
        onUsePriorities={(ids) => {
          const selected = new Set(ids.slice(0, 5));
          setDecisions((current) =>
            Object.fromEntries(
              Object.entries(current).map(([id, decision]) => [
                id,
                {
                  ...decision,
                  priority: selected.has(id) && !['done', 'dropped'].includes(decision.resolution),
                },
              ])
            )
          );
        }}
      />

      {notice ? (
        <div className="status-message review-complete-next" role="status">
          <p>{notice}</p>
          {/* Closing a week is only half of a weekly review. The next week has
              to be somewhere a person can go from here, rather than a route
              they are expected to remember. */}
          <p className="review-next-links">
            <Link href="/planner">Plan next week</Link>
            <Link href="/">Open Today</Link>
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="review-density" role="group" aria-label="How much of the week to show">
        <span className="review-density-label">Show</span>
        {(Object.keys(densityLabels) as ReviewDensity[]).map((option) => (
          <button
            key={option}
            type="button"
            className="review-density-option"
            aria-pressed={density === option}
            onClick={() => chooseDensity(option)}
          >
            {densityLabels[option]}
          </button>
        ))}
        <span className="review-density-hint">Or open and close any section on its own.</span>
      </div>

      <div className={`review-layout review-density-${density}`}>
        <section className="review-workspace" aria-label="This week">
          {/* What closed leads the screen. It is the question the week is
              opened to answer, and until now the Review has been the one
              surface in the product that could not answer it. */}
          <CollapsibleSection
            id="review-finished"
            eyebrow="What you did"
            title="Finished"
            count={data.finished.length}
            tone="finished"
            shut={<span className="review-shut-note">{data.finished.length} completed</span>}
            open={sectionOpen('finished', 'group')}
            onToggle={() => toggleSection('finished', 'group')}
          >
            {data.finishedSinceIsFallback ? (
              <p className="review-window-note">
                Counted across this week. Once you close a week, this covers everything since.
              </p>
            ) : (
              <p className="review-window-note">
                Everything completed since you last closed a week on{' '}
                {new Intl.DateTimeFormat('en-US', {
                  month: 'short',
                  day: 'numeric',
                }).format(new Date(data.finishedSince))}
                .
              </p>
            )}
            {finishedGroups.length ? (
              <div className="review-finished-groups">
                {finishedGroups.map((group) => (
                  <CollapsibleSection
                    key={group.key}
                    id={`review-finished-${group.key}`}
                    title={group.title}
                    count={group.items.length}
                    shut={<span className="review-shut-note">{group.items.length} done</span>}
                    open={sectionOpen(`finished:${group.key}`, 'band')}
                    onToggle={() => toggleSection(`finished:${group.key}`, 'band')}
                  >
                    <ul className="review-finished-list">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <CheckCircle2 size={13} aria-hidden="true" />
                          <span className="review-finished-title">{item.title}</span>
                          <time dateTime={item.completedAt}>
                            {new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(
                              new Date(item.completedAt)
                            )}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleSection>
                ))}
              </div>
            ) : (
              <p className="review-empty-note">
                Nothing has been completed yet. Anything you finish this week shows up here.
              </p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="review-unfinished"
            eyebrow="No silent rollover"
            title="Still open"
            count={data.actions.length}
            shut={
              <span className="review-shut-note">
                {data.actions.length} open
                {stalledCount
                  ? ` · ${stalledCount} carried ${stalledCount === 1 ? 'week' : 'weeks'} on`
                  : ''}
              </span>
            }
            open={sectionOpen('unfinished', 'group')}
            onToggle={() => toggleSection('unfinished', 'group')}
          >
            {data.actions.length ? (
              <div className="review-open-groups">
                {openGroups.map((group) => {
                  const goal = goalsById.get(group.key);
                  const stalledHere = group.items.filter((item) =>
                    isStalled(item.weeksCarried)
                  ).length;
                  const quiet = goal && goal.quietCheckpoints >= STALLED_AFTER_CHECKPOINTS;
                  return (
                    <CollapsibleSection
                      key={group.key}
                      id={`review-open-${group.key}`}
                      title={group.title}
                      eyebrow={
                        goal?.kind === 'initiative'
                          ? 'Initiative'
                          : group.key === UNFILED
                            ? 'Unfiled'
                            : 'Goal'
                      }
                      count={group.items.length}
                      tone={stalledHere ? 'stalled' : undefined}
                      shut={
                        <span className="review-shut-note">
                          {group.items.length} open
                          {stalledHere ? ` · ${stalledHere} asking` : ''}
                        </span>
                      }
                      open={sectionOpen(`open:${group.key}`, 'band')}
                      onToggle={() => toggleSection(`open:${group.key}`, 'band')}
                    >
                      {/* A task can be stuck; so can a whole project, and that
                          is a different problem with a different answer. */}
                      {quiet && goal ? (
                        <div className="review-quiet-goal">
                          <p>
                            Nothing has been completed here in {goal.quietCheckpoints} reviews. If
                            that is deliberate, pause it — a paused
                            {goal.kind === 'initiative' ? ' initiative' : ' Goal'} stops appearing
                            here and keeps everything filed under it.
                          </p>
                          {goal.status === 'paused' ? (
                            <span className="review-quiet-paused">Paused</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => pauseGoal(goal.id, goal.version, goal.title)}
                              disabled={isPending}
                            >
                              Pause {goal.title}
                            </button>
                          )}
                        </div>
                      ) : null}
                      <div className="review-action-list">
                        {group.items.map((action) => renderOpenRow(action))}
                      </div>
                    </CollapsibleSection>
                  );
                })}
              </div>
            ) : (
              <div className="review-clear-state">
                <CheckCircle2 size={22} aria-hidden="true" />
                <div>
                  <h3>Nothing unresolved</h3>
                  <p>You can still record a reflection and close the week.</p>
                </div>
              </div>
            )}
          </CollapsibleSection>

          <div className="review-reflection">
            <label htmlFor="weekly-reflection">What should you remember from this week?</label>
            <textarea
              id="weekly-reflection"
              value={reflection}
              onChange={(event) => setReflection(event.target.value)}
              placeholder="Wins, friction, lessons, and one adjustment for next week..."
              maxLength={50_000}
            />
          </div>
          <div className="review-commit">
            <div>
              <Flag size={15} aria-hidden="true" />
              <span>
                {priorityCount} of 5 priorities selected
                {data.actions.length ? ` · ${data.actions.length} staying open` : ''}
              </span>
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={completeReview}
              disabled={isPending || !decisionsValid || Boolean(notice)}
            >
              {isPending ? 'Completing...' : 'Complete weekly review'}
            </button>
          </div>
          {undecidedCount ? (
            <p className="review-validation" role="alert">
              <AlertCircle size={14} aria-hidden="true" /> {undecidedCount}{' '}
              {undecidedCount === 1 ? 'Action has' : 'Actions have'} been carried for three weeks or
              more and {undecidedCount === 1 ? 'needs' : 'need'} an answer before the week can
              close. Everything else can stay open.
            </p>
          ) : missingReason ? (
            <p className="review-validation" role="alert">
              <AlertCircle size={14} aria-hidden="true" /> Add a reason for each blocked or dropped
              Action.
            </p>
          ) : null}
        </section>

        <aside className="review-history" aria-labelledby="review-history-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Continuity</p>
              <h2 id="review-history-heading">Past reviews</h2>
            </div>
            <History size={17} aria-hidden="true" />
          </div>
          <div className="review-history-list">
            {data.recentReviews.map((review) => (
              <article key={review.id}>
                <time dateTime={review.completedAt}>
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }).format(new Date(review.completedAt))}
                </time>
                <strong>
                  {review.itemCount} actions · {review.priorityCount} priorities
                </strong>
                <p>{review.reflectionMarkdown || 'No reflection recorded.'}</p>
              </article>
            ))}
            {!data.recentReviews.length ? (
              <p className="review-history-empty">Your completed reviews will appear here.</p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
