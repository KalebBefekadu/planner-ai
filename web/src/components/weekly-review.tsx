'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertCircle, CalendarRange, CheckCircle2, Flag, History } from 'lucide-react';
import {
  completeWeeklyReview,
  type WeeklyReviewData,
  type WeeklyReviewDecision,
} from '@/app/review/actions';
import { CoachingCue } from '@/components/coaching-cue';
import { ReviewTabs } from '@/components/review-tabs';
import { ReviewAiProposal } from '@/components/review-ai-proposal';
import { weeklyReviewCoachingCue } from '@/lib/coaching';

type Resolution = WeeklyReviewDecision['resolution'];

const resolutionLabels: Record<Resolution, string> = {
  done: 'Completed',
  next_week: 'Move to next week',
  blocked: 'Blocked',
  dropped: 'Drop intentionally',
  left_overdue: 'Leave overdue',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Weekly Review could not be completed.';
}

export function WeeklyReview({ data }: { data: WeeklyReviewData }) {
  const [isPending, startTransition] = useTransition();
  const [reflection, setReflection] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, WeeklyReviewDecision>>(() =>
    Object.fromEntries(
      data.actions.map((action) => [
        action.id,
        {
          actionId: action.id,
          expectedVersion: action.version,
          resolution: 'left_overdue' as const,
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

  function updateDecision(actionId: string, change: Partial<WeeklyReviewDecision>) {
    setDecisions((current) => ({
      ...current,
      [actionId]: { ...current[actionId], ...change },
    }));
  }

  const decisionsValid = Object.values(decisions).every(
    (decision) =>
      !['blocked', 'dropped'].includes(decision.resolution) || Boolean(decision.reason?.trim())
  );

  function completeReview() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await completeWeeklyReview({
          startsOn: data.startsOn,
          endsOn: data.endsOn,
          reflectionMarkdown: reflection,
          decisions: Object.values(decisions),
        });
        setNotice(
          `Review completed. ${result.resolvedCount} actions resolved and ${result.priorityCount} priorities committed.`
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="page review-page">
      <ReviewTabs active="week" />
      <header className="page-heading review-heading">
        <div>
          <p className="eyebrow">Weekly reset</p>
          <h1>Review</h1>
          <p className="lede">
            Resolve what happened this week before deciding what carries forward.
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
        <p className="status-message" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="review-layout">
        <section className="review-workspace" aria-labelledby="unfinished-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">No silent rollover</p>
              <h2 id="unfinished-heading">Unfinished actions</h2>
            </div>
            <span className="review-count">{data.actions.length}</span>
          </div>

          {data.actions.length ? (
            <div className="review-action-list">
              {data.actions.map((action) => {
                const decision = decisions[action.id];
                const canPrioritize = !['done', 'dropped'].includes(decision.resolution);
                return (
                  <article className="review-action-row" key={action.id}>
                    <div className="review-action-copy">
                      <strong>{action.title}</strong>
                      <span>
                        {action.goalTitle ?? 'Unlinked action'} · {action.status.replace('_', ' ')}
                      </span>
                    </div>
                    <select
                      value={decision.resolution}
                      aria-label={`Decision for ${action.title}`}
                      onChange={(event) => {
                        const resolution = event.target.value as Resolution;
                        updateDecision(action.id, {
                          resolution,
                          priority: ['done', 'dropped'].includes(resolution)
                            ? false
                            : decision.priority,
                        });
                      }}
                    >
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
                        onChange={(event) =>
                          updateDecision(action.id, { reason: event.target.value || null })
                        }
                        placeholder={
                          decision.resolution === 'blocked'
                            ? 'What is blocking it?'
                            : 'Why drop it?'
                        }
                        aria-label={`Reason for ${action.title}`}
                        maxLength={500}
                      />
                    ) : null}
                    <label
                      className={`review-priority${canPrioritize ? '' : ' review-priority-disabled'}`}
                    >
                      <input
                        type="checkbox"
                        checked={decision.priority}
                        disabled={!canPrioritize || (!decision.priority && priorityCount >= 5)}
                        onChange={(event) =>
                          updateDecision(action.id, { priority: event.target.checked })
                        }
                      />
                      <Flag size={14} aria-hidden="true" />
                      Priority
                    </label>
                  </article>
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
              <span>{priorityCount} of 5 priorities selected</span>
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
          {!decisionsValid ? (
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
