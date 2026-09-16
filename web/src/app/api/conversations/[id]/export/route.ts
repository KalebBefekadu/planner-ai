import { NextResponse } from 'next/server';
import { selectAll } from '@/lib/supabase/select-all';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const parsedId = z.uuid().safeParse((await context.params).id);
  if (!parsedId.success) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id,title,status,created_at,updated_at,archived_at')
    .eq('id', parsedId.data)
    .is('trashed_at', null)
    .single();
  if (error || !conversation) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  /* Paged, for the same reason the Notes vault is: PostgREST caps a response
     at max_rows without saying so, and an export that is quietly short is
     worse than one that fails. A long-running conversation passes a thousand
     messages without being remarkable. */
  const [{ data: messages, error: messagesError }, { data: proposals, error: proposalsError }] =
    await Promise.all([
      selectAll((from, to) =>
        supabase
          .from('conversation_messages')
          .select('id,role,content,route,sources,claims,created_at')
          .eq('conversation_id', parsedId.data)
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to)
      ),
      selectAll((from, to) =>
        supabase
          .from('ai_proposals')
          .select(
            'id,operation_id,input_json,summary,risk_class,status,result_json,created_at,decided_at,applied_at'
          )
          .eq('conversation_id', parsedId.data)
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to)
      ),
    ]);
  if (messagesError || proposalsError) {
    return NextResponse.json({ error: 'Export could not be created.' }, { status: 500 });
  }
  const filename = `planner-ai-conversation-${conversation.id}.json`;
  return new NextResponse(
    JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        conversation,
        messages: messages ?? [],
        proposals: proposals ?? [],
      },
      null,
      2
    ),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    }
  );
}
