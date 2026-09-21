begin;
select plan(42);

select has_table('public', 'weekly_plans', 'a committed week is a row');
select has_table('public', 'weekly_plan_items', 'its membership is rows');
select has_table('public', 'weekly_plan_snapshots', 'and its closed result is one more');
select is(
  public.operation_handler_for('week.close.v1'), 'weekly_plan',
  'the router sends week Operations to the weekly plan handler'
);
select table_privs_are(
  'public', 'weekly_plan_snapshots', 'authenticated', array['SELECT'],
  'a closed week is readable and never directly writable'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('52000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'week-owner-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- The week under test is the current one, so a completion recorded through the
-- Operation lands inside it. `date_trunc('week', ...)` is Monday, which is the
-- workspace default. Written inline rather than held in a temp table, because
-- the test runs as `authenticated` and cannot read one it created as superuser.

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"A direction."}', 'week-vision-0001'
  )$$,
  'a workspace exists'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Already finished', 'horizonKind', 'week',
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'goalId', null, 'parentActionId', null,
      'scheduledOn', date_trunc('week', current_date)::date
    ),
    'week-action-0001'
  )$$,
  'work can be created in the week'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Finished in time', 'horizonKind', 'week',
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'goalId', null, 'parentActionId', null,
      'scheduledOn', date_trunc('week', current_date)::date
    ),
    'week-action-0002'
  )$$,
  'and more of it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Finished too late', 'horizonKind', 'week',
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'goalId', null, 'parentActionId', null,
      'scheduledOn', date_trunc('week', current_date)::date
    ),
    'week-action-0003'
  )$$,
  'and more again'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Not finished', 'horizonKind', 'week',
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'goalId', null, 'parentActionId', null,
      'scheduledOn', date_trunc('week', current_date)::date
    ),
    'week-action-0004'
  )$$,
  'and one that will not get done'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Turned up on Wednesday', 'horizonKind', 'week',
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'goalId', null, 'parentActionId', null,
      'scheduledOn', date_trunc('week', current_date)::date
    ),
    'week-action-0005'
  )$$,
  'and one that was never planned'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Already finished'),
      'status', 'done', 'expectedVersion', 1
    ),
    'week-done-000001'
  )$$,
  'one task is finished before the week is planned'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'week.plan.v1',
    jsonb_build_object(
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'intention', 'Finish the household plan', 'capacityHours', 10
    ),
    'week-plan-000001'
  )$$,
  'a week can be planned'
);
select is((select state from public.weekly_plans), 'draft', 'a new plan is a draft');
select lives_ok(
  $$select public.execute_ui_operation(
    'week.plan.v1',
    jsonb_build_object(
      'startsOn', date_trunc('week', current_date)::date,
      'endsOn', (date_trunc('week', current_date)::date + 6),
      'intention', 'Finish the household plan', 'capacityHours', 10
    ),
    'week-plan-000001'
  )$$,
  'the same request can arrive twice'
);
select is((select count(*)::integer from public.weekly_plans), 1, 'and there is still one plan');

select lives_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Already finished'),
      'selected', true
    ),
    'week-select-0001'
  )$$,
  'work can be selected into the week'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Finished in time'),
      'selected', true
    ),
    'week-select-0002'
  )$$,
  'and more of it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Finished too late'),
      'selected', true
    ),
    'week-select-0003'
  )$$,
  'and more again'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Not finished'),
      'selected', true
    ),
    'week-select-0004'
  )$$,
  'and the one that will not get done'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'week.commit.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'expectedVersion', (select version from public.weekly_plans)
    ),
    'week-commit-0001'
  )$$,
  'the plan can be committed'
);
select is((select state from public.weekly_plans), 'committed', 'the plan is committed');
-- Three, not four: work already finished when the promise was made is not part
-- of the promise.
select is(
  (select count(*)::integer from public.weekly_plan_items where in_baseline), 3,
  'the baseline excludes work that was already finished'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Turned up on Wednesday'),
      'selected', true
    ),
    'week-select-0005'
  )$$,
  'work can still be added after the commitment'
);
select is(
  (select count(*)::integer from public.weekly_plan_items where in_baseline), 3,
  'and the baseline does not grow to meet it'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Not finished'),
      'selected', false
    ),
    'week-select-0006'
  )$$,
  'P0001', 'baseline_item_needs_disposition',
  'a baseline commitment cannot be quietly taken back out'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Finished in time'),
      'status', 'done', 'expectedVersion', 1
    ),
    'week-done-000002'
  )$$,
  'one of the committed tasks is finished'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Finished too late'),
      'status', 'done', 'expectedVersion', 1
    ),
    'week-done-000003'
  )$$,
  'and so is another one'
);

