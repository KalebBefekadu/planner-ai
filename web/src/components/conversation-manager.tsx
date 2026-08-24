'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  Check,
  Download,
  FileOutput,
  MessageSquare,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  changeConversationStatusAction,
  deleteConversationAction,
  promoteConversationAction,
  renameConversationAction,
  type ConversationView,
} from '@/app/conversations/actions';

function ConversationRow({ conversation }: { conversation: ConversationView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [confirmation, setConfirmation] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [destination, setDestination] = useState<'note' | 'capture' | 'memory'>('note');
  const [memoryStatement, setMemoryStatement] = useState('');
  const [successHref, setSuccessHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string; href?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'The change could not be saved.');
        return;
      }
      setEditing(false);
      setDeleting(false);
      setPromoting(false);
      if (result.href) setSuccessHref(result.href);
      router.refresh();
    });
  }

  return (
    <article className="conversation-row">
      <div className="conversation-row-icon" aria-hidden="true">
        <MessageSquare size={17} />
      </div>
      <div className="conversation-row-main">
        {editing ? (
          <div className="conversation-rename">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              aria-label="Conversation title"
              disabled={pending}
              autoFocus
            />
            <button
              className="icon-button"
              type="button"
              title="Save title"
              aria-label="Save title"
              disabled={pending || !title.trim()}
              onClick={() =>
                run(() => renameConversationAction(conversation.id, conversation.version, title))
              }
            >
              <Check size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Cancel rename"
              aria-label="Cancel rename"
              disabled={pending}
              onClick={() => {
                setTitle(conversation.title);
                setEditing(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <h2>{conversation.title}</h2>
        )}
        <p>
          {conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'}
          <span aria-hidden="true"> · </span>
          Updated{' '}
          <time dateTime={conversation.updatedAt}>
            {new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }).format(new Date(conversation.updatedAt))}
          </time>
        </p>
        {deleting ? (
          <div className="conversation-delete-confirmation">
            <label htmlFor={`delete-${conversation.id}`}>
              Type <strong>DELETE CONVERSATION</strong> to permanently remove its messages.
            </label>
            <div>
              <input
                id={`delete-${conversation.id}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={pending}
              />
              <button
                type="button"
                className="btn-danger button-with-icon"
                disabled={pending || confirmation !== 'DELETE CONVERSATION'}
                onClick={() =>
                  run(() =>
                    deleteConversationAction(conversation.id, conversation.version, confirmation)
                  )
                }
              >
                <Trash2 size={15} /> Delete permanently
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={pending}
                onClick={() => {
                  setDeleting(false);
                  setConfirmation('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {promoting ? (
          <div className="conversation-promotion">
            <label htmlFor={`promote-${conversation.id}`}>Save conversation as</label>
            <div>
              <select
                id={`promote-${conversation.id}`}
                value={destination}
                onChange={(event) =>
                  setDestination(event.target.value as 'note' | 'capture' | 'memory')
                }
                disabled={pending}
              >
                <option value="note">Note</option>
                <option value="capture">Inbox Capture</option>
                <option value="memory">Assistant Memory</option>
              </select>
              {destination === 'memory' ? (
                <input
                  value={memoryStatement}
                  onChange={(event) => setMemoryStatement(event.target.value)}
                  maxLength={2_000}
                  placeholder="Specific fact to remember"
                  aria-label="Memory statement"
                  disabled={pending}
                />
              ) : null}
              <button
                className="btn-primary button-with-icon"
                type="button"
                disabled={pending || (destination === 'memory' && !memoryStatement.trim())}
                onClick={() =>
                  run(() =>
                    promoteConversationAction(
                      conversation.id,
                      destination,
                      destination === 'memory' ? memoryStatement : undefined
                    )
                  )
                }
              >
                <FileOutput size={15} /> Save
              </button>
              <button
                className="btn-secondary"
                type="button"
                disabled={pending}
                onClick={() => setPromoting(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {successHref ? (
          <p className="status-message status-message-success">
            Saved. <Link href={successHref}>Open it</Link>
          </p>
        ) : null}
        {error ? <p className="status-message status-message-error">{error}</p> : null}
      </div>
      <div className="conversation-row-actions">
        {conversation.status === 'active' ? (
          <Link
            className="btn-primary button-with-icon"
            href={`/?conversation=${encodeURIComponent(conversation.id)}`}
          >
            <MessageSquare size={15} /> Resume
          </Link>
        ) : null}
        <button
          className="icon-button"
          type="button"
          title="Rename conversation"
          aria-label="Rename conversation"
          disabled={pending}
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} />
        </button>
        <a
          className="icon-button"
          href={`/api/conversations/${conversation.id}/export`}
          title="Export conversation"
          aria-label="Export conversation"
        >
          <Download size={16} />
        </a>
        <button
          className="icon-button"
          type="button"
          title="Save conversation elsewhere"
          aria-label="Save conversation elsewhere"
          disabled={pending}
          onClick={() => setPromoting(true)}
        >
          <FileOutput size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          title={conversation.status === 'active' ? 'Archive conversation' : 'Restore conversation'}
          aria-label={
            conversation.status === 'active' ? 'Archive conversation' : 'Restore conversation'
          }
          disabled={pending}
          onClick={() =>
            run(() =>
              changeConversationStatusAction(
                conversation.id,
                conversation.version,
                conversation.status === 'active' ? 'archived' : 'active'
              )
            )
          }
        >
          {conversation.status === 'active' ? <Archive size={16} /> : <ArchiveRestore size={16} />}
        </button>
        <button
          className="icon-button icon-button-danger"
          type="button"
          title="Delete conversation"
          aria-label="Delete conversation"
          disabled={pending}
          onClick={() => setDeleting(true)}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

export function ConversationManager({ conversations }: { conversations: ConversationView[] }) {
  if (!conversations.length) {
    return (
      <div className="conversation-empty">
        <MessageSquare size={22} aria-hidden="true" />
        <p>No conversations match this view.</p>
      </div>
    );
  }
  return (
    <section className="conversation-list" aria-label="Conversation history">
      {conversations.map((conversation) => (
        <ConversationRow conversation={conversation} key={conversation.id} />
      ))}
    </section>
  );
}
