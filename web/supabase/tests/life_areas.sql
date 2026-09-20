begin;
select plan(52);

select has_table('public', 'life_areas', 'a life area is a row');
select has_function(
  'public', 'execute_life_area_operation', array['text', 'jsonb', 'text', 'text'],
  'life area Operations have one handler'
);
-- `row_security_active` answers for the current role, and the suite runs as a
-- superuser that bypasses RLS, so it would say no however the table is set up.
-- The catalogue is the thing being asserted.
select ok(
  (select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.life_areas'::regclass),
  'life areas have RLS, forced on the owner too'
);
select table_privs_are(
  'public', 'life_areas', 'authenticated', array['SELECT'],
  'life areas are readable but never writable directly'
);
select table_privs_are(
  'public', 'life_areas', 'anon', array[]::text[],
  'anonymous callers reach nothing'
);
select is(
  public.operation_handler_for('area.create.v1'), 'life_area',
  'the router sends area Operations to the life area handler'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'area-owner-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'area-owner-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);

-- Creating an area makes exactly one page, and a retry makes no more.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Health","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'area-create-00001'
  )$$,
  'a life area can be created from a name alone'
);
select is((select count(*)::integer from public.life_areas), 1, 'one area exists');
select is((select count(*)::integer from public.notes), 1, 'one page was created with it');
select is(
  (select title from public.notes), 'Health',
  'the page takes the name of its area'
);
select is(
  (select canonical_note_id from public.life_areas),
  (select id from public.notes),
  'the area points at that page'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Health","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'area-create-00001'
  )$$,
  'the same request can be delivered twice'
);
select is((select count(*)::integer from public.life_areas), 1, 'a retry creates no second area');
select is((select count(*)::integer from public.notes), 1, 'a retry creates no second page');

-- Names are labels. Two areas may share one.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Health","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'area-create-00002'
  )$$,
  'a second area may carry the same name'
);
select is((select count(*)::integer from public.life_areas), 2, 'identity is the id, not the name');

select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    jsonb_build_object(
      'name', 'Movement',
      'parentAreaId', (select id from public.life_areas order by created_at limit 1),
      'existingNoteId', null, 'icon', null, 'color', null
    ),
    'area-create-00003'
  )$$,
  'a subarea can be created under a parent'
);
select is(
  (select parent_area_id from public.life_areas where name = 'Movement'),
  (select id from public.life_areas where name = 'Health' order by created_at limit 1),
  'the subarea keeps its parent'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Orphan","parentAreaId":"50000000-0000-0000-0000-0000000000ff",
      "existingNoteId":null,"icon":null,"color":null}',
    'area-create-00004'
  )$$,
  'P0001', 'parent_not_found',
  'a parent that does not exist is refused'
);

-- An existing page can be adopted, and adoption changes nothing about it.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Reading log","bodyMarkdown":"Kept exactly","parentNoteId":null}',
    'area-note-000001'
  )$$,
  'an ordinary Note can exist first'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    jsonb_build_object(
      'name', 'Learning', 'parentAreaId', null,
      'existingNoteId', (select id from public.notes where title = 'Reading log'),
      'icon', null, 'color', null
    ),
    'area-create-00005'
  )$$,
  'an area can adopt an existing page'
);
select is(
  (select body_markdown from public.notes where title = 'Reading log'), 'Kept exactly',
  'adopting a page leaves its writing alone'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    jsonb_build_object(
      'name', 'Learning again', 'parentAreaId', null,
      'existingNoteId', (select id from public.notes where title = 'Reading log'),
      'icon', null, 'color', null
    ),
    'area-create-00006'
  )$$,
  'P0001', 'note_already_canonical',
  'a page cannot be the page of two areas'
);

-- The tree cannot eat itself.
select throws_ok(
  $$select public.execute_ui_operation(
    'area.move.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Health' order by created_at limit 1),
      'parentAreaId', (select id from public.life_areas where name = 'Movement'),
      'sortKey', 1000, 'expectedVersion', 1
    ),
    'area-move-000001'
  )$$,
  'P0001', 'area_cycle',
  'an area cannot be moved inside its own descendant'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'area.move.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Movement'),
      'parentAreaId', (select id from public.life_areas where name = 'Movement'),
      'sortKey', 1000, 'expectedVersion', 1
    ),
    'area-move-000002'
  )$$,
  'P0001', 'area_cycle',
  'an area cannot be moved inside itself'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.move.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Movement'),
      'parentAreaId', null, 'sortKey', 5000, 'expectedVersion', 1
    ),
    'area-move-000003'
  )$$,
  'a subarea can be moved to the root'
);
select is(
  (select parent_area_id from public.life_areas where name = 'Movement'), null,
  'the move is recorded'
);

