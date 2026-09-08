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

export type ExperienceNavSection = {
  label: string;
  items: ExperienceNavItem[];
};

export type ExperienceNavigation = {
  area: ExperienceArea;
  title: string;
  subtitle: string;
  sections: ExperienceNavSection[];
};

export type ExperienceRailItem = {
  area: ExperienceArea;
  href: string;
  label: string;
  placement: 'main' | 'footer';
  count?: number;
};

export type ExperienceCommand = {
  label: string;
  detail: string;
  href: string;
};

const plannerPaths = ['/planner', '/goals', '/vision', '/review'];
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

export function experienceRailItems(
  canonical: boolean,
  unreadNotifications = 0
): ExperienceRailItem[] {
  return [
    { area: 'home', href: '/', label: 'Home', placement: 'main' },
    { area: 'planner', href: '/planner', label: 'Planner', placement: 'main' },
    {
      area: 'workspace',
      href: canonical ? '/notes' : '/inbox',
      label: 'Workspace',
      placement: 'main',
    },
    { area: 'search', href: '/search', label: 'Search', placement: 'main' },
    ...(canonical
      ? [
          {
            area: 'notifications' as const,
            href: '/notifications',
            label: 'Notifications',
            placement: 'footer' as const,
            count: unreadNotifications,
          },
        ]
      : []),
    {
      area: 'settings',
      href: canonical ? '/settings/preferences' : '/settings/security',
      label: 'Settings',
      placement: 'footer',
    },
  ];
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
      sections: [
        {
          label: 'Plan',
          items: [
            { label: 'Today', href: '/', match: 'exact' },
            { label: 'This week', href: '/planner', match: 'exact' },
            ...(canonical
              ? [
                  { label: 'Calendar', href: '/planner/calendar', match: 'prefix' as const },
                  { label: 'Action inbox', href: '/inbox', match: 'prefix' as const },
                ]
              : []),
          ],
        },
        {
          label: 'Align',
          items: [
            ...(canonical
              ? [
                  { label: 'Weekly review', href: '/review', match: 'prefix' as const },
                  { label: 'Goals & horizons', href: '/goals', match: 'prefix' as const },
                ]
              : []),
            { label: 'Vision', href: '/vision', match: 'prefix' },
          ],
        },
      ],
    };
  }

  if (area === 'workspace') {
    return {
      area,
      title: 'Workspace',
      subtitle: 'Pages, captures, and history',
      sections: [
        {
          label: 'Workspace',
          items: [
            ...(canonical ? [{ label: 'Notes', href: '/notes', match: 'prefix' as const }] : []),
            { label: 'Capture inbox', href: '/inbox', match: 'prefix' },
            ...(canonical
              ? [{ label: 'Conversations', href: '/conversations', match: 'prefix' as const }]
              : []),
          ],
        },
        ...(canonical
          ? [
              {
                label: 'History',
                items: [
                  { label: 'Activity', href: '/activity', match: 'prefix' as const },
                  { label: 'Trash', href: '/trash', match: 'prefix' as const },
                ],
              },
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
      sections: [
        ...(canonical
          ? [
              {
                label: 'Workspace',
                items: [
                  { label: 'Preferences', href: '/settings/preferences', match: 'prefix' as const },
                  { label: 'AI and agents', href: '/settings/ai', match: 'prefix' as const },
                  { label: 'Memory', href: '/settings/memory', match: 'prefix' as const },
                  { label: 'Data and offline', href: '/settings/data', match: 'prefix' as const },
                  { label: 'MCP', href: '/settings/mcp', match: 'prefix' as const },
                ],
              },
            ]
          : []),
        {
          label: 'Trust',
          items: [
            { label: 'Security', href: '/settings/security', match: 'prefix' },
            { label: 'Safety', href: '/settings/safety', match: 'prefix' },
          ],
        },
      ],
    };
  }

  if (area === 'notifications') {
    return {
      area,
      title: 'Notifications',
      subtitle: 'Your attention queue',
      sections: [
        {
          label: 'Notifications',
          items: [
            { label: 'All notifications', href: '/notifications', match: 'exact' },
            ...(canonical
              ? [{ label: 'Notification preferences', href: '/settings/preferences' }]
              : []),
          ],
        },
      ],
    };
  }

  if (area === 'search') {
    return {
      area,
      title: 'Search',
      subtitle: 'Find anything',
      sections: [
        {
          label: 'Search',
          items: [{ label: 'All results', href: '/search', match: 'prefix' }],
        },
      ],
    };
  }

  return {
    area,
    title: 'Home',
    subtitle: 'Focus and momentum',
    sections: [
      {
        label: 'Home',
        items: [
          { label: 'Today', href: '/', match: 'exact' },
          { label: 'Capture inbox', href: '/inbox', match: 'prefix' },
          ...(canonical
            ? [{ label: 'Weekly review', href: '/review', match: 'prefix' as const }]
            : []),
        ],
      },
    ],
  };
}

export function experienceNavItems(navigation: ExperienceNavigation) {
  return navigation.sections.flatMap((section) => section.items);
}

export function experienceCommands(canonical: boolean): ExperienceCommand[] {
  return [
    { label: 'Today', detail: 'Home', href: '/' },
    { label: 'This week', detail: 'Planner', href: '/planner' },
    ...(canonical
      ? [
          { label: 'Calendar', detail: 'Planner', href: '/planner/calendar' },
          { label: 'Weekly review', detail: 'Planner', href: '/review' },
          { label: 'Goals & horizons', detail: 'Planner', href: '/goals' },
          { label: 'Notes', detail: 'Workspace', href: '/notes' },
          { label: 'Conversations', detail: 'Workspace', href: '/conversations' },
        ]
      : []),
    { label: 'Capture inbox', detail: 'Workspace', href: '/inbox' },
    { label: 'Search workspace', detail: 'Search', href: '/search' },
    {
      label: 'Settings',
      detail: 'Account and workspace',
      href: canonical ? '/settings/preferences' : '/settings/security',
    },
  ];
}

export function isExperienceNavItemActive(pathname: string, item: ExperienceNavItem) {
  return item.match === 'exact' ? pathname === item.href : matchesPath(pathname, item.href);
}
