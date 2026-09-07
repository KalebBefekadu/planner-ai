begin;
select plan(25);

select function_privs_are(
  'public', 'execute_planning_archive_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the planning archive undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'cd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'archive-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'cd000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Build with deliberate attention."}',
    'archive-undo-vision-0001'
  )$$,
  'a Vision is created for archive fixtures'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Archive year","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'archive-undo-year-0001'
  )$$,
  'a yearly Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Archive quarter', 'horizonKind', 'quarter',
      'startsOn', '2026-01-01', 'endsOn', '2026-03-31',
      'parentGoalId', (select id from public.goals where title = 'Archive year')
    ),
    'archive-undo-quarter-0001'
  )$$,
  'a child Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Archive action', 'horizonKind', 'month',
      'startsOn', '2026-01-01', 'endsOn', '2026-01-31',
      'goalId', (select id from public.goals where title = 'Archive quarter'),
      'parentActionId', null, 'scheduledOn', '2026-01-10'
    ),
    'archive-undo-action-0001'
  )$$,
  'a linked Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Archive action'))
    ),
    'archive-undo-focus-0001'
  )$$,
  'the linked Action is selected for Today focus'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.archive.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Archive year'),
      'expectedVersion', 1
    ),
    'archive-undo-goal-0001'
  )$$,
  'Goal archive applies to the owned planning branch'
);
select is(
  (select jsonb_array_length(undo_payload_json -> 'snapshots')
   from public.operation_receipts where idempotency_key = 'archive-undo-goal-0001'),
  3, 'the receipt snapshots the Goal, child Goal, and linked Action'
);
select is((select count(*)::integer from public.daily_focus_items), 0,
  'archiving removes the inactive Action from Today focus');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'archive-undo-goal-0001')
    ),
    'archive-undo-goal-apply-0001'
  )$$,
  'an unchanged Goal archive can be undone atomically'
);
select is(
  (select count(*)::integer from public.goals where archived_at is null),
  2, 'Goal archive Undo restores both Goal archive timestamps'
);
select ok((select archived_at is null from public.actions where title = 'Archive action'),
  'Goal archive Undo restores the linked Action');
select is((select count(*)::integer from public.daily_focus_items), 1,
  'Goal archive Undo restores the prior Today focus');
select is((select version from public.goals where title = 'Archive year'), 3::bigint,
  'the root Goal version remains monotonic');
select is((select version from public.goals where title = 'Archive quarter'), 3::bigint,
  'the child Goal version remains monotonic');
select is((select version from public.actions where title = 'Archive action'), 3::bigint,
  'the linked Action version remains monotonic');

select lives_ok(
  $$select public.execute_ui_operation(
    'action.archive.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Archive action'),
      'expectedVersion', 3
    ),
    'archive-undo-action-only-0001'
  )$$,
  'a single Action can be archived'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'archive-undo-action-only-0001')
    ),
    'archive-undo-action-only-apply-0001'
  )$$,
  'an unchanged Action archive can be undone'
);
select ok((select archived_at is null from public.actions where title = 'Archive action'),
  'Action archive Undo restores its archive timestamp');
select is((select version from public.actions where title = 'Archive action'), 5::bigint,
  'Action archive Undo advances its version');

select lives_ok(
  $$select public.execute_ui_operation(
    'action.archive.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Archive action'),
      'expectedVersion', 5
    ),
    'archive-undo-conflict-archive-0001'
  )$$,
  'another Action archive is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.archive.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Archive action'),
      'expectedVersion', 6
    ),
    'archive-undo-conflict-newer-0001'
  )$$,
  'a later versioned archive supersedes the first archive result'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'archive-undo-conflict-archive-0001')
    ),
    'archive-undo-conflict-apply-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses to overwrite a later Action archive'
);
select is(
  (select version from public.actions where title = 'Archive action'),
  7::bigint, 'a refused Undo preserves the newer version'
);
select ok(
  (select archived_at is not null from public.actions where title = 'Archive action'),
  'a refused Undo preserves the latest archive state'
);

select * from finish();
rollback;