-- Renaming offers the page, and records what the page was called.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.update.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Movement'),
      'name', 'Exercise', 'icon', null, 'color', 'moss',
      'renameCanonicalNote', true, 'expectedVersion', 2
    ),
    'area-update-00001'
  )$$,
  'an area can be renamed together with its page'
);
select is(
  (select name from public.life_areas where color = 'moss'), 'Exercise',
  'the area carries the new name'
);
select is(
  (select title from public.notes
    where id = (select canonical_note_id from public.life_areas where color = 'moss')),
  'Exercise',
  'the page was renamed with it'
);
select is(
  (select count(*)::integer from public.note_revisions), 1,
  'the previous page title is kept as a revision'
);

-- Archive is one row, and restoring it is its inverse.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.archive.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Exercise'), 'expectedVersion', 3
    ),
    'area-archive-0001'
  )$$,
  'an area can be archived'
);
select isnt(
  (select archived_at from public.life_areas where name = 'Exercise'), null,
  'the archive instant is recorded'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.restore.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Exercise'), 'expectedVersion', 4
    ),
    'area-restore-0001'
  )$$,
  'an archived area can be restored'
);
select is(
  (select archived_at from public.life_areas where name = 'Exercise'), null,
  'restoring clears the archive instant'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'area.ai-exclusion.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Exercise'),
      'aiExcluded', true, 'expectedVersion', 5
    ),
    'area-exclude-0001'
  )$$,
  'an area can be excluded from AI retrieval'
);
select is(
  (select ai_excluded from public.life_areas where name = 'Exercise'), true,
  'the exclusion is stored on the area'
);

-- A page in use cannot be thrown away behind its area's back.
select throws_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'note',
      'id', (select canonical_note_id from public.life_areas where name = 'Exercise'),
      'expectedVersion', (select version from public.notes
        where id = (select canonical_note_id from public.life_areas where name = 'Exercise'))
    ),
    'area-trash-000001'
  )$$,
  'P0001', 'area_canonical_note_in_use',
  'an area page cannot be trashed while the area uses it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Replacement page","bodyMarkdown":"","parentNoteId":null}',
    'area-note-000002'
  )$$,
  'a replacement page can be written first'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.replace-note.v1',
    jsonb_build_object(
      'id', (select id from public.life_areas where name = 'Exercise'),
      'noteId', (select id from public.notes where title = 'Replacement page'),
      'expectedVersion', 6
    ),
    'area-replace-00001'
  )$$,
  'an area can be pointed at a different page'
);
select is(
  (select canonical_note_id from public.life_areas where name = 'Exercise'),
  (select id from public.notes where title = 'Replacement page'),
  'the area now uses the replacement'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'trash.move.v1',
    jsonb_build_object(
      'itemType', 'note',
      'id', (select id from public.notes where title = 'Exercise'),
      'expectedVersion', (select version from public.notes where title = 'Exercise')
    ),
    'area-trash-000002'
  )$$,
  'the page it no longer uses can be thrown away'
);

-- Undoing a create takes the area back, and the page only if this made it.
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    '{"name":"Mistake","parentAreaId":null,"existingNoteId":null,"icon":null,"color":null}',
    'area-create-00007'
  )$$,
  'an area can be created by accident'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
        where operation_id = 'area.create.v1' and idempotency_key = 'area-create-00007')
    ),
    'area-undo-000001'
  )$$,
  'creating an area can be undone'
);
select is(
  (select count(*)::integer from public.life_areas where name = 'Mistake'), 0,
  'the area is gone'
);
select isnt(
  (select trashed_at from public.notes where title = 'Mistake'), null,
  'the empty page it made goes with it'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Older writing","bodyMarkdown":"Written before","parentNoteId":null}',
    'area-note-000003'
  )$$,
  'a page can exist before any area wants it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    jsonb_build_object(
      'name', 'Second mistake', 'parentAreaId', null,
      'existingNoteId', (select id from public.notes where title = 'Older writing'),
      'icon', null, 'color', null
    ),
    'area-create-00008'
  )$$,
  'an area can adopt it'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
        where operation_id = 'area.create.v1' and idempotency_key = 'area-create-00008')
    ),
    'area-undo-000002'
  )$$,
  'that area can be undone too'
);
select is(
  (select trashed_at from public.notes where title = 'Older writing'), null,
  'a page that existed first survives the undo'
);

-- Another owner reaches none of it. The id is carried across the role change
-- in a temp table, because reading it back as the second owner returns null --
-- which would have made the attempt below create an ordinary new page and pass
-- for the wrong reason.
create temp table area_owner_one_note as
  select id from public.notes where title = 'Reading log';

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.life_areas), 0,
  'another owner cannot read these areas'
);
select throws_ok(
  $$select public.execute_ui_operation(
    'area.create.v1',
    jsonb_build_object(
      'name', 'Borrowed', 'parentAreaId', null,
      'existingNoteId', (select id from area_owner_one_note),
      'icon', null, 'color', null
    ),
    'area-create-00009'
  )$$,
  'P0001', 'note_not_found',
  'another owner cannot adopt this workspace''s page'
);

select * from finish();
rollback;
