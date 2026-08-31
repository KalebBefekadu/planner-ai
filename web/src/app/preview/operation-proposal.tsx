'use client';

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Info,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import styles from './preview.module.css';

/* The Operation proposal, built to the anatomy in
   planner_ai_next_ui_ux_direction.md 18.1:

     user goal - context chips - exact object count - grouped before/after diff
     - evidence vs inference labels - risk level - estimated cost
     - Approve / Adjust / Cancel - progress ledger - receipt plus Undo

   This is the surface that makes "nothing changes without a clear preview"
   true rather than a claim, so every part of the list is present and none of
   it is decorative. */

type Stage = 'proposal' | 'running' | 'receipt' | 'cancelled';

type Risk = 'low' | 'medium' | 'high';

type ChangeKind = 'create' | 'update' | 'move';

type Change = {
  kind: ChangeKind;
  object: string;
  field?: string;
  before?: string;
  after: string;
  basis: 'evidence' | 'inference';
  why: string;
};

const RISK_COPY: Record<Risk, { label: string; detail: string }> = {
  low: { label: 'Low risk', detail: 'Reversible for 30 days. Nothing is deleted.' },
  medium: { label: 'Medium risk', detail: 'Changes dated commitments. Reversible for 30 days.' },
  high: { label: 'High risk', detail: 'Removes or reassigns work. Review each row.' },
};

const KIND_COPY: Record<ChangeKind, { label: string; icon: React.ReactNode }> = {
  create: { label: 'Create', icon: <Plus size={13} aria-hidden="true" /> },
  update: { label: 'Update', icon: <ArrowRight size={13} aria-hidden="true" /> },
  move: { label: 'Move', icon: <ChevronRight size={13} aria-hidden="true" /> },
};

const proposedChanges: Change[] = [
  {
    kind: 'update',
    object: 'Renew passport',
    field: 'Due date',
    before: 'No date',
    after: 'Fri 5 September',
    basis: 'evidence',
    why: 'Your note of 22 Aug says “passport expires in October”.',
  },
  {
    kind: 'update',
    object: 'Review August finances',
    field: 'Due date',
    before: 'No date',
    after: 'Sun 31 August',
    basis: 'evidence',
    why: 'Monthly review is scheduled for the last day of each month.',
  },
  {
    kind: 'move',
    object: 'Research local-first sync',
    field: 'Project',
    before: 'Action inbox',
    after: 'Planner AI private beta',
    basis: 'inference',
    why: 'Wording overlaps the beta goal. No explicit link exists yet.',
  },
  {
    kind: 'create',
    object: 'Book passport appointment',
    field: 'New action',
    after: 'Due Wed 3 September · Personal',
    basis: 'inference',
    why: 'Renewal usually needs an appointment first. Added as a prerequisite.',
  },
];

const ledgerSteps = [
  'Reading 4 selected objects',
  'Checking permissions and validation',
  'Writing 4 changes',
  'Recording an undo point',
];

