'use client';

import Link from 'next/link';
import {
  CalendarDays,
  CircleCheckBig,
  Compass,
  ListTodo,
  Repeat2,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { periodRangeLabel, type HorizonFilter } from '@/lib/planner/horizon-labels';
import type { GoalsData } from '@/app/actions';

export type PlannerPeriodFilter = 'current' | 'all';

type HorizonOption = {
  id: HorizonFilter;
  label: string;
  count: number;
};

export function PlannerSummary({
  periodFilter,
  horizonFilter,
  currentPeriods,
  hiddenByPeriod,
  horizonOptions,
  yearlyCount,
  quarterlyCount,
  weeklyCount,
  activeGoalCount,
  openActionCount,
  completedCount,
  activeTemplateCount,
  driftHeadline,
  onPeriodChange,
  onHorizonChange,
}: {
  periodFilter: PlannerPeriodFilter;
  horizonFilter: HorizonFilter;
  currentPeriods: GoalsData['currentPeriods'];
  hiddenByPeriod: number;
  horizonOptions: HorizonOption[];
  yearlyCount: number;
  quarterlyCount: number;
  weeklyCount: number;
  activeGoalCount: number;
  openActionCount: number;
  completedCount: number;
  activeTemplateCount: number;
  driftHeadline: string | null;
  onPeriodChange: (period: PlannerPeriodFilter) => void;
  onHorizonChange: (horizon: HorizonFilter) => void;
}) {
  return (
    <>
      <div className="planner-period-bar">
        <div className="planner-period-choice" role="group" aria-label="Filter plan by period">
          <button
            type="button"
            aria-pressed={periodFilter === 'current'}
            className={periodFilter === 'current' ? 'planner-horizon-active' : undefined}
            onClick={() => onPeriodChange('current')}
          >
            This period
          </button>
          <button
            type="button"
            aria-pressed={periodFilter === 'all'}
            className={periodFilter === 'all' ? 'planner-horizon-active' : undefined}
            onClick={() => onPeriodChange('all')}
          >
            All time
          </button>
        </div>
        <p className="planner-period-range">
          {periodFilter === 'current'
            ? periodRangeLabel(horizonFilter, currentPeriods)
            : 'Every period on record'}
        </p>
      </div>

      {periodFilter === 'current' && hiddenByPeriod > 0 ? (
        <p className="planner-period-hidden">
          {hiddenByPeriod} {hiddenByPeriod === 1 ? 'item is' : 'items are'} outside this period.{' '}
          <button type="button" className="link-button" onClick={() => onPeriodChange('all')}>
            Show all time
          </button>
        </p>
      ) : null}

      <div className="planner-horizon-tabs" role="group" aria-label="Filter plan by horizon">
        {horizonOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={horizonFilter === option.id}
            className={horizonFilter === option.id ? 'planner-horizon-active' : undefined}
            onClick={() => onHorizonChange(option.id)}
          >
            <span>{option.label}</span>
            <small>{option.count}</small>
          </button>
        ))}
      </div>

      <nav className="planner-flow" aria-label="Planning flow">
        <Link href="/vision">
          <Compass size={16} aria-hidden="true" />
          <span>
            <strong>Vision</strong>
            <small>The direction</small>
          </span>
        </Link>
        <span className="planner-flow-connector" aria-hidden="true" />
        <a href="#plan-horizons">
          <Target size={16} aria-hidden="true" />
          <span>
            <strong>Horizons</strong>
            <small>{yearlyCount + quarterlyCount} active goals</small>
          </span>
        </a>
        <span className="planner-flow-connector" aria-hidden="true" />
        <Link href="/planner/calendar">
          <CalendarDays size={16} aria-hidden="true" />
          <span>
            <strong>Calendar</strong>
            <small>{weeklyCount} weekly actions</small>
          </span>
        </Link>
        <span className="planner-flow-connector" aria-hidden="true" />
        <Link href="/review">
          <CircleCheckBig size={16} aria-hidden="true" />
          <span>
            <strong>Review</strong>
            <small>Close the loop</small>
          </span>
        </Link>
      </nav>

      <section className="planner-overview" aria-label="Plan overview">
        <div>
          <Target size={17} aria-hidden="true" />
          <span>Active goals</span>
          <strong>{activeGoalCount}</strong>
        </div>
        <div>
          <ListTodo size={17} aria-hidden="true" />
          <span>Open actions</span>
          <strong>{openActionCount}</strong>
        </div>
        <div>
          <CircleCheckBig size={17} aria-hidden="true" />
          <span>Completed</span>
          <strong>{completedCount}</strong>
        </div>
        <div>
          <Repeat2 size={17} aria-hidden="true" />
          <span>Active routines</span>
          <strong>{activeTemplateCount}</strong>
        </div>
      </section>

      {driftHeadline ? (
        <aside className="drift-banner" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>{driftHeadline}</strong>
            <p>Nothing has been changed. Review each one and decide what it is worth.</p>
          </div>
        </aside>
      ) : null}
    </>
  );
}
