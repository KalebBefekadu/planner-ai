import Link from 'next/link';
import { FileText, Inbox, Search, Target, WandSparkles } from 'lucide-react';
import { getGoalsHierarchy, getTranscripts } from '@/app/actions';
import { getNotes, type NoteView } from '@/app/notes/actions';
import { buildWorkspaceSearchResults, type WorkspaceSearchResult } from '@/lib/workspace-search';

const resultIcons = {
  page: FileText,
  goal: Target,
  action: WandSparkles,
  capture: Inbox,
} satisfies Record<WorkspaceSearchResult['kind'], typeof FileText>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const rawQuery = (await searchParams).q ?? '';
  const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, 120);
  const canonical = process.env.PLANNER_DATA_MODEL === 'canonical';

  let notes: NoteView[] = [];
  let plan = null;
  let captures = [] as Awaited<ReturnType<typeof getTranscripts>>;
  if (query.length >= 2) {
    [notes, plan, captures] = await Promise.all([
      canonical ? getNotes(query) : Promise.resolve([]),
      getGoalsHierarchy(),
      getTranscripts(50),
    ]);
  }

  const results = buildWorkspaceSearchResults(query, {
    pages: notes.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.bodyMarkdown,
      updatedAt: note.updatedAt,
    })),
    goals: plan
      ? [
          {
            id: plan.vision.id,
            title: 'Vision',
            body: plan.vision.content,
            updatedAt: plan.vision.updated_at,
          },
          ...[...plan.yearly, ...plan.quarterly].map((goal) => ({
            id: goal.id,
            title: goal.content,
            body: goal.description,
            updatedAt: goal.updated_at,
          })),
        ]
      : [],
    actions: plan
      ? [...plan.monthly, ...plan.weekly].map((action) => ({
          id: action.id,
          title: action.content,
          body: action.description,
          updatedAt: action.updated_at,
        }))
      : [],
    captures: captures.map((capture) => ({
      id: capture.id,
      rawText: capture.raw_text,
      createdAt: capture.created_at,
    })),
  });

  return (
    <div className="page workspace-search-page">
      <header className="workspace-search-heading">
        <p className="eyebrow">Workspace</p>
        <h1>Search</h1>
      </header>

      <form className="workspace-search-form" action="/search" role="search">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search pages, plans, actions, and captures"
          aria-label="Search workspace"
          minLength={2}
          maxLength={120}
          autoFocus
        />
        <button className="btn-primary" type="submit">
          Search
        </button>
      </form>

      <section className="workspace-search-results" aria-label="Search results">
        <header>
          <strong>{query.length >= 2 ? `${results.length} results` : 'Recent knowledge'}</strong>
          {query.length >= 2 ? <span>for &quot;{query}&quot;</span> : null}
        </header>

        {results.length ? (
          <div>
            {results.map((result) => {
              const Icon = resultIcons[result.kind];
              return (
                <Link
                  className="workspace-search-result"
                  href={result.href}
                  key={`${result.kind}-${result.id}`}
                >
                  <span className={`workspace-search-result-icon search-kind-${result.kind}`}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="workspace-search-result-copy">
                    <strong>{result.title}</strong>
                    <small>{result.excerpt}</small>
                  </span>
                  <span className="workspace-search-result-kind">{result.kind}</span>
                </Link>
              );
            })}
          </div>
        ) : query.length >= 2 ? (
          <div className="workspace-search-empty">
            <Search size={22} aria-hidden="true" />
            <h2>No results</h2>
            <p>Try a title, phrase, Goal, or Action name.</p>
          </div>
        ) : (
          <div className="workspace-search-empty">
            <Search size={22} aria-hidden="true" />
            <h2>Your workspace is ready</h2>
          </div>
        )}
      </section>
    </div>
  );
}
