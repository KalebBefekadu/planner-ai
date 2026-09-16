begin;
select plan(12);

-- Three defects found by auditing the nesting work against the rest of the
-- schema. All were newly reachable: nothing could reparent an Action under
-- another Action before.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5f000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'always-closes@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5f000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation('vision.upsert.v1',
    '{"bodyMarkdown":"Build something that runs without me."}', 'closes-vision-0001')$$,
  'a Vision is recorded'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    '{"title":"Steady income","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'closes-year-0001')$$,
  'a yearly Goal exists'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    jsonb_build_object('title','Land a role','horizonKind','quarter','startsOn','2026-07-01','endsOn','2026-09-30',
      'parentGoalId',(select id from public.goals where title = 'Steady income')),
    'closes-q1-0001')$$,
  'one quarterly Goal exists'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    jsonb_build_object('title','Ship the beta','horizonKind','quarter','startsOn','2026-07-01','endsOn','2026-09-30',
      'parentGoalId',(select id from public.goals where title = 'Steady income')),
    'closes-q2-0001')$$,
  'and a second one to move work between'
);

-- A parent with a subtask, both under the first Goal.
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object('title','Reach out to Baily','horizonKind','week','startsOn','2026-08-10','endsOn','2026-08-16',
      'goalId',(select id from public.goals where title = 'Land a role'),
      'parentActionId',null,'scheduledOn','2026-08-12'),
    'closes-parent-0001')$$,
  'a weekly Action exists'
);
select lives_ok(
  $$select public.execute_ui_operation('action.create.v1',
    jsonb_build_object('title','wait to hear back','horizonKind','week','startsOn','2026-08-10','endsOn','2026-08-16',
      'goalId',(select id from public.goals where title = 'Land a role'),
      'parentActionId',(select id from public.actions where title = 'Reach out to Baily'),
      'scheduledOn','2026-08-13'),
    'closes-child-0001')$$,
  'with a subtask under it'
);

-- Moving the parent to another Goal has to take the subtree with it. Both this
-- operation and action.create.v1 require a child's Goal to match its parent's,
-- so leaving the child behind produces a tree the schema's own rules forbid.
select lives_ok(
  $$select public.execute_ui_operation('action.move.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Reach out to Baily'),
      'expectedVersion',1,
      'goalId',(select id from public.goals where title = 'Ship the beta'),
      'parentActionId',null,'horizonKind','week',
      'startsOn','2026-08-10','endsOn','2026-08-16','scheduledOn','2026-08-12'),
    'closes-move-0001')$$,
  'the parent moves to another Goal'
);
select is(
  (select goal.title from public.actions action
     join public.goals goal on goal.id = action.goal_id
   where action.title = 'wait to hear back'),
  'Ship the beta',
  'and the subtask goes with it rather than being stranded on the old one'
);

-- Archiving a parent has to take the subtree. The confirmation dialog has
-- always promised "and any items beneath it", which was vacuously true while
-- nothing could nest an Action under an Action.
select lives_ok(
  $$select public.execute_ui_operation('action.archive.v1',
    jsonb_build_object(
      'id',(select id from public.actions where title = 'Reach out to Baily'),
      'expectedVersion',2),
    'closes-archive-0001')$$,
  'the parent is archived'
);
select isnt(
  (select archived_at from public.actions where title = 'wait to hear back'),
  null,
  'and the subtask is archived with it rather than orphaned'
);

-- The bound on what a week must answer for. Without it a workspace past a
-- hundred stalled Actions could never close a week at all: every one of them
-- was required, and the operation rejects more than a hundred decisions.
set local role postgres;
insert into public.actions (workspace_id, goal_id, horizon_id, title, status, scheduled_on, created_at)
select
  (select id from public.workspaces limit 1),
  (select id from public.goals where title = 'Land a role'),
  (select id from public.planning_horizons where kind = 'week' limit 1),
  'Stalled item ' || generated,
  'open',
  '2026-08-12',
  '2020-01-01T00:00:00Z'
from generate_series(1, 120) as generated;

-- Three checkpoints, each on its own week: only one completed weekly Review
-- may exist per horizon.
insert into public.planning_horizons (workspace_id, kind, starts_on, ends_on, timezone_snapshot)
select (select id from public.workspaces limit 1), 'week',
       date '2026-07-06' + (generated * 7), date '2026-07-12' + (generated * 7), 'UTC'
from generate_series(0, 2) as generated
on conflict (workspace_id, kind, starts_on) do nothing;

insert into public.reviews (workspace_id, horizon_id, kind, status, reflection_markdown, completed_at)
select (select id from public.workspaces limit 1), horizon.id, 'weekly', 'completed', '', now()
from public.planning_horizons horizon
where horizon.kind = 'week' and horizon.starts_on between '2026-07-06' and '2026-07-20';

select cmp_ok(
  (select count(*)::integer
     from public.review_week_eligible_actions(
       (select id from public.workspaces limit 1), '2026-08-17', '2026-08-23')),
  '>', 100,
  'more than a hundred Actions are eligible'
);
select is(
  (select count(*)::integer
     from public.review_week_required_actions(
       (select id from public.workspaces limit 1), '2026-08-17', '2026-08-23')),
  40,
  'but the week asks about the oldest forty, so it can always be closed'
);

select * from finish();
rollback;
