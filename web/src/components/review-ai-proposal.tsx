'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, RefreshCw, Sparkles } from 'lucide-react';
import type { ReviewAiProposalView, ReviewAnalysisJobView } from '@/app/review/actions';

type ProposalResponse = {
  proposalId?: string;
  proposal?: ReviewAiProposalView['proposal'];
  modelId?: string;
  promptVersion?: string;
  error?: string;
};

export function ReviewAiProposal({
  initial,
  kind,
  startsOn,
  endsOn,
  onUsePriorities,
  job,
}: {
  initial: ReviewAiProposalView | null;
  kind: 'weekly' | 'monthly' | 'quarterly';
  startsOn: string;
  endsOn: string;
  onUsePriorities?: (ids: string[]) => void;
  job: ReviewAnalysisJobView | null;
}) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const persistedRunning = job?.status === 'running' && !view;

  function generate() {
    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/review-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, startsOn, endsOn }),
      });
      const data = (await response.json()) as ProposalResponse;
      if (!response.ok || !data.proposal || !data.proposalId) {
        setError(data.error ?? 'Planner AI could not prepare this Review proposal.');
        return;
      }
      setView({
        id: data.proposalId,
        proposal: data.proposal,
        modelId: data.modelId ?? 'unknown',
        promptVersion: data.promptVersion ?? 'unknown',
        createdAt: new Date().toISOString(),
      });
    });
  }

  return (
    <section className="review-ai-proposal" aria-labelledby="review-ai-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Advisory proposal</p>
          <h2 id="review-ai-heading">Planner AI perspective</h2>
        </div>
        <button
          className="btn-secondary button-with-icon"
          type="button"
          onClick={generate}
          disabled={pending || persistedRunning}
        >
          {view ? <RefreshCw size={15} /> : <Sparkles size={15} />}
          {pending || persistedRunning
            ? 'Analyzing...'
            : view
              ? 'Reprocess'
              : job?.status === 'failed'
                ? 'Retry'
                : 'Generate'}
        </button>
      </div>
      {error ? (
        <p className="status-message status-message-error" role="alert">
          {error}
        </p>
      ) : null}
      {!error && job?.status === 'failed' && !view ? (
        <p className="status-message status-message-error" role="alert">
          Review analysis did not finish. Your Review data is unchanged.
        </p>
      ) : null}
      {view ? (
        <div className="review-ai-content">
          <p>{view.proposal.summary}</p>
          {view.proposal.recommendations.map((recommendation, index) => (
            <article key={`${recommendation.status}-${index}`}>
              <span>{recommendation.status.replace('_', ' ')}</span>
              <p>{recommendation.text}</p>
              {recommendation.evidence.length ? (
                <div>
                  {recommendation.evidence.map((source) => (
                    <Link href={source.href} key={`${source.type}-${source.id}`}>
                      {source.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          <div className="review-ai-prompts">
            <strong>Reflection prompts</strong>
            {view.proposal.reflectionPrompts.map((prompt) => (
              <p key={prompt}>{prompt}</p>
            ))}
          </div>
          {onUsePriorities && view.proposal.priorityActionIds.length ? (
            <button
              className="btn-secondary button-with-icon"
              type="button"
              onClick={() => onUsePriorities(view.proposal.priorityActionIds)}
            >
              <Check size={15} /> Use suggested priorities
            </button>
          ) : null}
          <small>
            {view.modelId} · {view.promptVersion}
          </small>
        </div>
      ) : (
        <p className="review-history-empty">
          Generate a bounded perspective from this period&apos;s Actions, Goals, and completed
          Reviews.
        </p>
      )}
    </section>
  );
}
