import { notFound } from 'next/navigation';
import { Activity, Bot, ExternalLink, MousePointer2 } from 'lucide-react';
import { OperationUndoButton } from '@/components/operation-undo-button';
import { undoableOperationIds, type OperationId } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

type ActivityReceipt = {
  id: string;
  operation_id: string;
  actor_type: string;
  surface: string;
  target_type: string | null;
  risk_class: string;
  status: string;
  reversed_at: string | null;
  created_at: string;
};

function operationLabel(operationId: string) {
  return operationId
    .replace(/\.v\d+$/, '')
    .split('.')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export default async function ActivityPage() {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (!workspace) notFound();
  const { data, error } = await supabase
    .from('operation_receipts')
    .select(
      'id,operation_id,actor_type,surface,target_type,risk_class,status,reversed_at,created_at'
    )
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Unable to load Activity.');
  const events = (data ?? []) as unknown as ActivityReceipt[];
  const undoable = new Set<OperationId>(undoableOperationIds);

  return (
    <div className="page activity-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Accountability</p>
          <h1>Activity</h1>
          <p className="lede">
            A content-free record of important reads and changes in your Workspace.
          </p>
        </div>
      </header>
      <section className="activity-list" aria-label="Workspace Activity">
        {events.length ? (
          events.map((event) => {
            const SurfaceIcon =
              event.surface === 'chat'
                ? Bot
                : event.surface === 'mcp'
                  ? ExternalLink
                  : MousePointer2;
            return (
              <article className="activity-row" key={event.id}>
                <span className="activity-icon">
                  <SurfaceIcon size={16} aria-hidden="true" />
                </span>
                <div>
                  <h2>{operationLabel(event.operation_id)}</h2>
                  <p>
                    {event.actor_type} via {event.surface}
                    {event.target_type ? ` on ${event.target_type}` : ''}
                  </p>
                </div>
                <div className="activity-meta">
                  <span>{event.reversed_at ? 'undone' : event.status}</span>
                  <span>{event.risk_class} risk</span>
                  <time dateTime={event.created_at}>
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(event.created_at))}
                  </time>
                  {!event.reversed_at &&
                  event.status === 'succeeded' &&
                  undoable.has(event.operation_id as OperationId) ? (
                    <OperationUndoButton receiptId={event.id} />
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="activity-empty">
            <Activity size={22} />
            <p>Important Workspace actions will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
