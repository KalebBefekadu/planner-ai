-- Reopening a past import report and resuming an interrupted one are the two
-- things that decide whether a large Notion migration has to be finished in a
-- single sitting. Both are reads and writes against a job the browser only
-- knows by id, so both have to hold under a workspace boundary.

begin;
select plan(13);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'import-history-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'import-history-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-preview.v1',
    '{
      "sourceName":"Notion export",
      "sourceType":"notion",
      "items":[
        {"sourcePath":"Roadmap/","title":"Roadmap","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":null},
        {"sourcePath":"Roadmap/One.md","title":"One","bodyMarkdown":"First","parentSourcePath":"Roadmap/","unsupportedReason":null},
        {"sourcePath":"Roadmap/Two.md","title":"Two","bodyMarkdown":"Second","parentSourcePath":"Roadmap/","unsupportedReason":null},
        {"sourcePath":"Roadmap/Rows.csv#row-1","title":"Ship","bodyMarkdown":"## Status\n\nDoing","parentSourcePath":"Roadmap/","unsupportedReason":null,"conversionNotice":"Converted from a CSV row. Column types, formulas, relations, filters and views are not imported."}
      ]
    }',
    'history-preview-0001'
  )$$,
  'a mixed Notion export stages for review'
);

-- A converted CSV row is created, not skipped, so its lossiness can only reach
-- the owner through the reason the report shows next to it.
select is(
  (select disposition from public.note_import_items where source_path = 'Roadmap/Rows.csv#row-1'),
  'create',
  'a converted CSV row is still imported'
);
select ok(
  (select reason from public.note_import_items where source_path = 'Roadmap/Rows.csv#row-1')
    like '%formulas, relations%',
  'the stored report explains what the CSV conversion left behind'
);
select is(
  (select reason from public.note_import_items where source_path = 'Roadmap/One.md'),
  null,
  'a faithfully carried Markdown page claims no loss'
);

-- Interruption: one item commits, then the browser goes away.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object('jobId', (select id from public.note_import_jobs), 'batchSize', 1),
    'history-commit-0001'
  )$$,
  'the first batch commits'
);
select is(
  (select status from public.note_import_jobs), 'committing',
  'an unfinished job stays reachable as committing'
);

-- This is the reopen path the dialog uses after a reload: the job is named by
-- id and read straight back, with no dependence on any in-browser state.
select is(
  (
    select committed_count from public.note_import_jobs
    where id = (select id from public.note_import_jobs limit 1)
  ),
  1,
  'the reopened report matches the stored item count'
);

select is(
  (select count(*)::integer from public.notes), 1,
  'only the committed batch exists after the interruption'
);

-- Resuming is the moment a duplicate would appear. It must not.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object('jobId', (select id from public.note_import_jobs), 'batchSize', 50),
    'history-commit-0002'
  )$$,
  'the interrupted import resumes to completion'
);
select is(
  (select count(*)::integer from public.notes), 4,
  'resuming creates each staged Note exactly once'
);
select is(
  (
    select count(*)::integer from public.notes note
    join public.notes parent on parent.id = note.parent_note_id
    where parent.title = 'Roadmap'
  ),
  3,
  'hierarchy survives the interruption'
);

-- A completed job must refuse another commit outright, so a stale browser tab
-- replaying the last request cannot import the same export twice.
select throws_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    jsonb_build_object('jobId', (select id from public.note_import_jobs), 'batchSize', 50),
    'history-commit-0003'
  )$$,
  'P0001', 'import_job_not_available',
  'a completed job cannot be committed again'
);

-- History is enumerated by selecting jobs for the workspace, so the boundary
-- that protects it is the same RLS policy. A second owner holding a real job
-- id must still read nothing.
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.note_import_jobs), 0,
  'another owner cannot enumerate import jobs'
);

select * from finish();
rollback;