export function OperationProposal({
  goal = 'Give every unplanned action a date',
  scope = ['Action inbox', '4 selected'],
  risk = 'medium',
  onDone,
}: {
  goal?: string;
  scope?: string[];
  risk?: Risk;
  onDone?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('proposal');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [undone, setUndone] = useState(false);

  const included = proposedChanges.filter((change) => !excluded.includes(change.object));
  const inferred = included.filter((change) => change.basis === 'inference').length;

  const toggle = (object: string) =>
    setExcluded((current) =>
      current.includes(object) ? current.filter((item) => item !== object) : [...current, object]
    );

  const approve = () => {
    setStage('running');
    window.setTimeout(() => setStage('receipt'), 1400);
  };

  if (stage === 'cancelled') {
    return (
      <div className={styles.opCard}>
        <p className={styles.opCancelled}>
          <X size={15} aria-hidden="true" /> Nothing was changed.
        </p>
        <button className={styles.quietButton} type="button" onClick={() => setStage('proposal')}>
          Show the proposal again
        </button>
      </div>
    );
  }

  if (stage === 'running') {
    return (
      <div className={styles.opCard}>
        <header className={styles.opHead}>
          <span className={styles.opBadge}>
            <Loader2 size={12} aria-hidden="true" /> Applying
          </span>
        </header>
        <h3 className={styles.opGoal}>{goal}</h3>
        <ol className={styles.opLedger} aria-live="polite">
          {ledgerSteps.map((step, index) => (
            <li key={step} data-state={index < 3 ? 'done' : 'active'}>
              {index < 3 ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <Loader2 size={13} aria-hidden="true" />
              )}
              {step}
            </li>
          ))}
        </ol>
        <p className={styles.opFoot}>
          You can leave this panel. Progress is recorded and can be undone afterwards.
        </p>
      </div>
    );
  }

  if (stage === 'receipt') {
    return (
      <div className={styles.opCard}>
        <header className={styles.opHead}>
          <span className={`${styles.opBadge} ${styles.opBadgeDone}`}>
            <ShieldCheck size={12} aria-hidden="true" /> Applied
          </span>
          <time className={styles.opTime}>Just now</time>
        </header>
        <h3 className={styles.opGoal}>{goal}</h3>
        <p className={styles.opReceiptLine} role="status">
          {undone
            ? `Reverted ${included.length} changes. Everything is back to how it was.`
            : `${included.length} changes applied across ${new Set(included.map((c) => c.object)).size} objects.`}
        </p>
        {!undone ? (
          <ul className={styles.opReceiptList}>
            {included.map((change) => (
              <li key={change.object}>
                <Check size={13} aria-hidden="true" />
                <span>
                  <strong>{change.object}</strong> · {change.field} → {change.after}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <footer className={styles.opActions}>
          {!undone ? (
            <button className={styles.quietButton} type="button" onClick={() => setUndone(true)}>
              <Undo2 size={14} aria-hidden="true" /> Undo all
            </button>
          ) : (
            <button className={styles.quietButton} type="button" onClick={() => setUndone(false)}>
              <RotateCcw size={14} aria-hidden="true" /> Redo
            </button>
          )}
          <button className={styles.primaryButton} type="button" onClick={onDone}>
            Done
          </button>
        </footer>
        <p className={styles.opFoot}>
          Recoverable from Trash for 30 days. Full history in Data &amp; offline.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.opCard}>
      <header className={styles.opHead}>
        <span className={styles.opBadge}>
          <Sparkles size={12} aria-hidden="true" /> Proposal
        </span>
        <span className={`${styles.opRisk} ${styles[`opRisk${risk}`]}`}>
          <AlertTriangle size={12} aria-hidden="true" /> {RISK_COPY[risk].label}
        </span>
      </header>

      <h3 className={styles.opGoal}>{goal}</h3>

      <ul className={styles.opChips} aria-label="Context used">
        {scope.map((chip) => (
          <li key={chip}>
            <FileText size={12} aria-hidden="true" />
            {chip}
          </li>
        ))}
      </ul>

      <p className={styles.opCount} role="status">
        <strong>{included.length}</strong> {included.length === 1 ? 'change' : 'changes'} to{' '}
        <strong>{new Set(included.map((c) => c.object)).size}</strong> objects
        {inferred > 0 ? ` · ${inferred} inferred` : ''}
      </p>

      <ul className={styles.opDiff}>
        {proposedChanges.map((change) => {
          const off = excluded.includes(change.object);
          return (
            <li key={change.object} data-excluded={off || undefined}>
              <div className={styles.opDiffHead}>
                <span className={`${styles.opKind} ${styles[`opKind${change.kind}`]}`}>
                  {KIND_COPY[change.kind].icon} {KIND_COPY[change.kind].label}
                </span>
                <strong>{change.object}</strong>
                <button
                  type="button"
                  className={styles.opExclude}
                  aria-pressed={off}
                  aria-label={
                    off ? `Include ${change.object} again` : `Leave ${change.object} unchanged`
                  }
                  onClick={() => toggle(change.object)}
                >
                  {off ? (
                    <Plus size={13} aria-hidden="true" />
                  ) : (
                    <Minus size={13} aria-hidden="true" />
                  )}
                </button>
              </div>
              <p className={styles.opDiffBody}>
                <span className={styles.opField}>{change.field}</span>
                {change.before ? <del>{change.before}</del> : null}
                <ArrowRight size={12} aria-hidden="true" />
                <ins>{change.after}</ins>
              </p>
              <p className={styles.opBasis}>
                <span
                  className={change.basis === 'evidence' ? styles.opEvidence : styles.opInference}
                >
                  {change.basis === 'evidence' ? (
                    <ShieldCheck size={11} aria-hidden="true" />
                  ) : (
                    <Info size={11} aria-hidden="true" />
                  )}
                  {change.basis === 'evidence' ? 'From your notes' : 'Inferred'}
                </span>
                {change.why}
              </p>
            </li>
          );
        })}
      </ul>

      <p className={styles.opCost}>
        <CircleDollarSign size={13} aria-hidden="true" />
        About $0.02 of your $2.00 daily budget · {RISK_COPY[risk].detail}
      </p>

      <footer className={styles.opActions}>
        <button className={styles.quietButton} type="button" onClick={() => setStage('cancelled')}>
          Cancel
        </button>
        <button className={styles.quietButton} type="button">
          Adjust
        </button>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={included.length === 0}
          onClick={approve}
        >
          Approve {included.length}
        </button>
      </footer>
    </div>
  );
}
