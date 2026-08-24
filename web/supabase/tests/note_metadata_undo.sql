begin;
select plan(32);

select has_table(
  'public', 'operation_undo_support', 'implemented Undo strategies have one database registry'
);
select table_privs_are(
  'public', 'operation_undo_support', 'authenticated', array[]::text[],
  'the Undo strategy registry is private'
);
select function_privs_are(
  'public', 'execute_note_metadata_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Note metadata restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'metadata-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Metadata source","bodyMarkdown":"","parentNoteId":null}',
    'metadata-note-source-0001'
  )$$,
  'the source Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Metadata target","bodyMarkdown":"","parentNoteId":null}',
    'metadata-note-target-0001'
  )$$,
  'the target Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.link.v1',
    jsonb_build_object(
      'sourceNoteId', (select id from public.notes where title = 'Metadata source'),
      'targetNoteId', (select id from public.notes where title = 'Metadata target'),
      'relationType', 'continues'
    ),
    'metadata-note-link-0001'
  )$$,
  'a typed Note link is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.unlink.v1',
    jsonb_build_object(
      'linkId', (select result_json ->> 'id' from public.operation_receipts
                 where idempotency_key = 'metadata-note-link-0001')
    ),
    'metadata-note-unlink-0001'
  )$$,
  'removing a Note link retains its exact endpoints and relation type'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'metadata-note-unlink-0001')
    ),
    'metadata-note-unlink-undo-0001'
  )$$,
  'an unchanged Note unlink can be undone'
);
select is((select count(*)::integer from public.note_links), 1,
  'Note unlink undo recreates one exact link');

select lives_ok(
  $$select public.execute_ui_operation(
    'vision.upsert.v1', '{"bodyMarkdown":"Connected knowledge serves the plan."}',
    'metadata-vision-0001'
  )$$,
  'a Vision is created for planning relation fixtures'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    '{"title":"Metadata annual goal","horizonKind":"year","startsOn":"2026-01-01","endsOn":"2026-12-31","parentGoalId":null}',
    'metadata-year-0001'
  )$$,
  'an annual Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'goal.create.v1',
    jsonb_build_object(
      'title', 'Metadata quarter', 'horizonKind', 'quarter',
      'startsOn', '2026-01-01', 'endsOn', '2026-03-31',
      'parentGoalId', (select id from public.goals where title = 'Metadata annual goal')
    ),
    'metadata-quarter-0001'
  )$$,
  'a quarter Goal is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'action.create.v1',
    jsonb_build_object(
      'title', 'Metadata action', 'horizonKind', 'month',
      'startsOn', '2026-01-01', 'endsOn', '2026-01-31',
      'goalId', (select id from public.goals where title = 'Metadata quarter'),
      'parentActionId', null, 'scheduledOn', '2026-01-12'
    ),
    'metadata-action-0001'
  )$$,
  'an Action is created'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.goal-link.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'goalId', (select id from public.goals where title = 'Metadata quarter')
    ),
    'metadata-goal-link-0001'
  )$$,
  'a Note-to-Goal relation is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.goal-unlink.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'goalId', (select id from public.goals where title = 'Metadata quarter')
    ),
    'metadata-goal-unlink-0001'
  )$$,
  'removing the Note-to-Goal relation captures the deleted row'
);
select is(
  (select undo_payload_json ->> 'goalId' from public.operation_receipts
   where idempotency_key = 'metadata-goal-unlink-0001'),
  (select id::text from public.goals where title = 'Metadata quarter'),
  'the Goal unlink receipt retains the exact Goal'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'metadata-goal-unlink-0001')
    ),
    'metadata-goal-unlink-undo-0001'
  )$$,
  'an unchanged Goal unlink can be undone'
);
select is((select count(*)::integer from public.note_goal_links), 1,
  'Goal unlink undo recreates one exact relation');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.action-link.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'actionId', (select id from public.actions where title = 'Metadata action')
    ),
    'metadata-action-link-0001'
  )$$,
  'a Note-to-Action relation is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.action-unlink.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'actionId', (select id from public.actions where title = 'Metadata action')
    ),
    'metadata-action-unlink-0001'
  )$$,
  'removing the Note-to-Action relation captures the deleted row'
);
select is(
  (select undo_payload_json ->> 'actionId' from public.operation_receipts
   where idempotency_key = 'metadata-action-unlink-0001'),
  (select id::text from public.actions where title = 'Metadata action'),
  'the Action unlink receipt retains the exact Action'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'metadata-action-unlink-0001')
    ),
    'metadata-action-unlink-undo-0001'
  )$$,
  'an unchanged Action unlink can be undone'
);
select is((select count(*)::integer from public.note_action_links), 1,
  'Action unlink undo recreates one exact relation');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.tags.set.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'tags', jsonb_build_array('beta', 'alpha')
    ),
    'metadata-tags-original-0001'
  )$$,
  'an original tag set is saved'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.tags.set.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'tags', jsonb_build_array('gamma')
    ),
    'metadata-tags-changed-0001'
  )$$,
  'replacing tags captures the prior normalized set'
);
select is(
  (select undo_payload_json -> 'tags' from public.operation_receipts
   where idempotency_key = 'metadata-tags-changed-0001'),
  '["alpha", "beta"]'::jsonb,
  'the tag receipt retains the prior sorted set'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'metadata-tags-changed-0001')
    ),
    'metadata-tags-undo-0001'
  )$$,
  'an unchanged tag replacement can be undone'
);
select is(
  (select jsonb_agg(tag.name order by tag.name)
   from public.note_tags note_tag
   join public.tags tag on tag.id = note_tag.tag_id and tag.workspace_id = note_tag.workspace_id
   where note_tag.note_id = (select id from public.notes where title = 'Metadata source')),
  '["alpha", "beta"]'::jsonb,
  'tag undo restores the exact prior set'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.tags.set.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'tags', jsonb_build_array('delta')
    ),
    'metadata-tags-conflict-first-0001'
  )$$,
  'a tag replacement is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.tags.set.v1',
    jsonb_build_object(
      'noteId', (select id from public.notes where title = 'Metadata source'),
      'tags', jsonb_build_array('epsilon')
    ),
    'metadata-tags-conflict-second-0001'
  )$$,
  'a newer tag replacement supersedes it'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'metadata-tags-conflict-first-0001')
    ),
    'metadata-tags-conflict-undo-0001'
  )$$,
  '40001', 'undo_conflict',
  'tag undo refuses to overwrite a newer set'
);
select is(
  (select jsonb_agg(tag.name order by tag.name)
   from public.note_tags note_tag
   join public.tags tag on tag.id = note_tag.tag_id and tag.workspace_id = note_tag.workspace_id
   where note_tag.note_id = (select id from public.notes where title = 'Metadata source')),
  '["epsilon"]'::jsonb,
  'a refused tag undo preserves the newest set'
);

select * from finish();
rollback;
