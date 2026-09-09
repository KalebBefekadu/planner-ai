-- Filing a Capture as an Action must leave the same trail as filing it as a
-- Note: a durable link, a Capture that says it has been dealt with, an undo
-- that refuses to misstate later work, and rows only their owner can read.

begin;
select plan(25);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.capture_action_links'::regclass),
  'row security is on for capture to Action links'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.capture_action_links'::regclass),
  'row security is forced for capture to Action links'
);
select function_privs_are(
  'public', 'execute_capture_action_filing_operation',
  array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[],
  'the Capture to Action filing executor is private'
);
select function_privs_are(
  'public', 'execute_capture_action_filing_undo',
  array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[],
  'the Capture to Action filing undo executor is private'
);
select table_privs_are(
  'public', 'capture_action_links', 'authenticated', array['SELECT'],
  'an owner may read the link and never write it directly'
);
-- Emptying Trash hard-deletes the record; the link has to go with it rather
-- than block the delete or outlive what it points at.
select is(
  (select count(*)::integer from pg_catalog.pg_constraint
   where conrelid = 'public.capture_action_links'::regclass
     and contype = 'f' and confdeltype = 'c'),
  3, 'every link reference is deleted with the record it points at'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'ca000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'capture-action-a@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'ca000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'capture-action-b@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-00000000000a', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"  call Dana about the offer  ","source":"voice"}',
    'capture-action-create-0001'
  )$$,
  'a Capture is recorded'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'call Dana about the offer', 'horizonKind', 'week',
      'startsOn', '2026-08-17', 'endsOn', '2026-08-23',
      'goalId', null, 'scheduledOn', null
    ),
    'capture-action-action-0001'
  )$$,
  'the Action is filed from it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = '  call Dana about the offer  '),
      'actionId', (select id from public.actions where title = 'call Dana about the offer')
    ),
    'capture-action-link-0001'
  )$$,
  'the Action keeps a link back to the Capture it came from'
);
select is(
  (select count(*)::integer from public.capture_action_links),
  1, 'the link is durable, not derived'
);
select is(
  (select state from public.captures where raw_text = '  call Dana about the offer  '),
  'reviewed', 'the Capture stops claiming it is unprocessed'
);
select is(
  (select raw_text from public.captures where state = 'reviewed'),
  '  call Dana about the offer  ',
  'the recorded words survive filing byte for byte'
);
select is(
  (select undo_payload_json ->> 'priorState' from public.operation_receipts
   where idempotency_key = 'capture-action-link-0001'),
  'new', 'the receipt retains the state the Capture was in'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = '  call Dana about the offer  '),
      'actionId', (select id from public.actions where title = 'call Dana about the offer')
    ),
    'capture-action-link-0001'
  )$$,
  'a retry of the filing replays instead of writing twice'
);
select is(
  (select count(*)::integer from public.capture_action_links),
  1, 'the retry left exactly one link'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-action-link-0001')
    ),
    'capture-action-undo-0001'
  )$$,
  'an unchanged filing can be undone'
);
select is(
  (select count(*)::integer from public.capture_action_links),
  0, 'the undo removes only the link it created'
);
select is(
  (select state from public.captures where raw_text = '  call Dana about the offer  '),
  'new', 'the undo restores the exact prior Capture state'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = '  call Dana about the offer  '),
      'actionId', (select id from public.actions where title = 'call Dana about the offer')
    ),
    'capture-action-conflict-0001'
  )$$,
  'the Capture is filed again for the conflict case'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'ask Dana for the revised terms', 'horizonKind', 'week',
      'startsOn', '2026-08-17', 'endsOn', '2026-08-23',
      'goalId', null, 'scheduledOn', null
    ),
    'capture-action-action-0002'
  )$$,
  'a second Action is filed from the same Capture'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-action.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures
                    where raw_text = '  call Dana about the offer  '),
      'actionId', (select id from public.actions where title = 'ask Dana for the revised terms')
    ),
    'capture-action-conflict-0002'
  )$$,
  'the later filing adds a second link'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-action-conflict-0001')
    ),
    'capture-action-conflict-undo-01'
  )$$,
  'P0001', 'undo_conflict',
  'undo refuses to erase or misstate later work'
);

-- Trash is recoverable, so an Action waiting in it has not lost its origin.
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'action',
      'id', (select id from public.actions where title = 'call Dana about the offer'),
      'expectedVersion', (select version from public.actions
                          where title = 'call Dana about the offer')
    ),
    'capture-action-trash-0001'
  )$$,
  'the Action can be moved to Trash'
);
select is(
  (select count(*)::integer from public.capture_action_links),
  2, 'recoverable Trash keeps the provenance it could still need'
);

select set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-00000000000b', true);
select is(
  (select count(*)::integer from public.capture_action_links),
  0, 'another owner cannot read the link'
);

select * from finish();
rollback;
