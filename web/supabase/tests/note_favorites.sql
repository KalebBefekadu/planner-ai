begin;
select plan(15);

-- A favourite is stored as the instant it was marked, not a flag. The tests
-- below hold that choice to its two consequences: the favourites list has a
-- real order, and Undo restores the exact instant rather than inventing one.

select has_column('public', 'notes', 'favorited_at', 'a Note records when it was favourited');
select col_is_null('public', 'notes', 'favorited_at', 'a Note is not a favourite until someone says so');
select function_privs_are(
  'public', 'execute_note_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the Note operation executor is private'
);
-- Read as the owner of the database rather than as a signed-in account: the
-- Undo strategy registry is deliberately unreadable by `authenticated`.
select is(
  (select strategy from public.operation_undo_support where operation_id = 'note.favorite.v1'),
  'snapshot', 'the favourite Operation declares how it is undone'
);


insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'favorites-owner@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
), (
  'c8000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'favorites-stranger@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Favourite me","bodyMarkdown":"","parentNoteId":null}',
    'favorite-note-create-0001'
  )$$,
  'a Note is created'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Favourite me'),
      'favorite', true,
      'expectedVersion', (select version from public.notes where title = 'Favourite me')
    ),
    'favorite-note-mark-0001'
  )$$,
  'marking a favourite goes through the versioned Operation path'
);

select isnt(
  (select favorited_at from public.notes where title = 'Favourite me'), null,
  'the Note now records when it became a favourite'
);

-- Favouriting is a change to the Note like any other, so it must take part in
-- optimistic concurrency. Without this, two tabs could each write over the
-- other's edits by way of a star.
select throws_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Favourite me'),
      'favorite', false,
      'expectedVersion', 1
    ),
    'favorite-note-stale-0001'
  )$$,
  'P0001', 'version_conflict_or_not_found',
  'a favourite written against a stale version is refused rather than applied'
);

-- Re-marking an existing favourite must not move it to the top of the list.
-- Someone reordering nothing should see nothing reordered.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Favourite me'),
      'favorite', true,
      'expectedVersion', (select version from public.notes where title = 'Favourite me')
    ),
    'favorite-note-remark-0001'
  )$$,
  'marking an existing favourite again is accepted'
);
select is(
  (select favorited_at from public.notes where title = 'Favourite me'),
  (select (result_json ->> 'favorited_at')::timestamptz from public.operation_receipts
   where idempotency_key = 'favorite-note-mark-0001'),
  'marking an existing favourite again keeps its original place in the order'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Favourite me'),
      'favorite', false,
      'expectedVersion', (select version from public.notes where title = 'Favourite me')
    ),
    'favorite-note-clear-0001'
  )$$,
  'a favourite can be taken back'
);
select is(
  (select favorited_at from public.notes where title = 'Favourite me'), null,
  'unmarking a favourite clears the record of when it was marked'
);

-- Undo restores the instant, which is the whole reason the instant is stored.
-- Restoring only a boolean would have put the Note back in the list at the
-- wrong position.
select lives_ok(
  $$select public.execute_ui_operation(
    'operation.undo.v1',
    jsonb_build_object(
      'receiptId', (select id from public.operation_receipts
                    where idempotency_key = 'favorite-note-clear-0001')
    ),
    'favorite-note-undo-0001'
  )$$,
  'taking back a favourite can itself be undone'
);
select is(
  (select favorited_at from public.notes where title = 'Favourite me'),
  (select (result_json ->> 'favorited_at')::timestamptz from public.operation_receipts
   where idempotency_key = 'favorite-note-mark-0001'),
  'Undo returns the favourite to exactly the moment it was first marked'
);

-- A favourite is as private as the Note carrying it.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-000000000002', true);
select is_empty(
  $$select 1 from public.notes where favorited_at is not null$$,
  'another account cannot see which Notes someone has favourited'
);

select * from finish();
rollback;
