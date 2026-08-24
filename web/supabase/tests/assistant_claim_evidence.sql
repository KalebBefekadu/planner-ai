begin;
select plan(14);

select has_column('public', 'conversation_messages', 'claims', 'Messages persist claim labels');
select function_privs_are(
  'public', 'record_assistant_turn',
  array['uuid', 'text', 'text', 'text', 'jsonb', 'text', 'text', 'jsonb', 'jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated users can persist validated claims'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'claim-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'claim-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1', '{"statement":"Morning planning works best.","sourceType":"user","sourceId":null}'::jsonb,
    'claim-memory-0001'
  )$$,
  'an owned evidence record exists'
);

select lives_ok(
  $$select public.record_assistant_turn(
    null, 'What planning pattern is supported?', 'Morning planning is your recorded preference.', '/today',
    null, 'test-model', 'assistant-v8',
    jsonb_build_array(jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1))),
    jsonb_build_array(jsonb_build_object(
      'text', 'Morning planning is your recorded preference.', 'status', 'supported',
      'evidence', jsonb_build_array(jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1)))
    ))
  )$$,
  'a supported claim with exact owned evidence persists'
);
select is(
  (select claims -> 0 ->> 'status' from public.conversation_messages where role = 'assistant' limit 1),
  'supported', 'the claim label is durable'
);
select is(
  (select sources -> 0 ->> 'label' from public.conversation_messages where role = 'assistant' limit 1),
  'Morning planning works best.', 'source display metadata remains database-owned'
);

select throws_ok(
  $$select public.record_assistant_turn(
    null, 'Unsupported', 'Unsupported', '/today', null, 'test-model', 'assistant-v8', '[]'::jsonb,
    '[{"text":"Unsupported","status":"supported","evidence":[]}]'::jsonb
  )$$, 'P0001', 'invalid_assistant_claims', 'supported claims require evidence'
);
select throws_ok(
  $$select public.record_assistant_turn(
    null, 'Need input', 'Need input', '/today', null, 'test-model', 'assistant-v8',
    jsonb_build_array(jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1))),
    jsonb_build_array(jsonb_build_object(
      'text', 'Need input', 'status', 'needs_input',
      'evidence', jsonb_build_array(jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1)))
    ))
  )$$, 'P0001', 'invalid_assistant_claims', 'needs-input claims cannot cite evidence'
);
select throws_ok(
  $$select public.record_assistant_turn(
    null, 'Invented', 'Invented', '/today', null, 'test-model', 'assistant-v8', '[]'::jsonb,
    '[{"text":"Invented","status":"supported","evidence":[{"type":"goal","id":"72000000-0000-4000-8000-000000000099"}]}]'::jsonb
  )$$, 'P0001', 'invalid_assistant_claims', 'claim references must be present in validated sources'
);
select throws_ok(
  $$select public.record_assistant_turn(
    null, 'Duplicate', 'Duplicate', '/today', null, 'test-model', 'assistant-v8',
    jsonb_build_array(jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1))),
    jsonb_build_array(jsonb_build_object(
      'text', 'Duplicate', 'status', 'supported', 'evidence', jsonb_build_array(
        jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1)),
        jsonb_build_object('type', 'memory', 'id', (select id from public.memories limit 1))
      )
    ))
  )$$, 'P0001', 'invalid_assistant_claims', 'duplicate claim evidence is rejected'
);
select lives_ok(
  $$select public.record_assistant_turn(
    null, 'What is missing?', 'A deadline is still needed.', '/today', null, 'test-model', 'assistant-v8', '[]'::jsonb,
    '[{"text":"A deadline is still needed.","status":"needs_input","evidence":[]}]'::jsonb
  )$$, 'a needs-input claim persists without fabricated evidence'
);
select lives_ok(
  $$select public.record_assistant_turn(
    null, 'What follows?', 'This may be the next useful step.', '/today', null, 'test-model', 'assistant-v8', '[]'::jsonb,
    '[{"text":"This may be the next useful step.","status":"inferred","evidence":[]}]'::jsonb
  )$$, 'an explicitly inferred claim can persist without evidence'
);
select is(
  (select count(*)::integer from public.conversation_messages where role = 'assistant'),
  3, 'rejected turns leave no partial Conversation Messages'
);
select is(
  (select count(*)::integer from public.conversation_messages where role = 'user'),
  3, 'assistant turn persistence remains atomic'
);

select * from finish();
rollback;
