'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { ShellQuickCapture } from '@/components/shell-quick-capture';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Cloud,
  FileText,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import AuthButton from '@/components/auth-button';
import { PanelResizer } from '@/components/panel-resizer';
import { useDialog } from '@/lib/use-dialog';
import { AssistantDock } from '@/components/assistant-dock';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  experienceAreaForPath,
  experienceCommands,
  experienceNavItems,
  filterExperienceCommands,
  experienceNavigationForPath,
  experienceRailItems,
  isExperienceNavItemActive,
  type ExperienceArea,
} from '@/lib/experience-navigation';

const SIDEBAR_DEFAULT = 236;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 320;
const SIDEBAR_OPEN_KEY = 'planner-sidebar-open';
const SIDEBAR_WIDTH_KEY = 'planner-sidebar-width';
const SIDEBAR_EVENT = 'planner-sidebar-change';

function subscribeToSidebar(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(SIDEBAR_EVENT, onChange);
  };
}

function sidebarOpenSnapshot() {
  return window.localStorage.getItem(SIDEBAR_OPEN_KEY) !== 'false';
}

function sidebarWidthSnapshot() {
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX
    ? stored
    : SIDEBAR_DEFAULT;
}

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
  const standaloneFlow = pathname === '/onboarding';
  const contentOwnsSidebar = pathname === '/notes';
  const router = useRouter();
  const sidebarOpen = useSyncExternalStore(subscribeToSidebar, sidebarOpenSnapshot, () => true);
  const sidebarWidth = useSyncExternalStore(
    subscribeToSidebar,
    sidebarWidthSnapshot,
    () => SIDEBAR_DEFAULT
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const navigation = useMemo(
    () => experienceNavigationForPath(pathname, canonical),
    [canonical, pathname]
  );
  const navigationItems = useMemo(() => experienceNavItems(navigation), [navigation]);
  const currentLabel =
    navigationItems.find((item) => isExperienceNavItemActive(pathname, item))?.label ??
    navigation.title;
  const primaryItems = experienceRailItems(canonical, unreadNotifications);
  const mainItems = primaryItems.filter((item) => item.placement === 'main');
  const footerItems = primaryItems.filter((item) => item.placement === 'footer');
  const commands = filterExperienceCommands(experienceCommands(canonical), commandQuery);

  const shellRef = useRef<HTMLDivElement>(null);

  // The sidebar is dragged to any width, so this cannot be a class. Written as
  // a style attribute the Content Security Policy discards it, because a nonce
  // does not extend to style attributes; through the CSSOM it applies and the
  // policy stays as strict as it was.
  useEffect(() => {
    shellRef.current?.style.setProperty('--experience-sidebar-w', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  function toggleSidebar() {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(!sidebarOpen));
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  }

  function setSidebarWidth(width: number) {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    window.dispatchEvent(new Event(SIDEBAR_EVENT));
  }

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

      {/* A composer rather than a link. The thought arrives while someone is
          in the middle of something else, and navigating to /inbox to write it
          down is the interruption Capture exists to avoid. */}
      {navigation.area === 'workspace' || navigation.area === 'planner' ? (
        <ShellQuickCapture
          label={navigation.area === 'workspace' ? 'Capture a thought' : 'Capture an action'}
        />
      ) : null}

      {/* Named "menu" rather than "sections": on /settings the in-page tab bar
          is already the "Settings sections" landmark, and two navigation
          landmarks sharing one name leaves a screen-reader user unable to tell
          the sidebar from the tab bar. */}
      <nav className="experience-secondary-nav" aria-label={`${navigation.title} menu`}>
        {navigation.sections.map((section) => (
          <div className="experience-nav-section" key={`${navigation.area}-${section.label}`}>
            <p>{section.label}</p>
            {section.items.map((item) => (
              <Link
                key={`${navigation.area}-${item.href}-${item.label}`}
                aria-current={isExperienceNavItemActive(pathname, item) ? 'page' : undefined}
                className={
                  isExperienceNavItemActive(pathname, item)
                    ? 'experience-secondary-active'
                    : undefined
                }
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>{item.label}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </Link>
            ))}
          </div>
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
      ref={shellRef}
      className={`experience-shell${sidebarOpen ? '' : ' experience-sidebar-collapsed'}${standaloneFlow ? ' experience-standalone' : ''}${contentOwnsSidebar ? ' experience-content-sidebar' : ''}`}
      data-experience-area={navigation.area}
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
          {mainItems.map((item) => {
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
          {footerItems.map((item) => {
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

      {sidebarOpen && !contentOwnsSidebar ? sidebar : null}
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
              onClick={toggleSidebar}
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
            <span className="experience-sync-state">
              <Cloud size={13} aria-hidden="true" />
              Saved
            </span>
          </div>
        </header>
        <main id="experience-main" className="app-main experience-main">
          {children}
        </main>
      </section>

      <nav className="experience-mobile-bottom-nav" aria-label="Product areas">
        {mainItems.map((item) => {
          const Icon = areaIcons[item.area];
          const active = navigation.area === item.area;
          return (
            <Link
              key={`bottom-${item.area}`}
              className={active ? 'experience-mobile-bottom-active' : undefined}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

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
            {/* Announced politely so a filter that matches nothing is heard, not
                just seen as an empty gap above the search fallback. */}
            <p className="visually-hidden" role="status">
              {commands.length === 1 ? '1 destination' : `${commands.length} destinations`}
            </p>
            {commands.length === 0 ? (
              <p className="experience-command-empty">No destination matches that.</p>
            ) : null}
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
