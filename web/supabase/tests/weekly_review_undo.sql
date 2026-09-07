begin;
select plan(22);

select function_privs_are(
  'public', 'execute_weekly_review_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Weekly Review undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'weekly-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Finish launch notes","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"scheduledOn":"2026-08-12"}',
    'weekly-undo-action-one-0001'
  )$$,
  'the first review Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Prepare interviews","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"scheduledOn":"2026-08-14"}',
    'weekly-undo-action-two-0001'
  )$$,
  'the second review Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'Keep the commitments explicit.',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Finish launch notes'),
          'expectedVersion', 1, 'resolution', 'done', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Prepare interviews'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', true
        )
      )
    ),
    'weekly-undo-complete-0001'
  )$$,
  'Weekly Review commits both decisions'
);
select is(
  (select jsonb_array_length(undo_payload_json -> 'actions') from public.operation_receipts
   where idempotency_key = 'weekly-undo-complete-0001'),
  2, 'the receipt snapshots both affected Actions'
);
select is(
  (select jsonb_array_length(undo_payload_json -> 'expectedHistories') from public.operation_receipts
   where idempotency_key = 'weekly-undo-complete-0001'),
  2, 'the receipt snapshots both schedule-history entries'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'weekly-undo-complete-0001')
    ),
    'weekly-undo-apply-0001'
  )$$,
  'an unchanged Weekly Review can be undone atomically'
);
select is((select count(*)::integer from public.reviews), 0,
  'Weekly Review Undo removes the completed Review');
select is((select count(*)::integer from public.review_action_items), 0,
  'Weekly Review Undo removes the owned decision snapshots');
select is(
  (select count(*)::integer from public.action_schedule_history
   where review_id is null and reason <> 'undo'),
  2, 'the original append-only schedule evidence is retained after Review removal'
);
select is(
  (select count(*)::integer from public.action_schedule_history where reason = 'undo'),
  1, 'a changed schedule receives a matching Undo history entry'
);
select is((select status from public.actions where title = 'Finish launch notes'), 'open',
  'Undo restores the completed Action status');
select is((select version from public.actions where title = 'Finish launch notes'), 3::bigint,
  'restoration advances the Action version monotonically');
select is((select scheduled_on from public.actions where title = 'Prepare interviews'),
  '2026-08-14'::date, 'Undo restores the rolled-over Action date');
select is(
  (select horizon.starts_on from public.actions action
   join public.planning_horizons horizon on horizon.id = action.horizon_id
   where action.title = 'Prepare interviews'),
  '2026-08-10'::date, 'Undo restores the rolled-over Action horizon'
);
select is(
  (select count(*)::integer from public.planning_horizons
   where kind = 'week' and starts_on = '2026-08-17'),
  1, 'the append-only history safely retains its referenced next-week horizon'
);
select ok(
  (select reversed_at is not null from public.operation_receipts
   where idempotency_key = 'weekly-undo-complete-0001'),
  'the original Weekly Review receipt is marked reversed'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'Conflict fixture.',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Finish launch notes'),
          'expectedVersion', 3, 'resolution', 'done', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Prepare interviews'),
          'expectedVersion', 3, 'resolution', 'done', 'reason', null, 'priority', false
        )
      )
    ),
    'weekly-undo-conflict-review-0001'
  )$$,
  'another Weekly Review is completed for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.update.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Finish launch notes'),
      'expectedVersion', 4,
      'title', 'Finish launch notes with edits',
      'descriptionMarkdown', null,
      'scheduledOn', '2026-08-12'
    ),
    'weekly-undo-conflict-edit-0001'
  )$$,
  'a later Action edit supersedes the Review result'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'weekly-undo-conflict-review-0001')
    ),
    'weekly-undo-conflict-apply-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses to overwrite a later Action edit'
);
select is(
  (select title from public.actions where title = 'Finish launch notes with edits'),
  'Finish launch notes with edits', 'a refused Undo preserves the newer Action title'
);
select is((select count(*)::integer from public.reviews), 1,
  'a refused Undo preserves the completed Review');

select * from finish();
rollback;
