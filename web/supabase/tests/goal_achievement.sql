-- Completing a Goal used to hide it. goal.status.v1 stamped archived_at, and
-- every planner read filters on `archived_at is null`, so the Goal someone
-- worked a year toward vanished from the plan and the "Completed" tile stayed
-- at zero. Nothing failed and nothing was logged; the work simply stopped
-- being shown.
--
-- These assertions pin the distinction that fixes it: achieving records an
-- outcome, archiving is a filing decision, and neither one implies the other.

begin;
select plan(15);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e2000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'goal-achievement@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

select has_column('public', 'goals', 'achieved_at',
  'a Goal records when it was reached');
select col_is_null('public', 'goals', 'achieved_at',
  'a Goal that has not been reached carries no achievement date');
select has_check('public', 'goals',
  'the achievement date and the achieved status cannot disagree');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-0000-0000-000000000020', true);

select lives_ok($$select public.execute_ui_operation('vision.upsert.v1',
  '{"bodyMarkdown":"A steady year."}', 'achieve-vision-0001')$$,
  'the owner sets a Vision');

select lives_ok($$select public.execute_ui_operation('goal.create.v1',
  '{"title":"Reach the thing worth reaching","horizonKind":"year",
    "startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
  'achieve-goal-0001')$$,
  'the owner sets a yearly Goal');

-- Achieving it.
select lives_ok(
  format($$select public.execute_ui_operation('goal.status.v1', %L::jsonb, 'achieve-status-0001')$$,
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Reach the thing worth reaching'),
      'expectedVersion', (select version from public.goals where title = 'Reach the thing worth reaching'),
      'status', 'achieved'
    )),
  'the owner marks the Goal achieved');

select is(
  (select status from public.goals where title = 'Reach the thing worth reaching'),
  'achieved',
  'the Goal is recorded as achieved');

select isnt(
  (select achieved_at from public.goals where title = 'Reach the thing worth reaching'),
  null,
  'the day it was reached is kept');

-- The assertion the bug would have failed.
select is(
  (select archived_at from public.goals where title = 'Reach the thing worth reaching'),
  null,
  'achieving a Goal does not archive it out of the plan');

select is(
  (select count(*)::int from public.goals
    where archived_at is null and trashed_at is null),
  1,
  'the achieved Goal is still returned by the query the Planner runs');

-- Archiving is still available, and is still a separate decision.
select lives_ok(
  format($$select public.execute_ui_operation('goal.archive.v1', %L::jsonb, 'achieve-archive-0001')$$,
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Reach the thing worth reaching'),
      'expectedVersion', (select version from public.goals where title = 'Reach the thing worth reaching')
    )),
  'the owner can still archive the Goal deliberately');

select isnt(
  (select archived_at from public.goals where title = 'Reach the thing worth reaching'),
  null,
  'archiving on purpose still files the Goal away');

select isnt(
  (select achieved_at from public.goals where title = 'Reach the thing worth reaching'),
  null,
  'filing it away does not erase the fact that it was reached');

-- An Action was always correct here. Pinning it stops the two from diverging
-- again in the other direction.
select lives_ok($$select public.execute_ui_operation('action.create.v1',
  '{"title":"Do the smaller thing","horizonKind":"week",
    "startsOn":"2026-08-31","endsOn":"2026-09-06","goalId":null,
    "parentActionId":null,"scheduledOn":null}',
  'achieve-action-0001')$$,
  'the owner adds a weekly Action');

select is(
  (select archived_at from public.actions where title = 'Do the smaller thing'),
  null,
  'a newly created Action is not archived');

select * from finish();
rollback;
