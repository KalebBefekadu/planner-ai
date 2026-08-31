'use client';

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDashed,
  Pencil,
  Plus,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import styles from './preview.module.css';

/* "Goals & horizons" and "Vision" used to render the Today plan with a
   different heading, so a vision screen showed an 8:00 AM calendar row. These
   are the surfaces those two navigation entries actually promise: one shows
   the cascade between horizons, the other shows the durable statement
   everything hangs off. */

type Horizon = { id: string; label: string; window: string };

const horizons: Horizon[] = [
  { id: 'year', label: 'This year', window: '2026' },
  { id: 'quarter', label: 'This quarter', window: 'Jul – Sep' },
  { id: 'month', label: 'This month', window: 'August' },
];

type Goal = {
  title: string;
  horizon: string;
  area: string;
  progress: number;
  measure: string;
  status: 'on-track' | 'at-risk' | 'not-started';
  children: string[];
  drift?: string;
};

const goals: Goal[] = [
  {
    title: 'Build Planner AI into a trusted daily workspace',
    horizon: 'This year',
    area: 'Craft',
    progress: 68,
    measure: '20 people using it weekly by December',
    status: 'on-track',
    children: ['Ship the private beta', 'Prove local-first sync', 'Write the product story'],
  },
  {
    title: 'Ship the private beta',
    horizon: 'This quarter',
    area: 'Craft',
    progress: 68,
    measure: '10 invited users, no blocking bugs for two weeks',
    status: 'on-track',
    children: ['Finalize the product story', 'Build frontend prototype'],
  },
  {
    title: 'Rebuild a body that holds up under load',
    horizon: 'This quarter',
    area: 'Health',
    progress: 42,
    measure: 'Train four times a week through September',
    status: 'at-risk',
    children: ['Complete morning training'],
    drift: 'Trained twice in each of the last two weeks. The measure says four.',
  },
  {
    title: 'Put the finances on a monthly rhythm',
    horizon: 'This month',
    area: 'Money',
    progress: 20,
    measure: 'Close every month within three days of month end',
    status: 'not-started',
    children: [],
    drift: 'No action is scheduled and the month ends in six days.',
  },
];

const STATUS: Record<Goal['status'], { label: string; className: string }> = {
  'on-track': { label: 'On track', className: 'alignOnTrack' },
  'at-risk': { label: 'At risk', className: 'alignAtRisk' },
  'not-started': { label: 'Not started', className: 'alignNotStarted' },
};

