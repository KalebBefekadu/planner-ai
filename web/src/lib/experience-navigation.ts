export type ExperienceArea =
  | 'home'
  | 'planner'
  | 'workspace'
  | 'search'
  | 'notifications'
  | 'settings';

export type ExperienceNavItem = {
  label: string;
  href: string;
  match?: 'exact' | 'prefix';
};

export type ExperienceNavigation = {
  area: ExperienceArea;
  title: string;
  subtitle: string;
  items: ExperienceNavItem[];
};

const plannerPaths = ['/planner', '/vision', '/review'];
const workspacePaths = ['/notes', '/inbox', '/conversations', '/activity', '/trash'];

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function experienceAreaForPath(pathname: string): ExperienceArea {
  if (pathname.startsWith('/settings/')) return 'settings';
  if (matchesPath(pathname, '/notifications')) return 'notifications';
  if (matchesPath(pathname, '/search')) return 'search';
  if (plannerPaths.some((path) => matchesPath(pathname, path))) return 'planner';
  if (workspacePaths.some((path) => matchesPath(pathname, path))) return 'workspace';
  return 'home';
}

export function experienceNavigationForPath(
  pathname: string,
  canonical: boolean
): ExperienceNavigation {
  const area = experienceAreaForPath(pathname);

  if (area === 'planner') {
    return {
      area,
      title: 'Planner',
      subtitle: 'Direction to today',
      items: [
        { label: 'Today', href: '/', match: 'exact' },
        { label: 'Plan', href: '/planner', match: 'prefix' },
        ...(canonical
          ? [{ label: 'Calendar', href: '/planner/calendar', match: 'prefix' as const }]
          : []),
        { label: 'Vision', href: '/vision', match: 'prefix' },
        ...(canonical
          ? [{ label: 'Weekly review', href: '/review', match: 'prefix' as const }]
          : []),
      ],
    };
  }

  if (area === 'workspace') {
    return {
      area,
      title: 'Workspace',
      subtitle: 'Pages, captures, and history',
      items: [
        ...(canonical ? [{ label: 'Notes', href: '/notes', match: 'prefix' as const }] : []),
        { label: 'Capture inbox', href: '/inbox', match: 'prefix' },
        ...(canonical
          ? [
              { label: 'Conversations', href: '/conversations', match: 'prefix' as const },
              { label: 'Activity', href: '/activity', match: 'prefix' as const },
              { label: 'Trash', href: '/trash', match: 'prefix' as const },
            ]
          : []),
      ],
    };
  }

  if (area === 'settings') {
    return {
      area,
      title: 'Settings',
      subtitle: 'Workspace and account',
      items: [
        ...(canonical
          ? [
              { label: 'Preferences', href: '/settings/preferences', match: 'prefix' as const },
              { label: 'AI and agents', href: '/settings/ai', match: 'prefix' as const },
              { label: 'Memory', href: '/settings/memory', match: 'prefix' as const },
              { label: 'Data and offline', href: '/settings/data', match: 'prefix' as const },
              { label: 'MCP', href: '/settings/mcp', match: 'prefix' as const },
            ]
          : []),
        { label: 'Security', href: '/settings/security', match: 'prefix' },
        { label: 'Safety', href: '/settings/safety', match: 'prefix' },
      ],
    };
  }

  if (area === 'notifications') {
    return {
      area,
      title: 'Notifications',
      subtitle: 'Your attention queue',
      items: [
        { label: 'All notifications', href: '/notifications', match: 'exact' },
        ...(canonical
          ? [{ label: 'Notification preferences', href: '/settings/preferences' }]
          : []),
      ],
    };
  }

  if (area === 'search') {
    return {
      area,
      title: 'Search',
      subtitle: 'Find anything',
      items: [{ label: 'All results', href: '/search', match: 'prefix' }],
    };
  }

  return {
    area,
    title: 'Home',
    subtitle: 'Focus and momentum',
    items: [
      { label: 'Today', href: '/', match: 'exact' },
      { label: 'Capture inbox', href: '/inbox', match: 'prefix' },
      ...(canonical ? [{ label: 'Weekly review', href: '/review' }] : []),
    ],
  };
}

export function isExperienceNavItemActive(pathname: string, item: ExperienceNavItem) {
  return item.match === 'exact' ? pathname === item.href : matchesPath(pathname, item.href);
}
