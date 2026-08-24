begin;
select plan(15);

select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'planning_horizons', 'planning horizons exist');
select has_table('public', 'goals', 'goals exist');
select has_table('public', 'actions', 'actions exist');
select has_table('public', 'captures', 'captures exist');
select has_table('public', 'operation_receipts', 'operation receipts exist');
select has_table('public', 'activity_events', 'Activity exists');
select row_security_active('public.goals'), 'goals has RLS';
select row_security_active('public.captures'), 'captures has RLS';
select table_privs_are(
  'public', 'goals', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate goals outside Operations'
);
select table_privs_are(
  'public', 'captures', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate captures outside Operations'
);
select function_privs_are(
  'public', 'execute_ui_operation', array['text', 'jsonb', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated users call the fixed-surface UI gateway'
);
select function_privs_are(
  'public', 'execute_planner_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'authenticated users cannot spoof an Operation surface'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Build a deliberate, healthy, useful life."}'::jsonb,
    'test-vision-0001'
  )$$,
  'the Operation service can create a Vision'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"  Preserve this exact raw thought.  ","source":"typed"}'::jsonb,
    'test-capture-0001'
  )$$,
  'the Operation service can create an immutable Capture'
);

select is(
  (select raw_text from public.captures limit 1),
  '  Preserve this exact raw thought.  ',
  'Capture source whitespace is preserved exactly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.captures), 0, 'another owner cannot read the Capture');

select * from finish();
rollback;
