'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BotOff,
  Check,
  FileText,
  Pencil,
  Plus,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  renameArea,
  saveAreaVision,
  setAreaAiExclusion,
  setAreaArchived,
  type AreaPageData,
  type AreaScope,
} from '@/app/areas/actions';
import { createTodayAction } from '@/app/today/actions';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { AreaTree } from '@/components/areas/area-tree';

type Tab = 'overview' | 'plan' | 'notes';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'plan', label: 'Plan' },
  { id: 'notes', label: 'Notes' },
];

function statusLabel(status: string) {
  if (status === 'in_progress') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  if (status === 'achieved') return 'Achieved';
  if (status === 'paused') return 'Paused';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function AreaWorkspace({
  data,
  tab,
  showArchived,
  localDate,
}: {
  data: AreaPageData;
  tab: Tab;
  showArchived: boolean;
  /** The workspace's today, so a task added here is scheduled in their day. */
  localDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [areaVersion, setAreaVersion] = useState(data.area.version);
  const [name, setName] = useState(data.area.name);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(data.area.name);
  /* Default on only while the page still carries the area's own name. A title
     someone has made their own is not quietly overwritten by a rename. */
  const [alsoRenamePage, setAlsoRenamePage] = useState(
    data.canonicalNote?.title === data.area.name
  );

  const [visionDraft, setVisionDraft] = useState(data.vision?.bodyMarkdown ?? '');
  const [savedVision, setSavedVision] = useState(data.vision?.bodyMarkdown ?? '');
  const [editingVision, setEditingVision] = useState(!data.vision);

  const [taskTitle, setTaskTitle] = useState('');

  function run(work: () => Promise<void>, fallback: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await work();
      } catch (caught) {
        setError(actionFailureMessage(caught, fallback));
      }
    });
  }

  function href(next: Partial<{ tab: Tab; scope: AreaScope }>) {
    const params = new URLSearchParams();
    const wantedTab = next.tab ?? tab;
    const wantedScope = next.scope ?? data.scope;
    if (wantedTab !== 'overview') params.set('tab', wantedTab);
    if (wantedScope !== 'descendants') params.set('scope', wantedScope);
    if (showArchived) params.set('archived', '1');
    const query = params.toString();
    return query ? `/areas/${data.area.id}?${query}` : `/areas/${data.area.id}`;
  }

  const archived = Boolean(data.area.archivedAt);
  const hiddenByAncestor = data.ancestry.slice(0, -1).some((row) => row.archivedAt);

  return (
    <div className="page area-page">
      <div className="area-layout">
        <aside className="area-aside">
          <AreaTree tree={data.tree} activeAreaId={data.area.id} showArchived={showArchived} />
        </aside>

        <div className="area-main">
          <header className="page-heading area-heading">
            <div>
              <nav className="area-breadcrumb" aria-label="Life area path">
                <Link href="/areas">Life areas</Link>
                {data.ancestry.slice(0, -1).map((row) => (
                  <span key={row.id}>
                    <span aria-hidden="true">/</span>
                    <Link href={`/areas/${row.id}`}>{row.name}</Link>
                  </span>
                ))}
              </nav>
              {editingName ? (
                <div className="area-rename">
                  <input
                    autoFocus
                    aria-label="Area name"
                    value={draftName}
                    disabled={pending}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingName(false);
                    }}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={alsoRenamePage}
                      onChange={(event) => setAlsoRenamePage(event.target.checked)}
                    />
                    Also rename its page
                  </label>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={pending || !draftName.trim()}
                    onClick={() =>
                      run(async () => {
                        const result = await renameArea({
                          id: data.area.id,
                          name: draftName.trim(),
                          icon: data.area.icon,
                          color: data.area.color,
                          renameCanonicalNote: alsoRenamePage,
                          expectedVersion: areaVersion,
                        });
                        setName(result.name);
                        setAreaVersion(result.version);
                        setEditingName(false);
                        setNotice('Renamed.');
                        router.refresh();
                      }, 'Planner AI could not rename this area.')
                    }
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h1>
                  {data.area.icon ? (
                    <span className="area-icon" aria-hidden="true">
                      {data.area.icon}
                    </span>
                  ) : null}
                  {name}
                  <button
                    type="button"
                    className="area-inline-edit"
                    aria-label="Rename this area"
                    onClick={() => {
                      setDraftName(name);
                      setEditingName(true);
                    }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                </h1>
              )}
            </div>
            <div className="page-heading-actions">
              <button
                type="button"
                className="btn-secondary button-with-icon"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await setAreaArchived({
                      id: data.area.id,
                      archived: !archived,
                      expectedVersion: areaVersion,
                    });
                    setAreaVersion(result.version);
                    router.refresh();
                  }, 'Planner AI could not change this area.')
                }
              >
                {archived ? (
                  <ArchiveRestore size={15} aria-hidden="true" />
                ) : (
                  <Archive size={15} aria-hidden="true" />
                )}
                {archived ? 'Restore area' : 'Archive area'}
              </button>
            </div>
          </header>

          {archived || hiddenByAncestor ? (
            <p className="area-banner" role="status">
              {archived
                ? 'This area is archived. Its work is still scheduled and still searchable — archiving organises, it does not cancel.'
                : 'An area above this one is archived, so this one is hidden from the list until that one is restored.'}
            </p>
          ) : null}
          {data.aiExcludedByAncestor && !data.area.aiExcluded ? (
            <p className="area-banner" role="status">
              An area above this one is excluded from AI, so this one is excluded too.
            </p>
          ) : null}
          {error ? (
            <p className="area-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="area-notice" role="status">
              {notice}
            </p>
          ) : null}

          <nav className="area-tabs" aria-label="Area sections">
            {TABS.map((entry) => (
              <Link
                key={entry.id}
                className={entry.id === tab ? 'area-tab area-tab-active' : 'area-tab'}
                href={href({ tab: entry.id })}
                aria-current={entry.id === tab ? 'page' : undefined}
              >
                {entry.label}
              </Link>
            ))}
            {data.children.length ? (
              <span className="area-scope">
                <Link
                  className={data.scope === 'descendants' ? 'area-scope-active' : undefined}
                  href={href({ scope: 'descendants' })}
                >
                  Including subareas
                </Link>
                <Link
                  className={data.scope === 'self' ? 'area-scope-active' : undefined}
                  href={href({ scope: 'self' })}
                >
                  This area only
                </Link>
              </span>
            ) : null}
          </nav>

          {tab === 'overview' ? (
            <div className="area-sections">
              <section className="area-section">
                <div className="section-heading">
                  <h2>What this area is for</h2>
                  {savedVision && !editingVision ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setEditingVision(true)}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
                {data.inheritedVision ? (
                  <p className="area-inherited">
                    Under{' '}
                    <Link href={`/areas/${data.inheritedVision.areaId}`}>
                      {data.inheritedVision.areaName}
                    </Link>
                    : {data.inheritedVision.bodyMarkdown.slice(0, 180)}
                    {data.inheritedVision.bodyMarkdown.length > 180 ? '…' : ''}
                  </p>
                ) : null}
                {editingVision ? (
                  <div className="area-vision-editor">
                    <textarea
                      aria-label={`What ${name} is for`}
                      rows={5}
                      value={visionDraft}
                      disabled={pending}
                      placeholder="Write what matters here…"
                      onChange={(event) => setVisionDraft(event.target.value)}
                    />
                    <div className="area-vision-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={pending || visionDraft.trim().length < 3}
                        onClick={() =>
                          run(async () => {
                            await saveAreaVision({
                              areaId: data.area.id,
                              bodyMarkdown: visionDraft.trim(),
                            });
                            setSavedVision(visionDraft.trim());
                            setEditingVision(false);
                            setNotice('Saved.');
                            router.refresh();
                          }, 'Planner AI could not save this direction.')
                        }
                      >
                        Save
                      </button>
                      {savedVision ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={pending}
                          onClick={() => {
                            setVisionDraft(savedVision);
                            setEditingVision(false);
                          }}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="area-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedVision}</ReactMarkdown>
                  </div>
                )}
              </section>

              <section className="area-section">
                <div className="section-heading">
                  <h2>Current focus</h2>
                </div>
                {data.goals.length ? (
                  <ul className="area-list">
                    {data.goals.map((goal) => (
                      <li key={goal.id}>
                        <span className="area-list-title">{goal.title}</span>
                        <span className="area-list-meta">
                          {goal.kind === 'initiative' ? 'Initiative' : statusLabel(goal.status)}
                          {goal.dueOn ? ` · by ${goal.dueOn}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="area-empty">
                    No goals are filed here yet.{' '}
                    <Link href="/planner">Add one from the planner</Link>, or leave this area as a
                    place to write and keep things.
                  </p>
                )}
              </section>

              <section className="area-section">
                <div className="section-heading">
                  <h2>Next actions</h2>
                </div>
                <form
                  className="area-quick-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = taskTitle.trim();
                    if (title.length < 3) return;
                    run(async () => {
                      await createTodayAction({
                        title,
                        goalId: null,
                        areaId: data.area.id,
                        scheduledOn: localDate,
                        focus: false,
                        requestKey: `${data.area.id}-${Date.now()}`,
                      });
                      setTaskTitle('');
                      setNotice('Added to this area.');
                      router.refresh();
                    }, 'Planner AI could not add this task.');
                  }}
                >
                  <label className="visually-hidden" htmlFor="area-task">
                    What needs doing in {name}?
                  </label>
                  <input
                    id="area-task"
                    value={taskTitle}
                    disabled={pending}
                    placeholder={`What needs doing in ${name}?`}
                    onChange={(event) => setTaskTitle(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn-primary button-with-icon"
                    disabled={pending || taskTitle.trim().length < 3}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add task
                  </button>
                </form>
                {data.openWork.length ? (
                  <ul className="area-list">
                    {data.openWork.slice(0, 8).map((item) => (
                      <li key={item.id}>
                        <span className="area-list-title">{item.title}</span>
                        <span className="area-list-meta">
                          {item.scheduledOn ?? 'Unscheduled'}
                          {item.status === 'open' ? '' : ` · ${statusLabel(item.status)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="area-empty">Nothing open here.</p>
                )}
                {data.openWork.length > 8 ? (
                  <Link className="area-more" href={href({ tab: 'plan' })}>
                    See all {data.openWork.length}
                    {data.moreWork ? '+' : ''} open items
                  </Link>
                ) : null}
              </section>

              {data.children.length ? (
                <section className="area-section">
                  <div className="section-heading">
                    <h2>Subareas</h2>
                  </div>
                  <ul className="area-chips">
                    {data.children.map((child) => (
                      <li key={child.id}>
                        <Link href={`/areas/${child.id}`}>
                          {child.icon ? <span aria-hidden="true">{child.icon}</span> : null}
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === 'plan' ? (
            <div className="area-sections">
              <section className="area-section">
                <div className="section-heading">
                  <h2>Goals</h2>
                </div>
                {data.goals.length ? (
                  <ul className="area-list">
                    {data.goals.map((goal) => (
                      <li key={goal.id}>
                        <span className="area-list-title">{goal.title}</span>
                        <span className="area-list-meta">
                          {goal.kind === 'initiative' ? 'Initiative' : statusLabel(goal.status)}
                          {goal.dueOn ? ` · by ${goal.dueOn}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="area-empty">No goals are filed here.</p>
                )}
              </section>
              <section className="area-section">
                <div className="section-heading">
                  <h2>Open work</h2>
                </div>
                {data.openWork.length ? (
                  <ul className="area-list">
                    {data.openWork.map((item) => (
                      <li key={item.id}>
                        <span className="area-list-title">{item.title}</span>
                        <span className="area-list-meta">
                          {item.scheduledOn ?? 'Unscheduled'}
                          {item.status === 'open' ? '' : ` · ${statusLabel(item.status)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="area-empty">Nothing open here.</p>
                )}
                {data.moreWork ? (
                  <p className="area-empty">
                    Showing the first {data.openWork.length}. Older work is in the planner.
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === 'notes' ? (
            <div className="area-sections">
              <section className="area-section">
                <div className="section-heading">
                  <h2>This area’s page</h2>
                </div>
                {data.canonicalNote ? (
                  <Link className="area-page-link" href={`/notes?note=${data.canonicalNote.id}`}>
                    <FileText size={16} aria-hidden="true" />
                    <span>
                      <strong>{data.canonicalNote.title}</strong>
                      <small>Open in Notes — the same page, wherever you reach it from</small>
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="area-empty">This area’s page is missing.</p>
                )}
              </section>
              <section className="area-section">
                <div className="section-heading">
                  <h2>Related notes</h2>
                </div>
                {data.notes.filter((note) => !note.isCanonicalPage).length ? (
                  <ul className="area-list">
                    {data.notes
                      .filter((note) => !note.isCanonicalPage)
                      .map((note) => (
                        <li key={note.id}>
                          <Link className="area-list-title" href={`/notes?note=${note.id}`}>
                            {note.title}
                          </Link>
                          <span className="area-list-meta">
                            {new Date(note.updatedAt).toLocaleDateString()}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="area-empty">
                    Nothing else is filed here yet. A page filed under this area appears in this
                    list; it does not become a subarea unless you make one.
                  </p>
                )}
              </section>
            </div>
          ) : null}

          <section className="area-section area-privacy">
            <div className="section-heading">
              <h2>Privacy</h2>
            </div>
            <button
              type="button"
              className="btn-secondary button-with-icon"
              disabled={pending || data.aiExcludedByAncestor}
              onClick={() =>
                run(async () => {
                  const result = await setAreaAiExclusion({
                    id: data.area.id,
                    aiExcluded: !data.area.aiExcluded,
                    expectedVersion: areaVersion,
                  });
                  setAreaVersion(result.version);
                  router.refresh();
                }, 'Planner AI could not change this setting.')
              }
            >
              {data.area.aiExcluded ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <BotOff size={15} aria-hidden="true" />
              )}
              {data.area.aiExcluded ? 'Excluded from AI' : 'Exclude this area from AI'}
            </button>
            <p className="area-empty">
              Exclusion applies to everything under this area, and to work reached from anywhere
              else. It cannot un-send anything already sent to a provider.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
