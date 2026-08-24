begin;
select plan(24);

select has_function(
  'public', 'execute_knowledge_operation', array['text', 'jsonb', 'text', 'text'],
  'Knowledge operations use one shared service'
);
select row_security_active('public.note_links'), 'Note links have RLS';
select function_privs_are(
  'public', 'execute_ui_operation', array['text', 'jsonb', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated users call the fixed-surface UI gateway'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'knowledge-owner-one@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'knowledge-owner-two@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Alpha","bodyMarkdown":"First body","parentNoteId":null}',
    'knowledge-note-0001'
  )$$,
  'the source Note can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Beta","bodyMarkdown":"Second body","parentNoteId":null}',
    'knowledge-note-0002'
  )$$,
  'the target Note can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.tags.set.v1',
    jsonb_build_object('noteId', (select id from public.notes where title = 'Alpha'), 'tags', jsonb_build_array(' Work ', 'work', 'Research')),
    'knowledge-tags-0001'
  )$$,
  'tags can be normalized through the operation service'
);
select is((select count(*)::integer from public.tags), 2, 'duplicate tag spellings collapse');
select is(
  (select array_agg(normalized_name order by normalized_name) from public.tags),
  array['research', 'work']::text[],
  'tags are stored in normalized order-independent form'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.link.v1',
    jsonb_build_object(
      'sourceNoteId', (select id from public.notes where title = 'Alpha'),
      'targetNoteId', (select id from public.notes where title = 'Beta'),
      'relationType', 'supports'
    ),
    'knowledge-link-0001'
  )$$,
  'typed Note links can be created'
);
select is((select count(*)::integer from public.note_links), 1, 'one link also provides a backlink');

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Build a connected knowledge practice."}',
    'knowledge-vision-0001'
  )$$,
  'a Vision can anchor planning relations'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Publish the research","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'knowledge-goal-0001'
  )$$,
  'a Goal can be created for the relation test'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Draft the outline', 'horizonKind', 'week',
      'startsOn', '2026-08-17', 'endsOn', '2026-08-23',
      'goalId', (select id from public.goals where title = 'Publish the research'),
      'scheduledOn', '2026-08-17'
    ),
    'knowledge-action-0001'
  )$$,
  'an Action can be created for the relation test'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.goal-link.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Alpha'),
      'goalId', (select id from public.goals where title = 'Publish the research')
    ),
    'knowledge-goal-link-0001'
  )$$,
  'a Note can connect to a Goal through the shared dispatcher'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.action-link.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Alpha'),
      'actionId', (select id from public.actions where title = 'Draft the outline')
    ),
    'knowledge-action-link-0001'
  )$$,
  'a Note can connect to an Action through the shared dispatcher'
);
select is((select count(*)::integer from public.note_goal_links), 1, 'one Goal relation is stored');
select is((select count(*)::integer from public.note_action_links), 1, 'one Action relation is stored');
select ok(
  (select 'mcp' = any(exposures) from public.operation_contracts where operation_id = 'note.goal-link.v1'),
  'the versioned planning relation is explicitly MCP-visible'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1', '{"rawText":"  Exact immutable Capture.  ","source":"typed"}',
    'knowledge-capture-0001'
  )$$,
  'a Capture can be created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.file-to-note.v1',
    jsonb_build_object(
      'captureId', (select id from public.captures limit 1),
      'noteId', (select id from public.notes where title = 'Alpha')
    ),
    'knowledge-file-0001'
  )$$,
  'a Capture can be filed without rewriting it'
);
select is(
  (select raw_text from public.captures limit 1),
  '  Exact immutable Capture.  ',
  'filing preserves exact Capture text'
);
select is((select state from public.captures limit 1), 'reviewed', 'filing reviews the Capture');
select lives_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Alpha'),
      'title', 'Alpha revised', 'bodyMarkdown', 'Revised body', 'expectedVersion', 1
    ),
    'knowledge-revision-0001'
  )$$,
  'editing a Note remains revision-backed'
);
select is((select count(*)::integer from public.note_revisions), 1, 'the prior Note revision is retained');

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.note_links), 0, 'another owner cannot read Note links');

select * from finish();
rollback;
