begin;
select plan(24);

select function_privs_are(
  'public', 'execute_note_import_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Notes import Undo executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'cf000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'import-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'cf000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{"sourceName":"Discarded preview","sourceType":"generic","items":[{"sourcePath":"Draft.md","title":"Draft","bodyMarkdown":"Draft body","parentSourcePath":null,"unsupportedReason":null}]}',
    'import-undo-preview-only-0001'
  )$$,
  'a staging-only import preview is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'import-undo-preview-only-0001')
    ),
    'import-undo-preview-only-apply-0001'
  )$$,
  'an untouched preview can be undone'
);
select is((select count(*)::integer from public.note_import_jobs), 0,
  'preview Undo removes its staging job');
select is((select count(*)::integer from public.note_import_items), 0,
  'preview Undo removes its owned staging items');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"Undo Vault",
      "sourceType":"obsidian",
      "items":[
        {"sourcePath":"Vault/","title":"Vault","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"Vault/Child.md","title":"Child","bodyMarkdown":"Exact child body.","parentSourcePath":"Vault/","unsupportedReason":null}
      ]
    }',
    'import-undo-preview-batches-0001'
  )$$,
  'a parent-safe two-item import is staged'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object(
      'jobId', (select id from public.note_import_jobs),
      'batchSize', 1
    ),
    'import-undo-first-batch-0001'
  )$$,
  'the first import batch creates only its parent Note'
);
select is(
  (select jsonb_array_length(undo_payload_json -> 'createdNotes')
   from public.operation_receipts where idempotency_key = 'import-undo-first-batch-0001'),
  1, 'the commit receipt owns the exact first-batch Note'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'import-undo-first-batch-0001')
    ),
    'import-undo-first-batch-apply-0001'
  )$$,
  'the latest import batch can be undone'
);
select is((select count(*)::integer from public.notes), 0,
  'commit Undo removes only the Note created by its receipt');
select is((select status from public.note_import_jobs), 'preview',
  'commit Undo restores the prior job status');
select is((select committed_count from public.note_import_jobs), 0,
  'commit Undo restores the prior committed count');
select is(
  (select count(*)::integer from public.note_import_items where target_note_id is null),
  2, 'commit Undo restores both items to their prior staging state'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object(
      'jobId', (select id from public.note_import_jobs),
      'batchSize', 2
    ),
    'import-undo-complete-batch-0001'
  )$$,
  'a resumed batch commits the complete hierarchy'
);
select is((select status from public.note_import_jobs), 'completed',
  'the resumed import reaches completed state');
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'import-undo-complete-batch-0001')
    ),
    'import-undo-complete-batch-apply-0001'
  )$$,
  'a completed import batch can be undone as one hierarchy'
);
select is((select count(*)::integer from public.notes), 0,
  'completed-batch Undo removes both unchanged imported Notes');
select is((select status from public.note_import_jobs), 'preview',
  'completed-batch Undo returns the import to its prior preview state');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object(
      'jobId', (select id from public.note_import_jobs),
      'batchSize', 2
    ),
    'import-undo-conflict-batch-0001'
  )$$,
  'another complete batch is committed for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Child'),
      'title', 'Child edited later',
      'bodyMarkdown', 'Newer body.',
      'expectedVersion', 1
    ),
    'import-undo-conflict-note-edit-0001'
  )$$,
  'a later Note edit supersedes the import result'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'import-undo-conflict-batch-0001')
    ),
    'import-undo-conflict-apply-0001'
  )$$,
  '40001', 'undo_conflict',
  'Undo refuses to delete an imported Note edited later'
);
select is((select count(*)::integer from public.notes), 2,
  'a refused import Undo preserves the complete hierarchy');
select is((select status from public.note_import_jobs), 'completed',
  'a refused import Undo preserves the completed job');
select is(
  (select body_markdown from public.notes where title = 'Child edited later'),
  'Newer body.', 'a refused import Undo preserves the newer Note body'
);

select * from finish();
rollback;
