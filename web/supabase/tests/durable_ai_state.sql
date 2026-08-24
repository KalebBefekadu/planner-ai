begin;
select plan(16);

select has_table('public', 'conversations', 'Conversations exist');
select has_table('public', 'conversation_messages', 'Conversation Messages exist');
select has_table('public', 'ai_proposals', 'AI Proposals exist');
select has_table('public', 'memories', 'explicit Memory exists');
select row_security_active('public.conversations'), 'Conversations have RLS';
select row_security_active('public.ai_proposals'), 'AI Proposals have RLS';
select table_privs_are(
  'public', 'conversations', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate Conversations directly'
);
select function_privs_are(
  'public', 'record_assistant_turn',
  array['uuid', 'text', 'text', 'text', 'jsonb', 'text', 'text', 'jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated users can persist validated assistant turns'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ai-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ai-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1', '{"statement":"I plan best in the morning.","sourceType":"user","sourceId":null}'::jsonb,
    'memory-test-0001'
  )$$,
  'explicit Memory can be created through the Operation service'
);
select is(
  (select statement from public.memories limit 1),
  'I plan best in the morning.',
  'Memory remains user-visible and exact'
);

select lives_ok(
  $$select public.record_assistant_turn(
    null, 'Capture this thought.', 'I prepared one exact Capture for approval.', '/inbox',
    '{"operationId":"capture.create.v1","input":{"rawText":"  Exact proposed Capture.  ","source":"typed"},"summary":"Create one Capture"}'::jsonb,
    'test-model', 'test-prompt-v1',
    jsonb_build_array(jsonb_build_object(
      'type', 'memory', 'id', (select id from public.memories limit 1)
    ))
  )$$,
  'a validated assistant turn and Proposal persist atomically'
);
select lives_ok(
  $$select public.execute_assistant_proposal((select id from public.ai_proposals limit 1))$$,
  'approval executes the persisted Proposal rather than browser-supplied input'
);
select is(
  (select raw_text from public.captures limit 1),
  '  Exact proposed Capture.  ',
  'Proposal execution preserves exact Capture input'
);
select is(
  (select sources -> 0 ->> 'label' from public.conversation_messages where role = 'assistant' limit 1),
  'I plan best in the morning.',
  'assistant evidence labels are rebuilt from an owned Workspace record'
);

select lives_ok(
  $$select public.record_assistant_turn(
    null, 'Close the month.', 'I prepared the monthly reflection for approval.', '/review',
    '{"operationId":"review.complete-period.v1","input":{"kind":"monthly","startsOn":"2026-08-01","endsOn":"2026-08-31","reflectionMarkdown":"Keep the next month focused."},"summary":"Complete the August monthly review"}'::jsonb,
    'test-model', 'test-prompt-v1', '[]'::jsonb
  )$$,
  'a newer chat-exposed Operation is accepted from the database catalog'
);
select lives_ok(
  $$select public.execute_assistant_proposal(
    (select id from public.ai_proposals where operation_id = 'review.complete-period.v1')
  )$$,
  'a newer Proposal executes through the current trusted dispatcher'
);
select is(
  (select count(*)::integer from public.reviews where kind = 'monthly'),
  1,
  'the catalog-driven assistant Proposal reaches its specialized executor'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.conversations), 0, 'another owner cannot read Conversations');

select * from finish();
rollback;
