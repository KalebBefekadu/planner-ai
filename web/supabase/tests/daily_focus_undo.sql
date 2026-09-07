begin;
select plan(15);

select function_privs_are(
  'public', 'execute_daily_focus_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the daily-focus restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'focus-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"A focused direction for the year."}', 'focus-vision-0001'
  )$$,
  'a Vision is available for focus fixtures'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Focus annual goal","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'focus-year-0001'
  )$$,
  'an annual Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Focus quarter', 'horizonKind', 'quarter',
      'startsOn', '2026-01-01', 'endsOn', '2026-03-31',
      'parentGoalId', (select id from public.goals where title = 'Focus annual goal')
    ),
    'focus-quarter-0001'
  )$$,
  'a quarter Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Focus action A', 'horizonKind', 'month',
      'startsOn', '2026-01-01', 'endsOn', '2026-01-31',
      'goalId', (select id from public.goals where title = 'Focus quarter'),
      'parentActionId', null, 'scheduledOn', '2026-01-10'
    ),
    'focus-action-a-0001'
  )$$,
  'the first Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Focus action B', 'horizonKind', 'month',
      'startsOn', '2026-01-01', 'endsOn', '2026-01-31',
      'goalId', (select id from public.goals where title = 'Focus quarter'),
      'parentActionId', null, 'scheduledOn', '2026-01-11'
    ),
    'focus-action-b-0001'
  )$$,
  'the second Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Focus action A'))
    ),
    'focus-set-a-0001'
  )$$,
  'the first ordered focus set is saved'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Focus action B'))
    ),
    'focus-set-b-0001'
  )$$,
  'replacing focus captures the previous ordered set'
);
select is(
  (select undo_payload_json -> 'items' -> 0 ->> 'actionId'
   from public.operation_receipts where idempotency_key = 'focus-set-b-0001'),
  (select id::text from public.actions where title = 'Focus action A'),
  'the focus receipt retains the previous Action'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts where idempotency_key = 'focus-set-b-0001')
    ),
    'focus-set-b-undo-0001'
  )$$,
  'an unchanged focus replacement can be undone'
);
select is(
  (select action_id from public.daily_focus_items where focus_on = current_date),
  (select id from public.actions where title = 'Focus action A'),
  'focus undo restores the previous Action'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Focus action B'))
    ),
    'focus-conflict-b-0001'
  )$$,
  'another focus replacement is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array((select id from public.actions where title = 'Focus action A'))
    ),
    'focus-conflict-a-0001'
  )$$,
  'a newer focus replacement supersedes it'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts where idempotency_key = 'focus-conflict-b-0001')
    ),
    'focus-conflict-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'undo refuses to overwrite a newer focus set'
);
select is(
  (select action_id from public.daily_focus_items where focus_on = current_date),
  (select id from public.actions where title = 'Focus action A'),
  'a refused focus undo preserves the newest set'
);

select * from finish();
rollback;
