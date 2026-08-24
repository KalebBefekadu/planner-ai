begin;
select plan(11);

select has_trigger('public', 'memories', 'memories_validate_source', 'Memory sources are validated');
select col_is_null('public', 'memories', 'source_id', 'user-authored Memory may omit a source record');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('89000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'memory-source-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('89000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'memory-source-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.conversations (workspace_id, title)
select id, 'Owned source' from public.workspaces where owner_user_id = '89000000-0000-4000-8000-000000000001';
insert into public.conversations (workspace_id, title)
select id, 'Other source' from public.workspaces where owner_user_id = '89000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '89000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1',
    '{"statement":"Explicit user preference","sourceType":"user","sourceId":null}'::jsonb,
    'memory-source-user-0001'
  )$$,
  'user-authored Memory requires no source record'
);
select throws_ok(
  format(
    $$select public.execute_ui_operation(
      'memory.create.v1',
      %L::jsonb,
      'memory-source-user-invalid-0001'
    )$$,
    jsonb_build_object(
      'statement', 'Invalid user source', 'sourceType', 'user',
      'sourceId', (select id from public.conversations where title = 'Owned source')
    )::text
  ),
  'P0001', 'invalid_memory_source',
  'user-authored Memory rejects a source ID'
);
select lives_ok(
  format(
    $$select public.execute_ui_operation(
      'memory.create.v1', %L::jsonb, 'memory-source-conversation-0001'
    )$$,
    jsonb_build_object(
      'statement', 'Validated conversation fact', 'sourceType', 'conversation',
      'sourceId', (select id from public.conversations where title = 'Owned source')
    )::text
  ),
  'an owned Conversation is accepted as Memory provenance'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1',
    '{"statement":"Missing source","sourceType":"conversation","sourceId":null}'::jsonb,
    'memory-source-null-0001'
  )$$,
  'P0001', 'invalid_memory_source',
  'non-user Memory rejects a null source ID'
);
select throws_ok(
  format(
    $$select public.execute_ui_operation(
      'memory.create.v1', %L::jsonb, 'memory-source-cross-workspace-0001'
    )$$,
    jsonb_build_object(
      'statement', 'Cross Workspace source', 'sourceType', 'conversation',
      'sourceId', (select id from public.conversations where title = 'Other source')
    )::text
  ),
  'P0001', 'invalid_memory_source',
  'cross-Workspace Conversation provenance is rejected'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1',
    '{"statement":"Invented source","sourceType":"note","sourceId":"89000000-0000-4000-8000-000000000099"}'::jsonb,
    'memory-source-invented-0001'
  )$$,
  'P0001', 'invalid_memory_source',
  'invented source records are rejected'
);
select is(
  (select count(*)::integer from public.memories where source_type = 'conversation'),
  1,
  'only the validated Conversation source persisted'
);
select is(
  (select source_id from public.memories where source_type = 'conversation'),
  (select id from public.conversations where title = 'Owned source'),
  'Memory retains the exact validated source ID'
);
select is(
  (select count(*)::integer from public.memories),
  2,
  'failed provenance attempts create no Memory records'
);

select * from finish();
rollback;
