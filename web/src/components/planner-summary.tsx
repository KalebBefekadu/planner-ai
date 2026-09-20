'use client';

import { CircleCheckBig, ListTodo, Repeat2, Target, TriangleAlert } from 'lucide-react';
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
  activeGoalCount: number;
  openActionCount: number;
  completedCount: number;
  activeTemplateCount: number;
  driftHeadline: string | null;
  onPeriodChange: (period: PlannerPeriodFilter) => void;
  onHorizonChange: (horizon: HorizonFilter) => void;
}) {
  const tiles = [
    { label: 'Active goals', count: activeGoalCount, Icon: Target },
    { label: 'Open actions', count: openActionCount, Icon: ListTodo },
    { label: 'Completed', count: completedCount, Icon: CircleCheckBig, always: true },
    { label: 'Active routines', count: activeTemplateCount, Icon: Repeat2 },
  ].filter((tile) => tile.count > 0 || (tile.always && activeGoalCount + openActionCount > 0));

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
        {/* The dates moved into the page heading, where the name of the slice
            and the dates it covers are read together. Saying them twice, six
            centimetres apart, made the second one look like a different
            answer. */}
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

      {/* The flow strip that stood here linked to Vision, Calendar and Review --
         all three of which are in the Planner sidebar, two clicks apart from
         themselves -- plus an anchor to the list further down this same page.
         Four destinations, none of them new, above the work. */}
      {/* A counter reading zero is not information; four of them are a
          dashboard telling a new account how little it holds. Each tile
          appears once it has something to count, and the row disappears
          entirely until one does -- which is also what puts the actual plan
          above the fold on a phone. Completed keeps its zero, because a
          completed count is read against the work beside it and "none yet" is
          the answer someone is looking for. */}
      {tiles.length ? (
        <section className="planner-overview" aria-label="Plan overview">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <tile.Icon size={17} aria-hidden="true" />
              <span>{tile.label}</span>
              <strong>{tile.count}</strong>
            </div>
          ))}
        </section>
      ) : null}

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
