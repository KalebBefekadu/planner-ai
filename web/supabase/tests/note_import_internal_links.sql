begin;
select plan(9);

-- An exported workspace is a web of pages that link to each other by relative
-- file path. Staging rewrites a resolvable href to the SHA-256 of the target
-- item's source path, because the Note it names does not exist yet. These
-- tests are about what the commit owes that token: a real URL when the target
-- became a Note, and the path back when it never will.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'import-links-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

create temporary table link_token as
select
  encode(extensions.digest('Projects/Launch.md', 'sha256'), 'hex') as launch,
  encode(extensions.digest('photo.png', 'sha256'), 'hex') as photo,
  encode(extensions.digest('Existing.md', 'sha256'), 'hex') as existing;

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Already here","bodyMarkdown":"Existing exact body","parentNoteId":null}',
    'link-existing-0001'
  )$$,
  'an existing Note can be the target of an imported link'
);

select lives_ok(
  format(
    $$select public.execute_ui_operation('note.import-preview.v1', %L, 'link-preview-0001')$$,
    format(
      $${
        "sourceName":"Workspace",
        "sourceType":"notion",
        "items":[
          {"sourcePath":"Projects/","title":"Projects","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":null},
          {"sourcePath":"Projects/Launch.md","title":"Launch","bodyMarkdown":"# Launch","parentSourcePath":"Projects/","unsupportedReason":null},
          {"sourcePath":"Index.md","title":"Index","bodyMarkdown":"Go to [Launch](planner-ai-import:%s), [Photo](planner-ai-import:%s) and [Old](planner-ai-import:%s).","parentSourcePath":null,"unsupportedReason":null},
          {"sourcePath":"photo.png","title":"photo.png","bodyMarkdown":"","parentSourcePath":null,"unsupportedReason":"Unsupported file type: .png."},
          {"sourcePath":"Existing.md","title":"Already here","bodyMarkdown":"Existing exact body","parentSourcePath":null,"unsupportedReason":null}
        ]
      }$$,
      (select launch from link_token), (select photo from link_token), (select existing from link_token)
    )
  ),
  'an import carrying link tokens stages without complaint'
);

-- Index.md sorts before Projects/Launch.md, so the first batch commits a Note
-- whose link points at a page that does not exist yet. A forward link is the
-- normal case in a real export, not an edge case.
select lives_ok(
  format(
    $$select public.execute_ui_operation('note.import-commit.v1',
      '{"jobId":"%s","batchSize":1}', 'link-commit-0001')$$,
    (select id from public.note_import_jobs)
  ),
  'the first batch commits one Note'
);
select ok(
  (select body_markdown from public.notes where title = 'Index')
    like '%planner-ai-import:%',
  'a link whose target is not committed yet is still a token'
);

select lives_ok(
  format(
    $$select public.execute_ui_operation('note.import-commit.v1',
      '{"jobId":"%s","batchSize":50}', 'link-commit-0002')$$,
    (select id from public.note_import_jobs)
  ),
  'the rest of the import commits'
);
select is(
  (select status from public.note_import_jobs), 'completed', 'the import finished'
);

select is(
  (select body_markdown from public.notes where title = 'Index'),
  format(
    'Go to [Launch](/notes?note=%s), [Photo](photo.png) and [Old](/notes?note=%s).',
    (select target_note_id from public.note_import_items where source_path = 'Projects/Launch.md'),
    (select id from public.notes where title = 'Already here')
  ),
  'each token becomes the Note it named, and an unimportable target becomes its path again'
);

-- An item that matched an existing Note is a duplicate: the import must be
-- able to link to that Note without rewriting anything inside it.
select is(
  (select body_markdown from public.notes where title = 'Already here'),
  'Existing exact body',
  'a Note the owner already had is never edited by an import'
);

select is(
  (select count(*)::integer from public.notes where body_markdown like '%planner-ai-import:%'),
  0,
  'no internal token survives a finished import'
);

select * from finish();
rollback;
