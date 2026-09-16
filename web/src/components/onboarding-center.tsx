'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, FileInput, ListChecks, NotebookPen, ShieldCheck } from 'lucide-react';
import { NoteImportDialog } from '@/components/note-import-dialog';

type SetupStage = {
  title: string;
  description: string;
  complete: boolean;
  action?: { label: string; href: string };
};

export function OnboardingCenter({ hasVision }: { hasVision: boolean }) {
  const [importOpen, setImportOpen] = useState(false);
  const stages: SetupStage[] = [
    {
      title: 'Set your direction',
      description: hasVision
        ? 'Your first direction is in place. It can evolve as you use the workspace.'
        : 'Start with a vision and one meaningful goal when you are ready.',
      complete: hasVision,
      action: hasVision
        ? { label: 'Review vision', href: '/vision' }
        : { label: 'Draft vision', href: '/vision' },
    },
    {
      title: 'Bring your Notes',
      description:
        'Start with a small Notion or Obsidian folder. Preview duplicates and unsupported files before anything is created.',
      complete: false,
    },
    {
      title: 'Use one daily loop',
      description:
        'Capture a thought, turn one item into an action, and review your plan at the end of the week.',
      complete: false,
      action: { label: 'Open Today', href: '/' },
    },
  ];

  return (
    <>
      <section className="onboarding-center" aria-labelledby="onboarding-center-title">
        <header className="onboarding-center-heading">
          <p className="eyebrow">Onboarding center</p>
          <h1 id="onboarding-center-title">Make Planner AI your daily workspace</h1>
          <p>
            Move a small slice of your real life first. You can return here whenever you want to
            continue setup, import more Notes, or reset your planning rhythm.
          </p>
        </header>

        <ol className="onboarding-center-stages">
          {stages.map((stage, index) => (
            <li
              key={stage.title}
              className={stage.complete ? 'onboarding-center-stage-complete' : ''}
            >
              <span className="onboarding-center-stage-number" aria-hidden="true">
                {stage.complete ? <Check size={15} /> : index + 1}
              </span>
              <div>
                <h2>{stage.title}</h2>
                <p>{stage.description}</p>
              </div>
              {stage.title === 'Bring your Notes' ? (
                <button
                  className="btn-primary button-with-icon"
                  type="button"
                  onClick={() => setImportOpen(true)}
                >
                  <FileInput size={16} /> Import Notes
                </button>
              ) : stage.action ? (
                <Link className="btn-secondary" href={stage.action.href}>
                  {stage.action.label}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>

        <div className="onboarding-center-safety">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>
            Imports are reviewed before commit, duplicate content is flagged, and your source data
            stays untouched. Keep Notion read-only until your pilot import feels correct.
          </p>
        </div>

        <div className="onboarding-center-next">
          <NotebookPen size={19} aria-hidden="true" />
          <div>
            <strong>Recommended first migration</strong>
            <p>One personal folder, 5–10 pages, and one week of daily use before moving more.</p>
          </div>
          <Link className="button-with-icon text-button" href="/notes">
            <ListChecks size={16} /> Open workspace
          </Link>
        </div>
      </section>
      <NoteImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
