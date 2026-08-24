begin;
select plan(16);

select function_privs_are(
  'public', 'execute_vision_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Vision restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vision-undo-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c8000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vision-undo-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"First reversible Vision."}', 'vision-create-undo-0001'
  )$$,
  'a first Vision is created'
);
select is(
  (select undo_payload_json ->> 'mode' from public.operation_receipts
   where idempotency_key = 'vision-create-undo-0001'),
  'create', 'a first upsert records create mode'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'vision-create-undo-0001')
    ),
    'vision-create-undo-apply-0001'
  )$$,
  'a dependency-free first Vision can be undone'
);
select is((select count(*)::integer from public.visions), 0,
  'first-Vision undo removes the exact new row');

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Original enduring Vision."}', 'vision-update-base-0001'
  )$$,
  'another Vision is created for update restoration'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Changed enduring Vision."}', 'vision-update-change-0001'
  )$$,
  'a Vision edit captures prior Markdown'
);
select is(
  (select undo_payload_json ->> 'mode' from public.operation_receipts
   where idempotency_key = 'vision-update-change-0001'),
  'update', 'a later upsert records update mode'
);
select is(
  (select undo_payload_json ->> 'bodyMarkdown' from public.operation_receipts
   where idempotency_key = 'vision-update-change-0001'),
  'Original enduring Vision.', 'the edit receipt retains exact prior Markdown'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'vision-update-change-0001')
    ),
    'vision-update-undo-0001'
  )$$,
  'an unchanged Vision edit can be undone'
);
select is((select body_markdown from public.visions), 'Original enduring Vision.',
  'Vision edit undo restores exact Markdown');
select is((select version from public.visions), 3::bigint,
  'Vision edit undo advances the optimistic version');

select set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Vision with dependent planning."}',
    'vision-dependent-create-0001'
  )$$,
  'a second owner creates a Vision'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Dependent annual goal","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'vision-dependent-goal-0001'
  )$$,
  'planning can depend on that Vision'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'vision-dependent-create-0001')
    ),
    'vision-dependent-undo-0001'
  )$$,
  '40001', 'undo_conflict',
  'first-Vision undo refuses to orphan dependent Goals'
);
select is((select count(*)::integer from public.visions), 1,
  'a conflicted Vision remains available');

select * from finish();
rollback;
