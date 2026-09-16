import Link from 'next/link';
import { FileText, Inbox, Search, Target, WandSparkles } from 'lucide-react';
import { getGoalsHierarchy, getTranscripts } from '@/app/actions';
import { getNoteBodies, getNotes, type NoteView } from '@/app/notes/actions';
import { buildWorkspaceSearchResults, type WorkspaceSearchResult } from '@/lib/workspace-search';
import { noteLocationLabel } from '@/lib/notes/note-paths';

const resultIcons = {
  page: FileText,
  goal: Target,
  action: WandSparkles,
  capture: Inbox,
} satisfies Record<WorkspaceSearchResult['kind'], typeof FileText>;

/* A workspace the size of a real Notion export answers most queries with more
   rows than fit on a screen, and the thing the person knows is usually what
   kind of thing they are looking for. The filter is a link with the query
   carried along rather than a client control, so it works the same way the
   search form does: no JavaScript required, and a filtered search is an
   address that can be reopened. */
const KINDS = [
  { id: 'all', label: 'Everything' },
  { id: 'page', label: 'Pages' },
  { id: 'goal', label: 'Goals' },
  { id: 'action', label: 'Actions' },
  { id: 'capture', label: 'Captures' },
] as const;

type KindFilter = (typeof KINDS)[number]['id'];

function readKind(value: string | undefined): KindFilter {
  return KINDS.some((kind) => kind.id === value) ? (value as KindFilter) : 'all';
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const rawQuery = params.q ?? '';
  const kind = readKind(params.kind);
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

  /* A result list is only useful if each row names one page. Two Notes filed in
     different parts of the tree can carry the same title, and with nothing but
     that title on screen the person has to open both to find out which is which.
     Their location tells them apart.
     Resolving a location needs the ancestors of the match. A filtered query
     would not return them, so getNotes carries them alongside the matches and
     marks them as not being matches themselves; they are what the location is
     read from here, and they are excluded from the results and from the
     duplicate check. */
  const matched = notes.filter((note) => note.matchesQuery !== false);
  const duplicateTitles = new Set(
    matched
      .map((note) => note.title.trim().toLocaleLowerCase())
      .filter((title, index, all) => all.indexOf(title) !== index)
  );

  /* The tree query returns no text, because a sidebar of titles does not need
     any. This page does: it ranks and excerpts on what a Note actually says, so
     without the body a query matching only the writing would return nothing at
     all. Fetched for the matches alone, which is bounded by how many results
     there are rather than by how much the workspace holds. */
  const bodies = await getNoteBodies(matched.map((note) => note.id));

  const allResults = buildWorkspaceSearchResults(query, {
    pages: matched.map((note) => ({
      id: note.id,
      title: note.title,
      body: bodies.get(note.id) ?? '',
      context: duplicateTitles.has(note.title.trim().toLocaleLowerCase())
        ? noteLocationLabel(notes, note.id)
        : '',
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

  // Counts describe the whole query, not the current filter, so a chip that
  // would show nothing says so before it is chosen rather than after.
  const countFor = (id: KindFilter) =>
    id === 'all' ? allResults.length : allResults.filter((result) => result.kind === id).length;
  const results = kind === 'all' ? allResults : allResults.filter((result) => result.kind === kind);

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
        {/* Submitting a new query starts from everything again: the filter
            belonged to the search that is being replaced. */}
        <button className="btn-primary" type="submit">
          Search
        </button>
      </form>

      {query.length >= 2 ? (
        <nav className="workspace-search-kinds" aria-label="Filter results by kind">
          {KINDS.map((option) => {
            const count = countFor(option.id);
            const href =
              option.id === 'all'
                ? `/search?q=${encodeURIComponent(query)}`
                : `/search?q=${encodeURIComponent(query)}&kind=${option.id}`;
            return (
              <Link
                className="workspace-search-kind"
                key={option.id}
                href={href}
                aria-current={kind === option.id ? 'page' : undefined}
                // Not aria-disabled: the link works, and it lands on an
                // empty state that offers the way back. Saying "disabled"
                // about a control that navigates would be untrue, and it
                // would stop assistive technology activating it at all.
                data-empty={count === 0 ? 'true' : undefined}
              >
                {option.label}
                <small>{count}</small>
              </Link>
            );
          })}
        </nav>
      ) : null}

      <section className="workspace-search-results" aria-label="Search results">
        <header>
          <strong>
            {query.length >= 2
              ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
              : 'Recent knowledge'}
          </strong>
          {query.length >= 2 ? (
            <span>
              for &quot;{query}&quot;
              {kind === 'all' ? null : ` in ${KINDS.find((option) => option.id === kind)!.label}`}
            </span>
          ) : null}
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
                    {result.context ? (
                      <small className="workspace-search-result-context">{result.context}</small>
                    ) : null}
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
            {kind === 'all' ? (
              <p>Try a title, phrase, Goal, or Action name.</p>
            ) : (
              <p>
                Nothing of this kind matches.{' '}
                <Link href={`/search?q=${encodeURIComponent(query)}`}>
                  Search everything instead
                </Link>
                {allResults.length ? ` (${allResults.length} elsewhere).` : '.'}
              </p>
            )}
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
