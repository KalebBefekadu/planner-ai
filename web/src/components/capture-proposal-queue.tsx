'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  applyCaptureProposalBatchAction,
  dismissCaptureProposalBatchAction,
  updateCaptureProposalItemAction,
  type CaptureProposalBatchView,
  type CaptureProposalItemView,
  type CaptureAnalysisJobView,
} from '@/app/inbox/actions';
import type { CaptureView } from '@/app/actions';
import { AsyncStatus } from '@/components/async-status';
import {
  changeKind,
  distinctObjects,
  highestRisk,
  operationLabel,
  proposedFields,
  RISK_DETAIL,
} from '@/lib/proposal-anatomy';

function ProposalItem({ item }: { item: CaptureProposalItemView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(item.summary);
  const [input, setInput] = useState<Record<string, unknown>>(item.input);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: unknown) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCaptureProposalItemAction({
        id: item.id,
        batchId: item.batchId,
        expectedVersion: item.version,
        operationInput: input,
        summary,
      });
      if (!result.ok) {
        setError(result.error ?? 'The change could not be saved.');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <article className="capture-proposal-item">
      <div className="capture-proposal-item-heading">
        <div>
          <span className={`proposal-kind proposal-kind-${changeKind(item.operationId)}`}>
            {changeKind(item.operationId)}
          </span>
          <span>{operationLabel(item.operationId)}</span>
          <span>{item.risk} risk</span>
        </div>
        <button
          className="icon-button"
          type="button"
          title={editing ? 'Cancel edit' : 'Edit proposed change'}
          aria-label={editing ? 'Cancel edit' : 'Edit proposed change'}
          disabled={pending}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? <X size={15} /> : <Pencil size={15} />}
        </button>
      </div>
      {editing ? (
        <div className="capture-proposal-editor">
          <label>
            Effect
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={300}
            />
          </label>
          {'title' in input ? (
            <label>
              Title
              <input
                value={String(input.title ?? '')}
                onChange={(event) => setField('title', event.target.value)}
                maxLength={1_000}
              />
            </label>
          ) : null}
          {'bodyMarkdown' in input ? (
            <label>
              Note
              <textarea
                value={String(input.bodyMarkdown ?? '')}
                onChange={(event) => setField('bodyMarkdown', event.target.value)}
                rows={5}
              />
            </label>
          ) : null}
          {'horizonKind' in input ? (
            <label>
              Planning period
              <select
                value={String(input.horizonKind)}
                onChange={(event) => setField('horizonKind', event.target.value)}
              >
                <option value="month">Month</option>
                <option value="week">Week</option>
              </select>
            </label>
          ) : null}
          {['startsOn', 'endsOn', 'scheduledOn'].map((field) =>
            field in input ? (
              <label key={field}>
                {field === 'startsOn' ? 'Starts' : field === 'endsOn' ? 'Ends' : 'Scheduled'}
                <input
                  type="date"
                  value={String(input[field] ?? '')}
                  onChange={(event) => setField(field, event.target.value || null)}
                />
              </label>
            ) : null
          )}
          {Array.isArray(input.tags) ? (
            <label>
              Tags
              <input
                value={input.tags.join(', ')}
                onChange={(event) =>
                  setField(
                    'tags',
                    event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                  )
                }
              />
            </label>
          ) : null}
          <button
            className="btn-primary button-with-icon"
            type="button"
            onClick={save}
            disabled={pending || !summary.trim()}
          >
            <Check size={15} /> Save edit
          </button>
        </div>
      ) : (
        <>
          <p>{item.summary}</p>
          {proposedFields(item.input).length ? (
            <dl className="proposal-fields">
              {proposedFields(item.input).map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      )}
      {error ? <p className="status-message status-message-error">{error}</p> : null}
    </article>
  );
}

function CaptureProposalBatch({
  batch,
  capture,
}: {
  batch: CaptureProposalBatchView;
  capture?: CaptureView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmingExpensive, setConfirmingExpensive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const risk = highestRisk(batch.items);
  const objectCount = distinctObjects(batch.items);

  function decide(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'The Proposal could not be updated.');
        return;
      }
      router.refresh();
    });
  }

  async function reprocess() {
    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/capture-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          captureId: batch.captureId,
          ...(confirmingExpensive ? { confirmExpensive: true } : {}),
        }),
      });
      const data = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === 'expensive_analysis_confirmation_required') {
          setConfirmingExpensive(true);
        }
        setError(data.error ?? 'Planner AI could not reprocess this Capture.');
        return;
      }
      setConfirmingExpensive(false);
      router.refresh();
    });
  }

  return (
    <article className="capture-proposal-batch">
      <header>
        <div>
          <p className="eyebrow">Review proposal</p>
          <h3>{batch.summary}</h3>
        </div>
        <span className={`proposal-risk proposal-risk-${risk}`}>{risk} risk</span>
      </header>
      <p className="proposal-scope">
        <strong>{batch.items.length}</strong> {batch.items.length === 1 ? 'change' : 'changes'} to{' '}
        <strong>{objectCount}</strong> {objectCount === 1 ? 'object' : 'objects'} ·{' '}
        {RISK_DETAIL[risk]}
      </p>
      {capture ? <blockquote>{capture.raw_text}</blockquote> : null}
      {batch.insights.length ? (
        <div className="capture-proposal-insights">
          {batch.insights.map((insight, index) => (
            <p key={`${insight.kind}-${index}`}>
              <strong>{insight.kind}</strong> {insight.text}
            </p>
          ))}
        </div>
      ) : null}
      <div className="capture-proposal-items">
        {batch.items.map((item) => (
          <ProposalItem item={item} key={item.id} />
        ))}
        {!batch.items.length ? <p>No record changes were inferred from this Capture.</p> : null}
      </div>
      <AsyncStatus
        message={
          pending
            ? `Applying ${batch.items.length} changes. This takes a moment.`
            : confirming
              ? `Ready to apply ${batch.items.length} changes to ${objectCount} ${objectCount === 1 ? 'object' : 'objects'}. Each one can be undone from Activity afterwards.`
              : ''
        }
      />
      <footer>
        <span>
          {batch.modelId} · {batch.promptVersion}
        </span>
        <div>
          <button
            className="btn-secondary button-with-icon"
            type="button"
            disabled={pending}
            onClick={() => void reprocess()}
          >
            <RefreshCw size={15} />
            {confirmingExpensive ? 'Confirm reprocess' : 'Reprocess'}
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={pending}
            onClick={() => decide(() => dismissCaptureProposalBatchAction(batch.id, batch.version))}
          >
            Dismiss
          </button>
          {confirming ? (
            <button
              className="btn-primary button-with-icon"
              type="button"
              disabled={pending}
              onClick={() => decide(() => applyCaptureProposalBatchAction(batch.id, batch.version))}
            >
              <Check size={15} />
              {batch.items.length ? `Apply ${batch.items.length} changes` : 'Mark reviewed'}
            </button>
          ) : (
            <button
              className="btn-primary"
              type="button"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              Review and apply
            </button>
          )}
        </div>
      </footer>
      {error ? <p className="status-message status-message-error">{error}</p> : null}
    </article>
  );
}

