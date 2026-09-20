'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { createArea } from '@/app/areas/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { AreaTree } from '@/components/areas/area-tree';
import type { AreaNode } from '@/lib/areas/tree';

/* Offered, never assumed. Nobody's life has the same shape, and onboarding
   does not ask for any of this -- the set is here, on a page someone chose to
   open, so that starting from nothing is a choice and not a chore. Every name
   is editable the moment it exists. */
const STARTERS = [
  'Health',
  'Home & Organising',
  'Relationships',
  'Career & Learning',
  'Finances',
  'Personal Growth',
];

export function AreaIndex({ tree, showArchived }: { tree: AreaNode[]; showArchived: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(STARTERS);

  const empty = tree.length === 0;

  function createStarters() {
    setError(null);
    startTransition(async () => {
      try {
        /* One key per name, so a retry after a partial failure finishes the
           set instead of making a second copy of what already landed. */
        for (const name of chosen) {
          await createArea({ name, parentAreaId: null, requestKey: `starter:${name}` });
        }
        router.refresh();
      } catch (caught) {
        setError(actionFailureMessage(caught, 'Planner AI could not create these areas.'));
      }
    });
  }

  return (
    <div className="page area-page">
      <div className="area-layout">
        <aside className="area-aside">
          <AreaTree tree={tree} activeAreaId={null} showArchived={showArchived} />
        </aside>
        <div className="area-main">
          <header className="page-heading">
            <div>
              <h1>Life areas</h1>
              <p className="lede">
                A place to keep one part of life: what it is for, the work it needs, and the pages
                you write about it. Every area has one page, and you can start with none of them.
              </p>
            </div>
          </header>

          {error ? (
            <p className="area-error" role="alert">
              {error}
            </p>
          ) : null}

          {empty ? (
            <section className="area-section">
              <div className="section-heading">
                <h2>Start from a suggestion, or from nothing</h2>
              </div>
              <p className="area-empty">
                These are a starting point, not a template. Rename them, delete what does not fit,
                and add the ones that are yours — Faith, Marriage, a business, whatever the parts of
                your life actually are.
              </p>
              <ul className="area-starters">
                {STARTERS.map((name) => (
                  <li key={name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.includes(name)}
                        onChange={(event) =>
                          setChosen((current) =>
                            event.target.checked
                              ? [...current, name]
                              : current.filter((entry) => entry !== name)
                          )
                        }
                      />
                      {name}
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-primary button-with-icon"
                disabled={pending || chosen.length === 0}
                onClick={createStarters}
              >
                <Sparkles size={15} aria-hidden="true" />
                Create {chosen.length} {chosen.length === 1 ? 'area' : 'areas'}
              </button>
              <p className="area-empty">
                Or use the <strong>+</strong> beside “Life areas” to name your own.
              </p>
            </section>
          ) : (
            <section className="area-section">
              <p className="area-empty">
                Choose an area to open it. Its page is an ordinary Note: the same page whether you
                reach it from here or from Notes.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
