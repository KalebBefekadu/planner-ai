begin;
select plan(18);

select has_table('public', 'daily_focus_items', 'daily focus storage exists');
select row_security_active('public.daily_focus_items'), 'daily focus storage has RLS';
select table_privs_are(
  'public', 'daily_focus_items', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate daily focus directly'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_focus_items'
      and policyname = 'daily_focus_owner_select'
      and qual like '%current_workspace_id%'
  ),
  'daily focus RLS does not depend on an undefined workspace helper'
);
select function_privs_are(
  'public', 'execute_daily_execution_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'daily execution domain operations are private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('82000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'today-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('82000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'today-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
select id, 'week', current_date - 3, current_date + 3, 'UTC'
from public.workspaces
where owner_user_id = '82000000-0000-0000-0000-000000000001';
insert into public.actions (workspace_id, horizon_id, title, scheduled_on)
select workspace.id, horizon.id, seed.title, current_date
from public.workspaces workspace
join public.planning_horizons horizon on horizon.workspace_id = workspace.id
cross join (values ('First focused Action'), ('Second focused Action')) seed(title)
where workspace.owner_user_id = '82000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-0000-0000-000000000001","aal":"aal1"}', true
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''daily-focus.set.v1'', %L::jsonb, ''daily-focus-0001'')',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', (select jsonb_agg(id order by title) from public.actions)
    )::text
  ),
  'the trusted UI gateway commits a daily focus list'
);
select is((select count(*)::integer from public.daily_focus_items), 2, 'two focused Actions are stored');
select is(
  (select max(sort_order)::integer from public.daily_focus_items), 1,
  'focus order is retained'
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''daily-focus.set.v1'', %L::jsonb, ''daily-focus-0002'')',
    jsonb_build_object(
      'focusOn', current_date,
      'actionIds', jsonb_build_array(
        (select id from public.actions order by title limit 1),
        (select id from public.actions order by title limit 1)
      )
    )::text
  ),
  'P0001', 'invalid_daily_focus', 'duplicate focused Actions are rejected'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action.update.v1'', %L::jsonb, ''action-update-0001'')',
    jsonb_build_object(
      'id', (select id from public.actions order by title limit 1),
      'expectedVersion', 1,
      'title', 'Edited focused Action',
      'descriptionMarkdown', 'Useful context',
      'scheduledOn', current_date + 1
    )::text
  ),
  'an Action can be edited through the operation service'
);
select is(
  (select description_markdown from public.actions where title = 'Edited focused Action'),
  'Useful context', 'Action details are saved'
);
select is(
  (select version::integer from public.actions where title = 'Edited focused Action'),
  2, 'editing increments the optimistic version'
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''action.update.v1'', %L::jsonb, ''action-update-0002'')',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Edited focused Action'),
      'expectedVersion', 1,
      'title', 'Stale overwrite attempt',
      'descriptionMarkdown', null,
      'scheduledOn', current_date
    )::text
  ),
  '40001', 'version_conflict_or_not_found', 'stale Action edits are rejected'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''action.status.v1'', %L::jsonb, ''action-done-0001'')',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Edited focused Action'),
      'expectedVersion', 2,
      'status', 'done'
    )::text
  ),
  'a focused Action can be completed through the existing operation'
);
select is(
  (select count(*)::integer from public.daily_focus_items focused
   join public.actions action on action.id = focused.action_id
   where action.title = 'Edited focused Action'),
  0, 'completed Actions are removed from daily focus'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id in ('daily-focus.set.v1', 'action.update.v1')),
  2, 'daily execution writes operation receipts'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id in ('daily-focus.set.v1', 'action.update.v1')),
  2, 'daily execution is visible in Activity'
);

select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-0000-0000-000000000002","aal":"aal1"}', true
);
select is((select count(*)::integer from public.daily_focus_items), 0, 'another owner sees no focus list');
select is((select count(*)::integer from public.actions), 0, 'another owner sees no Actions');

select * from finish();
rollback;
