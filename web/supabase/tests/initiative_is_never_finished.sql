begin;
select plan(9);

-- "Real estate agent business" is not an outcome. It is a standing concern that
-- recurs every week with new work under it, and a Goal is built to be reached.
-- goals.kind is the one column that lets a container like that live in the
-- hierarchy without being asked every quarter whether it is done.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'initiative-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5c000000-0000-0000-0000-000000000001', true);

-- goals.vision_id is not null, so an initiative cannot exist before a Vision
-- does. Onboarding's vision step is optional, which makes this the first thing
-- a new workspace hits.
select throws_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Real estate agent business","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null,"kind":"initiative"}',
    'initiative-before-vision-0001'
  )$$,
  'P0001', 'vision_required',
  'an initiative cannot be created before a Vision exists'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1',
    '{"bodyMarkdown":"Build something that runs without me."}',
    'initiative-vision-0001'
  )$$,
  'a Vision is recorded'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Real estate agent business","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null,"kind":"initiative"}',
    'initiative-create-0001'
  )$$,
  'an initiative is created'
);

-- The anchor is bookkeeping. The absence of a deadline is the point.
select is(
  (select due_on from public.goals where title = 'Real estate agent business'),
  null,
  'an initiative is never due'
);
select is(
  (select horizon.kind from public.goals goal
     join public.planning_horizons horizon on horizon.id = goal.horizon_id
   where goal.title = 'Real estate agent business'),
  'year',
  'and is anchored to the year only because a horizon is required'
);

-- A period Goal is unchanged by any of this.
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Land a contract role","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'initiative-outcome-0001'
  )$$,
  'a yearly outcome still needs no kind'
);
select is(
  (select kind || ' due ' || due_on::text from public.goals where title = 'Land a contract role'),
  'outcome due 2026-12-31',
  'and is still an outcome with a deadline'
);

-- An initiative is a standing concern, so a quarter is a category error.
select throws_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"A quarter is not a business","horizonKind":"quarter","startsOn":"2026-07-01","endsOn":"2026-09-30","parentGoalId":null,"kind":"initiative"}',
    'initiative-quarter-0001'
  )$$,
  'P0001', 'initiative_is_not_a_period',
  'an initiative cannot be filed inside a period'
);

-- Pausing is the "clean it up" step, and it already existed.
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.status.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'Real estate agent business'),
      'status', 'paused', 'expectedVersion', 1
    ),
    'initiative-pause-0001'
  )$$,
  'a stalled initiative is paused rather than abandoned'
);

select * from finish();
rollback;
