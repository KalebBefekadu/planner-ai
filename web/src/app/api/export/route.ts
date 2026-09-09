import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exportTables = [
  ['planning_horizons', '*'],
  ['visions', '*'],
  ['goals', '*'],
  ['action_templates', '*'],
  ['actions', '*'],
  ['notifications', '*'],
  [
    'notification_email_deliveries',
    'id,workspace_id,delivery_on,status,notification_count,error_code,claimed_at,attempt_count,next_attempt_at,sent_at,created_at,updated_at',
  ],
  ['daily_focus_items', '*'],
  ['captures', '*'],
  ['notes', '*'],
  ['note_revisions', '*'],
  ['note_import_jobs', '*'],
  ['note_import_items', '*'],
  ['tags', '*'],
  ['note_tags', '*'],
  ['note_links', '*'],
  ['note_goal_links', '*'],
  ['note_action_links', '*'],
  ['capture_note_links', '*'],
  ['capture_action_links', '*'],
  ['conversations', '*'],
  ['conversation_messages', '*'],
  ['ai_proposals', '*'],
  ['capture_proposal_batches', '*'],
  ['review_ai_proposals', '*'],
  ['ai_usage_events', '*'],
  ['memories', '*'],
  ['reviews', '*'],
  ['review_action_items', '*'],
  ['action_schedule_history', '*'],
  ['activity_events', '*'],
  ['operation_receipts', '*'],
  ['trash_batches', '*'],
  ['trash_batch_items', '*'],
  [
    'mcp_access_tokens',
    'id,workspace_id,owner_user_id,name,allowed_operations,expires_at,last_used_at,revoked_at,created_at',
  ],
  [
    'mcp_oauth_grants',
    'id,workspace_id,owner_user_id,oauth_client_id,client_name,allowed_operations,revoked_at,created_at,updated_at',
  ],
  [
    'account_deletion_requests',
    'id,workspace_id,user_id,status,requested_at,scheduled_for,canceled_at,processing_started_at,completed_at,updated_at',
  ],
] as const;

async function readAll(client: SupabaseClient, table: string, select: string, workspaceId: string) {
  const rows: unknown[] = [];
  const pageSize = 1_000;
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from(table)
      .select(select)
      .eq('workspace_id', workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Export read failed for ${table}.`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function GET() {
  const supabase = await createClient();
  const [userResult, assuranceResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return NextResponse.json(
      { error: 'Export is unavailable before data migration.' },
      { status: 503 }
    );
  }
  if (assuranceResult.data?.currentLevel !== 'aal2') {
    return NextResponse.json(
      { error: 'Verify this session in Security before exporting.' },
      { status: 403 }
    );
  }
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_user_id', user.id)
    .single();
  if (workspaceError || !workspace) {
    return NextResponse.json({ error: 'Workspace is unavailable.' }, { status: 503 });
  }

  try {
    const untyped = supabase as unknown as SupabaseClient;
    const entries = await Promise.all(
      exportTables.map(async ([table, select]) => [
        table,
        await readAll(untyped, table, select, workspace.id as string),
      ])
    );
    const archive = {
      format: 'planner-ai-export',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email ?? null },
      workspace,
      data: Object.fromEntries(entries),
    };
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(archive, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="planner-ai-export-${date}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Planner AI could not complete this export.' },
      { status: 500 }
    );
  }
}
