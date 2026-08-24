import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { getConversations } from '@/app/conversations/actions';
import { ConversationManager } from '@/components/conversation-manager';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const params = await searchParams;
  const query = (params.q ?? '').slice(0, 100);
  const status = params.status === 'archived' ? 'archived' : 'active';
  const conversations = await getConversations(query, status);

  return (
    <div className="page conversations-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Planner AI</p>
          <h1>Conversations</h1>
          <p className="lede">Resume useful threads and control what the assistant retains.</p>
        </div>
      </header>
      <form className="conversation-search" action="/conversations" method="get">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search titles and messages"
          maxLength={100}
          aria-label="Search conversations"
        />
        <input type="hidden" name="status" value={status} />
        <button className="btn-secondary" type="submit">
          Search
        </button>
      </form>
      <div className="conversation-tabs" role="tablist" aria-label="Conversation status">
        <Link
          role="tab"
          aria-selected={status === 'active'}
          className={status === 'active' ? 'conversation-tab-active' : ''}
          href={`/conversations?status=active${query ? `&q=${encodeURIComponent(query)}` : ''}`}
        >
          Active
        </Link>
        <Link
          role="tab"
          aria-selected={status === 'archived'}
          className={status === 'archived' ? 'conversation-tab-active' : ''}
          href={`/conversations?status=archived${query ? `&q=${encodeURIComponent(query)}` : ''}`}
        >
          Archived
        </Link>
      </div>
      <ConversationManager conversations={conversations} />
    </div>
  );
}
