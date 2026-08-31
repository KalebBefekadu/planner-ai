'use client';

import {
  ArrowLeft,
  CircleAlert,
  CircleSlash,
  Clock3,
  CloudOff,
  Copy,
  CornerDownLeft,
  FileText,
  GitMerge,
  Globe,
  History,
  Link2,
  ListTodo,
  Lock,
  Mic,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import styles from './preview.module.css';
import { useDialog } from '@/lib/use-dialog';

/* The states 1.2 makes a release condition: AI unavailable, slow or lost
   network, empty state, invalid input, permission failure, and recovery.
   The preview previously drew every surface in its happy, populated,
   online, signed-in state only. */

/* ---------------------------------------------------------------- offline */

export function OfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.stateView}>
      <StateBanner
        tone="warning"
        icon={<CloudOff size={16} aria-hidden="true" />}
        title="Working offline"
        body="Seven changes are saved on this device and will sync when you reconnect. Keep working."
        action={{ label: 'Try to reconnect', onClick: onRetry }}
      />
      <section className={styles.stateSection}>
        <h2>Waiting to sync</h2>
        <ul className={styles.pendingList}>
          {[
            ['Renew passport', 'Due date set to 5 September', '3 min ago'],
            ['Weekly review', 'Reflection saved', '12 min ago'],
            ['Finalize the product story', 'Marked done', '40 min ago'],
          ].map(([title, change, when]) => (
            <li key={title}>
              <Clock3 size={14} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <p>{change}</p>
              </div>
              <time>{when}</time>
            </li>
          ))}
        </ul>
        <p className={styles.stateFoot}>
          These are stored in your device database, not in memory. Closing the tab will not lose
          them.
        </p>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- conflict */

