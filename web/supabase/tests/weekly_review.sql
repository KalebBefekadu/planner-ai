begin;
select plan(15);

select has_table('public', 'reviews', 'Reviews exist');
select has_table('public', 'action_schedule_history', 'Action schedule history exists');
select row_security_active('public.reviews'), 'Reviews have RLS';
select function_privs_are(
  'public', 'execute_ui_operation', array['text', 'jsonb', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated users call the fixed-surface UI gateway'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'review-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Finish release notes","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"scheduledOn":"2026-08-12"}',
    'weekly-review-action-0001'
  )$$,
  'the first weekly Action can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    '{"title":"Prepare user interviews","horizonKind":"week","startsOn":"2026-08-10","endsOn":"2026-08-16","goalId":null,"scheduledOn":"2026-08-14"}',
    'weekly-review-action-0002'
  )$$,
  'the second weekly Action can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'review.complete-weekly.v1',
    jsonb_build_object(
      'startsOn', '2026-08-10', 'endsOn', '2026-08-16',
      'reflectionMarkdown', 'Keep the scope narrow.',
      'decisions', jsonb_build_array(
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Finish release notes'),
          'expectedVersion', 1, 'resolution', 'done', 'reason', null, 'priority', false
        ),
        jsonb_build_object(
          'actionId', (select id from public.actions where title = 'Prepare user interviews'),
          'expectedVersion', 1, 'resolution', 'next_week', 'reason', null, 'priority', true
        )
      )
    ),
    'weekly-review-complete-0001'
  )$$,
  'Weekly Review commits every explicit decision atomically'
);
select is((select count(*)::integer from public.reviews), 1, 'one completed Review is stored');
select is((select count(*)::integer from public.review_action_items), 2, 'both Action snapshots are retained');
select is(
  (select count(*)::integer from public.review_action_items where priority),
  1,
  'at most the selected priorities are committed'
);
select is(
  (select status from public.actions where title = 'Finish release notes'),
  'done',
  'completed decision completes the Action'
);
select is(
  (select scheduled_on from public.actions where title = 'Prepare user interviews'),
  '2026-08-17'::date,
  'rollover is an explicit reschedule into next week'
);
select is(
  (select count(*)::integer from public.action_schedule_history),
  2,
  'every decision has append-only scheduling history'
);
select is(
  (select risk_class from public.operation_receipts where operation_id = 'review.complete-weekly.v1'),
  'medium',
  'Weekly Review is audited as consequential'
);
select is(
  (select risk_class from public.operation_contracts where operation_id = 'review.complete-weekly.v1'),
  'medium',
  'the database Operation catalog matches Review risk'
);

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.reviews), 0, 'another owner cannot read Reviews');

select * from finish();
rollback;