export function CaptureProposalQueue({
  batches,
  captures,
}: {
  batches: CaptureProposalBatchView[];
  captures: CaptureView[];
}) {
  if (!batches.length) return null;
  return (
    <section className="capture-proposal-queue" aria-label="Capture Proposal review queue">
      <div className="capture-proposal-queue-heading">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <p className="eyebrow">Planner AI</p>
          <h2>Ready for review</h2>
        </div>
      </div>
      {batches.map((batch) => (
        <CaptureProposalBatch
          batch={batch}
          capture={captures.find((capture) => capture.id === batch.captureId)}
          key={batch.id}
        />
      ))}
    </section>
  );
}

export function AnalyzeCaptureButton({
  captureId,
  job,
}: {
  captureId: string;
  job?: CaptureAnalysisJobView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingExpensive, setConfirmingExpensive] = useState(false);
  function analyze() {
    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/capture-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          captureId,
          ...(confirmingExpensive ? { confirmExpensive: true } : {}),
        }),
      });
      const data = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === 'expensive_analysis_confirmation_required') {
          setConfirmingExpensive(true);
        }
        setError(data.error ?? 'Planner AI could not analyze this Capture.');
        return;
      }
      setConfirmingExpensive(false);
      router.refresh();
    });
  }
  return (
    <div className="capture-analyze-action">
      <button
        className="btn-secondary button-with-icon"
        type="button"
        onClick={analyze}
        disabled={pending || job?.status === 'running'}
      >
        <Sparkles size={14} />
        {pending || job?.status === 'running'
          ? 'Analyzing...'
          : confirmingExpensive
            ? 'Confirm organize'
            : job?.status === 'failed'
              ? 'Retry organize'
              : job?.status === 'succeeded'
                ? 'Reprocess'
                : 'Organize'}
      </button>
      {job?.status === 'failed' && !error ? <span>Analysis did not finish.</span> : null}
      {job?.status === 'succeeded' && !error ? <span>Proposal ready.</span> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
