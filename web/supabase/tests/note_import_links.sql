begin;
select plan(5);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'import-links-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000001', true);

-- The preview stages a resolved internal link as the SHA-256 of the target's
-- source path, because the Note it points at does not exist yet. Two pages
-- share a title here on purpose: identity comes from the path, so the link must
-- reach the page it named and not whichever duplicate was created first.
select lives_ok(
  format(
    $$select public.execute_ui_operation(
      'note.import-preview.v1',
      %L,
      'import-links-0001'
    )$$,
    json_build_object(
      'sourceName', 'Notion export.zip',
      'sourceType', 'notion',
      'items', json_build_array(
        json_build_object(
          'sourcePath', 'Space/', 'title', 'Space', 'bodyMarkdown', '',
          'parentSourcePath', null, 'unsupportedReason', null
        ),
        json_build_object(
          'sourcePath', 'Space/Launch abc.md', 'title', 'Launch',
          'bodyMarkdown', '# Launch' || chr(10) || chr(10) || 'See [Retro](planner-ai-import://'
            || encode(extensions.digest('Space/Retro abc.md', 'sha256'), 'hex') || ').',
          'parentSourcePath', 'Space/', 'unsupportedReason', null
        ),
        json_build_object(
          'sourcePath', 'Space/Retro abc.md', 'title', 'Launch',
          'bodyMarkdown', 'Retro body', 'parentSourcePath', 'Space/', 'unsupportedReason', null
        )
      )
    )::text
  ),
  'a preview carrying staged link markers is accepted'
);

-- Nothing is rewritten before the owner agrees: the marker is still a marker,
-- and no Note exists yet.
select is(
  (select count(*)::integer from public.notes),
  0,
  'a preview creates no Notes'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.import-commit.v1',
    (select json_build_object('jobId', id, 'batchSize', 50)::text
     from public.note_import_jobs)::jsonb,
    'import-links-commit-0001'
  )$$,
  'the import commits'
);

select is(
  (select body_markdown from public.notes
   where title = 'Launch' and body_markdown like '# Launch%'),
  '# Launch' || chr(10) || chr(10) || 'See [Retro](/notes?note='
    || (select target_note_id from public.note_import_items
        where source_path = 'Space/Retro abc.md')::text || ').',
  'the committed Note links to the Note the export named, not to its namesake'
);

-- A marker left in a Note body would be a dead link the owner cannot repair.
select is(
  (select count(*)::integer from public.notes where body_markdown like '%planner-ai-import://%'),
  0,
  'no unresolved marker survives the commit'
);

select * from finish();
rollback;
