export type WorkspaceSearchResult = {
  id: string;
  kind: 'page' | 'goal' | 'action' | 'capture';
  title: string;
  excerpt: string;
  href: string;
  updatedAt: string;
};

type SearchItem = {
  id: string;
  title: string;
  body?: string | null;
  updatedAt: string;
};

export type WorkspaceSearchInput = {
  pages: SearchItem[];
  goals: SearchItem[];
  actions: SearchItem[];
  captures: Array<{ id: string; rawText: string; createdAt: string }>;
};

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function excerpt(value: string, query: string) {
  const normalized = clean(value);
  if (normalized.length <= 150) return normalized;
  const matchAt = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, matchAt < 0 ? 0 : matchAt - 45);
  const clipped = normalized.slice(start, start + 150).trim();
  return `${start > 0 ? '...' : ''}${clipped}${start + 150 < normalized.length ? '...' : ''}`;
}

function matches(item: SearchItem, normalizedQuery: string) {
  return `${item.title}\n${item.body ?? ''}`.toLocaleLowerCase().includes(normalizedQuery);
}

export function buildWorkspaceSearchResults(
  query: string,
  input: WorkspaceSearchInput,
  limit = 40
) {
  const normalizedQuery = clean(query).toLocaleLowerCase();
  if (normalizedQuery.length < 2) return [];

  const pages = input.pages
    .filter((item) => matches(item, normalizedQuery))
    .map(
      (item): WorkspaceSearchResult => ({
        id: item.id,
        kind: 'page',
        title: item.title,
        excerpt: excerpt(item.body ?? item.title, normalizedQuery),
        href: `/notes?note=${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt,
      })
    );
  const goals = input.goals
    .filter((item) => matches(item, normalizedQuery))
    .map(
      (item): WorkspaceSearchResult => ({
        id: item.id,
        kind: 'goal',
        title: item.title,
        excerpt: excerpt(item.body ?? 'Planner Goal', normalizedQuery),
        href: '/planner',
        updatedAt: item.updatedAt,
      })
    );
  const actions = input.actions
    .filter((item) => matches(item, normalizedQuery))
    .map(
      (item): WorkspaceSearchResult => ({
        id: item.id,
        kind: 'action',
        title: item.title,
        excerpt: excerpt(item.body ?? 'Planner Action', normalizedQuery),
        href: '/planner',
        updatedAt: item.updatedAt,
      })
    );
  const captures = input.captures
    .filter((item) => item.rawText.toLocaleLowerCase().includes(normalizedQuery))
    .map(
      (item): WorkspaceSearchResult => ({
        id: item.id,
        kind: 'capture',
        title: excerpt(item.rawText, normalizedQuery),
        excerpt: 'Capture inbox',
        href: '/inbox',
        updatedAt: item.createdAt,
      })
    );

  return [...pages, ...goals, ...actions, ...captures]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
