begin;
select plan(41);

select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'planning_horizons', 'planning horizons exist');
select has_table('public', 'goals', 'goals exist');
select has_table('public', 'actions', 'actions exist');
select has_table('public', 'captures', 'captures exist');
select has_table('public', 'operation_receipts', 'operation receipts exist');
select has_table('public', 'activity_events', 'Activity exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.goals'::regclass),
  'goals have RLS'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.captures'::regclass),
  'captures have RLS'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.operation_contracts'::regclass),
  'Operation contracts have RLS'
);
select table_privs_are(
  'public', 'workspaces', 'authenticated', array['SELECT'],
  'authenticated users can read their Workspace through the Data API'
);
select table_privs_are(
  'public', 'planning_horizons', 'authenticated', array['SELECT'],
  'authenticated users can read planning horizons through the Data API'
);
select table_privs_are(
  'public', 'visions', 'authenticated', array['SELECT'],
  'authenticated users can read the Vision through the Data API'
);
select table_privs_are(
  'public', 'goals', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate goals outside Operations'
);
select table_privs_are(
  'public', 'operation_contracts', 'authenticated', array['SELECT'],
  'authenticated users can only read the Operation catalog'
);
select table_privs_are(
  'public', 'operation_contracts', 'anon', array[]::text[],
  'anonymous users have no Operation catalog privileges'
);
select table_privs_are(
  'public', 'actions', 'authenticated', array['SELECT'],
  'authenticated users can read Actions through the Data API'
);
select table_privs_are(
  'public', 'captures', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate captures outside Operations'
);
select table_privs_are(
  'public', 'operation_receipts', 'authenticated', array['SELECT'],
  'authenticated users can read their Operation receipts through the Data API'
);
select table_privs_are(
  'public', 'activity_events', 'authenticated', array['SELECT'],
  'authenticated users can read their Activity through the Data API'
);
select table_privs_are(
  'public', 'workspaces', 'anon', array[]::text[],
  'anonymous users cannot access Workspace rows through the Data API'
);
select table_privs_are(
  'public', 'planning_horizons', 'anon', array[]::text[],
  'anonymous users cannot access planning horizons through the Data API'
);
select table_privs_are(
  'public', 'visions', 'anon', array[]::text[],
  'anonymous users cannot access the Vision through the Data API'
);
select table_privs_are(
  'public', 'actions', 'anon', array[]::text[],
  'anonymous users cannot access Actions through the Data API'
);
select table_privs_are(
  'public', 'captures', 'anon', array[]::text[],
  'anonymous users cannot access Captures through the Data API'
);
select table_privs_are(
  'public', 'operation_receipts', 'anon', array[]::text[],
  'anonymous users cannot access Operation receipts through the Data API'
);
select table_privs_are(
  'public', 'activity_events', 'anon', array[]::text[],
  'anonymous users cannot access Activity through the Data API'
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

set local role anon;
select throws_ok(
  $$select count(*) from public.operation_contracts$$,
  '42501', null,
  'anonymous users cannot read the Operation catalog'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select ok(
  (select count(*) > 0 from public.operation_contracts),
  'authenticated users can read registered Operations'
);
select throws_ok(
  $$insert into public.operation_contracts (
    operation_id, risk_class, exposures, reversible
  ) values ('forged.operation.v1', 'low', array['ui'], false)$$,
  '42501', null,
  'authenticated users cannot forge Operation contracts'
);

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

select is(
  public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"  Preserve this exact raw thought.  ","source":"typed"}'::jsonb,
    'test-capture-0001'
  ) ->> 'id',
  (select id::text from public.captures limit 1),
  'a duplicate Capture delivery returns the original result'
);

select is(
  (select count(*)::integer from public.captures),
  1,
  'a duplicate Capture delivery does not create a second Capture'
);

select is(
  (
    select count(*)::integer
    from public.operation_receipts
    where operation_id = 'capture.create.v1' and idempotency_key = 'test-capture-0001'
  ),
  1,
  'a duplicate Capture delivery retains one authoritative receipt'
);

select is(
  (
    select count(*)::integer
    from public.activity_events
    where operation_id = 'capture.create.v1'
  ),
  1,
  'a duplicate Capture delivery does not emit a second activity event'
);

select throws_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Different text must not reuse the accepted key.","source":"typed"}'::jsonb,
    'test-capture-0001'
  )$$,
  'P0001',
  'idempotency_payload_mismatch',
  'a reused Capture key cannot acknowledge different source content'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.captures), 0, 'another owner cannot read the Capture');

select * from finish();
rollback;