export function GoalsHorizonsView({
  onOpenPlan,
  onAskAi,
}: {
  onOpenPlan: () => void;
  onAskAi: () => void;
}) {
  const drifting = goals.filter((goal) => goal.drift);

  return (
    <div className={styles.alignView}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>Align</p>
          <h1>Goals &amp; horizons</h1>
          <p>See whether this week actually serves the year, before planning another one.</p>
        </div>
        <div className={styles.alignHeaderActions}>
          <button className={styles.quietButton} type="button" onClick={onAskAi}>
            <Sparkles size={15} aria-hidden="true" /> Check for drift
          </button>
          <button className={styles.primaryButton} type="button">
            <Plus size={15} aria-hidden="true" /> Add goal
          </button>
        </div>
      </header>

      {drifting.length > 0 ? (
        <aside className={styles.driftBanner} role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>
              {drifting.length} {drifting.length === 1 ? 'goal has' : 'goals have'} drifted from
              their measure
            </strong>
            <p>Nothing has been changed. Review each one and decide what it is worth.</p>
          </div>
          <button className={styles.quietButton} type="button" onClick={onAskAi}>
            Review with AI
          </button>
        </aside>
      ) : null}

      <nav className={styles.horizonLegend} aria-label="Horizons in view">
        {horizons.map((horizon) => (
          <span key={horizon.id}>
            <strong>{horizon.label}</strong>
            <small>{horizon.window}</small>
          </span>
        ))}
      </nav>

      <ol className={styles.goalCascade}>
        {goals.map((goal) => (
          <li key={goal.title} data-status={goal.status}>
            <article className={styles.goalCard}>
              <header>
                <span className={styles.goalHorizon}>{goal.horizon}</span>
                <span className={`${styles.goalStatus} ${styles[STATUS[goal.status].className]}`}>
                  {goal.status === 'on-track' ? (
                    <Check size={12} aria-hidden="true" />
                  ) : goal.status === 'at-risk' ? (
                    <TriangleAlert size={12} aria-hidden="true" />
                  ) : (
                    <CircleDashed size={12} aria-hidden="true" />
                  )}
                  {STATUS[goal.status].label}
                </span>
                <span className={styles.goalArea}>{goal.area}</span>
              </header>

              <h2>{goal.title}</h2>
              <p className={styles.goalMeasure}>
                <Target size={13} aria-hidden="true" /> {goal.measure}
              </p>

              <div
                className={styles.goalProgress}
                role="meter"
                aria-valuenow={goal.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${goal.title} progress`}
              >
                <i style={{ inlineSize: `${goal.progress}%` }} />
              </div>
              <p className={styles.goalProgressLabel}>{goal.progress}% of the measure</p>

              {goal.drift ? (
                <p className={styles.goalDrift}>
                  <TriangleAlert size={13} aria-hidden="true" /> {goal.drift}
                </p>
              ) : null}

              {goal.children.length > 0 ? (
                <ul className={styles.goalChildren}>
                  {goal.children.map((child) => (
                    <li key={child}>
                      <ChevronRight size={13} aria-hidden="true" />
                      <button type="button" onClick={onOpenPlan}>
                        {child}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.goalEmptyChildren}>
                  Nothing below this goal yet.{' '}
                  <button type="button" onClick={onOpenPlan}>
                    Add the first action
                  </button>
                </p>
              )}
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

const principles = [
  {
    title: 'Build with calm urgency',
    body: 'Move deliberately. Keep momentum. Protect quality over speed.',
    supports: 2,
  },
  {
    title: 'Protect energy before optimizing output',
    body: 'Health is the input, not the reward for finishing.',
    supports: 1,
  },
  {
    title: 'Own the material',
    body: 'Anything worth keeping should be readable without this app.',
    supports: 3,
  },
];

export function VisionView({
  onOpenGoals,
  onAskAi,
}: {
  onOpenGoals: () => void;
  onAskAi: () => void;
}) {
  return (
    <div className={styles.visionView}>
      <header className={styles.visionHeader}>
        <p className={styles.overline}>Vision</p>
        <blockquote className={styles.visionStatement}>
          Build a life where focused work, faith, health, and meaningful relationships reinforce
          each other instead of competing for whatever attention is left.
        </blockquote>
        <p className={styles.visionMeta}>
          Written 14 March 2026 · Reviewed every quarter · Next review 30 September
        </p>
        <div className={styles.visionActions}>
          <button className={styles.quietButton} type="button">
            <Pencil size={15} aria-hidden="true" /> Edit vision
          </button>
          <button className={styles.quietButton} type="button" onClick={onAskAi}>
            <Sparkles size={15} aria-hidden="true" /> Read it back to me
          </button>
        </div>
      </header>

      <section className={styles.visionSection}>
        <h2>Principles</h2>
        <p className={styles.visionLede}>
          The rules you decided on in a calm moment, so you do not have to relitigate them in a busy
          one.
        </p>
        <ul className={styles.principleList}>
          {principles.map((principle) => (
            <li key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
              <small>
                Supports {principle.supports} active {principle.supports === 1 ? 'goal' : 'goals'}
              </small>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.visionSection}>
        <h2>What this vision is currently producing</h2>
        <p className={styles.visionLede}>
          Every goal below claims to serve the statement above. Where it does not, the link is worth
          questioning.
        </p>
        <ul className={styles.visionGoals}>
          {goals.slice(0, 3).map((goal) => (
            <li key={goal.title}>
              <button type="button" onClick={onOpenGoals}>
                <span className={`${styles.goalStatus} ${styles[STATUS[goal.status].className]}`}>
                  {STATUS[goal.status].label}
                </span>
                <strong>{goal.title}</strong>
                <small>{goal.horizon}</small>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
