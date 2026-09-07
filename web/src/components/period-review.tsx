'use client';

import { useState, useTransition } from 'react';
import { CalendarRange, CheckCircle2, Flag, ListChecks, Target } from 'lucide-react';
import { completePeriodReview, type PeriodReviewData } from '@/app/review/actions';
import { CoachingCue } from '@/components/coaching-cue';
import { ReviewTabs } from '@/components/review-tabs';
import { ReviewAiProposal } from '@/components/review-ai-proposal';
import { periodReviewCoachingCue } from '@/lib/coaching';
import { actionFailureMessage } from '@/lib/operations/failure-message';

function formatPeriodDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`));
}

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'The review could not be completed.');
}

export function PeriodReview({ data }: { data: PeriodReviewData }) {
  const [reflection, setReflection] = useState(data.completedReview?.reflectionMarkdown ?? '');
  const [completed, setCompleted] = useState(data.completedReview);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const title = data.kind === 'month' ? 'Monthly Review' : 'Quarterly Review';

  function completeReview() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await completePeriodReview({
          kind: data.kind === 'month' ? 'monthly' : 'quarterly',
          startsOn: data.startsOn,
          endsOn: data.endsOn,
          reflectionMarkdown: reflection,
        });
        setCompleted({
          id: result.reviewId,
          reflectionMarkdown: reflection.trim(),
          completedAt: new Date().toISOString(),
        });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="page review-page">
      <ReviewTabs active={data.kind} />
      <header className="page-heading review-heading">
        <div>
          <p className="eyebrow">Direction check</p>
          <h1>{title}</h1>
          <p className="lede">Read the evidence, notice the pattern, and record the adjustment.</p>
        </div>
        <div className="review-range" aria-label="Review period">
          <CalendarRange size={17} aria-hidden="true" />
          <span>
            {formatPeriodDate(data.startsOn)} to {formatPeriodDate(data.endsOn)}
          </span>
        </div>
      </header>

      <CoachingCue
        cue={periodReviewCoachingCue(data.coachingIntensity, {
          planned: data.actionCounts.planned,
          completed: data.actionCounts.completed,
          blocked: data.actionCounts.blocked,
        })}
      />

      <ReviewAiProposal
        initial={data.aiProposal}
        kind={data.kind === 'month' ? 'monthly' : 'quarterly'}
        startsOn={data.startsOn}
        endsOn={data.endsOn}
        job={data.analysisJob}
      />

      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="period-review-layout">
        <main className="period-review-main">
          <section aria-labelledby="period-evidence-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Execution evidence</p>
                <h2 id="period-evidence-heading">Actions in this period</h2>
              </div>
              <ListChecks size={18} aria-hidden="true" />
            </div>
            <dl className="period-metrics">
              <div>
                <dt>Planned</dt>
                <dd>{data.actionCounts.planned}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{data.actionCounts.completed}</dd>
              </div>
              <div>
                <dt>Still active</dt>
                <dd>{data.actionCounts.active}</dd>
              </div>
              <div>
                <dt>Blocked</dt>
                <dd>{data.actionCounts.blocked}</dd>
              </div>
              <div>
                <dt>Dropped</dt>
                <dd>{data.actionCounts.dropped}</dd>
              </div>
              <div>
                <dt>Weekly reviews</dt>
                <dd>{data.weeklyReviewsCompleted}</dd>
              </div>
            </dl>
          </section>

          <section className="period-goals" aria-labelledby="period-goals-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Outcome evidence</p>
                <h2 id="period-goals-heading">Goal direction</h2>
              </div>
              <Target size={18} aria-hidden="true" />
            </div>
            {data.goals.length ? (
              <div className="period-goal-list">
                {data.goals.map((goal) => {
                  const progress =
                    goal.currentValue !== null && goal.targetValue
                      ? Math.min(100, Math.max(0, (goal.currentValue / goal.targetValue) * 100))
                      : null;
                  return (
                    <article key={goal.id}>
                      <div>
                        <strong>{goal.title}</strong>
                        <span>
                          {goal.status}
                          {goal.dueOn ? ` · due ${formatPeriodDate(goal.dueOn)}` : ''}
                        </span>
                      </div>
                      {progress === null ? (
                        <span className="period-goal-unmeasured">No measure</span>
                      ) : (
                        <div className="period-goal-progress">
                          <div aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <span>
                            {goal.currentValue} / {goal.targetValue} {goal.unit}
                          </span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="review-history-empty">No active Goal evidence is available yet.</p>
            )}
          </section>
        </main>

        <aside className="period-reflection" aria-labelledby="period-reflection-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Decision record</p>
              <h2 id="period-reflection-heading">Reflection</h2>
            </div>
            {completed ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : (
              <Flag size={18} aria-hidden="true" />
            )}
          </div>
          {completed ? (
            <div className="period-reflection-complete">
              <p>{completed.reflectionMarkdown}</p>
              <time dateTime={completed.completedAt}>
                Completed{' '}
                {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                  new Date(completed.completedAt)
                )}
              </time>
            </div>
          ) : (
            <>
              <label htmlFor="period-reflection">
                What changed, what mattered, and what will you adjust next?
              </label>
              <textarea
                id="period-reflection"
                value={reflection}
                onChange={(event) => setReflection(event.target.value)}
                maxLength={50_000}
                placeholder="Write the pattern you want your future self to remember..."
              />
              <button
                className="btn-primary"
                type="button"
                disabled={isPending || !reflection.trim()}
                onClick={completeReview}
              >
                {isPending ? 'Completing...' : `Complete ${data.kind} review`}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
