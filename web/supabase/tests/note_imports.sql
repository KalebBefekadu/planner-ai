begin;
select plan(24);

select has_table('public', 'note_import_jobs', 'Notes import jobs exist');
select has_table('public', 'note_import_items', 'Notes import staging items exist');
select row_security_active('public.note_import_jobs'), 'import jobs have RLS';
select row_security_active('public.note_import_items'), 'import items have RLS';
select table_privs_are(
  'public', 'note_import_jobs', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate import jobs directly'
);
select table_privs_are(
  'public', 'note_import_items', 'authenticated', array['SELECT'],
  'authenticated users cannot mutate import items directly'
);
select function_privs_are(
  'public', 'execute_note_import_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the import executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'import-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'import-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Already here","bodyMarkdown":"Existing exact body","parentNoteId":null}',
    'import-existing-0001'
  )$$,
  'an existing Note can seed duplicate detection'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"My Vault",
      "sourceType":"obsidian",
      "items":[
        {"sourcePath":"Vault/","title":"Vault","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"Vault/Fresh.md","title":"Fresh","bodyMarkdown":"# Fresh\n\nExact body.  ","parentSourcePath":"Vault/","unsupportedReason":null},
        {"sourcePath":"Existing.md","title":"Already here","bodyMarkdown":"Existing exact body","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"photo.png","title":"photo.png","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":"Unsupported file type: .png."}
      ]
    }',
    'import-preview-0001'
  )$$,
  'preview stages a bounded import through the Operation gateway'
);
select is((select status from public.note_import_jobs), 'preview', 'the import waits for review');
select is((select create_count from public.note_import_jobs), 2, 'new Notes are counted');
select is((select duplicate_count from public.note_import_jobs), 1, 'exact duplicates are counted');
select is((select unsupported_count from public.note_import_jobs), 1, 'unsupported files are counted');
select is((select count(*)::integer from public.notes), 1, 'preview creates no Notes');
select is(
  (select body_markdown from public.note_import_items where source_path = 'Vault/Fresh.md'),
  E'# Fresh\n\nExact body.  ',
  'preview preserves exact Markdown content'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object('jobId', (select id from public.note_import_jobs), 'batchSize', 1),
    'import-commit-0001'
  )$$,
  'the first small batch commits safely'
);
select is((select committed_count from public.note_import_jobs), 1, 'batch progress is durable');
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object('jobId', (select id from public.note_import_jobs), 'batchSize', 50),
    'import-commit-0002'
  )$$,
  'a resumed batch completes the import'
);
select is((select status from public.note_import_jobs), 'completed', 'the job completes');
select is((select count(*)::integer from public.notes), 3, 'only new Notes are created');
select is(
  (
    select parent.title
    from public.notes child
    join public.notes parent on parent.id = child.parent_note_id
    where child.title = 'Fresh'
  ),
  'Vault',
  'folder hierarchy is preserved'
);
select is(
  (select count(*)::integer from public.operation_receipts where operation_id like 'note.import-%'),
  3,
  'preview and commit batches have receipts'
);
select is(
  (select count(*)::integer from public.activity_events where operation_id like 'note.import-%'),
  3,
  'preview and commit batches appear in Activity'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"Invalid hierarchy",
      "sourceType":"generic",
      "items":[
        {"sourcePath":"Blocked/","title":"Blocked","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":"Unsupported folder"},
        {"sourcePath":"Blocked/Child.md","title":"Child","bodyMarkdown":"Body","parentSourcePath":"Blocked/","unsupportedReason":null}
      ]
    }',
    'import-invalid-0001'
  )$$,
  'P0001', 'invalid_import_items',
  'children of unsupported parents are rejected before staging'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.note_import_jobs), 0, 'another owner cannot read jobs');
select is((select count(*)::integer from public.note_import_items), 0, 'another owner cannot read items');

select * from finish();
rollback;
