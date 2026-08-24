begin;
select plan(17);

select has_table('public', 'account_deletion_requests', 'account deletion requests exist');
select ok((select relrowsecurity from pg_class
  where oid = 'public.account_deletion_requests'::regclass
), 'account deletion requests have RLS'
);
select table_privs_are(
  'public', 'account_deletion_requests', 'authenticated', array['SELECT'],
  'users cannot mutate deletion requests directly'
);
select function_privs_are(
  'public', 'execute_account_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'account lifecycle domain operations are private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('83000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'delete-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('83000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'delete-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.mcp_access_tokens (
  workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
)
select id, owner_user_id, repeat('a', 64), 'Deletion test',
  array['workspace.snapshot.read.v1'], now() + interval '30 days'
from public.workspaces
where owner_user_id = '83000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","aal":"aal1"}', true
);
select throws_ok(
  $$select public.execute_ui_operation(
    'account.deletion.schedule.v1', '{"confirmation":"DELETE MY ACCOUNT"}',
    'account-delete-0001'
  )$$,
  '42501', 'aal2_required', 'scheduling deletion requires AAL2'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000001","aal":"aal2"}', true
);
select lives_ok(
  $$select public.execute_ui_operation(
    'account.deletion.schedule.v1', '{"confirmation":"DELETE MY ACCOUNT"}',
    'account-delete-0002'
  )$$,
  'an AAL2 session can schedule deletion'
);
select is(
  (select status from public.account_deletion_requests limit 1),
  'scheduled', 'deletion begins in scheduled state'
);
select ok(
  (select scheduled_for between now() + interval '6 days 23 hours'
    and now() + interval '7 days 1 hour' from public.account_deletion_requests limit 1),
  'the cancellation window is seven days'
);
select ok(
  (select revoked_at is not null from public.mcp_access_tokens limit 1),
  'external MCP authority is revoked immediately'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'account.deletion.schedule.v1'),
  1, 'scheduling deletion writes a receipt'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'account.deletion.schedule.v1'),
  1, 'scheduling deletion is visible in Activity'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'account.deletion.schedule.v1', '{"confirmation":"DELETE MY ACCOUNT"}',
    'account-delete-0003'
  )$$,
  'a repeated schedule request does not create another active deletion'
);
select is(
  (select count(*)::integer from public.account_deletion_requests),
  1, 'only one active deletion exists per user'
);
select lives_ok(
  format(
    'select public.execute_ui_operation(''account.deletion.cancel.v1'', %L::jsonb, ''account-cancel-0001'')',
    jsonb_build_object('requestId', (select id from public.account_deletion_requests))::text
  ),
  'the owner can cancel during the grace period'
);
select is(
  (select status from public.account_deletion_requests limit 1),
  'canceled', 'cancellation is durable'
);

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-0000-0000-000000000002","aal":"aal1"}', true
);
select is(
  (select count(*)::integer from public.account_deletion_requests),
  0, 'another owner cannot inspect deletion status'
);
select is(
  (select exposures from public.operation_contracts
   where operation_id = 'account.deletion.schedule.v1'),
  array['ui']::text[], 'account deletion is never exposed to chat or MCP'
);

select * from finish();
rollback;
