begin;
select plan(15);

select function_privs_are(
  'public', 'execute_capture_filing_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Capture filing restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'capture-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Capture destination A","bodyMarkdown":"","parentNoteId":null}',
    'capture-undo-note-a-0001'
  )$$,
  'the first destination Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Capture destination B","bodyMarkdown":"","parentNoteId":null}',
    'capture-undo-note-b-0001'
  )$$,
  'the second destination Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"File this Capture safely","source":"typed"}',
    'capture-undo-create-0001'
  )$$,
  'a Capture is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-note.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures where raw_text = 'File this Capture safely'),
      'noteId', (select id from public.notes where title = 'Capture destination A')
    ),
    'capture-undo-file-a-0001'
  )$$,
  'filing records the prior state and exact post-write links'
);
select is(
  (select undo_payload_json ->> 'priorState' from public.operation_receipts
   where idempotency_key = 'capture-undo-file-a-0001'),
  'new', 'the filing receipt retains the prior Capture state'
);
select is(
  (select (undo_payload_json ->> 'createdLink')::boolean from public.operation_receipts
   where idempotency_key = 'capture-undo-file-a-0001'),
  true, 'the filing receipt records that it created the link'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-undo-file-a-0001')
    ),
    'capture-undo-file-a-apply-0001'
  )$$,
  'an unchanged filing can be undone'
);
select is((select count(*)::integer from public.capture_note_links), 0,
  'filing undo removes only the link it created');
select is((select state from public.captures where raw_text = 'File this Capture safely'), 'new',
  'filing undo restores the exact prior Capture state');

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-note.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures where raw_text = 'File this Capture safely'),
      'noteId', (select id from public.notes where title = 'Capture destination A')
    ),
    'capture-conflict-file-a-0001'
  )$$,
  'another filing is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-note.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures where raw_text = 'File this Capture safely'),
      'noteId', (select id from public.notes where title = 'Capture destination B')
    ),
    'capture-conflict-file-b-0001'
  )$$,
  'a later filing adds another dependency'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'capture-conflict-file-a-0001')
    ),
    'capture-conflict-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'filing undo refuses to erase or misstate later work'
);
select is((select count(*)::integer from public.capture_note_links), 2,
  'a refused filing undo preserves every current link');
select is((select state from public.captures where raw_text = 'File this Capture safely'), 'reviewed',
  'a refused filing undo preserves the current state');

select * from finish();
rollback;
