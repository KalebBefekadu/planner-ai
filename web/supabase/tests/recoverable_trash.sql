begin;
select plan(9);

select has_table('public', 'trash_batches', 'recoverable Trash batches exist');
select has_table('public', 'trash_batch_items', 'Trash batch membership exists');
select row_security_active('public.trash_batches'), 'Trash batches have RLS';
select table_privs_are(
  'public', 'trash_batches', 'authenticated', array['SELECT'],
  'authenticated users cannot alter Trash batches directly'
);
select function_privs_are(
  'public', 'execute_ui_operation', array['text', 'jsonb', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated users call the fixed-surface UI gateway'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'trash-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'trash-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.execute_ui_operation(
  'memory.create.v1', '{"statement":"Recover this Memory.","sourceType":"user","sourceId":null}'::jsonb,
  'trash-memory-create-0001'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''trash.move.v1'', %L::jsonb, ''trash-move-0001'')',
    jsonb_build_object('itemType', 'memory', 'id', (select id from public.memories limit 1), 'expectedVersion', 1)::text
  ),
  'a Memory can move to recoverable Trash'
);
select is((select count(*)::integer from public.memories where trashed_at is not null), 1, 'Trash keeps the record recoverable');
select lives_ok(
  format(
    'select public.execute_ui_operation(''trash.restore.v1'', %L::jsonb, ''trash-restore-0001'')',
    jsonb_build_object('batchId', (select id from public.trash_batches limit 1))::text
  ),
  'the exact Trash batch can be restored'
);
select is((select count(*)::integer from public.memories where trashed_at is null), 1, 'restore returns the Memory intact');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.trash_batches), 0, 'another owner cannot read Trash batches');

select * from finish();
rollback;
