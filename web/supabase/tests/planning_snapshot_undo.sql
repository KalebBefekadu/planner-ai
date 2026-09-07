begin;
select plan(42);

select has_table('public', 'operation_before_images', 'private before images have durable schema');
select ok((select relrowsecurity from pg_class
  where oid = 'public.operation_before_images'::regclass
), 'before images enforce row-level security'
);
select function_privs_are(
  'public', 'execute_planning_snapshot_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the planning restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'planning-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c4000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"A life directed with care."}', 'planning-vision-0001'
  )$$,
  'a Vision is available for planning fixtures'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Original annual goal","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'planning-year-goal-0001'
  )$$,
  'an annual Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.update.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Original annual goal'),
      'expectedVersion', 1, 'title', 'Changed annual goal',
      'descriptionMarkdown', 'Changed description', 'parentGoalId', null,
      'targetValue', 100, 'currentValue', 25, 'unit', 'percent', 'dueOn', '2026-12-15'
    ),
    'planning-goal-update-0001'
  )$$,
  'a Goal update captures its prior state'
);
select is(
  (select undo_payload_json ->> 'title' from public.operation_receipts
   where idempotency_key = 'planning-goal-update-0001'),
  'Original annual goal',
  'the Goal receipt owns its exact prior title'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-goal-update-0001')
    ),
    'planning-goal-update-undo-0001'
  )$$,
  'the unchanged Goal update can be undone'
);
select is((select title from public.goals where title = 'Original annual goal'),
  'Original annual goal', 'Goal undo restores the prior title');
select is((select version from public.goals where title = 'Original annual goal'), 3::bigint,
  'Goal undo advances the version');
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.status.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Original annual goal'),
      'status', 'achieved', 'expectedVersion', 3
    ),
    'planning-goal-status-0001'
  )$$,
  'Goal status records active and archive state'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-goal-status-0001')
    ),
    'planning-goal-status-undo-0001'
  )$$,
  'Goal status can be undone while unchanged'
);
select is((select status from public.goals where title = 'Original annual goal'), 'active',
  'Goal status undo restores active');
select ok((select archived_at is null from public.goals where title = 'Original annual goal'),
  'Goal status undo restores the prior archive timestamp');

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Quarter A', 'horizonKind', 'quarter',
      'startsOn', '2026-01-01', 'endsOn', '2026-03-31',
      'parentGoalId', (select id from public.goals where title = 'Original annual goal')
    ),
    'planning-quarter-a-0001'
  )$$,
  'a quarter Goal is created for Action fixtures'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Original monthly action', 'horizonKind', 'month',
      'startsOn', '2026-01-01', 'endsOn', '2026-01-31',
      'goalId', (select id from public.goals where title = 'Quarter A'),
      'parentActionId', null, 'scheduledOn', '2026-01-10'
    ),
    'planning-action-create-0001'
  )$$,
  'a monthly Action is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.update.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Original monthly action'),
      'expectedVersion', 1, 'title', 'Changed monthly action',
      'descriptionMarkdown', 'Changed details', 'scheduledOn', '2026-01-20'
    ),
    'planning-action-update-0001'
  )$$,
  'an Action update captures content and schedule'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-action-update-0001')
    ),
    'planning-action-update-undo-0001'
  )$$,
  'the unchanged Action update can be undone'
);
select is((select title from public.actions where title = 'Original monthly action'),
  'Original monthly action', 'Action undo restores its title');
select is((select scheduled_on from public.actions where title = 'Original monthly action'),
  '2026-01-10'::date, 'Action undo restores its schedule');
