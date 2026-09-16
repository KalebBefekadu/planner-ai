begin;
select plan(12);

-- 'canceled' was a status nothing ever wrote. An owner who opened an import,
-- read the preview and decided against it had no way to say so: the job stayed
-- in 'preview' and came back as the active import every time, presenting an
-- abandoned experiment as work still to do.

select has_function(
  'public', 'execute_note_import_operation', array['text', 'jsonb', 'text', 'text'],
  'the import executor still exists'
);
select is(
  (select exposures from public.operation_contracts where operation_id = 'note.import-cancel.v1'),
  array['ui'], 'cancelling is a user decision, not one the assistant can take'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'import-cancel-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"Abandoned",
      "sourceType":"notion",
      "items":[
        {"sourcePath":"One.md","title":"One","bodyMarkdown":"First","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"Two.md","title":"Two","bodyMarkdown":"Second","parentSourcePath":null,"unsupportedReason":null}
      ]
    }',
    'cancel-preview-0001'
  )$$,
  'an import is staged and waits for review'
);

select lives_ok(
  format(
    $$select public.execute_ui_operation('note.import-cancel.v1',
      '{"jobId":"%s"}', 'cancel-decide-0001')$$,
    (select id from public.note_import_jobs)
  ),
  'the owner can decide not to import'
);
select is(
  (select status from public.note_import_jobs), 'canceled',
  'the decision is recorded on the job'
);
select isnt(
  (select completed_at from public.note_import_jobs), null,
  'a cancelled import is finished, so it stops being the active job'
);
select is(
  (select count(*)::integer from public.notes), 0,
  'cancelling creates nothing'
);
-- The report is how the owner sees what they chose not to import, so the
-- staged items outlive the decision.
select is(
  (select count(*)::integer from public.note_import_items), 2,
  'the report of a cancelled import stays readable'
);

select throws_ok(
  format(
    $$select public.execute_ui_operation('note.import-commit.v1',
      '{"jobId":"%s","batchSize":50}', 'cancel-commit-0001')$$,
    (select id from public.note_import_jobs)
  ),
  'P0001', 'import_job_not_available',
  'a cancelled import can never be committed afterwards'
);
select throws_ok(
  format(
    $$select public.execute_ui_operation('note.import-cancel.v1',
      '{"jobId":"%s"}', 'cancel-decide-0002')$$,
    (select id from public.note_import_jobs)
  ),
  'P0001', 'import_job_not_cancelable',
  'a decision already made is not one to make again'
);

-- Cancelling is not undoing. Once an import has created a Note the workspace
-- has changed, and the way back from that is undo.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"Started",
      "sourceType":"notion",
      "items":[
        {"sourcePath":"Three.md","title":"Three","bodyMarkdown":"Third","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"Four.md","title":"Four","bodyMarkdown":"Fourth","parentSourcePath":null,"unsupportedReason":null}
      ]
    }',
    'cancel-preview-0002'
  )$$,
  'a second import is staged'
);
select throws_ok(
  format(
    $$with started as (
      select public.execute_ui_operation('note.import-commit.v1',
        '{"jobId":"%s","batchSize":1}', 'cancel-commit-0002')
    )
    select public.execute_ui_operation('note.import-cancel.v1',
      '{"jobId":"%s"}', 'cancel-decide-0003') from started$$,
    (select id from public.note_import_jobs where source_name = 'Started'),
    (select id from public.note_import_jobs where source_name = 'Started')
  ),
  'P0001', 'import_job_not_cancelable',
  'an import that has already created a Note cannot be called off'
);

select * from finish();
rollback;
