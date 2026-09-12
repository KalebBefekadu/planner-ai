'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  History,
  MessageSquarePlus,
  PanelRightClose,
  RotateCcw,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { boundedAssistantHistory } from '@/lib/assistant/history';
import type { OperationId } from '@/lib/operations';
import type { AssistantEvidence, ResolvedAssistantClaim } from '@/lib/assistant/evidence';
import { GenUiRenderer } from '@/components/genui-renderer';
import { parseGenUiSpec, type GenUiParseResult } from '@/lib/genui/schema';
import { actionFailureMessage } from '@/lib/operations/failure-message';
import { isPermanentAssistantFailure } from '@/lib/ai/proposal-failures';

type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistantEvidence[];
  claims?: ResolvedAssistantClaim[];
  genUi?: GenUiParseResult;
};
type Conversation = {
  id: string;
  title: string;
  status: 'active' | 'archived';
  updated_at: string;
};
type Proposal = {
  id: string;
  operationId: OperationId;
  input: Record<string, unknown>;
  summary: string;
  risk: 'read' | 'low' | 'medium' | 'high';
};
type AssistantResponse = {
  reply?: string;
  conversationId?: string;
  proposal?: Proposal | null;
  evidence?: AssistantEvidence[];
  claims?: ResolvedAssistantClaim[];
  genUi?: unknown;
  undoableReceiptId?: string | null;
  conversationClosed?: boolean;
  error?: string;
  code?: string;
};
type ConversationResponse = {
  conversations?: Conversation[];
  messages?: Message[];
  proposal?: Proposal | null;
  error?: string;
};