/* That second one is moved past the end of the week. There is no Operation for
   "finish this on a date of my choosing" and there should not be; the instant
   is set here directly to put a real completion outside the period, which is
   the case the counting rule exists for. */
reset role;
update public.actions
set completed_at = ((date_trunc('week', current_date)::date + 6) + 2)::timestamptz
where title = 'Finished too late';
set local role authenticated;

select lives_ok(
  $$select public.execute_ui_operation(
    'week.disposition.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Not finished'),
      'disposition', 'moved', 'note', 'Waiting on the delivery'
    ),
    'week-dispose-001'
  )$$,
  'the one that did not finish records what was decided about it'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'week.close.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'expectedVersion', (select version from public.weekly_plans)
    ),
    'week-close-00001'
  )$$,
  'the week can be closed'
);
select is((select state from public.weekly_plans), 'reviewed', 'the plan is reviewed');
select is(
  (select baseline_count from public.weekly_plan_snapshots), 3,
  'the denominator is the baseline'
);
-- One, not two: a task finished two days after the week ended is finished, and
-- it is not something this week did.
select is(
  (select completed_count from public.weekly_plan_snapshots), 1,
  'the numerator counts only what finished before the period ended'
);
select is(
  (select late_addition_count from public.weekly_plan_snapshots), 2,
  'the late addition and the already-finished task are counted separately'
);
select is(
  (select snapshot_json #>> '{intention}' from public.weekly_plan_snapshots),
  'Finish the household plan',
  'the intention is part of the record'
);

-- The point of the snapshot: later edits cannot rewrite what the week said.
select lives_ok(
  $$select public.execute_ui_operation(
    'action.status.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Not finished'),
      'status', 'done', 'expectedVersion', 1
    ),
    'week-done-000004'
  )$$,
  'the work that slipped can be finished next week'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.update.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Not finished'),
      'title', 'Renamed after the fact', 'descriptionMarkdown', null,
      'scheduledOn', (date_trunc('week', current_date)::date + 16),
      'expectedVersion', 2
    ),
    'week-rename-0001'
  )$$,
  'and renamed and moved afterwards'
);
select is(
  (select completed_count from public.weekly_plan_snapshots), 1,
  'and last week still reports what last week did'
);
select is(
  (select count(*)::integer from public.weekly_plan_snapshots
    where snapshot_json @> '[{"title": "Not finished"}]'::jsonb
      or snapshot_json #> '{items}' @> '[{"title": "Not finished"}]'::jsonb),
  1,
  'the record keeps the words the week was closed with'
);

select throws_ok(
  $$select public.execute_ui_operation(
    'week.select.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'actionId', (select id from public.actions where title = 'Turned up on Wednesday'),
      'selected', true
    ),
    'week-select-0007'
  )$$,
  'P0001', 'weekly_plan_closed',
  'a closed week does not take new work'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'week.close.v1',
    jsonb_build_object(
      'planId', (select id from public.weekly_plans),
      'expectedVersion', (select version from public.weekly_plans)
    ),
    'week-close-00002'
  )$$,
  'closing an already closed week answers with the record it already wrote'
);
select is(
  (select count(*)::integer from public.weekly_plan_snapshots), 1,
  'and writes no second one'
);

select * from finish();
rollback;
