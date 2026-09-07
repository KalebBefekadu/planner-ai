begin;
select plan(27);

select has_table('public', 'trash_batch_focus_items',
  'Trash batches retain private Today-focus restoration metadata');
select function_privs_are(
  'public', 'execute_trash_restore_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Trash restore Undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'trash-restore-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Trash focus action","horizonKind":"month","startsOn":"2026-08-01","endsOn":"2026-08-31","goalId":null,"parentActionId":null,"scheduledOn":"2026-08-18"}',
    'trash-restore-action-0001'
  )$$,
  'an Action is created for Trash restore testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Trash focus action'))
    ),
    'trash-restore-focus-0001'
  )$$,
  'the Action is selected for Today focus'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'action',
      'id', (select id from public.actions where title = 'Trash focus action'),
      'expectedVersion', 1
    ),
    'trash-restore-move-0001'
  )$$,
  'the focused Action moves to Trash'
);
set local role service_role;
select is((select count(*)::integer from public.trash_batch_focus_items), 1,
  'Trash move preserves the exact prior focus slot');
set local role authenticated;
select is((select count(*)::integer from public.daily_focus_items), 0,
  'Trash move removes the inactive Action from Today focus');
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.restore.v1',
    jsonb_build_object(
      'batchId', (select (result_json ->> 'batchId')::uuid from public.operation_receipts
                  where idempotency_key = 'trash-restore-move-0001')
    ),
    'trash-restore-apply-0001'
  )$$,
  'restoring the batch succeeds'
);
select ok((select trashed_at is null from public.actions where title = 'Trash focus action'),
  'Trash restore reactivates the Action');
select is((select count(*)::integer from public.daily_focus_items), 1,
  'Trash restore recovers the Action Today-focus slot');
select is(
  (select jsonb_array_length(undo_payload_json -> 'items') from public.operation_receipts
   where idempotency_key = 'trash-restore-apply-0001'),
  1, 'the restore receipt snapshots its exact batch item'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'trash-restore-apply-0001')
    ),
    'trash-restore-undo-0001'
  )$$,
  'an unchanged Trash restore can be undone'
);
select ok((select trashed_at is not null from public.actions where title = 'Trash focus action'),
  'Trash restore Undo returns the Action to Trash');
select is((select count(*)::integer from public.daily_focus_items), 0,
  'Trash restore Undo removes the inactive Action from focus again');
select ok(
  (select restored_at is null from public.trash_batches
   where id = (select (result_json ->> 'batchId')::uuid from public.operation_receipts
               where idempotency_key = 'trash-restore-move-0001')),
  'Trash restore Undo reopens the original batch');
select is((select version from public.actions where title = 'Trash focus action'), 4::bigint,
  'Trash restore Undo advances the Action version monotonically');

select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'trash-restore-move-0001')
    ),
    'trash-move-after-restore-undo-0001'
  )$$,
  'the original Trash move can be undone after restore reversal'
);
select ok((select trashed_at is null from public.actions where title = 'Trash focus action'),
  'Trash move Undo restores the Action');
select is((select count(*)::integer from public.daily_focus_items), 1,
  'Trash move Undo now restores Today focus exactly');
select is((select version from public.actions where title = 'Trash focus action'), 5::bigint,
  'Trash move Undo keeps the version monotonic');

select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'action',
      'id', (select id from public.actions where title = 'Trash focus action'),
      'expectedVersion', 5
    ),
    'trash-restore-conflict-move-0001'
  )$$,
  'another Trash batch is created for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.restore.v1',
    jsonb_build_object(
      'batchId', (select (result_json ->> 'batchId')::uuid from public.operation_receipts
                  where idempotency_key = 'trash-restore-conflict-move-0001')
    ),
    'trash-restore-conflict-apply-0001'
  )$$,
  'the conflict fixture is restored'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.update.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Trash focus action'),
      'expectedVersion', 7,
      'title', 'Trash focus action changed later',
      'descriptionMarkdown', null,
      'scheduledOn', '2026-08-18'
    ),
    'trash-restore-conflict-edit-0001'
  )$$,
  'a later Action edit supersedes the restore result'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'trash-restore-conflict-apply-0001')
    ),
    'trash-restore-conflict-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses to re-trash an Action edited after restore'
);
select is(
  (select title from public.actions where title = 'Trash focus action changed later'),
  'Trash focus action changed later', 'a refused Undo preserves the newer Action title'
);
select ok((select trashed_at is null from public.actions where title = 'Trash focus action changed later'),
  'a refused Undo preserves the active Action');
select is((select count(*)::integer from public.daily_focus_items), 1,
  'a refused Undo preserves the restored Today focus');

select * from finish();
rollback;