export function AssistantDock({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [undoableReceiptId, setUndoableReceiptId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversationIndex = useCallback(async () => {
    const response = await fetch('/api/assistant', { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as ConversationResponse;
    setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, proposal]);

  const selectConversation = useCallback(async (id: string) => {
    if (!id) {
      setConversationId(null);
      setMessages([]);
      setProposal(null);
      setUndoableReceiptId(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/assistant?conversationId=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as ConversationResponse;
      if (!response.ok) throw new Error(data.error ?? 'Conversation could not be loaded.');
      setConversationId(id);
      setMessages(data.messages ?? []);
      setProposal(data.proposal ?? null);
      setUndoableReceiptId(null);
    } catch (caught) {
      setError(actionFailureMessage(caught, 'Conversation could not be loaded.'));
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    const requestedConversation = new URLSearchParams(window.location.search).get('conversation');
    if (!requestedConversation) return;
    queueMicrotask(() => {
      setOpen(true);
      void loadConversationIndex();
      void selectConversation(requestedConversation);
    });
  }, [loadConversationIndex, pathname, selectConversation]);

  // `restoreOnFailure` puts back whatever the caller optimistically cleared
  // before the request. A provider outage should cost a retry, never the thing
  // the person was about to act on.
  async function callAssistant(
    options: {
      message?: string;
      approvedProposalId?: string;
      dismissedProposalId?: string;
      undoReceiptId?: string;
    },
    restoreOnFailure?: (failure: { permanent: boolean }) => void
  ) {
    setPending(true);
    setError(null);
    let failureCode: string | null = null;
    try {
      const selectedNoteId =
        pathname === '/notes' ? new URLSearchParams(window.location.search).get('note') : null;
      const selection =
        selectedNoteId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          selectedNoteId
        )
          ? { type: 'note' as const, id: selectedNoteId }
          : undefined;
      const historySource =
        options.message &&
        messages.at(-1)?.role === 'user' &&
        messages.at(-1)?.content === options.message
          ? messages.slice(0, -1)
          : messages;
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...options,
          history: boundedAssistantHistory(historySource),
          route: pathname,
          selection,
          conversationId: conversationId ?? undefined,
        }),
      });
      const data = (await response.json()) as AssistantResponse;
      // A 409 that carries a reply is the legacy data model politely declining
      // to act; a 409 with only an error is a real failure and must be shown.
      if (!response.ok && !data.reply) {
        failureCode = data.code ?? null;
        throw new Error(data.error ?? 'Planner AI could not respond.');
      }
      if (data.reply) {
        const genUi =
          data.genUi === undefined || data.genUi === null ? undefined : parseGenUiSpec(data.genUi);
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: data.reply as string,
            sources: data.evidence ?? [],
            claims: data.claims ?? [],
            genUi,
          },
        ]);
      }
      if (data.conversationClosed) {
        setConversationId(null);
        setMessages([]);
        router.replace(pathname);
      }
      if (data.conversationId) setConversationId(data.conversationId);
      setProposal(data.proposal ?? null);
      setUndoableReceiptId(data.undoableReceiptId ?? null);
      if (options.approvedProposalId && response.ok) router.refresh();
      await loadConversationIndex();
      setFailedMessage(null);
    } catch (caught) {
      setError(actionFailureMessage(caught, 'Planner AI could not respond.'));
      if (options.message) setFailedMessage(options.message);
      restoreOnFailure?.({ permanent: isPermanentAssistantFailure(failureCode) });
    } finally {
      setPending(false);
    }
  }

  function sendMessage() {
    const content = draft.trim();
    if (!content || pending) return;
    setMessages((current) => [...current, { role: 'user', content }]);
    setDraft('');
    setProposal(null);
    setUndoableReceiptId(null);
    void callAssistant({ message: content });
  }

  function approveProposal() {
    if (!proposal || pending) return;
    const actedOn = proposal;
    setProposal(null);
    // Putting the card back is what makes a retry possible, but a Proposal the
    // server has already spent can never be approved, and offering it again is
    // the approval loop this ticket set out to end.
    void callAssistant({ approvedProposalId: actedOn.id }, ({ permanent }) => {
      if (!permanent) setProposal(actedOn);
    });
  }

  function dismissProposal() {
    if (!proposal || pending) return;
    const actedOn = proposal;
    setProposal(null);
    void callAssistant({ dismissedProposalId: actedOn.id }, ({ permanent }) => {
      if (!permanent) setProposal(actedOn);
    });
  }

  function undoLastOperation() {
    if (!undoableReceiptId || pending) return;
    const receiptId = undoableReceiptId;
    setUndoableReceiptId(null);
    void callAssistant({ undoReceiptId: receiptId }, ({ permanent }) => {
      if (!permanent) setUndoableReceiptId(receiptId);
    });
  }

  return (
    <>
      <button
        className={`assistant-launch${className ? ` ${className}` : ''}`}
        type="button"
        onClick={() => {
          setOpen(true);
          void loadConversationIndex();
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        Ask Planner AI
      </button>
      {open ? (
        <div className="assistant-panel" role="dialog" aria-label="Planner AI assistant">
          <header className="assistant-header">
            <div>
              <span className="assistant-mark">
                <Sparkles size={15} />
              </span>
              <div>
                <strong>Planner AI</strong>
                <span>Private workspace assistant</span>
              </div>
            </div>
            <div className="assistant-header-actions">
              <Link
                className="icon-button"
                href="/conversations"
                title="Conversation history"
                aria-label="Conversation history"
                onClick={() => setOpen(false)}
              >
                <History size={17} />
              </Link>
              <button
                className="icon-button"
                type="button"
                onClick={() => void selectConversation('')}
                title="New conversation"
                aria-label="New conversation"
              >
                <MessageSquarePlus size={17} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => setOpen(false)}
                title="Close assistant"
                aria-label="Close assistant"
              >
                <PanelRightClose size={17} />
              </button>
            </div>
          </header>
          {conversations.length ? (
            <div className="assistant-conversation-picker">
              <label htmlFor="assistant-conversation">Conversation</label>
              <select
                id="assistant-conversation"
                value={conversationId ?? ''}
                onChange={(event) => void selectConversation(event.target.value)}
                disabled={pending}
              >
                <option value="">New conversation</option>
                {conversations
                  .filter((conversation) => conversation.status === 'active')
                  .map((conversation) => (
                    <option value={conversation.id} key={conversation.id}>
                      {conversation.title}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div className="assistant-messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="assistant-welcome">
                <h2>What would you like to plan?</h2>
                <p>Ask about your priorities, refine an idea, or request a change.</p>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div
                className={`assistant-message assistant-message-${message.role}`}
                key={message.id ?? `${message.role}-${index}`}
              >
                <span>{message.role === 'user' ? 'You' : 'Planner AI'}</span>
                <p>{message.content}</p>
                {message.role === 'assistant' && message.genUi ? (
                  <GenUiRenderer result={message.genUi} />
                ) : null}
                {message.role === 'assistant' && message.claims?.length ? (
                  <div className="assistant-claims" aria-label="Claim support">
                    {message.claims.map((claim, claimIndex) => (
                      <div key={`${claim.status}-${claimIndex}`}>
                        <span>{claim.status.replace('_', ' ')}</span>
                        <p>{claim.text}</p>
                        {claim.evidence.length ? (
                          <div>
                            {claim.evidence.map((source) => (
                              <Link href={source.href} key={`${source.type}-${source.id}`}>
                                {source.label}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.role === 'assistant' &&
                !message.claims?.length &&
                !message.genUi &&
                message.sources?.length ? (
                  <div className="assistant-evidence" aria-label="Sources used">
                    <span>Sources</span>
                    <div>
                      {message.sources.map((source) => (
                        <Link href={source.href} key={`${source.type}-${source.id}`}>
                          {source.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {pending ? (
              <div className="assistant-thinking" role="status">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {proposal ? (
              <section className="assistant-proposal">
                <div>
                  <p className="eyebrow">Proposed change</p>
                  <h3>{proposal.summary}</h3>
                  <span>{proposal.risk} risk</span>
                </div>
                <div>
                  {/* Disabled while a decision is in flight, for the same
                      reason Undo already is. Both handlers ignore a second
                      click, but a control that still looks pressable invites
                      one at the moment a person most wants to know whether
                      their decision landed. */}
                  <button
                    className="btn-secondary button-with-icon"
                    type="button"
                    disabled={pending}
                    onClick={dismissProposal}
                    aria-busy={pending}
                  >
                    <X size={15} />
                    Dismiss
                  </button>
                  <button
                    className="btn-primary button-with-icon"
                    type="button"
                    disabled={pending}
                    onClick={approveProposal}
                    aria-busy={pending}
                  >
                    <Check size={15} />
                    {pending ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              </section>
            ) : null}
            {undoableReceiptId ? (
              <section className="assistant-undo" aria-label="Undo applied change">
                <span>Change applied</span>
                <button
                  className="btn-secondary button-with-icon"
                  type="button"
                  onClick={undoLastOperation}
                  disabled={pending}
                  aria-busy={pending}
                >
                  <RotateCcw size={14} /> {pending ? 'Undoing…' : 'Undo'}
                </button>
              </section>
            ) : null}
            {error ? (
              <div className="assistant-error" role="alert">
                <p className="status-message status-message-error">{error}</p>
                {failedMessage ? (
                  <button
                    className="btn-secondary button-with-icon"
                    type="button"
                    disabled={pending}
                    onClick={() => void callAssistant({ message: failedMessage })}
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
          <div className="assistant-composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Message Planner AI"
              aria-label="Message Planner AI"
              maxLength={4_000}
              rows={3}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={pending || !draft.trim()}
              title="Send message"
              aria-label="Send message"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
