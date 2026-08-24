begin;
select plan(18);

select has_column('public', 'actions', 'parent_action_id', 'Actions have an explicit hierarchy');
select has_function(
  'public', 'execute_plan_edit_operation', array['text', 'jsonb', 'text', 'text'],
  'plan editing has a dedicated domain operation'
);
select function_privs_are(
  'public', 'execute_plan_edit_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'plan edit domain operations are private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('84000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'plan-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('84000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'plan-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.visions (workspace_id, body_markdown)
select id, 'Plan editing test Vision' from public.workspaces
where owner_user_id = '84000000-0000-0000-0000-000000000001';
insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
select workspace.id, seed.kind, seed.starts_on, seed.ends_on, 'UTC'
from public.workspaces workspace
cross join (values
  ('year', date '2026-01-01', date '2026-12-31'),
  ('quarter', date '2026-07-01', date '2026-09-30'),
  ('month', date '2026-08-01', date '2026-08-31'),
  ('week', date '2026-08-17', date '2026-08-23')
) seed(kind, starts_on, ends_on)
where workspace.owner_user_id = '84000000-0000-0000-0000-000000000001';
insert into public.goals (workspace_id, vision_id, horizon_id, title)
select workspace.id, vision.id, horizon.id, seed.title
from public.workspaces workspace
join public.visions vision on vision.workspace_id = workspace.id
join public.planning_horizons horizon on horizon.workspace_id = workspace.id and horizon.kind = 'year'
cross join (values ('Year One'), ('Year Two')) seed(title)
where workspace.owner_user_id = '84000000-0000-0000-0000-000000000001';
insert into public.goals (workspace_id, vision_id, horizon_id, parent_goal_id, title)
select workspace.id, vision.id, horizon.id, year_goal.id, seed.title
from public.workspaces workspace
join public.visions vision on vision.workspace_id = workspace.id
join public.planning_horizons horizon on horizon.workspace_id = workspace.id and horizon.kind = 'quarter'
join public.goals year_goal on year_goal.workspace_id = workspace.id and year_goal.title = 'Year One'
cross join (values ('Quarter One'), ('Quarter Two')) seed(title)
where workspace.owner_user_id = '84000000-0000-0000-0000-000000000001';
insert into public.actions (workspace_id, goal_id, horizon_id, title, scheduled_on)
select workspace.id, quarter_goal.id, horizon.id, quarter_goal.title || ' Monthly', date '2026-08-17'
from public.workspaces workspace
join public.goals quarter_goal on quarter_goal.workspace_id = workspace.id and quarter_goal.title like 'Quarter%'
join public.planning_horizons horizon on horizon.workspace_id = workspace.id and horizon.kind = 'month'
where workspace.owner_user_id = '84000000-0000-0000-0000-000000000001';
insert into public.actions (workspace_id, goal_id, parent_action_id, horizon_id, title, scheduled_on)
select workspace.id, parent.goal_id, parent.id, horizon.id, 'Weekly child', date '2026-08-17'
from public.workspaces workspace
join public.actions parent on parent.workspace_id = workspace.id and parent.title = 'Quarter One Monthly'
join public.planning_horizons horizon on horizon.workspace_id = workspace.id and horizon.kind = 'week'
where workspace.owner_user_id = '84000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-0000-0000-000000000001","aal":"aal1"}', true
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''goal.update.v1'', %L::jsonb, ''goal-edit-0001'')',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Quarter One'),
      'expectedVersion', 1,
      'title', 'Quarter One edited',
      'descriptionMarkdown', 'Outcome details',
      'parentGoalId', (select id from public.goals where title = 'Year Two'),
      'targetValue', 100,
      'currentValue', 35,
      'unit', 'customers',
      'dueOn', '2026-09-30'
    )::text
  ),
  'a Goal can be edited and moved through the trusted gateway'
);
select is(
  (select current_value::integer from public.goals where title = 'Quarter One edited'),
  35, 'Goal outcome progress is saved'
);
select is(
  (select parent.title from public.goals child join public.goals parent on parent.id = child.parent_goal_id
   where child.title = 'Quarter One edited'),
  'Year Two', 'a quarterly Goal can move to another yearly Goal'
);
select is(
  (select version::integer from public.goals where title = 'Quarter One edited'),
  2, 'Goal editing increments its version'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action.move.v1'', %L::jsonb, ''action-move-0001'')',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Weekly child'),
      'expectedVersion', 1,
      'goalId', (select goal_id from public.actions where title = 'Quarter Two Monthly'),
      'parentActionId', (select id from public.actions where title = 'Quarter Two Monthly'),
      'horizonKind', 'week',
      'startsOn', '2026-08-17',
      'endsOn', '2026-08-23',
      'scheduledOn', '2026-08-18'
    )::text
  ),
  'a weekly Action can move to another monthly Action'
);
select is(
  (select parent.title from public.actions child join public.actions parent on parent.id = child.parent_action_id
   where child.title = 'Weekly child'),
  'Quarter Two Monthly', 'the explicit Action parent changes'
);
select is(
  (select count(*)::integer from public.action_schedule_history
   where action_id = (select id from public.actions where title = 'Weekly child')),
  1, 'moving an Action records schedule history'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action.update.v1'', %L::jsonb, ''action-edit-0001'')',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Weekly child'),
      'expectedVersion', 2,
      'title', 'Weekly child edited',
      'descriptionMarkdown', 'Action details',
      'scheduledOn', '2026-08-19'
    )::text
  ),
  'an Action can be edited after moving'
);
select is(
  (select count(*)::integer from public.action_schedule_history
   where action_id = (select id from public.actions where title = 'Weekly child edited')),
  2, 'editing a schedule also records history'
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''goal.update.v1'', %L::jsonb, ''goal-edit-0002'')',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Quarter One edited'),
      'expectedVersion', 1,
      'title', 'Stale update',
      'descriptionMarkdown', null,
      'parentGoalId', (select parent_goal_id from public.goals where title = 'Quarter One edited'),
      'targetValue', null,
      'currentValue', null,
      'unit', null,
      'dueOn', null
    )::text
  ),
  '40001', 'version_conflict_or_not_found', 'stale Goal edits are rejected'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id in ('goal.update.v1', 'action.move.v1', 'action.update.v1')),
  3, 'plan edits write operation receipts'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id in ('goal.update.v1', 'action.move.v1', 'action.update.v1')),
  3, 'plan edits are visible in Activity'
);

select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-0000-0000-000000000002","aal":"aal1"}', true
);
select is((select count(*)::integer from public.goals), 0, 'another owner sees no Goals');
select is((select count(*)::integer from public.actions), 0, 'another owner sees no Actions');
select is(
  (select count(*)::integer from public.action_schedule_history),
  0, 'another owner sees no schedule history'
);

select * from finish();
rollback;
