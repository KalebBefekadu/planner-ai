begin;
select plan(10);

-- The criterion the Weekly Review quotes at the moment work is dropped.
-- Dropping something is only defensible when the standard it failed is on
-- screen while you decide.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('5d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'definition-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '5d000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation('vision.upsert.v1',
    '{"bodyMarkdown":"Build something that runs without me."}', 'dod-vision-0001')$$,
  'a Vision is recorded'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    '{"title":"Steady income by December","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'dod-year-0001')$$,
  'a yearly outcome exists'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.create.v1',
    jsonb_build_object(
      'title', 'TEK Systems', 'horizonKind', 'year',
      'startsOn', '2026-01-01', 'endsOn', '2026-12-31',
      'parentGoalId', (select id from public.goals where title = 'Steady income by December'),
      'kind', 'initiative'
    ),
    'dod-initiative-0001')$$,
  'an initiative sits under the yearly Goal it serves'
);

-- A caller that has never heard of the field must not erase it, which is what
-- a plain nullif on an absent key would have done.
select lives_ok(
  $$select public.execute_ui_operation('goal.update.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'TEK Systems'),
      'expectedVersion', 1, 'title', 'TEK Systems — Amazon',
      'descriptionMarkdown', null,
      'parentGoalId', (select id from public.goals where title = 'Steady income by December'),
      'targetValue', null, 'currentValue', null, 'unit', null, 'dueOn', null,
      'definitionOfDone', 'A signed contract, or a clear no so the time goes elsewhere.'
    ),
    'dod-set-0001')$$,
  'an initiative records what good looks like'
);
select is(
  (select definition_of_done from public.goals where title = 'TEK Systems — Amazon'),
  'A signed contract, or a clear no so the time goes elsewhere.',
  'and it is stored as written'
);
select lives_ok(
  $$select public.execute_ui_operation('goal.update.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'TEK Systems — Amazon'),
      'expectedVersion', 2, 'title', 'TEK Systems — Amazon',
      'descriptionMarkdown', null,
      'parentGoalId', (select id from public.goals where title = 'Steady income by December'),
      'targetValue', null, 'currentValue', null, 'unit', null, 'dueOn', null
    ),
    'dod-untouched-0001')$$,
  'an edit that never mentions the field still succeeds'
);
select is(
  (select definition_of_done from public.goals where title = 'TEK Systems — Amazon'),
  'A signed contract, or a clear no so the time goes elsewhere.',
  'and leaves it exactly as it was'
);

-- Clearing it has to be possible, and has to be explicit.
select lives_ok(
  $$select public.execute_ui_operation('goal.update.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'TEK Systems — Amazon'),
      'expectedVersion', 3, 'title', 'TEK Systems — Amazon',
      'descriptionMarkdown', null,
      'parentGoalId', (select id from public.goals where title = 'Steady income by December'),
      'targetValue', null, 'currentValue', null, 'unit', null, 'dueOn', null,
      'definitionOfDone', ''
    ),
    'dod-clear-0001')$$,
  'sending it empty clears it'
);
select is(
  (select definition_of_done from public.goals where title = 'TEK Systems — Amazon'),
  null,
  'and the field is null rather than an empty string'
);

-- "Never finished" is the point of the kind, so an edit contradicting it says
-- which rule it hit rather than surfacing a constraint name.
select throws_ok(
  $$select public.execute_ui_operation('goal.update.v1',
    jsonb_build_object(
      'id', (select id from public.goals where title = 'TEK Systems — Amazon'),
      'expectedVersion', 4, 'title', 'TEK Systems — Amazon',
      'descriptionMarkdown', null,
      'parentGoalId', (select id from public.goals where title = 'Steady income by December'),
      'targetValue', null, 'currentValue', null, 'unit', null, 'dueOn', '2026-12-31'
    ),
    'dod-deadline-0001')$$,
  'P0001', 'initiative_has_no_deadline',
  'an initiative cannot be given a deadline by an edit either'
);

select * from finish();
rollback;
