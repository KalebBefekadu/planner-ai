begin;
select plan(11);

select function_privs_are(
  'public', 'execute_trash_move_undo', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Trash-move restore executor is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'ca000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'trash-undo@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Trash Undo Note","bodyMarkdown":"","parentNoteId":null}',
    'trash-undo-note-create-0001'
  )$$,
  'a Note is created for Trash Undo'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'note',
      'id', (select id from public.notes where title = 'Trash Undo Note'),
      'expectedVersion', 1
    ),
    'trash-undo-move-0001'
  )$$,
  'the Note moves into one recoverable batch'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'trash-undo-move-0001')
    ),
    'trash-undo-apply-0001'
  )$$,
  'an unchanged Trash move can be undone'
);
select ok((select trashed_at is null from public.notes where title = 'Trash Undo Note'),
  'Trash-move undo restores the Note');
select ok(
  (select restored_at is not null from public.trash_batches
   where id = (select (result_json ->> 'batchId')::uuid from public.operation_receipts
               where idempotency_key = 'trash-undo-move-0001')),
  'the original Trash batch is marked restored'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'trash.restore.v1' and idempotency_key like 'inverse:%'),
  1, 'Trash-move Undo uses the shared restore Operation'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'note',
      'id', (select id from public.notes where title = 'Trash Undo Note'),
      'expectedVersion', 3
    ),
    'trash-conflict-move-0001'
  )$$,
  'another Trash move is captured for conflict testing'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.restore.v1',
    jsonb_build_object(
      'batchId', (select (result_json ->> 'batchId')::uuid from public.operation_receipts
                  where idempotency_key = 'trash-conflict-move-0001')
    ),
    'trash-conflict-manual-restore-0001'
  )$$,
  'the batch can be restored independently'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'trash-conflict-move-0001')
    ),
    'trash-conflict-undo-0001'
  )$$,
  'P0001', 'undo_conflict',
  'Undo refuses an already-restored Trash batch'
);
select ok((select trashed_at is null from public.notes where title = 'Trash Undo Note'),
  'a refused Trash Undo preserves the restored Note');

select * from finish();
rollback;
