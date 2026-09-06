'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  FileText,
  Home,
  Inbox,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import AuthButton from '@/components/auth-button';
import { PanelResizer } from '@/components/panel-resizer';
import { useDialog } from '@/lib/use-dialog';
import { AssistantDock } from '@/components/assistant-dock';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  experienceAreaForPath,
  experienceNavigationForPath,
  isExperienceNavItemActive,
  type ExperienceArea,
} from '@/lib/experience-navigation';

const SIDEBAR_DEFAULT = 236;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 320;

type ExperienceShellProps = {
  children: React.ReactNode;
  canonical: boolean;
  email: string;
  unreadNotifications: number;
};

const areaIcons = {
  home: Home,
  planner: CalendarDays,
  workspace: FileText,
  search: Search,
  notifications: Bell,
  settings: Settings2,
} satisfies Record<ExperienceArea, typeof Home>;

export function ExperienceShell({
  children,
  canonical,
  email,
  unreadNotifications,
}: ExperienceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const navigation = useMemo(
    () => experienceNavigationForPath(pathname, canonical),
    [canonical, pathname]
  );
  const currentLabel =
    navigation.items.find((item) => isExperienceNavItemActive(pathname, item))?.label ??
    navigation.title;

  const workspaceHref = canonical ? '/notes' : '/inbox';
  const primaryItems: Array<{
    area: ExperienceArea;
    href: string;
    label: string;
    count?: number;
  }> = [
    { area: 'home', href: '/', label: 'Home' },
    { area: 'planner', href: '/planner', label: 'Planner' },
    { area: 'workspace', href: workspaceHref, label: 'Workspace' },
    { area: 'search', href: '/search', label: 'Search' },
    ...(canonical
      ? [
          {
            area: 'notifications' as const,
            href: '/notifications',
            label: 'Notifications',
            count: unreadNotifications,
          },
        ]
      : []),
    { area: 'settings', href: '/settings/security', label: 'Settings' },
  ];
  const commands = [
    { label: 'Today', detail: 'Home', href: '/' },
    { label: 'Plan', detail: 'Planner', href: '/planner' },
    ...(canonical
      ? [
          { label: 'Calendar', detail: 'Planner', href: '/planner/calendar' },
          { label: 'Weekly review', detail: 'Planner', href: '/review' },
          { label: 'Notes', detail: 'Workspace', href: '/notes' },
        ]
      : []),
    { label: 'Capture inbox', detail: 'Workspace', href: '/inbox' },
    { label: 'Search workspace', detail: 'Search', href: '/search' },
    { label: 'Settings', detail: 'Account and workspace', href: '/settings/security' },
  ].filter((command) =>
    `${command.label} ${command.detail}`.toLowerCase().includes(commandQuery.trim().toLowerCase())
  );

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandQuery('');
        setCommandOpen(true);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function submitCommandSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = commandQuery.trim();
    if (!query) return;
    setCommandOpen(false);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  const sidebar = (
    <aside className="experience-sidebar" aria-label={`${navigation.title} navigation`}>
      <div className="experience-sidebar-identity">
        <span aria-hidden="true">{navigation.title.slice(0, 1)}</span>
        <div>
          <strong>{navigation.title}</strong>
          <small>{navigation.subtitle}</small>
        </div>
        <button
          className="experience-icon-button experience-mobile-close"
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X size={17} />
        </button>
      </div>

      <nav className="experience-mobile-primary" aria-label="Product areas">
        {primaryItems.map((item) => {
          const Icon = areaIcons[item.area];
          return (
            <Link
              key={`mobile-${item.area}`}
              aria-current={navigation.area === item.area ? 'page' : undefined}
              className={navigation.area === item.area ? 'experience-mobile-primary-active' : ''}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
              {item.count ? <strong>{item.count > 99 ? '99+' : item.count}</strong> : null}
            </Link>
          );
        })}
      </nav>

      {navigation.area === 'workspace' ? (
        <Link
          className="experience-quick-action"
          href="/inbox"
          onClick={() => setMobileMenuOpen(false)}
        >
          <Inbox size={15} aria-hidden="true" />
          Capture a thought
        </Link>
      ) : navigation.area === 'planner' ? (
        <Link
          className="experience-quick-action"
          href="/inbox"
          onClick={() => setMobileMenuOpen(false)}
        >
          <Sparkles size={15} aria-hidden="true" />
          Capture an action
        </Link>
      ) : null}

      <nav className="experience-secondary-nav" aria-label={`${navigation.title} sections`}>
        <p>{navigation.area === 'planner' ? 'Planning views' : 'Navigate'}</p>
        {navigation.items.map((item) => (
          <Link
            key={`${navigation.area}-${item.href}-${item.label}`}
            aria-current={isExperienceNavItemActive(pathname, item) ? 'page' : undefined}
            className={
              isExperienceNavItemActive(pathname, item) ? 'experience-secondary-active' : undefined
            }
            href={item.href}
            onClick={() => setMobileMenuOpen(false)}
          >
            <span>{item.label}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <div className="experience-sidebar-footer">
        <AssistantDock />
        <ThemeToggle />
        <AuthButton email={email} />
      </div>

      <PanelResizer
        label="Resize sidebar"
        value={sidebarWidth}
        min={SIDEBAR_MIN}
        max={SIDEBAR_MAX}
        edge="left"
        defaultValue={SIDEBAR_DEFAULT}
        className="experience-resizer"
        onChange={setSidebarWidth}
      />
    </aside>
  );

  return (
    <div
      className={`experience-shell${sidebarOpen ? '' : ' experience-sidebar-collapsed'}`}
      data-experience-area={navigation.area}
      style={{ '--experience-sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <a className="experience-skip-link" href="#experience-main">
        Skip to content
      </a>
      <header className="experience-mobile-header">
        <Link className="experience-brand-mark" href="/" aria-label="Planner AI home">
          P
        </Link>
        <strong>Planner AI</strong>
        <button
          className="experience-icon-button"
          type="button"
          aria-label="Open menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu size={19} />
        </button>
      </header>
      <AssistantDock className="experience-mobile-assistant" />

      <nav className="experience-rail" aria-label="Primary navigation">
        <Link className="experience-brand-mark" href="/" aria-label="Planner AI home">
          P
        </Link>
        <div className="experience-rail-main">
          {primaryItems.slice(0, 4).map((item) => {
            const Icon = areaIcons[item.area];
            const active = experienceAreaForPath(pathname) === item.area;
            return (
              <Link
                key={item.area}
                className={active ? 'experience-rail-active' : undefined}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
        <div className="experience-rail-bottom">
          {primaryItems.slice(4).map((item) => {
            const Icon = areaIcons[item.area];
            const active = experienceAreaForPath(pathname) === item.area;
            return (
              <Link
                key={item.area}
                /* 18.1: status never relies on a coloured dot alone, so the
                   count travels in the accessible name too. */
                aria-label={item.count ? `${item.label}, ${item.count} unread` : item.label}
                aria-current={active ? 'page' : undefined}
                className={active ? 'experience-rail-active' : undefined}
                href={item.href}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
                {item.count ? <span className="experience-notification-dot" /> : null}
              </Link>
            );
          })}
          <span className="experience-avatar" aria-hidden="true">
            {email.slice(0, 2).toUpperCase() || 'PA'}
          </span>
        </div>
      </nav>

      {sidebarOpen ? sidebar : null}
      {mobileMenuOpen ? (
        <MobileDrawer onClose={() => setMobileMenuOpen(false)}>{sidebar}</MobileDrawer>
      ) : null}

      <section className="experience-work-area">
        <header className="experience-topbar">
          <div>
            <button
              className="experience-icon-button experience-desktop-sidebar-toggle"
              type="button"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
              onClick={() => setSidebarOpen((current) => !current)}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
            <span>{navigation.title}</span>
            <ChevronRight size={13} aria-hidden="true" />
            <strong>{currentLabel}</strong>
          </div>
          <div className="experience-topbar-actions">
            <button
              className="experience-command-trigger"
              type="button"
              /* The label and shortcut are hidden at the mobile breakpoint and
                 the icon is decorative, which left this button with no
                 accessible name on every authenticated page. Naming it here
                 does not depend on which parts CSS chooses to show. It leads
                 with the visible word so the spoken name still matches the
                 written one wherever both appear. */
              aria-label="Search commands and workspace"
              onClick={() => {
                setCommandQuery('');
                setCommandOpen(true);
              }}
            >
              <Search size={14} aria-hidden="true" />
              <span>Search</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="experience-sync-state">Cloud workspace</span>
          </div>
        </header>
        <main id="experience-main" className="app-main experience-main">
          {children}
        </main>
      </section>

      {commandOpen ? (
        <CommandBackdrop onClose={() => setCommandOpen(false)}>
          <form action="/search" onSubmit={submitCommandSearch} role="search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              name="q"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search or open a destination"
              aria-label="Search commands and workspace"
              maxLength={120}
              autoFocus
            />
            <button
              className="experience-icon-button"
              type="button"
              aria-label="Close command palette"
              title="Close"
              onClick={() => setCommandOpen(false)}
            >
              <X size={16} />
            </button>
          </form>
          <div className="experience-command-results">
            <p>Open</p>
            {commands.map((command) => (
              <Link
                href={command.href}
                key={`${command.href}-${command.label}`}
                onClick={() => setCommandOpen(false)}
              >
                <span>{command.label}</span>
                <small>{command.detail}</small>
              </Link>
            ))}
            {commandQuery.trim() ? (
              <button
                type="button"
                onClick={() => {
                  setCommandOpen(false);
                  router.push(`/search?q=${encodeURIComponent(commandQuery.trim())}`);
                }}
              >
                <span>Search for &quot;{commandQuery.trim()}&quot;</span>
                <small>Entire workspace</small>
              </button>
            ) : null}
          </div>
        </CommandBackdrop>
      ) : null}
    </div>
  );
}

/* Escape closes, Tab cannot leave the palette, focus starts inside and returns
   to whatever opened it (WCAG 2.1.2, 2.4.3). Same hook the /preview dialogs
   use, so the two surfaces cannot drift. */
function CommandBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useDialog<HTMLElement>(onClose);
  return (
    <div className="experience-command-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialog}
        className="experience-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

function MobileDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialog = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="experience-mobile-drawer" ref={dialog}>
      <button
        className="experience-mobile-scrim"
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
      />
      {children}
    </div>
  );
}
