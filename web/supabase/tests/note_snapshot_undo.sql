begin;
select plan(28);

select has_column(
  'public', 'operation_receipts', 'undo_payload_json',
  'receipts can retain a private exact inverse payload'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'note-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Original title","bodyMarkdown":"Original body","parentNoteId":null}',
    'snapshot-create-0001'
  )$$,
  'a Note is created for content restoration'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Original title'),
      'title', 'Changed title', 'bodyMarkdown', 'Changed body', 'expectedVersion', 1
    ),
    'snapshot-update-0001'
  )$$,
  'a Note update records prior content'
);
select is(
  (select undo_payload_json from public.operation_receipts
   where idempotency_key = 'snapshot-update-0001'),
  '{"title":"Original title","bodyMarkdown":"Original body"}'::jsonb,
  'the update receipt retains only the exact prior editable content'
);
select is(
  (select operation_receipt_id from public.note_revisions limit 1),
  (select id from public.operation_receipts where idempotency_key = 'snapshot-update-0001'),
  'the prior revision links to the exact update receipt'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'snapshot-update-0001')
    ),
    'snapshot-undo-update-0001'
  )$$,
  'an unchanged Note update can be undone'
);
select is((select title from public.notes where title = 'Original title'), 'Original title',
  'undo restores the exact title');
select is((select body_markdown from public.notes where title = 'Original title'), 'Original body',
  'undo restores the exact Markdown body');
select is((select version from public.notes where title = 'Original title'), 3::bigint,
  'undo advances rather than rewinds the optimistic version');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Original title'),
      'title', 'First later edit', 'bodyMarkdown', 'One', 'expectedVersion', 3
    ),
    'snapshot-conflict-update-0001'
  )$$,
  'a later edit is recorded for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'First later edit'),
      'title', 'Second later edit', 'bodyMarkdown', 'Two', 'expectedVersion', 4
    ),
    'snapshot-conflict-update-0002'
  )$$,
  'another edit can supersede the first'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'snapshot-conflict-update-0001')
    ),
    'snapshot-conflict-undo-0001'
  )$$,
  '40001', 'undo_conflict',
  'undo refuses to overwrite a subsequent Note edit'
);
select is((select title from public.notes where title = 'Second later edit'), 'Second later edit',
  'a refused undo preserves the latest content');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Parent A","bodyMarkdown":"","parentNoteId":null}',
    'snapshot-parent-a-0001'
  )$$,
  'the original parent Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Parent B","bodyMarkdown":"","parentNoteId":null}',
    'snapshot-parent-b-0001'
  )$$,
  'the destination parent Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    jsonb_build_object(
      'title', 'Moved child', 'bodyMarkdown', '',
      'parentNoteId', (select id from public.notes where title = 'Parent A')
    ),
    'snapshot-child-0001'
  )$$,
  'a child Note is created under its original parent'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.move.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Moved child'),
      'parentNoteId', (select id from public.notes where title = 'Parent B'),
      'sortKey', 777, 'expectedVersion', 1
    ),
    'snapshot-move-0001'
  )$$,
  'the child Note moves with a prior hierarchy snapshot'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'snapshot-move-0001')
    ),
    'snapshot-undo-move-0001'
  )$$,
  'the unchanged move can be undone'
);
select is(
  (select parent_note_id from public.notes where title = 'Moved child'),
  (select id from public.notes where title = 'Parent A'),
  'move undo restores the original parent'
);
select is((select sort_key from public.notes where title = 'Moved child'), 1000::numeric,
  'move undo restores the original sort key');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Archive me","bodyMarkdown":"","parentNoteId":null}',
    'snapshot-archive-create-0001'
  )$$,
  'a Note is created for archive restoration'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.archive.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Archive me'), 'expectedVersion', 1
    ),
    'snapshot-archive-0001'
  )$$,
  'the Note is archived'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'snapshot-archive-0001')
    ),
    'snapshot-undo-archive-0001'
  )$$,
  'archive can be undone while unchanged'
);
select ok((select archived_at is null from public.notes where title = 'Archive me'),
  'archive undo restores the prior active state');

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Private context","bodyMarkdown":"","parentNoteId":null}',
    'snapshot-exclusion-create-0001'
  )$$,
  'a Note is created for AI Exclusion restoration'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.ai-exclusion.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Private context'),
      'aiExcluded', true, 'expectedVersion', 1
    ),
    'snapshot-exclusion-0001'
  )$$,
  'the Note is excluded from AI retrieval'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'snapshot-exclusion-0001')
    ),
    'snapshot-undo-exclusion-0001'
  )$$,
  'AI Exclusion can be undone while unchanged'
);
select is((select ai_excluded from public.notes where title = 'Private context'), false,
  'AI Exclusion undo restores the prior retrieval setting');

select * from finish();
rollback;
