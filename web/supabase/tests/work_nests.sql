begin;
select plan(14);

-- "wait to hear back" means nothing on its own; under "Reach out to Baily" it
-- means something exact. The storage was always a tree; only the interface
-- assumed one level.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nesting-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5e000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation('vision.upsert.v1',
    '{"bodyMarkdown":"Build something that runs without me."}', 'nest-vision-0001')$$,
  'a Vision is recorded'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    '{"title":"Steady income by December","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'nest-year-0001')$$,
  'a yearly Goal exists'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    jsonb_build_object(
      'title', 'Land a contract role', 'horizonKind', 'quarter',
      'startsOn', '2026-07-01', 'endsOn', '2026-09-30',
      'parentGoalId', (select id from public.goals where title = 'Steady income by December')
    ),
    'nest-quarter-0001')$$,
  'a quarterly Goal exists'
);

select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'Chase the Amazon contract', 'horizonKind', 'month',
      'startsOn', '2026-08-01', 'endsOn', '2026-08-31',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', null, 'scheduledOn', '2026-08-10'
    ),
    'nest-month-0001')$$,
  'a monthly Action exists'
);
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'Reach out to Baily', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'Chase the Amazon contract'),
      'scheduledOn', '2026-08-12'
    ),
    'nest-week-0001')$$,
  'a weekly Action rolls up to the monthly one, as it always did'
);

-- The change: a task may now sit under a task.
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'wait to hear back', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'Reach out to Baily'),
      'scheduledOn', '2026-08-13'
    ),
    'nest-sub-0001')$$,
  'and a subtask sits under a weekly Action'
);
select is(
  (select parent.title from public.actions child
     join public.actions parent on parent.id = child.parent_action_id
   where child.title = 'wait to hear back'),
  'Reach out to Baily',
  'and keeps its context by sitting under the task it belongs to'
);

-- Four levels is the bound, so a fourth child is the last one.
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'note the date they gave', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'wait to hear back'),
      'scheduledOn', '2026-08-14'
    ),
    'nest-sub-0002')$$,
  'a fourth level is allowed'
);
select throws_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'and a fifth', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'note the date they gave'),
      'scheduledOn', '2026-08-15'
    ),
    'nest-sub-0003')$$,
  'P0001', 'action_nested_too_deep',
  'a fifth is not, because the recursive cascades need a predictable cost'
);

-- An Action made its own ancestor would make every cascade over
-- parent_action_id fail to terminate.
select throws_ok(
  $$select public.execute_ui_operation('action.move.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Reach out to Baily'),
      'expectedVersion', 1,
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'wait to hear back'),
      'horizonKind', 'week', 'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'scheduledOn', '2026-08-12'
    ),
    'nest-cycle-0001')$$,
  'P0001', 'action_cannot_contain_itself',
  'an Action cannot be moved inside its own subtree'
);

-- A separate branch, two deep, to move onto.
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'Prepare the rate card', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'Chase the Amazon contract'),
      'scheduledOn', '2026-08-11'
    ),
    'nest-branch-0001')$$,
  'a sibling branch exists'
);
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object(
      'title', 'Look up the going rate', 'horizonKind', 'week',
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'Prepare the rate card'),
      'scheduledOn', '2026-08-11'
    ),
    'nest-branch-0002')$$,
  'two levels deep'
);

-- The whole subtree moves, so the bound is on where its deepest leaf lands,
-- not on the Action being dragged. "Reach out to Baily" is itself two levels
-- tall, and a leaf would be welcome at this parent.
select throws_ok(
  $$select public.execute_ui_operation('action.move.v1',
    jsonb_build_object(
      'id', (select id from public.actions where title = 'Reach out to Baily'),
      'expectedVersion', 1,
      'goalId', (select id from public.goals where title = 'Land a contract role'),
      'parentActionId', (select id from public.actions where title = 'Look up the going rate'),
      'horizonKind', 'week', 'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'scheduledOn', '2026-08-12'
    ),
    'nest-height-0001')$$,
  'P0001', 'action_nested_too_deep',
  'moving a two-deep subtree under a two-deep parent is refused'
);
-- A refused move changes nothing, which is the part that matters: a rejected
-- reparent must not leave the tree half-moved.
select is(
  (select parent.title from public.actions child
     join public.actions parent on parent.id = child.parent_action_id
   where child.title = 'Reach out to Baily'),
  'Chase the Amazon contract',
  'and a refused move leaves the Action exactly where it was'
);

select * from finish();
rollback;