select is(
  (select count(*)::integer from public.action_schedule_history
   where action_id = (select id from public.actions where title = 'Original monthly action')),
  2, 'Action update and undo both preserve schedule history'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'daily-focus.set.v1',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array(
        (select id from public.actions where title = 'Original monthly action')
      )
    ),
    'planning-daily-focus-0001'
  )$$,
  'the Action is focused before completion'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Original monthly action'),
      'status', 'done', 'expectedVersion', 3
    ),
    'planning-action-status-0001'
  )$$,
  'completing the Action captures its focus membership'
);
select is((select count(*)::integer from public.daily_focus_items), 0,
  'completion removes the Action from daily focus');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-action-status-0001')
    ),
    'planning-action-status-undo-0001'
  )$$,
  'Action status can be undone while focus slots remain free'
);
select is((select status from public.actions where title = 'Original monthly action'), 'open',
  'Action status undo restores open');
select is((select count(*)::integer from public.daily_focus_items), 1,
  'Action status undo restores its daily-focus membership');

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Quarter B', 'horizonKind', 'quarter',
      'startsOn', '2026-04-01', 'endsOn', '2026-06-30',
      'parentGoalId', (select id from public.goals where title = 'Original annual goal')
    ),
    'planning-quarter-b-0001'
  )$$,
  'a destination quarter Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.move.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Original monthly action'),
      'expectedVersion', 5,
      'goalId', (select id from public.goals where title = 'Quarter B'),
      'parentActionId', null, 'horizonKind', 'month',
      'startsOn', '2026-04-01', 'endsOn', '2026-04-30', 'scheduledOn', '2026-04-15'
    ),
    'planning-action-move-0001'
  )$$,
  'an Action move captures hierarchy and schedule state'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-action-move-0001')
    ),
    'planning-action-move-undo-0001'
  )$$,
  'the unchanged Action move can be undone'
);
select is(
  (select goal_id from public.actions where title = 'Original monthly action'),
  (select id from public.goals where title = 'Quarter A'),
  'Action move undo restores the original Goal'
);
select is((select scheduled_on from public.actions where title = 'Original monthly action'),
  '2026-01-10'::date, 'Action move undo restores the original date');
select is(
  (select count(*)::integer from public.action_schedule_history
   where action_id = (select id from public.actions where title = 'Original monthly action')
     and reason = 'undo'),
  2, 'each schedule reversal is explicitly recorded as undo'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1',
    '{"statement":"Original preference","sourceType":"user","sourceId":null}',
    'planning-memory-create-0001'
  )$$,
  'a Memory is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'memory.update.v1',
    jsonb_build_object(
      'id', (select id from public.memories where statement = 'Original preference'),
      'statement', 'Changed preference', 'expectedVersion', 1
    ),
    'planning-memory-update-0001'
  )$$,
  'a Memory update captures its exact statement'
);
select is(
  (select undo_payload_json ->> 'statement' from public.operation_receipts
   where idempotency_key = 'planning-memory-update-0001'),
  'Original preference', 'the Memory receipt retains the prior statement'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-memory-update-0001')
    ),
    'planning-memory-update-undo-0001'
  )$$,
  'an unchanged Memory update can be undone'
);
select is((select statement from public.memories where statement = 'Original preference'),
  'Original preference', 'Memory undo restores the exact prior statement');

select lives_ok(
  $$select public.execute_ui_operation(
    'memory.update.v1',
    jsonb_build_object(
      'id', (select id from public.memories where statement = 'Original preference'),
      'statement', 'First later memory', 'expectedVersion', 3
    ),
    'planning-memory-conflict-0001'
  )$$,
  'a later Memory update is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'memory.update.v1',
    jsonb_build_object(
      'id', (select id from public.memories where statement = 'First later memory'),
      'statement', 'Newest memory', 'expectedVersion', 4
    ),
    'planning-memory-conflict-0002'
  )$$,
  'a newer Memory update supersedes it'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'planning-memory-conflict-0001')
    ),
    'planning-memory-conflict-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'undo refuses to overwrite a newer Memory update'
);
select is((select statement from public.memories where statement = 'Newest memory'),
  'Newest memory', 'the refused undo preserves the newest Memory');

select * from finish();
rollback;
