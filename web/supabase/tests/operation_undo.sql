begin;
select plan(29);

select has_column(
  'public', 'operation_receipts', 'reverses_receipt_id', 'undo receipts link to originals'
);
select has_column(
  'public', 'operation_receipts', 'reversed_by_receipt_id', 'original receipts link to undo'
);
select has_column(
  'public', 'operation_receipts', 'reversed_at', 'original receipts retain reversal time'
);
select function_privs_are(
  'public', 'execute_operation_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the undo executor is private'
);
select is(
  (select exposures from public.operation_contracts where operation_id = 'operation.undo.v1'),
  array['ui']::text[],
  'undo is available only through the click-first UI gateway'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'undo-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'undo-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"Undo this Capture","source":"typed"}',
    'undo-capture-create-0001'
  )$$,
  'a Capture is created through its ordinary Operation'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'undo-capture-create-0001')
    ),
    'undo-capture-0001'
  )$$,
  'a recent unchanged create Operation can be undone'
);
select ok((select trashed_at is not null from public.captures), 'undo moves the Capture to Trash');
select ok(
  (select reversed_at is not null from public.operation_receipts
   where idempotency_key = 'undo-capture-create-0001'),
  'the original receipt is marked undone without changing its success status'
);
select is(
  (select status from public.operation_receipts
   where idempotency_key = 'undo-capture-create-0001'),
  'succeeded',
  'undo does not break original idempotency receipts'
);
select is(
  (select reverses_receipt_id from public.operation_receipts
   where operation_id = 'operation.undo.v1'),
  (select id from public.operation_receipts
   where idempotency_key = 'undo-capture-create-0001'),
  'the undo receipt points to the exact original receipt'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'trash.move.v1'),
  1,
  'the inverse uses the shared Trash Operation'
);
select is(
  (select count(*)::integer from public.activity_events
   where operation_id = 'operation.undo.v1'),
  1,
  'undo is visible in Activity'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'undo-capture-create-0001')
    ),
    'undo-capture-0001'
  )$$,
  'an idempotent undo retry returns its original result'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'operation.undo.v1'),
  1,
  'an idempotent retry does not create a second undo'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Source Note","bodyMarkdown":"A","parentNoteId":null}',
    'undo-note-create-0001'
  )$$,
  'the source Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Target Note","bodyMarkdown":"B","parentNoteId":null}',
    'undo-note-create-0002'
  )$$,
  'the target Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.link.v1',
    jsonb_build_object(
      'sourceNoteId', (select id from public.notes where title = 'Source Note'),
      'targetNoteId', (select id from public.notes where title = 'Target Note'),
      'relationType', 'supports'
    ),
    'undo-note-link-0001'
  )$$,
  'a Note link is created'
);
select is((select count(*)::integer from public.note_links), 1, 'the Note link exists');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'undo-note-link-0001'
                      and operation_id = 'note.link.v1')
    ),
    'undo-note-link-0001'
  )$$,
  'a relation create Operation can be undone'
);
select is((select count(*)::integer from public.note_links), 0, 'undo removes only the Note link');
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'undo-note-link-0001'
                      and operation_id = 'note.link.v1')
    ),
    'undo-note-link-again-0001'
  )$$,
  'P0001', 'undo_not_available',
  'one original Operation cannot be undone twice'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"File this before undo","source":"typed"}',
    'undo-conflict-capture-0001'
  )$$,
  'a second Capture is created for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-note.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures where raw_text = 'File this before undo'),
      'noteId', (select id from public.notes where title = 'Source Note')
    ),
    'undo-conflict-file-0001'
  )$$,
  'later work can depend on the created Capture'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'undo-conflict-capture-0001')
    ),
    'undo-conflict-attempt-0001'
  )$$,
  '40001', 'undo_conflict',
  'undo fails rather than erasing later dependent work'
);
select ok(
  (select trashed_at is null from public.captures where raw_text = 'File this before undo'),
  'a conflicted target remains available'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where idempotency_key = 'undo-conflict-attempt-0001'),
  0,
  'a failed undo leaves no success receipt'
);

select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.operation_receipts), 0, 'another owner cannot read receipts');
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts limit 1)
    ),
    'undo-cross-owner-0001'
  )$$,
  'P0001', 'undo_not_available',
  'another owner cannot undo an unseen receipt'
);

select * from finish();
rollback;
