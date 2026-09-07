begin;
select plan(15);

select function_privs_are(
  'public', 'execute_account_deletion_schedule_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the account deletion Undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ce000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'deletion-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.mcp_access_tokens (
  workspace_id, owner_user_id, token_hash, name, allowed_operations, expires_at
)
select id, owner_user_id, repeat('d', 64), 'Undo authority fixture',
  array['workspace.snapshot.read.v1'], now() + interval '30 days'
from public.workspaces where owner_user_id = 'ce000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ce000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-000000000001","aal":"aal2"}', true
);

select lives_ok(
  $$select public.execute_ui_operation(
    'account.deletion.schedule.v1', '{"confirmation":"DELETE MY ACCOUNT"}',
    'deletion-undo-schedule-0001'
  )$$,
  'an AAL2 session schedules account deletion'
);
select ok((select revoked_at is not null from public.mcp_access_tokens),
  'scheduling deletion revokes MCP authority');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'deletion-undo-schedule-0001')
    ),
    'deletion-undo-apply-0001'
  )$$,
  'a pending deletion schedule can be undone'
);
select is((select status from public.account_deletion_requests), 'canceled',
  'deletion schedule Undo uses the durable cancellation state');
select ok((select canceled_at is not null from public.account_deletion_requests),
  'deletion schedule Undo records its cancellation time');
select ok((select revoked_at is not null from public.mcp_access_tokens),
  'cancellation does not silently restore external authority');
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'account.deletion.cancel.v1' and idempotency_key like 'inverse:%'),
  1, 'Undo dispatches the existing account cancellation Operation'
);
select ok(
  (select reversed_at is not null from public.operation_receipts
   where idempotency_key = 'deletion-undo-schedule-0001'),
  'the scheduling receipt is marked reversed'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'deletion-undo-schedule-0001')
    ),
    'deletion-undo-apply-0001'
  )$$,
  'an identical Undo retry returns its saved receipt'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'account.deletion.schedule.v1', '{"confirmation":"DELETE MY ACCOUNT"}',
    'deletion-undo-conflict-schedule-0001'
  )$$,
  'another deletion can be scheduled after cancellation'
);
select lives_ok(
  format(
    'select public.execute_ui_operation(''account.deletion.cancel.v1'', %L::jsonb, ''deletion-undo-conflict-cancel-0001'')',
    jsonb_build_object(
      'requestId', (select (result_json ->> 'requestId')::uuid from public.operation_receipts
                    where idempotency_key = 'deletion-undo-conflict-schedule-0001')
    )::text
  ),
  'the second schedule is canceled independently'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'deletion-undo-conflict-schedule-0001')
    ),
    'deletion-undo-conflict-apply-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses an independently canceled deletion request'
);
select is(
  (select status from public.account_deletion_requests order by requested_at desc limit 1),
  'canceled', 'a refused Undo preserves the safer canceled state'
);
select is(
  (select reversible from public.operation_contracts
   where operation_id = 'account.deletion.cancel.v1'),
  false, 'canceling account deletion is intentionally non-reversible'
);

select * from finish();
rollback;
