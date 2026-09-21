begin;
select plan(29);

select col_is_null(
  'public', 'goals', 'horizon_id',
  'a Goal no longer has to be filed under one dated period'
);
select col_is_null(
  'public', 'goals', 'vision_id',
  'and no longer has to answer to a Vision that may not be written yet'
);
select has_column('public', 'goals', 'starts_on', 'a Goal says when it starts');
select is(
  public.operation_handler_for('goal.create.v2'), 'goal_scope',
  'the router sends the dated Goal Operations to their own handler'
);
select is(
  public.operation_handler_for('goal.create.v1'), 'planner',
  'and leaves the old one exactly where it was'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('53000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'goal-span-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '53000000-0000-0000-0000-000000000001', true);

-- A workspace, and deliberately no Vision: the point of v2 is that a Goal can
-- be written before anyone has decided what their life is for.
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"Anything at all","source":"typed"}', 'goal-span-ws-01'
  )$$,
  'a workspace exists without a Vision in it'
);
select is(
  (select count(*)::integer from public.visions), 0,
  'and nothing invented one'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v2',
    '{"title":"Rebuild the back garden","startsOn":"2026-10-01","targetOn":"2027-03-31"}',
    'goal-span-create-01'
  )$$,
  'a Goal can run from one quarter into the next'
);
select is(
  (select vision_id from public.goals where title = 'Rebuild the back garden'), null,
  'and is not attached to a Vision that does not exist'
);
select is(
  (select horizon_id from public.goals where title = 'Rebuild the back garden'), null,
  'and is not filed under a period it would have to be cloned out of'
);

-- The question a period view asks. One Goal, two quarters, no second row.
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2026-10-01', date '2026-12-31')),
  1, 'Q4 contains it'
);
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2027-01-01', date '2027-03-31')),
  1, 'Q1 contains the same one'
);
select is(
  (select count(*)::integer from public.goals),
  1, 'and there is still only one Goal'
);
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2027-04-01', date '2027-06-30')),
  0, 'a quarter it does not reach does not contain it'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v2', '{"title":"Learn to sail"}', 'goal-span-create-02'
  )$$,
  'a Goal can be written with no dates at all'
);
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2026-01-01', date '2030-12-31')),
  1, 'and undated work is in no period rather than in every period'
);

select throws_ok(
  $$select public.execute_ui_operation(
    'goal.create.v2',
    '{"title":"Backwards","startsOn":"2026-12-31","targetOn":"2026-01-01"}',
    'goal-span-create-03'
  )$$,
  'P0001', 'invalid_input',
  'a span that ends before it begins is refused'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'goal.create.v2',
    '{"title":"The business","kind":"initiative","targetOn":"2026-12-31"}',
    'goal-span-create-04'
  )$$,
  'P0001', 'initiative_is_not_a_period',
  'and a standing concern cannot be given a deadline by another name'
);

-- Scheduling what was unscheduled, and the concurrency that protects it.
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.schedule.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Learn to sail'),
      'expectedVersion', (select version from public.goals where title = 'Learn to sail'),
      'startsOn', '2026-11-01', 'targetOn', '2026-12-15'
    ),
    'goal-span-schedule-01'
  )$$,
  'an unscheduled Goal can be given dates'
);
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2026-10-01', date '2026-12-31')),
  2, 'and joins the quarter it now runs in'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'goal.schedule.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Learn to sail'),
      'expectedVersion', 1, 'startsOn', null, 'targetOn', null
    ),
    'goal-span-schedule-02'
  )$$,
  -- The handler raises 40001; the UI gateway translates it, because PostgREST
  -- turns 40001 into a 504 and throws the message away. The translated code is
  -- what a caller actually sees, so it is what this asserts.
  'P0001', 'version_conflict_or_not_found',
  'a stale edit is refused rather than overwriting a newer one'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.schedule.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Learn to sail'),
      'expectedVersion', (select version from public.goals where title = 'Learn to sail'),
      'startsOn', null, 'targetOn', null
    ),
    'goal-span-schedule-03'
  )$$,
  'dates can be taken off again, which is how work goes back to someday'
);
select is(
  (select count(*)::integer from public.goals_in_period(
    (select id from public.workspaces), date '2026-10-01', date '2026-12-31')),
  1, 'and it leaves the period it was in'
);

-- Retry safety, the same guarantee every other Operation gives.
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v2',
    '{"title":"Rebuild the back garden","startsOn":"2026-10-01","targetOn":"2027-03-31"}',
    'goal-span-create-01'
  )$$,
  'a repeated request answers with the Goal it already created'
);
select is(
  (select count(*)::integer from public.goals where title = 'Rebuild the back garden'), 1,
  'and does not create a second one'
);

-- A Goal written the old way still reads, and still nests the old way.
select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"A direction."}', 'goal-span-vision-01'
  )$$,
  'a Vision can be written later'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'The old way', 'horizonKind', 'year',
      'startsOn', '2026-01-01', 'endsOn', '2026-12-31', 'parentGoalId', null
    ),
    'goal-span-create-05'
  )$$,
  'goal.create.v1 still writes a horizon and still means what it meant'
);
select isnt(
  (select horizon_id from public.goals where title = 'The old way'), null,
  'the horizon is still there to read an old review by'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Under a dated parent', 'horizonKind', 'quarter',
      'startsOn', '2026-10-01', 'endsOn', '2026-12-31',
      'parentGoalId', (select id from public.goals where title = 'Rebuild the back garden')
    ),
    'goal-span-create-06'
  )$$,
  'and can sit under a Goal that has dates instead of a horizon'
);

select * from finish();
rollback;
