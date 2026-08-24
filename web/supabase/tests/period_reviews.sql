begin;
select plan(12);

select has_function(
  'public', 'execute_period_review_operation', array['text', 'jsonb', 'text', 'text'],
  'period review executor exists'
);
select function_privs_are(
  'public', 'execute_period_review_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'period review executor stays private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'period-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'period-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-08-01","endsOn":"2026-08-31","reflectionMarkdown":"Protect the highest-leverage work."}',
    'period-review-complete-0001'
  )$$,
  'a monthly review can be completed through the trusted UI gateway'
);
select is((select kind from public.reviews), 'monthly', 'the monthly Review kind is stored');
select is(
  (select reflection_markdown from public.reviews),
  'Protect the highest-leverage work.',
  'the reflection is stored exactly after boundary trimming'
);
select is(
  (select kind from public.planning_horizons where starts_on = '2026-08-01'),
  'month',
  'the Review is attached to a canonical month horizon'
);
select is(
  (select risk_class from public.operation_receipts where operation_id = 'review.complete-period.v1'),
  'low',
  'the completion receipt records the catalog risk'
);
select is(
  (select outcome from public.activity_events where operation_id = 'review.complete-period.v1'),
  'succeeded',
  'the completion is visible in Activity'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"monthly","startsOn":"2026-08-01","endsOn":"2026-08-31","reflectionMarkdown":"A duplicate."}',
    'period-review-complete-0002'
  )$$,
  'P0001', 'review_already_completed',
  'a period cannot be completed twice'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'review.complete-period.v1',
    '{"kind":"quarterly","startsOn":"2026-08-01","endsOn":"2026-10-31","reflectionMarkdown":"Invalid quarter."}',
    'period-review-invalid-0001'
  )$$,
  'P0001', 'invalid_review_range',
  'quarter boundaries are validated in the database'
);
select is(
  (select risk_class from public.operation_contracts where operation_id = 'review.complete-period.v1'),
  'low',
  'the database catalog contains the period Review contract'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.reviews), 0, 'another owner cannot read period Reviews');

select * from finish();
rollback;
