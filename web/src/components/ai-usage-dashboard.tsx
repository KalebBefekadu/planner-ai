'use client';

import { useState, useTransition } from 'react';
import { Activity, CircleDollarSign, Gauge, TimerReset } from 'lucide-react';
import { updateAiBudget } from '@/app/settings/ai/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { MeasuredFill } from '@/components/measured-fill';

export type AiUsageDashboardData = {
  softBudgetCents: number;
  hardCapCents: number;
  monthStartedAt: string;
  requests: number;
  succeeded: number;
  estimatedCostMicros: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  operations: Array<{
    operation: string;
    requests: number;
    failures: number;
    averageLatencyMs: number;
    estimatedCostMicros: number;
  }>;
  days: Array<{ date: string; requests: number; estimatedCostMicros: number }>;
};

const operationLabels: Record<string, string> = {
  assistant: 'Assistant',
  smart_goal: 'Goal analysis',
  capture_analysis: 'Capture analysis',
  review_analysis: 'Review analysis',
  socratic: 'Vision questions',
  transcribe: 'Voice transcription',
};

function dollars(micros: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: micros < 10_000 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(micros / 1_000_000);
}

function errorMessage(error: unknown) {
  return actionFailureMessage(error, 'The AI budget could not be saved.');
}

export function AiUsageDashboard({ initial }: { initial: AiUsageDashboardData }) {
  const [budget, setBudget] = useState(initial.softBudgetCents);
  const [savedBudget, setSavedBudget] = useState(initial.softBudgetCents);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const spentCents = initial.estimatedCostMicros / 10_000;
  const budgetPercent = Math.min(100, (spentCents / savedBudget) * 100);
  const successRate = initial.requests ? (initial.succeeded / initial.requests) * 100 : 100;
  const maxDailyRequests = Math.max(1, ...initial.days.map((day) => day.requests));

  function saveBudget() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await updateAiBudget(budget);
        setSavedBudget(result.softBudgetCents);
        setNotice('AI soft budget updated.');
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="ai-usage-dashboard">
      {notice ? <p className="status-message">{notice}</p> : null}
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}

      <dl className="ai-usage-metrics">
        <div>
          <dt>
            <CircleDollarSign size={15} /> Estimated spend
          </dt>
          <dd>
            {dollars(initial.estimatedCostMicros)}
            <span>Since {new Date(initial.monthStartedAt).toLocaleDateString()}</span>
          </dd>
        </div>
        <div>
          <dt>
            <Activity size={15} /> Requests
          </dt>
          <dd>
            {initial.requests}
            <span>{successRate.toFixed(1)}% completed</span>
          </dd>
        </div>
        <div>
          <dt>
            <Gauge size={15} /> Text tokens
          </dt>
          <dd>
            {(initial.inputTokens + initial.outputTokens).toLocaleString()}
            <span>{initial.audioSeconds.toFixed(1)} audio seconds</span>
          </dd>
        </div>
      </dl>

      <section className="ai-budget-section" aria-labelledby="ai-budget-heading">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">Monthly guardrail</p>
            <h2 id="ai-budget-heading">Soft budget</h2>
            <p>
              Planner AI warns at this threshold. The fixed platform cap is $
              {(initial.hardCapCents / 100).toFixed(2)}.
            </p>
          </div>
          <strong>${(savedBudget / 100).toFixed(2)}</strong>
        </div>
        <div
          className="ai-budget-progress"
          role="progressbar"
          aria-labelledby="ai-budget-heading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(budgetPercent)}
          aria-valuetext={`${budgetPercent.toFixed(1)}% of soft budget used`}
        >
          <MeasuredFill declarations={{ width: `${budgetPercent}%` }} />
        </div>
        {spentCents >= savedBudget ? (
          <p className="status-message" role="status">
            Soft budget reached. AI remains available until the fixed platform cap.
          </p>
        ) : null}
        <div className="ai-budget-control">
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
            aria-label="Monthly AI soft budget"
          />
          <output>${(budget / 100).toFixed(2)}</output>
          <button
            className="btn-secondary"
            type="button"
            onClick={saveBudget}
            disabled={isPending || budget === savedBudget}
          >
            {isPending ? 'Saving...' : 'Save budget'}
          </button>
        </div>
      </section>

      <section className="ai-usage-trend" aria-labelledby="ai-trend-heading">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">Last 14 days</p>
            <h2 id="ai-trend-heading">Request volume</h2>
          </div>
          <TimerReset size={18} />
        </div>
        <div className="ai-trend-bars">
          {initial.days.map((day) => (
            <div
              key={day.date}
              title={`${day.requests} requests, ${dollars(day.estimatedCostMicros)}`}
            >
              <MeasuredFill
                declarations={{
                  height: `${Math.max(3, (day.requests / maxDailyRequests) * 100)}%`,
                }}
              />
              <time dateTime={day.date}>{Number(day.date.slice(8))}</time>
            </div>
          ))}
        </div>
      </section>

      <section className="ai-operation-usage" aria-labelledby="ai-operation-heading">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">By capability</p>
            <h2 id="ai-operation-heading">Provider activity</h2>
          </div>
        </div>
        {/* Narrow viewports scroll this table sideways. Without a tab stop
            the only way to reach the right-hand columns is a pointer, so a
            keyboard user simply cannot read them. */}
        <div
          className="ai-operation-table"
          role="table"
          aria-label="AI usage by capability"
          tabIndex={0}
        >
          <div role="row" className="ai-operation-table-heading">
            <span role="columnheader">Capability</span>
            <span role="columnheader">Requests</span>
            <span role="columnheader">Failures</span>
            <span role="columnheader">Average</span>
            <span role="columnheader">Estimate</span>
          </div>
          {initial.operations.map((operation) => (
            <div role="row" key={operation.operation}>
              <strong role="cell">{operationLabels[operation.operation]}</strong>
              <span role="cell">{operation.requests}</span>
              <span role="cell">{operation.failures}</span>
              <span role="cell">{operation.averageLatencyMs} ms</span>
              <span role="cell">{dollars(operation.estimatedCostMicros)}</span>
            </div>
          ))}
        </div>
        <p className="ai-usage-disclosure">
          Estimates use the model price version recorded when each request ran. Usage records
          contain operational metadata only and expire after 90 days.
        </p>
      </section>
    </div>
  );
}
