'use client';

import {
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  History,
  Image as ImageIcon,
  Link2,
  ListTodo,
  Mic,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Target,
  WandSparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { OperationProposal } from './operation-proposal';
import { TabList } from '@/components/shell/tab-list';
import type { PreviewPage } from './preview-data';
import styles from './preview.module.css';

type ContextMode = 'ai' | 'properties' | 'links';

export function ContextPanel({
  mode,
  setMode,
  onClose,
  contextLabel,
  page,
  children,
}: {
  children?: React.ReactNode;
  mode: ContextMode;
  setMode: (mode: ContextMode) => void;
  onClose: () => void;
  contextLabel: string;
  page: PreviewPage | null;
}) {
  return (
    <aside className={styles.contextPanel} aria-label="Context and assistant">
      {children}
      <header className={styles.contextHeader}>
        <div>
          <span className={styles.aiMark}>
            <Sparkles size={16} />
          </span>
          <div>
            <strong>Planner AI</strong>
            <span>Working with {contextLabel}</span>
          </div>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <TabList
        label="Context panel"
        className={styles.contextTabs}
        activeClassName={styles.contextTabActive}
        value={mode}
        onChange={setMode}
        items={[
          { id: 'ai', label: 'AI', icon: <Sparkles size={14} /> },
          { id: 'properties', label: 'Properties', icon: <SlidersHorizontal size={14} /> },
          { id: 'links', label: 'Links', icon: <Link2 size={14} /> },
        ]}
      />
      <div id={`tabpanel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} tabIndex={-1}>
        {mode === 'ai' ? <AiContext contextLabel={contextLabel} page={page} /> : null}
        {mode === 'properties' ? (
          <PropertiesContext contextLabel={contextLabel} page={page} />
        ) : null}
        {mode === 'links' ? <LinksContext /> : null}
      </div>
    </aside>
  );
}

/* Suggestions are written per surface. A generic four-bullet card repeated on
   every screen teaches people to ignore the panel, which is the failure 17
   calls out by name. If a surface has nothing specific to offer, it offers
   nothing. */
const surfaceSuggestions: Record<
  string,
  { label: string; detail: string; icon: React.ReactNode; goal: string; scope: string[] }[]
> = {
  'Action inbox': [
    {
      label: 'Give every loose action a date',
      detail: '4 unprocessed · uses your notes for context',
      icon: <CalendarDays size={15} aria-hidden="true" />,
      goal: 'Give every unplanned action a date',
      scope: ['Action inbox', '4 selected'],
    },
    {
      label: 'File actions under the right project',
      detail: 'Matches wording against your active goals',
      icon: <Folder size={15} aria-hidden="true" />,
      goal: 'File loose actions under the right project',
      scope: ['Action inbox', '4 selected'],
    },
  ],
  Plan: [
    {
      label: 'Rebalance today against your energy',
      detail: '5h 10m planned in a day with 3h 30m of focus left',
      icon: <Clock3 size={15} aria-hidden="true" />,
      goal: 'Rebalance today against remaining focus time',
      scope: ['Today', '3 outcomes'],
    },
    {
      label: 'Connect today to a goal',
      detail: '1 outcome has no goal above it',
      icon: <Target size={15} aria-hidden="true" />,
      goal: 'Connect unlinked outcomes to a goal',
      scope: ['Today', '1 unlinked'],
    },
  ],
  'Weekly review': [
    {
      label: 'Draft the review from evidence',
      detail: '14 completed actions, 3 carried over',
      icon: <History size={15} aria-hidden="true" />,
      goal: 'Draft this week\u2019s review from completed work',
      scope: ['Week 35', '17 actions'],
    },
  ],
  'Goals & horizons': [
    {
      label: 'Explain the two drifting goals',
      detail: 'Compares each measure against the last four weeks',
      icon: <History size={15} aria-hidden="true" />,
      goal: 'Explain where the drifting goals went off measure',
      scope: ['4 goals', '2 drifting'],
    },
    {
      label: 'Propose a smaller measure',
      detail: 'For the goal with no scheduled action',
      icon: <Target size={15} aria-hidden="true" />,
      goal: 'Propose a measure you would actually meet',
      scope: ['Put the finances on a monthly rhythm'],
    },
  ],
  Vision: [
    {
      label: 'Read my own words back to me',
      detail: 'Quotes the vision against what you did this quarter',
      icon: <Sparkles size={15} aria-hidden="true" />,
      goal: 'Compare this quarter against the vision',
      scope: ['Vision', '4 goals'],
    },
  ],
  Calendar: [
    {
      label: 'Protect the open focus block',
      detail: '3:00-5:00 PM is uncommitted',
      icon: <Clock3 size={15} aria-hidden="true" />,
      goal: 'Protect the remaining focus block',
      scope: ['Week of Aug 25'],
    },
  ],
};

const documentSuggestions = [
  {
    label: 'Turn this into a weekly system',
    detail: 'Draft a reusable plan from these principles',
    icon: <WandSparkles size={15} aria-hidden="true" />,
    goal: 'Turn these principles into a weekly system',
    scope: ['This page'],
  },
  {
    label: 'Find missing connections',
    detail: 'Compare this page with active goals',
    icon: <Link2 size={15} aria-hidden="true" />,
    goal: 'Link this page to the goals it supports',
    scope: ['This page', '12 connections'],
  },
  {
    label: 'Create the next actions',
    detail: 'Propose actions without applying them',
    icon: <ListTodo size={15} aria-hidden="true" />,
    goal: 'Create the next actions from this page',
    scope: ['This page'],
  },
];

function AiContext({ contextLabel, page }: { contextLabel: string; page: PreviewPage | null }) {
  const [running, setRunning] = useState<{ goal: string; scope: string[] } | null>(null);
  const suggestions = surfaceSuggestions[contextLabel] ?? (page ? documentSuggestions : []);

  return (
    <div className={styles.aiPanelBody}>
      <div className={styles.contextScope}>
        <span>
          <FileText size={13} aria-hidden="true" /> {contextLabel}
        </span>
        <button type="button" aria-label="Remove context">
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      {running ? (
        <OperationProposal
          goal={running.goal}
          scope={running.scope}
          onDone={() => setRunning(null)}
        />
      ) : (
        <>
          <div className={styles.assistantIntro}>
            <span className={styles.aiMark}>
              <Sparkles size={17} aria-hidden="true" />
            </span>
            <h2>What should we shape next?</h2>
            <p>
              I can work with this view and its visible connections. Nothing changes without a clear
              preview.
            </p>
          </div>

          {suggestions.length > 0 ? (
            <div className={styles.promptSuggestions}>
              {suggestions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setRunning({ goal: item.goal, scope: item.scope })}
                >
                  {item.icon}
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.aiQuiet}>
              Nothing to suggest on this screen. Ask a question below, or open a page or plan where
              there is something to work with.
            </p>
          )}
        </>
      )}

      <form className={styles.aiComposer}>
        <label className={styles.visuallyHidden} htmlFor="ai-composer">
          Message Planner AI
        </label>
        <textarea id="ai-composer" placeholder="Ask about this page..." />
        <div>
          <span>
            <button type="button" aria-label="Attach context">
              <Plus size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Voice prompt">
              <Mic size={15} aria-hidden="true" />
            </button>
          </span>
          <button className={styles.sendButton} type="button" aria-label="Send message">
            <Send size={15} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

function PropertiesContext({
  contextLabel,
  page,
}: {
  contextLabel: string;
  page: PreviewPage | null;
}) {
  return (
    <div className={styles.propertiesPanel}>
      <div>
        <span>Page type</span>
        <strong>
          <FileText size={14} />
          {['Plan', 'Calendar', 'Action inbox', 'Weekly review'].includes(contextLabel)
            ? 'Planner view'
            : [
                  'Account',
                  'Preferences',
                  'AI & agents',
                  'Memory',
                  'Data & offline',
                  'Integrations',
                  'Security',
                ].includes(contextLabel)
              ? 'Settings view'
              : 'Page'}
        </strong>
      </div>
      <div>
        <span>Status</span>
        <strong className={styles.statusPill}>{page?.status ?? 'Active'}</strong>
      </div>
      <div>
        <span>Area</span>
        <strong>{page?.area ?? '🗓 Planning'}</strong>
      </div>
      <div>
        <span>Review</span>
        <strong>{page?.review ?? 'Every week'}</strong>
      </div>
      <div>
        <span>Last edited</span>
        <strong>{page?.updated ?? 'Just now'}</strong>
      </div>
      <button type="button">
        <Plus size={14} /> Add property
      </button>
      <section>
        <h2>Appearance</h2>
        <button type="button">
          <ImageIcon size={15} /> Cover studio <ChevronRight size={15} />
        </button>
        <button type="button">
          <FileText size={15} /> Editorial layout <ChevronRight size={15} />
        </button>
      </section>
    </div>
  );
}

function LinksContext() {
  return (
    <div className={styles.linksPanel}>
      <section>
        <h2>
          Backlinks <span>4</span>
        </h2>
        <button type="button">
          <span>✦</span>
          <div>
            <strong>Planner AI private beta</strong>
            <small>Project · mentions this page</small>
          </div>
        </button>
        <button type="button">
          <span>🗓</span>
          <div>
            <strong>Weekly planning ritual</strong>
            <small>Template · linked as context</small>
          </div>
        </button>
      </section>
      <section>
        <h2>
          Related <span>8</span>
        </h2>
        <button type="button">
          <span>🧭</span>
          <div>
            <strong>North star & values</strong>
            <small>Page · 3 shared connections</small>
          </div>
        </button>
        <button type="button">
          <span>🌱</span>
          <div>
            <strong>Health reset</strong>
            <small>Goal · 2 shared connections</small>
          </div>
        </button>
      </section>
      <button className={styles.addRelation} type="button">
        <Plus size={14} /> Add relation
      </button>
    </div>
  );
}
