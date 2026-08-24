begin;
select plan(29);

select has_column('public', 'conversations', 'version', 'conversations are versioned');
select row_security_active('public.conversations'), 'conversations have RLS';
select row_security_active('public.conversation_messages'), 'messages have RLS';
select table_privs_are(
  'public', 'conversations', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate conversations directly'
);
select function_privs_are(
  'public', 'execute_conversation_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the conversation executor is private'
);
select function_privs_are(
  'public', 'search_conversations', array['text', 'text', 'integer', 'integer'],
  'authenticated', array['EXECUTE'], 'authenticated users may use bounded search'
);
select is(
  (select count(*)::integer from public.operation_contracts
   where operation_id like 'conversation.%'),
  3, 'all conversation lifecycle Operations are registered'
);
select ok(
  (select not ('mcp' = any(exposures)) from public.operation_contracts
   where operation_id = 'conversation.delete.v1'),
  'permanent deletion is not exposed through MCP'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversations-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('e3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversations-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.conversations (id, workspace_id, title)
select 'e3100000-0000-0000-0000-000000000001', id, 'Original planning thread'
from public.workspaces
where owner_user_id = 'e3000000-0000-0000-0000-000000000001';
insert into public.conversation_messages (
  id, workspace_id, conversation_id, role, content
)
select 'e3200000-0000-0000-0000-000000000001', workspace_id, id,
  'user', 'A uniquely searchable quarterly thought'
from public.conversations where id = 'e3100000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e3000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'conversation.rename.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"title":"Renamed planning thread"}'::jsonb,
    'conversation-rename-0001'
  )$$,
  'a conversation can be renamed through the trusted gateway'
);
select is(
  (select title from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  'Renamed planning thread', 'rename updates the title'
);
select is(
  (select version from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  2::bigint, 'rename advances the version'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'conversation.rename.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"title":"Renamed planning thread"}'::jsonb,
    'conversation-rename-0001'
  )$$,
  'a rename can be retried with the same idempotency key'
);
select is(
  (select version from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  2::bigint, 'idempotent replay does not advance the version'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'conversation-rename-0001')
    ),
    'conversation-rename-undo-0001'
  )$$,
  'an unchanged rename can be undone'
);
select ok(
  (select title = 'Original planning thread' and version = 1
   from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  'rename Undo restores the prior title and version'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'conversation.status.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"status":"archived"}'::jsonb,
    'conversation-archive-0001'
  )$$,
  'a conversation can be archived'
);
select ok(
  (select status = 'archived' and archived_at is not null and version = 2
   from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  'archive records state, time, and version'
);
select throws_ok(
  $$select public.record_assistant_turn(
    'e3100000-0000-0000-0000-000000000001', 'Continue', 'No', '/', null,
    'test-model', 'test-prompt', '[]'::jsonb
  )$$,
  'P0001', 'conversation_not_active',
  'archived conversations cannot accept new turns'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'conversation-archive-0001')
    ),
    'conversation-archive-undo-0001'
  )$$,
  'archive can be undone'
);
select ok(
  (select status = 'active' and archived_at is null and version = 1
   from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  'archive Undo restores the active state'
);

select is(
  (select count(*)::integer from public.search_conversations(
    'quarterly thought', 'active', 50, 0
  )),
  1, 'search matches message content'
);
select is(
  (select message_count from public.search_conversations(
    'Original planning', 'active', 50, 0
  )),
  1::bigint, 'search returns bounded conversation metadata'
);
set local role service_role;
select ok(
  ((public.build_mcp_workspace_snapshot(
    (select id from public.workspaces
     where owner_user_id = 'e3000000-0000-0000-0000-000000000001')
  ) -> 'conversations' -> 0) ? 'version'),
  'MCP snapshot includes versioned conversation metadata'
);
select ok(
  position('uniquely searchable' in public.build_mcp_workspace_snapshot(
    (select id from public.workspaces
     where owner_user_id = 'e3000000-0000-0000-0000-000000000001')
  )::text) = 0,
  'MCP snapshot does not include transcript content'
);
set local role authenticated;

select set_config('request.jwt.claim.sub', 'e3000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.search_conversations('', null, 50, 0)),
  0, 'conversation search is workspace scoped'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'conversation.rename.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"title":"Forged"}'::jsonb,
    'conversation-cross-workspace-0001'
  )$$,
  '40001', 'version_conflict_or_not_found',
  'another workspace cannot rename a conversation'
);

select set_config('request.jwt.claim.sub', 'e3000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.execute_ui_operation(
    'conversation.delete.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"confirmation":"delete"}'::jsonb,
    'conversation-delete-invalid-0001'
  )$$,
  'P0001', 'confirmation_required',
  'permanent deletion requires the exact phrase'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'conversation.delete.v1',
    '{"id":"e3100000-0000-0000-0000-000000000001","expectedVersion":1,"confirmation":"DELETE CONVERSATION"}'::jsonb,
    'conversation-delete-0001'
  )$$,
  'exact confirmation permanently deletes a conversation'
);
select is(
  (select count(*)::integer from public.conversations
   where id = 'e3100000-0000-0000-0000-000000000001'),
  0, 'the conversation row is removed'
);
select is(
  (select count(*)::integer from public.conversation_messages
   where id = 'e3200000-0000-0000-0000-000000000001'),
  0, 'conversation deletion cascades to content-bearing messages'
);
select ok(
  exists (select 1 from public.operation_receipts
          where idempotency_key = 'conversation-delete-0001'
            and result_json = jsonb_build_object(
              'id', 'e3100000-0000-0000-0000-000000000001'::uuid,
              'deleted', true
            )),
  'deletion retains only a content-free receipt'
);

select * from finish();
rollback;
