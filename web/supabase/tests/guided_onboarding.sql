begin;
select plan(27);

select has_function(
  'public', 'execute_guided_onboarding_operation', array['text', 'jsonb', 'text', 'text'],
  'guided onboarding has one atomic domain executor'
);
select function_privs_are(
  'public', 'execute_guided_onboarding_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the guided onboarding executor is private'
);
select is(
  (select exposures from public.operation_contracts
   where operation_id = 'workspace.onboarding-complete.v1'),
  array['ui']::text[],
  'guided onboarding is UI-only'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guided-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guided-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

select ok(
  (select onboarding_completed_at is null from public.workspaces
   where owner_user_id = 'c1000000-0000-0000-0000-000000000001'),
  'a new Workspace is unfinished'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"America/New_York",
      "weekStartsOn":1,
      "coachingIntensity":"direct",
      "aiEnabled":true,
      "weeklyReviewDay":0,
      "today":"2026-08-17",
      "visionText":" Build a deliberate practice. ",
      "goalTitle":"Publish a useful body of work",
      "actionTitle":"Draft the first outline",
      "captureText":"  Preserve this raw first thought.  "
    }',
    'guided-setup-0001'
  )$$,
  'one Operation completes guided setup'
);
select ok(
  (select onboarding_completed_at is not null from public.workspaces where owner_user_id = auth.uid()),
  'guided setup marks the Workspace complete'
);
select is(
  (select timezone from public.workspaces where owner_user_id = auth.uid()),
  'America/New_York',
  'guided setup saves preferences'
);
select is((select body_markdown from public.visions), 'Build a deliberate practice.', 'Vision is saved');
select is((select title from public.goals), 'Publish a useful body of work', 'Goal is saved');
select is(
  (select kind from public.planning_horizons where id = (select horizon_id from public.goals)),
  'year',
  'the starter Goal uses the current yearly horizon'
);
select is((select title from public.actions), 'Draft the first outline', 'Action is saved');
select is(
  (select goal_id from public.actions),
  (select id from public.goals),
  'the starter Action links to the starter Goal'
);
select is(
  (select kind from public.planning_horizons where id = (select horizon_id from public.actions)),
  'month',
  'the starter Action uses the current monthly horizon'
);
select is((select scheduled_on from public.actions), date '2026-08-17', 'Action is scheduled today');
select is(
  (select raw_text from public.captures),
  '  Preserve this raw first thought.  ',
  'Capture source text is preserved exactly'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'workspace.onboarding-complete.v1'),
  1,
  'guided setup writes one receipt'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'workspace.onboarding-complete.v1'),
  1,
  'guided setup writes one Activity event'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"UTC","weekStartsOn":0,"coachingIntensity":"strict",
      "aiEnabled":false,"weeklyReviewDay":6,"today":"2026-08-18",
      "visionText":null,"goalTitle":null,"actionTitle":null,"captureText":null
    }',
    'guided-setup-0001'
  )$$,
  'an idempotent retry returns the original setup result'
);
select is((select count(*)::integer from public.visions), 1, 'retry does not duplicate the Vision');
select is((select count(*)::integer from public.goals), 1, 'retry does not duplicate the Goal');
select is((select count(*)::integer from public.actions), 1, 'retry does not duplicate the Action');
select is((select count(*)::integer from public.captures), 1, 'retry does not duplicate the Capture');

select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.execute_ui_operation(
    'workspace.onboarding-complete.v1',
    '{
      "timezone":"UTC","weekStartsOn":1,"coachingIntensity":"calm",
      "aiEnabled":true,"weeklyReviewDay":0,"today":"2026-08-17",
      "visionText":null,"goalTitle":"A Goal without direction",
      "actionTitle":"This must roll back","captureText":"This must also roll back"
    }',
    'guided-invalid-0001'
  )$$,
  'P0001', 'vision_required',
  'a Goal cannot be created without a Vision'
);
select ok(
  (select onboarding_completed_at is null from public.workspaces where owner_user_id = auth.uid()),
  'failed setup does not complete onboarding'
);
select is(
  (select count(*)::integer from public.actions) + (select count(*)::integer from public.captures),
  0,
  'failed setup leaves no partial starter records'
);
select is((select count(*)::integer from public.visions), 0, 'another owner cannot read the Vision');
select is((select count(*)::integer from public.operation_receipts), 0, 'another owner cannot read setup receipts');

select * from finish();
rollback;