export function ConflictState() {
  const [resolved, setResolved] = useState<'local' | 'remote' | 'merge' | null>(null);

  return (
    <div className={styles.stateView}>
      <StateBanner
        tone="danger"
        icon={<GitMerge size={16} aria-hidden="true" />}
        title="This page changed in two places"
        body="Nothing has been overwritten. Choose which version to keep, or keep both and merge by hand."
      />

      {resolved ? (
        <div className={styles.stateResolved} role="status">
          <strong>
            {resolved === 'local'
              ? 'Kept this device’s version.'
              : resolved === 'remote'
                ? 'Kept the synced version.'
                : 'Both versions kept. The other is saved as a copy below this page.'}
          </strong>
          <button className={styles.quietButton} type="button" onClick={() => setResolved(null)}>
            <Undo2 size={14} aria-hidden="true" /> Undo
          </button>
        </div>
      ) : (
        <div className={styles.conflictGrid}>
          {[
            {
              id: 'local' as const,
              label: 'On this device',
              when: 'Edited 4 minutes ago, offline',
              text: 'Protect energy before optimizing output. Health is the input, not the reward for finishing.',
            },
            {
              id: 'remote' as const,
              label: 'Synced version',
              when: 'Edited 11 minutes ago on iPhone',
              text: 'Protect energy before optimizing output. Sleep and training come before the backlog.',
            },
          ].map((side) => (
            <article key={side.id} className={styles.conflictCard}>
              <header>
                <strong>{side.label}</strong>
                <small>{side.when}</small>
              </header>
              <p>{side.text}</p>
              <button
                className={styles.quietButton}
                type="button"
                onClick={() => setResolved(side.id)}
              >
                Keep this one
              </button>
            </article>
          ))}
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => setResolved('merge')}
          >
            <Copy size={15} aria-hidden="true" /> Keep both
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------- AI unavailable/budget */

export function AiUnavailableState({ reason }: { reason: 'offline' | 'budget' | 'error' }) {
  const copy = {
    offline: {
      title: 'The assistant needs a connection',
      body: 'Everything else works offline. Suggestions and proposals resume when you reconnect.',
    },
    budget: {
      title: 'Daily AI budget reached',
      body: 'You have used $2.00 of $2.00 today. The budget resets at midnight, or raise it in AI & agents.',
    },
    error: {
      title: 'The model did not answer',
      body: 'Nothing was changed. This is usually temporary — try again, or work directly and come back to it.',
    },
  }[reason];

  return (
    <div className={styles.aiDownCard} role="status">
      <span className={styles.aiDownIcon}>
        {reason === 'offline' ? (
          <CloudOff size={18} aria-hidden="true" />
        ) : reason === 'budget' ? (
          <CircleSlash size={18} aria-hidden="true" />
        ) : (
          <TriangleAlert size={18} aria-hidden="true" />
        )}
      </span>
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <div className={styles.aiDownActions}>
        <button className={styles.quietButton} type="button">
          {reason === 'budget' ? 'Open AI & agents' : 'Try again'}
        </button>
      </div>
      <p className={styles.stateFoot}>
        Everything on this screen stays editable by hand. AI is never the only path to a change.
      </p>
    </div>
  );
}

/* ------------------------------------------------------- permission denied */

export function PermissionDeniedState({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.stateView}>
      <div className={styles.stateCentered}>
        <span className={styles.stateBigIcon}>
          <Lock size={22} aria-hidden="true" />
        </span>
        <h1>You don&rsquo;t have access to this page</h1>
        <p>
          It belongs to a workspace you are not a member of, or the link was shared and then
          revoked. Nothing about its contents is shown here.
        </p>
        <div className={styles.stateActions}>
          <button className={styles.primaryButton} type="button" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to my workspace
          </button>
          <button className={styles.quietButton} type="button">
            Request access
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ error / 404 */

export function ErrorState({ kind, onBack }: { kind: 'error' | 'notfound'; onBack: () => void }) {
  return (
    <div className={styles.stateView}>
      <div className={styles.stateCentered}>
        <span className={styles.stateBigIcon}>
          {kind === 'error' ? (
            <TriangleAlert size={22} aria-hidden="true" />
          ) : (
            <Search size={22} aria-hidden="true" />
          )}
        </span>
        <h1>
          {kind === 'error' ? 'This view failed to load' : 'That page doesn’t exist any more'}
        </h1>
        <p>
          {kind === 'error'
            ? 'Your material is safe and nothing was lost. Reloading this view usually fixes it; if it does not, the details below help us find the cause.'
            : 'It may have been renamed, or deleted. Deleted pages stay in Trash until you empty it yourself, so it is probably still recoverable.'}
        </p>
        <div className={styles.stateActions}>
          <button className={styles.primaryButton} type="button" onClick={onBack}>
            {kind === 'error' ? 'Reload this view' : 'Back to my workspace'}
          </button>
          <button className={styles.quietButton} type="button">
            {kind === 'error' ? 'Copy error details' : 'Search Trash'}
          </button>
        </div>
        {kind === 'error' ? (
          <code className={styles.stateCode}>
            request 4f2a91 · 29 Aug 2026 14:02 UTC · plan/today
          </code>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ trash */

/* Nothing in Trash is deleted on a timer. trash.empty.v1 is manual,
   irreversible and gated behind typing EMPTY TRASH, so the 30 days are when an
   item becomes *eligible* to be emptied — not a countdown to losing it. An
   earlier version of this screen showed "4 days left", which promised a
   deletion that never happens. */
const trashed = [
  ['Q2 retro notes', 'Page', 'Deleted 2 days ago', 'Held'],
  ['Old morning routine', 'Goal', 'Deleted 9 days ago', 'Held'],
  ['Cancel gym membership', 'Action', 'Deleted 26 days ago', 'Can be emptied'],
];

export function TrashState() {
  const [restored, setRestored] = useState<string[]>([]);

  return (
    <div className={styles.stateView}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>Recovery</p>
          <h1>Trash</h1>
          <p>
            Nothing here is deleted on a timer. Items stay until you empty Trash yourself, and only
            those held 30 days or more can be emptied at all.
          </p>
        </div>
      </header>

      <ul className={styles.trashList}>
        {trashed.map(([title, kind, when, left]) => {
          const isRestored = restored.includes(title);
          return (
            <li key={title} data-restored={isRestored || undefined}>
              <Trash2 size={15} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <p>
                  {kind} · {when}
                </p>
              </div>
              <span className={left === 'Held' ? styles.trashLeft : styles.trashEligible}>
                {left}
              </span>
              <button
                className={styles.quietButton}
                type="button"
                onClick={() =>
                  setRestored((all) =>
                    all.includes(title) ? all.filter((t) => t !== title) : [...all, title]
                  )
                }
              >
                {isRestored ? (
                  <>
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} aria-hidden="true" /> Restore
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.stateFoot}>
        Permanent deletion is not offered here on purpose. Empty Trash lives in Data &amp; offline,
        behind a typed confirmation, and it cannot be undone.
      </p>
    </div>
  );
}

/* -------------------------------------------------------- version history */

const versions = [
  ['Just now', 'You', 'Current version', true],
  ['4 minutes ago', 'You', 'Rewrote “What matters now”', false],
  ['Yesterday 19:40', 'Planner AI', 'Added 3 actions · approved by you', false],
  ['26 Aug 08:12', 'You', 'Created from Weekly planning ritual', false],
] as const;

export function VersionHistoryState() {
  const [selected, setSelected] = useState(0);

  return (
    <div className={styles.stateView}>
      <header className={styles.flowHeader}>
        <div>
          <p className={styles.overline}>History</p>
          <h1>Version history</h1>
          <p>Personal operating system · kept for 90 days</p>
        </div>
      </header>

      <div className={styles.historyGrid}>
        <ol className={styles.historyList}>
          {versions.map(([when, who, what, current], index) => (
            <li key={when}>
              <button
                type="button"
                aria-current={selected === index ? 'true' : undefined}
                className={selected === index ? styles.historyActive : ''}
                onClick={() => setSelected(index)}
              >
                <span className={who === 'Planner AI' ? styles.historyAi : styles.historyYou}>
                  {who === 'Planner AI' ? (
                    <Sparkles size={11} aria-hidden="true" />
                  ) : (
                    <History size={11} aria-hidden="true" />
                  )}
                  {who}
                </span>
                <strong>{what}</strong>
                <small>{when}</small>
                {current ? <em>Current</em> : null}
              </button>
            </li>
          ))}
        </ol>

        <article className={styles.historyPreview}>
          <h2>{versions[selected][2]}</h2>
          <p className={styles.historyMeta}>
            {versions[selected][0]} · {versions[selected][1]}
          </p>
          <div className={styles.historyDiff}>
            <p>
              <del>Build a life where work and everything else compete for attention.</del>
            </p>
            <p>
              <ins>
                Build a life where focused work, faith, health, and meaningful relationships
                reinforce each other.
              </ins>
            </p>
          </div>
          {selected > 0 ? (
            <button className={styles.primaryButton} type="button">
              <RotateCcw size={15} aria-hidden="true" /> Restore this version
            </button>
          ) : (
            <p className={styles.stateFoot}>This is the version you are looking at now.</p>
          )}
        </article>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ share */

export function ShareState({ onClose }: { onClose: () => void }) {
  const [access, setAccess] = useState<'private' | 'link' | 'people'>('private');
  const dialog = useDialog<HTMLDivElement>(onClose);

  return (
    <div className={styles.modalScrim} role="presentation" onClick={onClose}>
      <div
        ref={dialog}
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHead}>
          <h2 id="share-title">Share “Personal operating system”</h2>
          <button className={styles.iconButton} type="button" aria-label="Close" onClick={onClose}>
            <Plus size={18} style={{ transform: 'rotate(45deg)' }} aria-hidden="true" />
          </button>
        </header>

        <fieldset className={styles.shareOptions}>
          <legend className={styles.visuallyHidden}>Who can open this page</legend>
          {(
            [
              [
                'private',
                <Lock key="l" size={15} aria-hidden="true" />,
                'Only me',
                'The default. Nothing leaves your workspace.',
              ],
              [
                'link',
                <Link2 key="k" size={15} aria-hidden="true" />,
                'Anyone with the link',
                'Read only. The link can be revoked at any time.',
              ],
              [
                'people',
                <Users key="u" size={15} aria-hidden="true" />,
                'Specific people',
                'Invite by email. Each person signs in to read.',
              ],
            ] as const
          ).map(([id, icon, label, detail]) => (
            <label key={id} data-selected={access === id || undefined}>
              <input
                type="radio"
                name="share-access"
                checked={access === id}
                onChange={() => setAccess(id)}
              />
              {icon}
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {access === 'link' ? (
          <div className={styles.shareLinkRow}>
            <Globe size={15} aria-hidden="true" />
            <code>planner.ai/s/9f2b-personal-os</code>
            <button className={styles.quietButton} type="button">
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
          </div>
        ) : null}

        <p className={styles.shareNote}>
          <CircleAlert size={13} aria-hidden="true" />
          Shared readers see the page and its properties. They never see your other pages, your
          plan, or anything the assistant proposed.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- command palette */

const paletteGroups = [
  {
    label: 'Jump to',
    items: [
      { icon: <ListTodo size={15} aria-hidden="true" />, label: 'Today', hint: 'G then T' },
      {
        icon: <Target size={15} aria-hidden="true" />,
        label: 'Goals & horizons',
        hint: 'G then G',
      },
      {
        icon: <FileText size={15} aria-hidden="true" />,
        label: 'Personal operating system',
        hint: '',
      },
    ],
  },
  {
    label: 'Do',
    items: [
      { icon: <Plus size={15} aria-hidden="true" />, label: 'Capture a thought', hint: 'C' },
      { icon: <Mic size={15} aria-hidden="true" />, label: 'Start a voice dump', hint: 'V' },
      { icon: <Trash2 size={15} aria-hidden="true" />, label: 'Open Trash', hint: '' },
    ],
  },
  {
    label: 'Ask Planner AI',
    items: [
      {
        icon: <Sparkles size={15} aria-hidden="true" />,
        label: 'Give every unplanned action a date',
        hint: 'Preview first',
      },
      {
        icon: <Sparkles size={15} aria-hidden="true" />,
        label: 'Where did I drift this month?',
        hint: 'Preview first',
      },
    ],
  },
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const dialog = useDialog<HTMLDivElement>(onClose);
  const groups = paletteGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.label.toLowerCase().includes(query.trim().toLowerCase())
      ),
    }))
    .filter((group) => group.items.length > 0);
  const count = groups.reduce((total, group) => total + group.items.length, 0);

  return (
    <div className={styles.modalScrim} role="presentation" onClick={onClose}>
      <div
        ref={dialog}
        className={styles.paletteCard}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.paletteInput}>
          <Search size={17} aria-hidden="true" />
          <label className={styles.visuallyHidden} htmlFor="palette-query">
            Type a command or search
          </label>
          <input
            id="palette-query"
            autoFocus
            value={query}
            placeholder="Type a command, or ask a question…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && onClose()}
          />
          <kbd>ESC</kbd>
        </div>

        <p className={styles.visuallyHidden} role="status">
          {count} {count === 1 ? 'result' : 'results'}
        </p>

        {count === 0 ? (
          <div className={styles.paletteEmpty}>
            <p>
              Nothing matches “{query}”. Press <kbd>Enter</kbd> to ask Planner AI instead — it will
              show a preview before changing anything.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <p className={styles.paletteGroup}>{group.label}</p>
              <ul className={styles.paletteList}>
                {group.items.map((item) => (
                  <li key={item.label}>
                    <button type="button" onClick={onClose}>
                      {item.icon}
                      <span>{item.label}</span>
                      {item.hint ? <kbd>{item.hint}</kbd> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <footer className={styles.paletteFoot}>
          <span>
            <CornerDownLeft size={12} aria-hidden="true" /> open
          </span>
          <span>↑↓ move</span>
          <span>ESC close</span>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- capture composer */

export function CaptureComposer({ onClose }: { onClose: () => void }) {
  const [recording, setRecording] = useState(true);
  const [text, setText] = useState(
    'Need to get the passport sorted before October, and I keep pushing the finance review. ' +
      'Training slipped again this week — twice instead of four.'
  );
  const [saved, setSaved] = useState(false);
  const dialog = useDialog<HTMLDivElement>(onClose);

  return (
    <div className={styles.modalScrim} role="presentation" onClick={onClose}>
      <div
        ref={dialog}
        className={styles.captureCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.captureHead}>
          <h2 id="capture-title">
            {recording ? 'Listening' : saved ? 'Captured' : 'Capture a thought'}
          </h2>
          <span className={styles.captureMode}>
            {recording ? (
              <>
                <span className={styles.captureDot} aria-hidden="true" /> Voice · 00:42
              </>
            ) : (
              <>
                <FileText size={13} aria-hidden="true" /> Text
              </>
            )}
          </span>
        </header>

        <label className={styles.visuallyHidden} htmlFor="capture-text">
          What is on your mind
        </label>
        <textarea
          id="capture-text"
          rows={5}
          value={text}
          placeholder="Say or type anything. It is saved exactly as you put it."
          onChange={(event) => setText(event.target.value)}
        />

        <p className={styles.captureRaw}>
          <CircleAlert size={13} aria-hidden="true" />
          Your words are stored raw. Any cleanup the assistant does is saved as a revision on top,
          never as a replacement.
        </p>

        <p className={styles.captureStatus} role="status">
          {saved ? 'Saved to this device. Syncing.' : 'Not saved yet — held on this device only.'}
        </p>

        <footer className={styles.captureActions}>
          <button
            className={styles.quietButton}
            type="button"
            onClick={() => setRecording((value) => !value)}
          >
            {recording ? (
              <>
                <Square size={14} aria-hidden="true" /> Stop
              </>
            ) : (
              <>
                <Mic size={14} aria-hidden="true" /> Resume
              </>
            )}
          </button>
          <div>
            <button className={styles.quietButton} type="button" onClick={onClose}>
              Discard
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={text.trim().length === 0}
              onClick={() => setSaved(true)}
            >
              <Send size={14} aria-hidden="true" /> Save capture
            </button>
          </div>
        </footer>

        {saved ? (
          <p className={styles.captureAfter}>
            Saved.{' '}
            <button type="button" onClick={onClose}>
              Organize it now
            </button>{' '}
            or leave it in the inbox for later.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- shared UI */

function StateBanner({
  tone,
  icon,
  title,
  body,
  action,
}: {
  tone: 'warning' | 'danger';
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <aside
      className={`${styles.stateBanner} ${tone === 'danger' ? styles.stateBannerDanger : styles.stateBannerWarning}`}
      role="status"
    >
      {icon}
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      {action ? (
        <button className={styles.quietButton} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </aside>
  );
}
