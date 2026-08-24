begin;
select plan(20);

select has_table('public', 'ai_quota_reservations', 'in-flight cost reservations exist');
select row_security_active('public.ai_quota_reservations'), 'cost reservations have forced RLS';
select table_privs_are(
  'public', 'ai_quota_reservations', 'authenticated', array['SELECT'],
  'authenticated users can only inspect their own reservations'
);

select function_privs_are(
  'public', 'consume_ai_quota_status', array['text'],
  'authenticated', array['EXECUTE'], 'authenticated routes can request a stable quota decision'
);
select function_privs_are(
  'public', 'consume_ai_quota_status', array['text', 'uuid'],
  'authenticated', array['EXECUTE'], 'canonical routes can reserve cost by request ID'
);
select function_privs_are(
  'public', 'release_ai_quota_reservation', array['uuid'],
  'authenticated', array['EXECUTE'], 'canonical routes can reconcile their reservation'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('73000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'quota-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('73000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'quota-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);

select is(public.consume_ai_quota_status('capture_analysis'), 'allowed', 'a known capability is allowed');
select is(public.consume_ai_quota_status('unknown'), 'invalid', 'unknown capabilities fail closed');

set local role service_role;
select is(
  (select count(*)::integer from public.ai_request_windows where operation = 'capture_analysis'),
  1, 'an allowed request consumes one rate-limit slot'
);
set local role authenticated;

select public.consume_ai_quota_status('capture_analysis') from generate_series(1, 9);
select is(
  public.consume_ai_quota_status('capture_analysis'),
  'rate_limited', 'the per-minute limit has a stable decision'
);

select lives_ok(
  $$select public.record_ai_usage(
    '73100000-0000-4000-8000-000000000001', 'assistant', 'agent', 'groq',
    'openai/gpt-oss-120b', '2026-08-17-gpt-oss-120b', 'succeeded', 100,
    0, 0, null, 20000000, null
  )$$, 'a platform-cap fixture is recorded'
);
select is(
  public.consume_ai_quota_status('assistant'),
  'monthly_cap', 'the monthly platform cap has a distinct stable decision'
);
select is(public.consume_ai_quota('assistant'), false, 'the compatibility quota function stays fail closed');

select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);
select is(public.consume_ai_quota_status('assistant'), 'allowed', 'quota state is Workspace isolated');
select is((select count(*)::integer from public.ai_usage_events), 0, 'usage remains owner isolated');
select is(
  public.consume_ai_quota_status('assistant', '73200000-0000-4000-8000-000000000001'),
  'allowed', 'a canonical request reserves bounded in-flight cost'
);
select is(
  (select count(*)::integer from public.ai_quota_reservations),
  1, 'one private cost reservation exists'
);
select is(
  public.consume_ai_quota_status('assistant', '73200000-0000-4000-8000-000000000001'),
  'allowed', 'a retry with the same request ID is idempotent'
);
set local role service_role;
select is(
  (select request_count from public.ai_request_windows
   where user_id = '73000000-0000-4000-8000-000000000002'::uuid
     and operation = 'assistant'),
  2, 'an idempotent reservation retry does not consume another rate slot'
);
set local role authenticated;
select lives_ok(
  $$select public.release_ai_quota_reservation('73200000-0000-4000-8000-000000000001')$$,
  'a completed request releases its reservation'
);
select is(
  (select count(*)::integer from public.ai_quota_reservations),
  0, 'the reconciled reservation is removed'
);

select * from finish();
rollback;
