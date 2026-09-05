'use client';

import {
  ArrowUpRight,
  AtSign,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Circle,
  Clock3,
  Cloud,
  FileText,
  Files,
  Folder,
  History,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  ListTodo,
  Layers,
  Menu,
  Mic,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  Plus,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Table2,
  Target,
  Undo2,
  WandSparkles,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { PanelResizer } from '@/components/panel-resizer';
import { GoalsHorizonsView, VisionView } from './align-surfaces';
import { PerimeterView, type PerimeterScreen } from './perimeter';
import { ContextPanel } from './context-panel';
import { EmptyState } from './empty-state';
import {
  AiUnavailableState,
  CaptureComposer,
  CommandPalette,
  ConflictState,
  ErrorState,
  OfflineState,
  PermissionDeniedState,
  ShareState,
  TrashState,
  VersionHistoryState,
} from './states';
import styles from './preview.module.css';
import {
  files,
  focusItems,
  planRows,
  previewPages,
  type PageId,
  type PreviewPage,
} from './preview-data';

type SystemState =
  | 'offline'
  | 'conflict'
  | 'ai-offline'
  | 'ai-budget'
  | 'ai-error'
  | 'permission'
  | 'error'
  | 'notfound'
  | 'trash'
  | 'history';

/* The preview has to be walkable by a reviewer, so it carries one index of
   every screen -- including the ones that replace the whole shell. This
   switcher is preview-only chrome and is not part of the product. */
type Stage =
  | { kind: 'app' }
  | { kind: 'perimeter'; screen: PerimeterScreen }
  | { kind: 'state'; which: SystemState };

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'planner-preview-theme';
const THEME_EVENT = 'planner-preview-theme-change';

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function themeSnapshot(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

type PrimaryView = 'home' | 'planner' | 'workspace' | 'search' | 'settings' | 'notifications';
type WorkspaceMode = 'document' | 'table' | 'graph' | 'canvas';
type ContextMode = 'ai' | 'properties' | 'links';
type PlannerSurface = 'plan' | 'calendar' | 'inbox' | 'review' | 'goals' | 'vision';
type SettingsSection =
  | 'account'
  | 'preferences'
  | 'ai'
  | 'memory'
  | 'data'
  | 'integrations'
  | 'security';
export default function ProductPreviewPage() {
  const [primaryView, setPrimaryView] = useState<PrimaryView>('workspace');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('document');
  const [selectedPageId, setSelectedPageId] = useState<PageId>('personal');
  const [contextMode, setContextMode] = useState<ContextMode>('ai');
  const [contextPreference, setContextPreference] = useState<'auto' | 'open' | 'closed'>('auto');
  const [treePreference, setTreePreference] = useState<'auto' | 'open' | 'closed'>('auto');
  const [horizon, setHorizon] = useState('Today');
  const [plannerSurface, setPlannerSurface] = useState<PlannerSurface>('plan');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [completed, setCompleted] = useState<number[]>([1]);
  const [actionComposerOpen, setActionComposerOpen] = useState(false);
  const [actionDraft, setActionDraft] = useState('');
  const [customActions, setCustomActions] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: 'app' });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [contextWidth, setContextWidth] = useState(336);

  // Read through to storage rather than mirroring it into state in an effect,
  // which keeps the server and first client render agreeing on 'system'.
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, () => 'system' as const);
  const chooseTheme = (next: ThemePreference) => {
    if (next === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  const isCompact = useSyncExternalStore(
    subscribeToCompactLayout,
    compactLayoutSnapshot,
    () => true
  );
  const isNarrow = useSyncExternalStore(subscribeToNarrowLayout, narrowLayoutSnapshot, () => true);
  const isMobileBar = useSyncExternalStore(subscribeToMobileBar, mobileBarSnapshot, () => false);
  /* 14.3: the context panel is closed unless its content helps the current
     task, and 17 names a permanently open assistant as a pattern to avoid.
     Properties and backlinks earn the space on a document; a settings form
     does not. */
  const contextHelpsHere = primaryView === 'workspace' || primaryView === 'planner';
  const contextOpen =
    contextPreference === 'auto' ? contextHelpsHere && !isCompact : contextPreference === 'open';
  const treeOpen = treePreference === 'auto' ? !isNarrow : treePreference === 'open';
  const sidebarSupported = primaryView !== 'home' && primaryView !== 'search';
  const sidebarOpen = sidebarSupported && treeOpen;
  const selectedPage = previewPages[selectedPageId];

  const openPrimary = (view: PrimaryView) => {
    setPrimaryView(view);
    setTreePreference(view === 'home' || view === 'search' ? 'closed' : 'auto');
    setContextPreference('auto');
  };

  const openPlanner = (surface: PlannerSurface, nextHorizon?: string) => {
    setPrimaryView('planner');
    setPlannerSurface(surface);
    if (nextHorizon) setHorizon(nextHorizon);
    if (isNarrow) setTreePreference('closed');
  };

  const openSettings = (section: SettingsSection) => {
    setPrimaryView('settings');
    setSettingsSection(section);
    if (isNarrow) setTreePreference('closed');
  };

  const openPage = (pageId: PageId) => {
    setSelectedPageId(pageId);
    setPrimaryView('workspace');
    setWorkspaceMode('document');
    if (isNarrow) setTreePreference('closed');
  };

  const openWorkspaceMode = (mode: WorkspaceMode) => {
    setPrimaryView('workspace');
    setWorkspaceMode(mode);
    if (isNarrow) setTreePreference('closed');
  };

  const toggleComplete = (index: number) => {
    setCompleted((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  };

  const addAction = () => {
    const title = actionDraft.trim();
    if (!title) return;
    setCustomActions((current) => [...current, title]);
    setActionDraft('');
    setActionComposerOpen(false);
  };

  const shellChrome = (
    <>
      <PreviewIndex stage={stage} onGo={setStage} />
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
      {captureOpen ? <CaptureComposer onClose={() => setCaptureOpen(false)} /> : null}
      {shareOpen ? <ShareState onClose={() => setShareOpen(false)} /> : null}
    </>
  );

  const frameClass = styles.previewRoot;
  const frameStyle = {
    '--v2-sidebar-w': `${sidebarWidth}px`,
    '--v2-context-w': `${contextWidth}px`,
  } as React.CSSProperties;

  if (stage.kind === 'perimeter') {
    return (
      <div
        className={`${frameClass} ${styles.previewRootPlain}`}
        data-theme={theme === 'system' ? undefined : theme}
        style={frameStyle}
        onKeyDown={paletteShortcut(setPaletteOpen)}
      >
        <PerimeterView
          screen={stage.screen}
          onNavigate={(screen) => setStage({ kind: 'perimeter', screen })}
          onEnter={() =>
            stage.screen === 'signup'
              ? setStage({ kind: 'perimeter', screen: 'onboarding' })
              : setStage({ kind: 'app' })
          }
        />
        {shellChrome}
      </div>
    );
  }

  return (
    <div
      className={frameClass}
      data-theme={theme === 'system' ? undefined : theme}
      style={frameStyle}
      onKeyDown={paletteShortcut(setPaletteOpen)}
    >
      <a className={styles.skipLink} href="#preview-main">
        Skip to content
      </a>
      <header className={styles.mobileHeader}>
        <button className={styles.brandButton} type="button" aria-label="Planner AI home">
          P
        </button>
        <strong>Planner AI</strong>
        {/* 15 puts "receive and resolve approvals" in the mobile top six, so
            notifications and settings get a mobile home rather than being
            dropped with the rest of the desktop rail footer. */}
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Notifications"
          aria-current={primaryView === 'notifications' ? 'page' : undefined}
          onClick={() => openPrimary('notifications')}
        >
          <Bell size={19} aria-hidden="true" />
          <span className={styles.notificationDot} />
          <span className={styles.visuallyHidden}>4 unread</span>
        </button>
        <ThemeControl theme={theme} onChoose={chooseTheme} />
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Open menu"
          onClick={() => {
            if (!sidebarSupported) setPrimaryView('workspace');
            setTreePreference('open');
          }}
        >
          <Menu size={19} aria-hidden="true" />
        </button>
      </header>

      <nav className={styles.rail} aria-label="Primary navigation">
        <button className={styles.brandButton} type="button" aria-label="Planner AI home">
          P
        </button>
        <div className={styles.railMain}>
          <RailButton
            label="Home"
            active={primaryView === 'home'}
            onClick={() => openPrimary('home')}
          >
            <Home size={19} />
          </RailButton>
          <RailButton
            label="Planner"
            active={primaryView === 'planner'}
            onClick={() => openPrimary('planner')}
          >
            <CalendarDays size={19} />
          </RailButton>
          <RailButton
            label="Workspace"
            active={primaryView === 'workspace'}
            onClick={() => openPrimary('workspace')}
          >
            <Files size={19} />
          </RailButton>
          <RailButton
            label="Search"
            active={primaryView === 'search'}
            onClick={() => openPrimary('search')}
          >
            <Search size={19} />
          </RailButton>
        </div>
        {isMobileBar ? (
          <div className={styles.railMobileExtra}>
            <RailButton
              label="Settings"
              active={primaryView === 'settings'}
              onClick={() => openPrimary('settings')}
            >
              <Settings2 size={19} aria-hidden="true" />
            </RailButton>
          </div>
        ) : null}
        {isMobileBar ? null : (
          <div className={styles.railBottom}>
            <ThemeControl theme={theme} onChoose={chooseTheme} />
            <RailButton
              label="Notifications"
              active={primaryView === 'notifications'}
              onClick={() => openPrimary('notifications')}
            >
              <Bell size={19} />
              <span className={styles.notificationDot} />
            </RailButton>
            <RailButton
              label="Settings"
              active={primaryView === 'settings'}
              onClick={() => openPrimary('settings')}
            >
              <Settings2 size={19} />
            </RailButton>
            <button className={styles.avatar} type="button" aria-label="Open account menu">
              KK
            </button>
          </div>
        )}
      </nav>

      {sidebarOpen ? (
        <PreviewSidebar
          primaryView={primaryView}
          selectedPageId={selectedPageId}
          workspaceMode={workspaceMode}
          plannerSurface={plannerSurface}
          horizon={horizon}
          settingsSection={settingsSection}
          onOpenPage={openPage}
          onOpenWorkspaceMode={openWorkspaceMode}
          onOpenPlanner={openPlanner}
          onOpenSettings={openSettings}
          onOpenNotifications={() => openPrimary('notifications')}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenCapture={() => setCaptureOpen(true)}
        >
          <PanelResizer
            label="Resize sidebar"
            value={sidebarWidth}
            min={200}
            max={320}
            edge="left"
            defaultValue={248}
            className={`${styles.resizer} ${styles.resizerLeft}`}
            onChange={setSidebarWidth}
          />
        </PreviewSidebar>
      ) : null}

      <main
        id="preview-main"
        className={`${styles.workArea} ${sidebarOpen ? '' : styles.workAreaWide}`}
      >
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              className={styles.iconButton}
              type="button"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
              onClick={() => setTreePreference(sidebarOpen ? 'closed' : 'open')}
            >
              <PanelLeftClose size={17} />
            </button>
            <span className={styles.breadcrumb}>{primarySectionLabel(primaryView)}</span>
            <ChevronRight size={14} />
            <strong>
              {pageTitle(
                primaryView,
                workspaceMode,
                selectedPage.title,
                plannerSurface,
                settingsSection
              )}
            </strong>
          </div>
          <div className={styles.topBarRight}>
            <span className={styles.syncState} role="status">
              <Cloud size={14} aria-hidden="true" /> Saved
            </span>
            <button className={styles.quietButton} type="button" onClick={() => setShareOpen(true)}>
              <Share2 size={15} aria-hidden="true" /> Share
            </button>
            <button className={styles.iconButton} type="button" aria-label="More options">
              <MoreHorizontal size={18} />
            </button>
            <button
              className={`${styles.iconButton} ${contextOpen ? styles.iconButtonActive : ''}`}
              type="button"
              aria-label={contextOpen ? 'Close context panel' : 'Open context panel'}
              onClick={() => setContextPreference(contextOpen ? 'closed' : 'open')}
            >
              <PanelRightClose size={18} />
            </button>
          </div>
        </header>

        {primaryView === 'workspace' ? (
          <WorkspaceTabs mode={workspaceMode} onChange={setWorkspaceMode} />
        ) : null}

        <div className={styles.surfaceScroll}>
          {stage.kind === 'state' ? (
            <SystemStateSurface which={stage.which} onBack={() => setStage({ kind: 'app' })} />
          ) : null}
          {stage.kind === 'app' && primaryView === 'workspace' && workspaceMode === 'document' ? (
            <DocumentView page={selectedPage} />
          ) : null}
          {stage.kind === 'app' && primaryView === 'workspace' && workspaceMode === 'table' ? (
            <TableView />
          ) : null}
          {stage.kind === 'app' && primaryView === 'workspace' && workspaceMode === 'graph' ? (
            <GraphView />
          ) : null}
          {stage.kind === 'app' && primaryView === 'workspace' && workspaceMode === 'canvas' ? (
            <CanvasView />
          ) : null}
          {stage.kind === 'app' && primaryView === 'planner' ? (
            plannerSurface === 'plan' ? (
              <PlannerView
                horizon={horizon}
                setHorizon={setHorizon}
                completed={completed}
                toggleComplete={toggleComplete}
                actionComposerOpen={actionComposerOpen}
                setActionComposerOpen={setActionComposerOpen}
                actionDraft={actionDraft}
                setActionDraft={setActionDraft}
                customActions={customActions}
                onAddAction={addAction}
                onOpenCalendar={() => setPlannerSurface('calendar')}
                onPlanWithAi={() => setContextPreference('open')}
                onOpenGoal={() => openPage('planner-ai')}
              />
            ) : plannerSurface === 'calendar' ? (
              <PlannerCalendarView onOpenPlan={() => setPlannerSurface('plan')} />
            ) : plannerSurface === 'inbox' ? (
              <PlannerInboxView onOpenCalendar={() => setPlannerSurface('calendar')} />
            ) : plannerSurface === 'goals' ? (
              <GoalsHorizonsView
                onOpenPlan={() => setPlannerSurface('plan')}
                onAskAi={() => setContextPreference('open')}
              />
            ) : plannerSurface === 'vision' ? (
              <VisionView
                onOpenGoals={() => setPlannerSurface('goals')}
                onAskAi={() => setContextPreference('open')}
              />
            ) : (
              <PlannerReviewView
                onPlanNextWeek={() => {
                  setPlannerSurface('plan');
                  setHorizon('Week');
                }}
                onAskAi={() => setContextPreference('open')}
              />
            )
          ) : null}
          {stage.kind === 'app' && primaryView === 'home' ? (
            <HomeView onOpenPlanner={() => openPrimary('planner')} onOpenPage={openPage} />
          ) : null}
          {stage.kind === 'app' && primaryView === 'search' ? (
            <SearchView onOpenPage={openPage} />
          ) : null}
          {stage.kind === 'app' && primaryView === 'settings' ? (
            <SettingsView section={settingsSection} onChangeSection={openSettings} />
          ) : null}
          {stage.kind === 'app' && primaryView === 'notifications' ? <NotificationsView /> : null}
        </div>
      </main>

      {contextOpen ? (
        <ContextPanel
          mode={contextMode}
          setMode={setContextMode}
          onClose={() => setContextPreference('closed')}
          contextLabel={pageTitle(
            primaryView,
            workspaceMode,
            selectedPage.title,
            plannerSurface,
            settingsSection
          )}
          page={primaryView === 'workspace' && workspaceMode === 'document' ? selectedPage : null}
        >
          <PanelResizer
            label="Resize context panel"
            value={contextWidth}
            min={288}
            max={480}
            edge="right"
            defaultValue={336}
            className={`${styles.resizer} ${styles.resizerRight}`}
            onChange={setContextWidth}
          />
        </ContextPanel>
      ) : (
        <button
          className={styles.floatingAi}
          type="button"
          onClick={() => setContextPreference('open')}
          aria-label="Open Planner AI"
        >
          <Sparkles size={18} />
        </button>
      )}
      {shellChrome}
    </div>
  );
}

function paletteShortcut(setOpen: (open: boolean) => void) {
  return (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setOpen(true);
    }
  };
}

function SystemStateSurface({ which, onBack }: { which: SystemState; onBack: () => void }) {
  if (which === 'offline') return <OfflineState onRetry={onBack} />;
  if (which === 'conflict') return <ConflictState />;
  if (which === 'permission') return <PermissionDeniedState onBack={onBack} />;
  if (which === 'error') return <ErrorState kind="error" onBack={onBack} />;
  if (which === 'notfound') return <ErrorState kind="notfound" onBack={onBack} />;
  if (which === 'trash') return <TrashState />;
  if (which === 'history') return <VersionHistoryState />;
  return (
    <div className={styles.stateView}>
      <AiUnavailableState
        reason={which === 'ai-offline' ? 'offline' : which === 'ai-budget' ? 'budget' : 'error'}
      />
    </div>
  );
}

const previewIndex: {
  group: string;
  items: { label: string; stage: Stage }[];
}[] = [
  {
    group: 'Before the workspace',
    items: [
      { label: 'Sign in', stage: { kind: 'perimeter', screen: 'signin' } },
      { label: 'Sign up', stage: { kind: 'perimeter', screen: 'signup' } },
      { label: 'Reset password', stage: { kind: 'perimeter', screen: 'reset' } },
      { label: 'Onboarding', stage: { kind: 'perimeter', screen: 'onboarding' } },
    ],
  },
  {
    group: 'Network & sync',
    items: [
      { label: 'Working offline', stage: { kind: 'state', which: 'offline' } },
      { label: 'Sync conflict', stage: { kind: 'state', which: 'conflict' } },
    ],
  },
  {
    group: 'When AI cannot help',
    items: [
      { label: 'Assistant offline', stage: { kind: 'state', which: 'ai-offline' } },
      { label: 'Daily budget reached', stage: { kind: 'state', which: 'ai-budget' } },
      { label: 'Model did not answer', stage: { kind: 'state', which: 'ai-error' } },
    ],
  },
  {
    group: 'Failure & recovery',
    items: [
      { label: 'Permission denied', stage: { kind: 'state', which: 'permission' } },
      { label: 'View failed to load', stage: { kind: 'state', which: 'error' } },
      { label: 'Page not found', stage: { kind: 'state', which: 'notfound' } },
      { label: 'Trash', stage: { kind: 'state', which: 'trash' } },
      { label: 'Version history', stage: { kind: 'state', which: 'history' } },
    ],
  },
];

function PreviewIndex({ stage, onGo }: { stage: Stage; onGo: (next: Stage) => void }) {
  const [open, setOpen] = useState(false);
  const current =
    stage.kind === 'app' ? 'Workspace' : stage.kind === 'perimeter' ? stage.screen : stage.which;

  return (
    <div className={styles.previewIndex} data-open={open || undefined}>
      <button
        type="button"
        className={styles.previewIndexToggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Layers size={14} aria-hidden="true" />
        Screens
        <span>{current}</span>
      </button>
      {open ? (
        <div className={styles.previewIndexPanel}>
          <p className={styles.previewIndexNote}>Preview-only index. Not part of the product.</p>
          <button
            type="button"
            className={stage.kind === 'app' ? styles.previewIndexActive : ''}
            onClick={() => {
              onGo({ kind: 'app' });
              setOpen(false);
            }}
          >
            Back to the workspace
          </button>
          {previewIndex.map((group) => (
            <section key={group.group}>
              <p>{group.group}</p>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={
                    JSON.stringify(item.stage) === JSON.stringify(stage)
                      ? styles.previewIndexActive
                      : ''
                  }
                  onClick={() => {
                    onGo(item.stage);
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RailButton({
  children,
  label,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`${styles.railButton} ${active ? styles.railButtonActive : ''}`}
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_META: Record<ThemePreference, { label: string; icon: React.ReactNode }> = {
  system: { label: 'Match system', icon: <Monitor size={18} /> },
  light: { label: 'Light', icon: <Sun size={18} /> },
  dark: { label: 'Dark', icon: <Moon size={18} /> },
};

function ThemeControl({
  theme,
  onChoose,
}: {
  theme: ThemePreference;
  onChoose: (next: ThemePreference) => void;
}) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <button
      className={styles.railButton}
      type="button"
      title={`Theme: ${THEME_META[theme].label}`}
      aria-label={`Theme: ${THEME_META[theme].label}. Switch to ${THEME_META[next].label}`}
      onClick={() => onChoose(next)}
    >
      {THEME_META[theme].icon}
    </button>
  );
}

/* 16 requires a keyboard and menu path for every drag. Rather than draw a grip
   that does nothing in any input mode, this is a real control: Alt with the
   arrow keys moves the row, and each move is announced. */
function ReorderControl({
  label,
  position,
  total,
  onMove,
}: {
  label: string;
  position: number;
  total: number;
  onMove: (delta: number) => void;
}) {
  return (
    <span className={styles.reorderGroup}>
      <button
        type="button"
        className={styles.reorderButton}
        aria-label={`Move ${label} up. Currently ${position} of ${total}`}
        disabled={position === 1}
        onClick={() => onMove(-1)}
      >
        <ChevronUp size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.reorderButton}
        aria-label={`Move ${label} down. Currently ${position} of ${total}`}
        disabled={position === total}
        onClick={() => onMove(1)}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

function TreeSection({
  children,
  title,
  action,
}: {
  children: React.ReactNode;
  title: string;
  action?: string;
}) {
  return (
    <section className={styles.treeSection}>
      <div className={styles.treeSectionHeader}>
        <span>{title}</span>
        {action ? (
          <button type="button" aria-label={action} title={action}>
            <Plus size={14} />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function TreeItem({
  icon,
  label,
  active = false,
  nested = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  nested?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`${styles.treeItem} ${active ? styles.treeItemActive : ''} ${nested ? styles.treeItemNested : ''}`}
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {nested ? <ChevronRight size={13} /> : null}
      <span className={styles.treeItemIcon}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function PreviewSidebar({
  primaryView,
  selectedPageId,
  workspaceMode,
  plannerSurface,
  horizon,
  settingsSection,
  onOpenPage,
  onOpenWorkspaceMode,
  onOpenPlanner,
  onOpenSettings,
  onOpenNotifications,
  onOpenPalette,
  onOpenCapture,
  children,
}: {
  children?: React.ReactNode;
  onOpenPalette: () => void;
  onOpenCapture: () => void;
  primaryView: PrimaryView;
  selectedPageId: PageId;
  workspaceMode: WorkspaceMode;
  plannerSurface: PlannerSurface;
  horizon: string;
  settingsSection: SettingsSection;
  onOpenPage: (pageId: PageId) => void;
  onOpenWorkspaceMode: (mode: WorkspaceMode) => void;
  onOpenPlanner: (surface: PlannerSurface, horizon?: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenNotifications: () => void;
}) {
  const sidebarIdentity =
    primaryView === 'planner'
      ? { icon: 'P', title: 'Planner', subtitle: 'Direction to today' }
      : primaryView === 'settings'
        ? { icon: '⚙', title: 'Settings', subtitle: 'Workspace & account' }
        : primaryView === 'notifications'
          ? { icon: 'N', title: 'Notifications', subtitle: 'Your attention queue' }
          : { icon: 'S', title: "Sam's space", subtitle: 'Personal workspace' };

  return (
    <aside className={styles.treePanel} aria-label={`${sidebarIdentity.title} navigation`}>
      {children}
      <div className={styles.workspaceSwitcher}>
        <span className={styles.workspaceIcon}>{sidebarIdentity.icon}</span>
        <div>
          <strong>{sidebarIdentity.title}</strong>
          <span>{sidebarIdentity.subtitle}</span>
        </div>
        <ChevronDown size={15} />
      </div>

      {primaryView === 'workspace' ? (
        <button className={styles.quickSearch} type="button" onClick={onOpenPalette}>
          <Search size={15} aria-hidden="true" />
          <span>Search or run a command</span>
          <kbd>⌘ K</kbd>
        </button>
      ) : null}

      {primaryView === 'planner' ? (
        <button className={styles.sidebarPrimaryAction} type="button" onClick={onOpenCapture}>
          <Plus size={15} aria-hidden="true" /> Capture a thought
        </button>
      ) : null}

      <div className={styles.treeScroll}>
        {primaryView === 'workspace' ? (
          <>
            <TreeSection title="Favorites">
              <TreeItem
                icon={<Star size={15} />}
                label="Today"
                onClick={() => onOpenPlanner('plan', 'Today')}
              />
              <TreeItem
                icon={<span>🌄</span>}
                label="Personal operating system"
                active={selectedPageId === 'personal' && workspaceMode === 'document'}
                onClick={() => onOpenPage('personal')}
              />
            </TreeSection>
            <TreeSection title="Workspace" action="Add page">
              {files.map((file) => (
                <TreeItem
                  key={file.id}
                  icon={<span>{file.icon}</span>}
                  label={file.title}
                  active={selectedPageId === file.id && workspaceMode === 'document'}
                  onClick={() => onOpenPage(file.id)}
                />
              ))}
              <TreeItem icon={<Folder size={15} />} label="Journal" nested />
              <TreeItem
                icon={<span>{previewPages.journal.icon}</span>}
                label={previewPages.journal.title}
                active={selectedPageId === 'journal' && workspaceMode === 'document'}
                nested
                onClick={() => onOpenPage('journal')}
              />
              <TreeItem icon={<Folder size={15} />} label="Research" nested />
              <TreeItem
                icon={<span>{previewPages.research.icon}</span>}
                label={previewPages.research.title}
                active={selectedPageId === 'research' && workspaceMode === 'document'}
                nested
                onClick={() => onOpenPage('research')}
              />
              <TreeItem
                icon={<span>{previewPages['weekly-reset'].icon}</span>}
                label={previewPages['weekly-reset'].title}
                active={selectedPageId === 'weekly-reset' && workspaceMode === 'document'}
                onClick={() => onOpenPage('weekly-reset')}
              />
            </TreeSection>
            <TreeSection title="Views">
              <TreeItem
                icon={<Table2 size={15} />}
                label="Projects"
                onClick={() => onOpenWorkspaceMode('table')}
              />
              <TreeItem
                icon={<Network size={15} />}
                label="Knowledge graph"
                onClick={() => onOpenWorkspaceMode('graph')}
              />
              <TreeItem
                icon={<LayoutDashboard size={15} />}
                label="Vision canvas"
                onClick={() => onOpenWorkspaceMode('canvas')}
              />
            </TreeSection>
          </>
        ) : null}

        {primaryView === 'planner' ? (
          <>
            <TreeSection title="Plan">
              <TreeItem
                icon={<CalendarDays size={15} />}
                label="Today"
                active={plannerSurface === 'plan' && horizon === 'Today'}
                onClick={() => onOpenPlanner('plan', 'Today')}
              />
              <TreeItem
                icon={<Clock3 size={15} />}
                label="This week"
                active={plannerSurface === 'plan' && horizon === 'Week'}
                onClick={() => onOpenPlanner('plan', 'Week')}
              />
              <TreeItem
                icon={<CalendarDays size={15} />}
                label="Calendar"
                active={plannerSurface === 'calendar'}
                onClick={() => onOpenPlanner('calendar')}
              />
              <TreeItem
                icon={<ListTodo size={15} />}
                label="Action inbox"
                active={plannerSurface === 'inbox'}
                onClick={() => onOpenPlanner('inbox')}
              />
            </TreeSection>
            <TreeSection title="Align">
              <TreeItem
                icon={<History size={15} />}
                label="Weekly review"
                active={plannerSurface === 'review'}
                onClick={() => onOpenPlanner('review')}
              />
              <TreeItem
                icon={<Target size={15} />}
                label="Goals & horizons"
                active={plannerSurface === 'goals'}
                onClick={() => onOpenPlanner('goals')}
              />
              <TreeItem
                icon={<Sparkles size={15} />}
                label="Vision"
                active={plannerSurface === 'vision'}
                onClick={() => onOpenPlanner('vision')}
              />
            </TreeSection>
            <section className={styles.sidebarSnapshot}>
              <span>This week</span>
              <strong>14 of 21 actions</strong>
              <div>
                <i />
              </div>
              <small>67% complete · 3 need review</small>
            </section>
          </>
        ) : null}

        {primaryView === 'settings' ? (
          <>
            <TreeSection title="Personal">
              <TreeItem
                icon={<span>KK</span>}
                label="Account"
                active={settingsSection === 'account'}
                onClick={() => onOpenSettings('account')}
              />
              <TreeItem
                icon={<SlidersHorizontal size={15} />}
                label="Preferences"
                active={settingsSection === 'preferences'}
                onClick={() => onOpenSettings('preferences')}
              />
            </TreeSection>
            <TreeSection title="Intelligence">
              <TreeItem
                icon={<Sparkles size={15} />}
                label="AI & agents"
                active={settingsSection === 'ai'}
                onClick={() => onOpenSettings('ai')}
              />
              <TreeItem
                icon={<Network size={15} />}
                label="Memory"
                active={settingsSection === 'memory'}
                onClick={() => onOpenSettings('memory')}
              />
            </TreeSection>
            <TreeSection title="Workspace">
              <TreeItem
                icon={<Cloud size={15} />}
                label="Data & offline"
                active={settingsSection === 'data'}
                onClick={() => onOpenSettings('data')}
              />
              <TreeItem
                icon={<Link2 size={15} />}
                label="Integrations"
                active={settingsSection === 'integrations'}
                onClick={() => onOpenSettings('integrations')}
              />
              <TreeItem
                icon={<CheckCircle2 size={15} />}
                label="Security"
                active={settingsSection === 'security'}
                onClick={() => onOpenSettings('security')}
              />
            </TreeSection>
          </>
        ) : null}

        {primaryView === 'notifications' ? (
          <TreeSection title="Notifications">
            <TreeItem icon={<Bell size={15} />} label="All" active />
            <TreeItem icon={<Sparkles size={15} />} label="AI suggestions" />
            <TreeItem icon={<CalendarDays size={15} />} label="Planning reminders" />
            <TreeItem icon={<AtSign size={15} />} label="Mentions" />
          </TreeSection>
        ) : null}
      </div>

      <div className={styles.treeFooter}>
        {primaryView !== 'notifications' ? (
          <button type="button" onClick={onOpenNotifications}>
            <Bell size={15} /> Notifications
          </button>
        ) : null}
        {primaryView !== 'settings' ? (
          <button type="button" onClick={() => onOpenSettings('account')}>
            <Settings2 size={15} /> Settings
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function WorkspaceTabs({
  mode,
  onChange,
}: {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
}) {
  const items: { id: WorkspaceMode; label: string; icon: React.ReactNode }[] = [
    { id: 'document', label: 'Document', icon: <FileText size={14} /> },
    { id: 'table', label: 'Projects', icon: <Table2 size={14} /> },
    { id: 'graph', label: 'Graph', icon: <Network size={14} /> },
    { id: 'canvas', label: 'Canvas', icon: <LayoutDashboard size={14} /> },
  ];
  return (
    <nav className={styles.workspaceTabs} aria-label="Workspace views">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={mode === item.id ? 'page' : undefined}
          className={mode === item.id ? styles.workspaceTabActive : ''}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <button type="button" aria-label="Add view" title="Add view">
        <Plus size={15} />
      </button>
    </nav>
  );
}

function DocumentView({ page }: { page: PreviewPage }) {
  const coverClass = {
    focus: styles.coverFocus,
    north: styles.coverNorth,
    health: styles.coverHealth,
    product: styles.coverProduct,
    journal: styles.coverJournal,
  }[page.cover];
  const toneClass = {
    green: styles.editorCalloutGreen,
    blue: styles.editorCalloutBlue,
    coral: styles.editorCalloutCoral,
    yellow: styles.editorCalloutYellow,
  };

  return (
    <article className={styles.document}>
      <div className={`${styles.cover} ${coverClass}`}>
        <div className={styles.coverActions}>
          <button type="button">
            <ImageIcon size={14} /> Change cover
          </button>
          <button type="button" aria-label="Reposition cover">
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>
      <div className={styles.documentBody}>
        <button className={styles.pageIcon} type="button" aria-label="Change page icon">
          {page.icon}
        </button>
        <div className={styles.documentTitleRow}>
          <div>
            <h1>{page.title}</h1>
            <p className={styles.documentMeta}>
              Updated {page.updated} · {page.connections} connections
            </p>
          </div>
          <button className={styles.iconButton} type="button" aria-label="Favorite page">
            <Star size={18} />
          </button>
        </div>

        <div className={styles.propertyStrip}>
          <button type="button">
            <span>Status</span>
            <strong className={styles.statusPill}>{page.status}</strong>
          </button>
          <button type="button">
            <span>Area</span>
            <strong>{page.area}</strong>
          </button>
          <button type="button">
            <span>Review</span>
            <strong>{page.review}</strong>
          </button>
          <button type="button">
            <Plus size={14} /> Add property
          </button>
        </div>

        <p className={styles.leadParagraph}>{page.lead}</p>

        <section className={styles.aiCallout}>
          <div className={styles.aiCalloutIcon}>
            <Sparkles size={17} />
          </div>
          <div>
            <strong>{page.aiTitle}</strong>
            <p>{page.aiText}</p>
            <div className={styles.inlineActions}>
              <button type="button">Review goals</button>
              <button type="button">Dismiss</button>
            </div>
          </div>
        </section>

        <h2>{page.sectionTitle}</h2>
        <p>{page.sectionBody}</p>

        <ul className={styles.calloutGrid}>
          {page.cards.map((card) => (
            <li className={`${styles.editorCallout} ${toneClass[card.tone]}`} key={card.title}>
              <span aria-hidden="true">{card.icon}</span>
              <div>
                <strong>{card.title}</strong>
                <p>{card.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <h2>{page.listTitle}</h2>
        <ul className={styles.checkList}>
          {page.list.map((item, index) => (
            <li key={item}>
              <label>
                <input type="checkbox" defaultChecked={index === 0} />
                <span>{item}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className={styles.blockHandle}>
          <button type="button" aria-label="Insert a block below">
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Block options: move, duplicate, delete">
            <GripVertical size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function PlannerView({
  horizon,
  setHorizon,
  completed,
  toggleComplete,
  actionComposerOpen,
  setActionComposerOpen,
  actionDraft,
  setActionDraft,
  customActions,
  onAddAction,
  onOpenCalendar,
  onPlanWithAi,
  onOpenGoal,
}: {
  horizon: string;
  setHorizon: (horizon: string) => void;
  completed: number[];
  toggleComplete: (index: number) => void;
  actionComposerOpen: boolean;
  setActionComposerOpen: (open: boolean) => void;
  actionDraft: string;
  setActionDraft: (value: string) => void;
  customActions: string[];
  onAddAction: () => void;
  onOpenCalendar: () => void;
  onPlanWithAi: () => void;
  onOpenGoal: () => void;
}) {
  const horizons = ['Today', 'Week', 'Month', 'Quarter', 'Year', 'Vision'];
  return (
    <div className={styles.planner}>
      <header className={styles.plannerHeader}>
        <div>
          <p className={styles.overline}>Monday, August 25</p>
          <h1>{horizon === 'Today' ? 'Make today count' : `${horizon} plan`}</h1>
          <p>Three outcomes. Enough space to do them well.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.quietButton} type="button" onClick={onPlanWithAi}>
            <WandSparkles size={15} /> Plan with AI
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => setActionComposerOpen(true)}
          >
            <Plus size={15} /> Add action
          </button>
        </div>
      </header>

      <nav className={styles.horizonTabs} aria-label="Planning horizon">
        {horizons.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={horizon === item ? 'page' : undefined}
            className={horizon === item ? styles.horizonActive : ''}
            onClick={() => setHorizon(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      {actionComposerOpen ? (
        <form
          className={styles.actionComposer}
          onSubmit={(event) => {
            event.preventDefault();
            onAddAction();
          }}
        >
          <div>
            <span className={styles.checkCircle} />
            <input
              autoFocus
              aria-label="Action title"
              value={actionDraft}
              placeholder="What needs to happen?"
              onChange={(event) => setActionDraft(event.target.value)}
            />
          </div>
          <button type="button" onClick={() => setActionComposerOpen(false)}>
            Cancel
          </button>
          <button className={styles.primaryButton} type="submit">
            Add to today
          </button>
        </form>
      ) : null}

      <section className={styles.plannerSummary}>
        <div>
          <span>Daily focus</span>
          <strong>3 outcomes</strong>
          <small>1 complete</small>
        </div>
        <div>
          <span>Planned time</span>
          <strong>5h 10m</strong>
          <small>67% capacity</small>
        </div>
        <div>
          <span>Energy</span>
          <strong>Focused</strong>
          <small>Best before 2 PM</small>
        </div>
        <div className={styles.progressRing}>
          <span>33%</span>
        </div>
      </section>

      <div className={styles.plannerColumns}>
        <section className={styles.focusSection}>
          <div className={styles.sectionTitle}>
            <div>
              <span>Priority</span>
              <h2>Today&apos;s outcomes</h2>
            </div>
            <button type="button" aria-label="More outcome options">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className={styles.outcomeList}>
            {focusItems.map((item, index) => {
              const done = completed.includes(index);
              return (
                <button
                  key={item.title}
                  className={`${styles.outcome} ${done ? styles.outcomeDone : ''}`}
                  type="button"
                  onClick={() => toggleComplete(index)}
                >
                  <span className={`${styles.checkCircle} ${done ? styles.checkCircleDone : ''}`}>
                    {done ? <Check size={15} /> : null}
                  </span>
                  <span className={`${styles.outcomeColor} ${styles[item.color]}`} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
            {customActions.map((title, index) => {
              const actionIndex = focusItems.length + index;
              const done = completed.includes(actionIndex);
              return (
                <button
                  key={`${title}-${index}`}
                  className={`${styles.outcome} ${done ? styles.outcomeDone : ''}`}
                  type="button"
                  onClick={() => toggleComplete(actionIndex)}
                >
                  <span className={`${styles.checkCircle} ${done ? styles.checkCircleDone : ''}`}>
                    {done ? <Check size={15} /> : null}
                  </span>
                  <span className={`${styles.outcomeColor} ${styles.blue}`} />
                  <span>
                    <strong>{title}</strong>
                    <small>Today · Newly added</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
          <button
            className={styles.addRow}
            type="button"
            onClick={() => setActionComposerOpen(true)}
          >
            <Plus size={15} /> Add an outcome
          </button>
        </section>

        <section className={styles.scheduleSection}>
          <div className={styles.sectionTitle}>
            <div>
              <span>Schedule</span>
              <h2>A realistic day</h2>
            </div>
            <button type="button" onClick={onOpenCalendar}>
              <CalendarDays size={16} /> Calendar
            </button>
          </div>
          <div className={styles.timeline}>
            {planRows.map((row) => (
              <div className={styles.timelineRow} key={row.time}>
                <time>{row.time}</time>
                <span className={`${styles.timelineMarker} ${styles[row.color]}`} />
                <div>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.plannerBand}>
        <div>
          <span className={styles.overline}>Direction</span>
          <h2>Build Planner AI into a trusted daily workspace</h2>
        </div>
        <p>
          Today&apos;s work advances your Q3 goal: finish a coherent private beta that you can use
          every day.
        </p>
        <button type="button" onClick={onOpenGoal}>
          Open goal <ArrowUpRight size={15} />
        </button>
      </section>
    </div>
  );
}

function PlannerCalendarView({ onOpenPlan }: { onOpenPlan: () => void }) {
  const days = [
    ['25', '3 actions', true],
    ['26', '4 actions', false],
    ['27', '2 actions', false],
    ['28', '5 actions', false],
    ['29', '2 actions', false],
    ['30', 'Reset', false],
    ['31', 'Open', false],
  ] as const;
  return (
    <div className={styles.plannerFlow}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>August 25–31</p>
          <h1>Calendar</h1>
          <p>See commitments in time before adding more.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.quietButton} type="button">
            Today
          </button>
          <button className={styles.primaryButton} type="button" onClick={onOpenPlan}>
            <Plus size={15} /> Plan an action
          </button>
        </div>
      </header>
      <div className={styles.calendarToolbar}>
        <button type="button" aria-label="Previous week">
          <ChevronRight size={16} />
        </button>
        <strong>Week of August 25</strong>
        <button type="button" aria-label="Next week">
          <ChevronRight size={16} />
        </button>
        <span />
        <button className={styles.calendarViewActive} type="button">
          Week
        </button>
        <button type="button">Month</button>
      </div>
      <section className={styles.weekStrip} aria-label="Week calendar">
        {days.map(([day, summary, active], index) => (
          <button className={active ? styles.weekDayActive : ''} type="button" key={day}>
            <span>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]}</span>
            <strong>{day}</strong>
            <small>{summary}</small>
          </button>
        ))}
      </section>
      <div className={styles.calendarColumns}>
        <section>
          <div className={styles.sectionTitle}>
            <div>
              <span>Monday</span>
              <h2>August 25</h2>
            </div>
            <button type="button">
              <Plus size={15} /> Add
            </button>
          </div>
          <div className={styles.daySchedule}>
            {planRows.map((row) => (
              <button type="button" key={row.time}>
                <time>{row.time}</time>
                <i className={styles[row.color]} />
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                <MoreHorizontal size={15} />
              </button>
            ))}
          </div>
        </section>
        <aside className={styles.calendarInsights}>
          <span className={styles.overline}>Capacity</span>
          <h2>Two hours remain open</h2>
          <p>
            Your focused work is front-loaded. Keep the 3:00–5:00 PM block uncommitted for overflow.
          </p>
          <div className={styles.capacityBar}>
            <i />
          </div>
          <dl>
            <div>
              <dt>Focused</dt>
              <dd>3h 30m</dd>
            </div>
            <div>
              <dt>Meetings</dt>
              <dd>45m</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>2h</dd>
            </div>
          </dl>
          <button type="button">
            <Sparkles size={15} /> Rebalance with AI
          </button>
        </aside>
      </div>
    </div>
  );
}

const INITIAL_INBOX = [
  ['Call the insurance company', 'Captured 18 min ago', 'Likely 15 minutes'],
  ['Research local-first sync approaches', 'From AI workspace research', 'Connects to Planner AI'],
  ['Plan dinner with family', 'Captured yesterday', 'Personal'],
  ['Renew passport', 'Captured Aug 22', 'Due this month'],
];

function PlannerInboxView({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const [resolved, setResolved] = useState<string[]>([]);
  const [inbox, setInbox] = useState(INITIAL_INBOX);
  const [announcement, setAnnouncement] = useState('');

  const move = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= inbox.length) return;
    setInbox((current) => {
      const copy = [...current];
      const [row] = copy.splice(index, 1);
      copy.splice(next, 0, row);
      return copy;
    });
    setAnnouncement(`${inbox[index][0]} moved to position ${next + 1} of ${inbox.length}`);
  };
  return (
    <div className={styles.plannerFlow}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>Triage</p>
          <h1>Action inbox</h1>
          <p>Give every loose commitment a place, date, or deliberate no.</p>
        </div>
        <span className={styles.inboxCount}>{inbox.length - resolved.length} unprocessed</span>
      </header>
      <p className={styles.visuallyHidden} role="status">
        {announcement}
      </p>
      <section className={styles.triageList}>
        {inbox.map((item, index) =>
          resolved.includes(item[0]) ? null : (
            <article key={item[0]}>
              <ReorderControl
                label={item[0]}
                position={index + 1}
                total={inbox.length}
                onMove={(delta) => move(index, delta)}
              />
              <div>
                <strong>{item[0]}</strong>
                <small>
                  {item[1]} · {item[2]}
                </small>
              </div>
              <div className={styles.triageActions}>
                <button
                  type="button"
                  onClick={() => {
                    setResolved((current) => [...current, item[0]]);
                    onOpenCalendar();
                  }}
                >
                  <CalendarDays size={14} aria-hidden="true" /> Schedule
                </button>
                <button
                  type="button"
                  onClick={() => setResolved((current) => [...current, item[0]])}
                >
                  <Target size={14} aria-hidden="true" /> Project
                </button>
                <button
                  type="button"
                  onClick={() => setResolved((current) => [...current, item[0]])}
                >
                  <Check size={14} aria-hidden="true" /> Done
                </button>
                <button type="button" aria-label={`More options for ${item[0]}`}>
                  <MoreHorizontal size={15} />
                </button>
              </div>
            </article>
          )
        )}
        {resolved.length === inbox.length ? (
          <div className={styles.emptyFlow}>
            <CheckCircle2 size={28} />
            <h2>Inbox clear</h2>
            <p>Every captured action has a home.</p>
          </div>
        ) : null}
      </section>
      <footer className={styles.flowTip}>
        <Sparkles size={16} />
        <p>
          <strong>AI can prepare the decision.</strong> It can suggest dates, projects, and duration
          while you remain in control of the commitment.
        </p>
        <button type="button">Triage all with AI</button>
      </footer>
    </div>
  );
}

function PlannerReviewView({
  onPlanNextWeek,
  onAskAi,
}: {
  onPlanNextWeek: () => void;
  onAskAi: () => void;
}) {
  return (
    <div className={styles.plannerFlow}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>Week 35</p>
          <h1>Weekly review</h1>
          <p>Close the loop before choosing what comes next.</p>
        </div>
        <button className={styles.quietButton} type="button" onClick={onAskAi}>
          <Sparkles size={15} /> Review with AI
        </button>
      </header>
      <section className={styles.reviewScoreboard}>
        <div>
          <span>Completed</span>
          <strong>14 / 21</strong>
          <small>67% of planned actions</small>
        </div>
        <div>
          <span>Focused time</span>
          <strong>11h 40m</strong>
          <small>Up 1h 20m</small>
        </div>
        <div>
          <span>Carried over</span>
          <strong>3</strong>
          <small>Two carried twice</small>
        </div>
        <div>
          <span>Energy</span>
          <strong>7.4 / 10</strong>
          <small>Best on Tuesday</small>
        </div>
      </section>
      <div className={styles.reviewColumns}>
        <section>
          <div className={styles.sectionTitle}>
            <div>
              <span>Reflect</span>
              <h2>What did the week teach you?</h2>
            </div>
          </div>
          <label className={styles.reviewPrompt}>
            <span>What moved forward?</span>
            <textarea defaultValue="The frontend direction became tangible and easier to evaluate." />
          </label>
          <label className={styles.reviewPrompt}>
            <span>What created friction?</span>
            <textarea placeholder="Write a sentence or ask AI to summarize the evidence..." />
          </label>
          <label className={styles.reviewPrompt}>
            <span>What changes next week?</span>
            <textarea placeholder="Choose one adjustment..." />
          </label>
        </section>
        <section>
          <div className={styles.sectionTitle}>
            <div>
              <span>Evidence</span>
              <h2>Patterns worth noticing</h2>
            </div>
          </div>
          <div className={styles.insightRows}>
            <div>
              <i className={styles.green} />
              <span>
                <strong>Morning focus held</strong>
                <small>Four of five deep-work blocks started before 9 AM.</small>
              </span>
            </div>
            <div>
              <i className={styles.coral} />
              <span>
                <strong>Planning work expanded</strong>
                <small>Two actions took more than twice their estimate.</small>
              </span>
            </div>
            <div>
              <i className={styles.blue} />
              <span>
                <strong>Health supported output</strong>
                <small>Training days correlated with stronger energy notes.</small>
              </span>
            </div>
          </div>
        </section>
      </div>
      <footer className={styles.reviewFooter}>
        <div>
          <CheckCircle2 size={18} />
          <span>
            <strong>Review saved locally</strong>
            <small>Your reflections remain private until sync.</small>
          </span>
        </div>
        <button className={styles.primaryButton} type="button" onClick={onPlanNextWeek}>
          Plan next week <ArrowUpRight size={15} />
        </button>
      </footer>
    </div>
  );
}

function TableView() {
  const rows = [
    ['Planner AI private beta', 'In progress', 'High', 'Aug 30', '68%'],
    ['Personal health reset', 'On track', 'Medium', 'Sep 14', '42%'],
    ['Financial operating plan', 'Planning', 'Medium', 'Sep 01', '20%'],
    ['Home systems', 'Paused', 'Low', 'Oct 10', '15%'],
  ];
  return (
    <div className={styles.databaseView}>
      <header className={styles.databaseHeader}>
        <div>
          <span className={styles.databaseIcon}>✦</span>
          <div>
            <h1>Projects</h1>
            <p>12 projects · 4 active</p>
          </div>
        </div>
        <button className={styles.primaryButton} type="button">
          <Plus size={15} /> New project
        </button>
      </header>
      <div className={styles.databaseToolbar}>
        <div>
          <button className={styles.activeView} type="button">
            <Table2 size={15} /> Table
          </button>
          <button type="button">
            <LayoutDashboard size={15} /> Board
          </button>
          <button type="button">
            <CalendarDays size={15} /> Calendar
          </button>
        </div>
        <div>
          <button type="button">
            <SlidersHorizontal size={15} /> Filter
          </button>
          <button type="button">
            <ArrowUpRight size={15} /> Sort
          </button>
          <button type="button">
            <Search size={15} />
          </button>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Target</th>
              <th>Progress</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row[0]}>
                <td>
                  <span className={styles.rowIcon}>{['✦', '🌱', '◫', '⌂'][index]}</span>
                  <strong>{row[0]}</strong>
                </td>
                <td>
                  <span className={`${styles.tableStatus} ${styles[`tableStatus${index}`]}`}>
                    {row[1]}
                  </span>
                </td>
                <td>{row[2]}</td>
                <td>{row[3]}</td>
                <td>
                  <span className={styles.progressBar}>
                    <i style={{ width: row[4] }} />
                  </span>
                  {row[4]}
                </td>
                <td>
                  <button type="button" aria-label={`Open ${row[0]}`}>
                    <MoreHorizontal size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className={styles.newTableRow} type="button">
          <Plus size={15} /> New project
        </button>
      </div>
    </div>
  );
}

function GraphView() {
  return (
    <div className={styles.graphView}>
      <div className={styles.spatialToolbar}>
        <div>
          <strong>Knowledge graph</strong>
          <span>28 pages · 46 connections</span>
        </div>
        <div>
          <button type="button">
            <Search size={15} /> Find
          </button>
          <button type="button">
            <SlidersHorizontal size={15} /> Filter
          </button>
          <button type="button">
            <Target size={15} /> Center
          </button>
        </div>
      </div>
      <div className={styles.graphCanvas} aria-label="Knowledge graph preview">
        <span className={`${styles.graphLine} ${styles.lineOne}`} />
        <span className={`${styles.graphLine} ${styles.lineTwo}`} />
        <span className={`${styles.graphLine} ${styles.lineThree}`} />
        <span className={`${styles.graphLine} ${styles.lineFour}`} />
        <span className={`${styles.graphLine} ${styles.lineFive}`} />
        <GraphNode className={styles.nodeCenter} icon="🌄" label="Personal OS" main />
        <GraphNode className={styles.nodeOne} icon="🧭" label="North star" />
        <GraphNode className={styles.nodeTwo} icon="✦" label="Planner AI" />
        <GraphNode className={styles.nodeThree} icon="🌱" label="Health" />
        <GraphNode className={styles.nodeFour} icon="☀" label="Morning routine" />
        <GraphNode className={styles.nodeFive} icon="◫" label="Q3 goals" />
        <div className={styles.graphLegend}>
          <span>
            <i className={styles.legendPage} /> Page
          </span>
          <span>
            <i className={styles.legendGoal} /> Goal
          </span>
          <span>
            <i className={styles.legendAction} /> Action
          </span>
        </div>
      </div>
    </div>
  );
}

function GraphNode({
  className,
  icon,
  label,
  main = false,
}: {
  className: string;
  icon: string;
  label: string;
  main?: boolean;
}) {
  return (
    <button
      className={`${styles.graphNode} ${className} ${main ? styles.graphNodeMain : ''}`}
      type="button"
    >
      <span>{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function CanvasView() {
  return (
    <div className={styles.canvasView}>
      <div className={styles.spatialToolbar}>
        <div>
          <strong>Vision canvas</strong>
          <span>Saved just now</span>
        </div>
        <div>
          <button type="button">
            <Undo2 size={15} />
          </button>
          <button type="button">
            <Plus size={15} /> Add
          </button>
          <button type="button">
            <Share2 size={15} aria-hidden="true" /> Share
          </button>
        </div>
      </div>
      <div className={styles.canvasSurface}>
        <div className={`${styles.canvasGroup} ${styles.canvasGroupOne}`}>
          <span>Direction</span>
        </div>
        <div className={`${styles.canvasGroup} ${styles.canvasGroupTwo}`}>
          <span>Now</span>
        </div>
        <article className={`${styles.canvasCard} ${styles.canvasVision}`}>
          <span>🧭</span>
          <small>VISION</small>
          <h2>Build a life of useful work, strong relationships, and steady growth.</h2>
        </article>
        <article className={`${styles.canvasCard} ${styles.canvasGoal}`}>
          <small>Q3 GOAL</small>
          <h3>Planner AI private beta</h3>
          <p>Build the workspace I want to use every day.</p>
          <span className={styles.canvasProgress}>
            <i />
          </span>
        </article>
        <article className={`${styles.canvasCard} ${styles.canvasNote}`}>
          <small>PRINCIPLE</small>
          <h3>Calm urgency</h3>
          <p>Move deliberately. Keep momentum. Protect quality.</p>
        </article>
        <article className={`${styles.canvasCard} ${styles.canvasActions}`}>
          <small>THIS WEEK</small>
          <label>
            <CheckCircle2 size={15} /> Frontend direction
          </label>
          <label>
            <Circle size={15} /> Editor prototype
          </label>
          <label>
            <Circle size={15} /> User test
          </label>
        </article>
        <button className={styles.canvasAdd} type="button" aria-label="Add canvas item">
          <Plus size={19} />
        </button>
      </div>
    </div>
  );
}

function HomeView({
  onOpenPlanner,
  onOpenPage,
}: {
  onOpenPlanner: () => void;
  onOpenPage: (pageId: PageId) => void;
}) {
  return (
    <div className={styles.homeView}>
      <header>
        <div>
          <p className={styles.overline}>Monday, August 25</p>
          <h1>Good morning, Sam.</h1>
          <p>Start with what is on your mind, or continue where you left off.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={onOpenPlanner}>
          Open today <ArrowUpRight size={15} />
        </button>
      </header>
      <section className={styles.captureComposer}>
        <div>
          <Sparkles size={18} />
          <textarea
            aria-label="Quick capture"
            placeholder="Capture a thought, task, note, or idea..."
          />
        </div>
        <footer>
          <div>
            <button type="button" aria-label="Attach file">
              <Paperclip size={16} />
            </button>
            <button type="button" aria-label="Mention page">
              <AtSign size={16} />
            </button>
            <span>Saved locally first</span>
          </div>
          <div>
            <button className={styles.micButton} type="button" aria-label="Record voice capture">
              <Mic size={17} />
            </button>
            <button className={styles.sendButton} type="button" aria-label="Save capture">
              <ArrowUpRight size={17} />
            </button>
          </div>
        </footer>
      </section>
      <div className={styles.homeColumns}>
        <section>
          <div className={styles.sectionTitle}>
            <div>
              <span>Continue</span>
              <h2>Recent work</h2>
            </div>
            <button type="button">View all</button>
          </div>
          <div className={styles.recentList}>
            <button type="button" onClick={() => onOpenPage('personal')}>
              <span className={styles.recentCover}>🌄</span>
              <span>
                <strong>Personal operating system</strong>
                <small>Edited 4 minutes ago · Page</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={() => onOpenPage('planner-ai')}>
              <span className={`${styles.recentCover} ${styles.recentCoverBlue}`}>✦</span>
              <span>
                <strong>Planner AI private beta</strong>
                <small>Edited yesterday · Project</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={() => onOpenPage('journal')}>
              <span className={`${styles.recentCover} ${styles.recentCoverYellow}`}>☀</span>
              <span>
                <strong>August 25 journal</strong>
                <small>Edited yesterday · Note</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
        <section>
          <div className={styles.sectionTitle}>
            <div>
              <span>Today</span>
              <h2>Next three</h2>
            </div>
            <button type="button" onClick={onOpenPlanner}>
              Open plan
            </button>
          </div>
          <div className={styles.miniFocus}>
            {focusItems.map((item, index) => (
              <div key={item.title}>
                <span>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type SearchScope = 'Everything' | 'Pages' | 'Actions' | 'Projects';

const searchResults: Array<{
  page: PageId;
  icon: string;
  title: string;
  snippet: React.ReactNode;
  meta: string;
  kind: Exclude<SearchScope, 'Everything'>;
}> = [
  {
    page: 'planner-ai',
    icon: '✦',
    title: 'Planner AI private beta',
    snippet: (
      <>
        Build the workspace I want to use every day, with a dependable <mark>planner</mark> and
        AI...
      </>
    ),
    meta: 'Project · Updated today',
    kind: 'Projects',
  },
  {
    page: 'personal',
    icon: '🌄',
    title: 'Personal operating system',
    snippet: (
      <>
        A simple system for deciding what deserves my attention and connecting actions to a larger{' '}
        <mark>plan</mark>...
      </>
    ),
    meta: 'Page · Updated today',
    kind: 'Pages',
  },
  {
    page: 'weekly-reset',
    icon: '🗓',
    title: 'Weekly planning ritual',
    snippet: (
      <>Review evidence, clear the inbox, and choose five commitments for the coming week.</>
    ),
    meta: 'Template · Updated Aug 20',
    kind: 'Pages',
  },
  {
    page: 'planner-ai',
    icon: '☑',
    title: 'Finalize the product story',
    snippet: (
      <>
        Write the one paragraph that explains what <mark>Planner</mark> is for before the beta
        invites go out.
      </>
    ),
    meta: 'Action · Due today · Planner AI',
    kind: 'Actions',
  },
];

function SearchView({ onOpenPage }: { onOpenPage: (pageId: PageId) => void }) {
  const [scope, setScope] = useState<SearchScope>('Everything');
  const shown = searchResults.filter((item) => scope === 'Everything' || item.kind === scope);

  return (
    <div className={styles.searchView}>
      <div className={styles.searchHero}>
        <Search size={22} aria-hidden="true" />
        <input autoFocus aria-label="Search workspace" defaultValue="planner" />
        <kbd>ESC</kbd>
      </div>
      <div className={styles.searchFilters} role="group" aria-label="Narrow results">
        {(['Everything', 'Pages', 'Actions', 'Projects'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={scope === item}
            className={scope === item ? styles.searchFilterActive : ''}
            onClick={() => setScope(item)}
          >
            {item}
          </button>
        ))}
        <button type="button">
          <SlidersHorizontal size={14} aria-hidden="true" /> Filters
        </button>
      </div>
      <section>
        <p className={styles.overline} role="status">
          {shown.length === 0
            ? 'No matches'
            : `${shown.length} ${shown.length === 1 ? 'match' : 'matches'}`}
        </p>
        {shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} aria-hidden="true" />}
            title={`Nothing in ${scope.toLowerCase()} matches “planner”`}
            body="Search covers titles, body text, and properties. Try a different scope, or search everything."
            action={{ label: 'Search everything', onClick: () => setScope('Everything') }}
          />
        ) : (
          <ul className={styles.searchResults}>
            {shown.map((item) => (
              <li key={`${item.title}-${item.kind}`}>
                <button type="button" onClick={() => onOpenPage(item.page)}>
                  <span aria-hidden="true">{item.icon}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.snippet}</p>
                    <small>{item.meta}</small>
                  </div>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const settingsContent: Record<
  SettingsSection,
  {
    eyebrow: string;
    title: string;
    description: string;
    groups: Array<{ title: string; rows: Array<[string, string, boolean?]> }>;
  }
> = {
  account: {
    eyebrow: 'Personal',
    title: 'Account',
    description: 'Your identity and the defaults attached to this workspace.',
    groups: [
      {
        title: 'Profile',
        rows: [
          ['Name', 'Sam Rivera'],
          ['Email', 'sam@example.com'],
          ['Time zone', 'Eastern Time (US & Canada)'],
        ],
      },
    ],
  },
  preferences: {
    eyebrow: 'Experience',
    title: 'Preferences',
    description: 'Shape how Planner AI looks, feels, and gets out of your way.',
    groups: [
      {
        title: 'Appearance',
        rows: [
          ['Theme', 'System'],
          ['Document width', 'Comfortable'],
          ['Reduce motion', 'Off', true],
        ],
      },
      {
        title: 'Planning',
        rows: [
          ['Start of week', 'Monday'],
          ['Default planning view', 'Today'],
          ['Show completed actions', 'On', true],
        ],
      },
    ],
  },
  ai: {
    eyebrow: 'Intelligence',
    title: 'AI & agents',
    description: 'Control how AI prepares, proposes, and executes work on your behalf.',
    groups: [
      {
        title: 'Behavior',
        rows: [
          ['Default model', 'Automatic'],
          ['Approval for writes', 'Always required'],
          ['Proactive suggestions', 'On', true],
        ],
      },
      {
        title: 'Agent access',
        rows: [
          ['Workspace operations', '50 available'],
          ['MCP connections', '2 connected'],
          ['Daily AI budget', '$2.00 limit'],
        ],
      },
    ],
  },
  memory: {
    eyebrow: 'Intelligence',
    title: 'Memory',
    description: 'Inspect what Planner AI is allowed to remember and use as context.',
    groups: [
      {
        title: 'Memory policy',
        rows: [
          ['Personal preferences', '12 memories'],
          ['Planning patterns', '8 memories'],
          ['Automatic memory', 'Ask first', true],
        ],
      },
    ],
  },
  data: {
    eyebrow: 'Ownership',
    title: 'Data & offline',
    description: 'Keep accepted work durable locally and understand what has synchronized.',
    groups: [
      {
        title: 'Local-first storage',
        rows: [
          ['Device database', 'Healthy'],
          ['Last synchronized', 'Just now'],
          ['Offline editing', 'Available', true],
        ],
      },
      {
        title: 'Portability',
        rows: [
          ['Markdown export', 'Ready'],
          ['Full workspace export', 'Generate'],
          ['Version history', '90 days'],
        ],
      },
    ],
  },
  integrations: {
    eyebrow: 'Connections',
    title: 'Integrations',
    description: 'Connect calendars, AI clients, and services without surrendering data control.',
    groups: [
      {
        title: 'Connected',
        rows: [
          ['Google Calendar', 'Connected'],
          ['Planner AI MCP', 'Configured'],
          ['Git version history', 'Not connected'],
        ],
      },
    ],
  },
  security: {
    eyebrow: 'Protection',
    title: 'Security',
    description: 'Manage sessions, permissions, encryption, and irreversible account actions.',
    groups: [
      {
        title: 'Access',
        rows: [
          ['Password', 'Updated recently'],
          ['Active sessions', '2 devices'],
          ['Two-factor authentication', 'Set up'],
        ],
      },
      {
        title: 'Data protection',
        rows: [
          ['Local encryption', 'Enabled'],
          ['Agent audit log', 'View activity'],
          ['Delete account', 'Review'],
        ],
      },
    ],
  },
};

function SettingsView({
  section,
  onChangeSection,
}: {
  section: SettingsSection;
  onChangeSection: (section: SettingsSection) => void;
}) {
  const content = settingsContent[section];
  return (
    <div className={styles.settingsView}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
      </header>
      {section === 'account' ? (
        <section className={styles.profileSummary}>
          <span>KK</span>
          <div>
            <strong>Sam Rivera</strong>
            <small>Owner · Personal workspace</small>
          </div>
          <button type="button">Change photo</button>
        </section>
      ) : null}
      {content.groups.map((group) => (
        <section className={styles.settingsGroup} key={group.title}>
          <header>
            <h2>{group.title}</h2>
            <p>Changes are saved automatically.</p>
          </header>
          <div>
            {group.rows.map(([label, value, toggle]) => (
              <button type="button" key={label} onClick={toggle ? undefined : () => undefined}>
                <span>
                  <strong>{label}</strong>
                  <small>{value}</small>
                </span>
                {toggle ? (
                  <span
                    className={`${styles.settingToggle} ${value === 'Off' ? '' : styles.settingToggleOn}`}
                  >
                    <i />
                  </span>
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
      <nav className={styles.settingsQuickLinks} aria-label="Related settings">
        {(Object.keys(settingsContent) as SettingsSection[])
          .filter((item) => item !== section)
          .slice(0, 3)
          .map((item) => (
            <button type="button" key={item} onClick={() => onChangeSection(item)}>
              {settingsContent[item].title}
              <ArrowUpRight size={14} />
            </button>
          ))}
      </nav>
    </div>
  );
}

function NotificationsView() {
  const [read, setRead] = useState<number[]>([]);
  const notifications = [
    [
      'Your weekly review is ready',
      'Planner AI prepared evidence from 14 completed actions.',
      'Now',
      'ai',
    ],
    [
      'Two actions need a date',
      '“Renew passport” and “Review finances” are still unplanned.',
      '24 min',
      'plan',
    ],
    [
      'Offline changes synchronized',
      'Seven local changes are now backed up securely.',
      '1 hr',
      'sync',
    ],
    [
      'Planner AI private beta moved forward',
      'Your project reached 68% based on completed milestones.',
      'Yesterday',
      'goal',
    ],
  ];
  return (
    <div className={styles.notificationsView}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>Attention</p>
          <h1>Notifications</h1>
          <p>Useful changes and decisions, without a noisy activity stream.</p>
        </div>
        <button
          className={styles.quietButton}
          type="button"
          onClick={() => setRead(notifications.map((_, index) => index))}
        >
          Mark all read
        </button>
      </header>
      <div className={styles.notificationFilters} role="group" aria-label="Filter notifications">
        {['All', 'Planning', 'AI', 'Mentions'].map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === 'All'}
            className={item === 'All' ? styles.searchFilterActive : ''}
          >
            {item}
          </button>
        ))}
      </div>
      <p className={styles.visuallyHidden} role="status">
        {notifications.length - read.length} unread
      </p>
      {read.length === notifications.length ? (
        <EmptyState
          icon={<Check size={20} aria-hidden="true" />}
          title="You are caught up"
          body="New notifications appear when a review is ready, a commitment loses its date, or the assistant needs a decision from you."
          secondary={{ label: 'Show read notifications', onClick: () => setRead([]) }}
        />
      ) : null}
      <section className={styles.notificationList}>
        {notifications.map(([title, description, time, kind], index) => (
          <button
            className={read.includes(index) ? styles.notificationRead : ''}
            type="button"
            key={title}
            onClick={() =>
              setRead((current) => (current.includes(index) ? current : [...current, index]))
            }
          >
            <span className={`${styles.notificationIcon} ${styles[`notificationIcon${kind}`]}`}>
              {kind === 'ai' ? (
                <Sparkles size={16} />
              ) : kind === 'plan' ? (
                <CalendarDays size={16} />
              ) : kind === 'sync' ? (
                <Cloud size={16} />
              ) : (
                <Target size={16} />
              )}
            </span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <time>{time}</time>
            {read.includes(index) ? (
              <span className={styles.notificationState}>Read</span>
            ) : (
              <span className={`${styles.notificationState} ${styles.notificationUnread}`}>
                <i aria-hidden="true" /> Unread
              </span>
            )}
          </button>
        ))}
      </section>
    </div>
  );
}

function primarySectionLabel(primary: PrimaryView) {
  if (primary === 'workspace') return 'Personal';
  if (primary === 'planner') return 'Planner';
  if (primary === 'settings') return 'Settings';
  if (primary === 'notifications') return 'Notifications';
  return 'Planner AI';
}

function pageTitle(
  primary: PrimaryView,
  mode: WorkspaceMode,
  selectedPageTitle: string,
  plannerSurface: PlannerSurface,
  settingsSection: SettingsSection
) {
  if (primary === 'planner') {
    if (plannerSurface === 'calendar') return 'Calendar';
    if (plannerSurface === 'inbox') return 'Action inbox';
    if (plannerSurface === 'review') return 'Weekly review';
    if (plannerSurface === 'goals') return 'Goals & horizons';
    if (plannerSurface === 'vision') return 'Vision';
    return 'Plan';
  }
  if (primary === 'home') return 'Home';
  if (primary === 'search') return 'Search';
  if (primary === 'settings') return settingsContent[settingsSection].title;
  if (primary === 'notifications') return 'All notifications';
  if (mode === 'table') return 'Projects';
  if (mode === 'graph') return 'Knowledge graph';
  if (mode === 'canvas') return 'Vision canvas';
  return selectedPageTitle;
}

function subscribeToCompactLayout(onChange: () => void) {
  const query = window.matchMedia('(max-width: 1180px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function compactLayoutSnapshot() {
  return window.matchMedia('(max-width: 1180px)').matches;
}

/* The mobile tab bar appears at 600px. Settings lives in the rail footer on
   desktop and in the tab bar on mobile -- rendering both and hiding one with
   CSS left two controls named "Settings" in the same nav, which is a duplicate
   in the accessibility tree, not just a test nuisance. */
const MOBILE_BAR = '(max-width: 600px)';

function subscribeToMobileBar(onChange: () => void) {
  const query = window.matchMedia(MOBILE_BAR);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function mobileBarSnapshot() {
  return window.matchMedia(MOBILE_BAR).matches;
}

function subscribeToNarrowLayout(onChange: () => void) {
  const query = window.matchMedia('(max-width: 820px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function narrowLayoutSnapshot() {
  return window.matchMedia('(max-width: 820px)').matches;
}
