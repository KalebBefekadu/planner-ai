begin;
select plan(6);

-- Undoing the archive of a deeply filed Note must put it back where it was.
--
-- WS-02 asks for archive and restore verified across deep trees. The shallow
-- case proves almost nothing here: a Note whose parent is the root returns to
-- the root whether the undo restored its parent or merely cleared the archive
-- flag, so the two possible implementations are indistinguishable. Only depth
-- separates them, and a Note that comes back at the root instead of five levels
-- down has been restored in the sense that its text exists and lost in every
-- sense the owner cares about.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'archive-undo-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000001', true);

-- A chain five deep, built through the ordinary create operation so that
-- parentage is whatever the product actually stores.
select lives_ok(
  $$select public.execute_ui_operation('note.create.v1',
    '{"title":"Level one","bodyMarkdown":"One","parentNoteId":null}', 'depth-level-one-0001')$$,
  'a root Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation('note.create.v1',
    jsonb_build_object('title','Level two','bodyMarkdown','Two',
      'parentNoteId',(select id from public.notes where title = 'Level one')),
    'depth-level-two-0001')$$,
  'a second level is created'
);
select lives_ok(
  $$select public.execute_ui_operation('note.create.v1',
    jsonb_build_object('title','Level three','bodyMarkdown','Three',
      'parentNoteId',(select id from public.notes where title = 'Level two')),
    'depth-level-three-0001')$$,
  'a third level is created'
);

select lives_ok(
  $$select public.execute_ui_operation('note.archive.v1',
    jsonb_build_object(
      'id',(select id from public.notes where title = 'Level three'),
      'expectedVersion',(select version from public.notes where title = 'Level three')),
    'depth-archive-0001')$$,
  'the deepest Note is archived'
);

select lives_ok(
  $$select public.execute_ui_operation('operation.undo.v1',
    jsonb_build_object('receiptId',
      (select id from public.operation_receipts where idempotency_key = 'depth-archive-0001')),
    'depth-archive-undo-0001')$$,
  'archiving it can be undone'
);

-- The whole question: back, and back *where it was*.
select results_eq(
  $$select (archived_at is null),
           (parent_note_id = (select id from public.notes where title = 'Level two'))
    from public.notes where title = 'Level three'$$,
  $$values (true, true)$$,
  'the Note returns unarchived and still filed under its parent, not at the root'
);

select * from finish();
rollback;
