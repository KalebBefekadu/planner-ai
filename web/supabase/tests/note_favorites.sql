begin;
select plan(17);

select has_column('public', 'notes', 'favorited_at', 'a Note records when it was favourited');
select col_is_null('public', 'notes', 'favorited_at', 'a Note is not favourited by default');
select has_function(
  'public', 'execute_note_favorite_operation', array['text', 'jsonb', 'text', 'text'],
  'favouriting runs through its own versioned Operation service'
);
select function_privs_are(
  'public', 'execute_note_favorite_operation', array['text', 'jsonb', 'text', 'text'],
  'authenticated', array[]::text[], 'the favourite executor is never called directly'
);
select table_privs_are(
  'public', 'notes', 'authenticated', array['SELECT'],
  'a favourite cannot be written by updating the table directly'
);
select ok(
  (select 'mcp' = any(exposures) from public.operation_contracts
   where operation_id = 'note.favorite.v1'),
  'an agent can favourite a Note wherever a person can'
);
select ok(
  (select not reversible from public.operation_contracts where operation_id = 'note.favorite.v1'),
  'favouriting is a toggle, not an undo history entry'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'favorite-owner-one@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'favorite-owner-two@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Daily log","bodyMarkdown":"","parentNoteId":null}',
    'favorite-note-first-0001'
  )$$,
  'the first Note is created'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1', '{"title":"Reading list","bodyMarkdown":"","parentNoteId":null}',
    'favorite-note-second-0001'
  )$$,
  'the second Note is created'
);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Daily log'),
      'favorited', true,
      'expectedVersion', (select version from public.notes where title = 'Daily log')
    ),
    'favorite-set-first-0001'
  )$$,
  'a Note can be favourited'
);
select isnt(
  (select favorited_at from public.notes where title = 'Daily log'), null,
  'the favourite is persisted, not held in the session'
);

-- Ordering is the reason the column is a timestamp rather than a boolean. The
-- second favourite must land after the first and stay there.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Reading list'),
      'favorited', true,
      'expectedVersion', (select version from public.notes where title = 'Reading list')
    ),
    'favorite-set-second-0001'
  )$$,
  'a second Note can be favourited'
);
select is(
  (select array_agg(title order by favorited_at)
   from public.notes where favorited_at is not null),
  array['Daily log', 'Reading list'],
  'favourites keep the order they were favourited in'
);

-- A stray second press must not quietly move a Note to the end of the list.
select lives_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Daily log'),
      'favorited', true,
      'expectedVersion', (select version from public.notes where title = 'Daily log')
    ),
    'favorite-set-first-again-0001'
  )$$,
  'favouriting an already favourited Note is accepted'
);
select is(
  (select array_agg(title order by favorited_at)
   from public.notes where favorited_at is not null),
  array['Daily log', 'Reading list'],
  'refavouriting does not reorder the list'
);

-- Optimistic concurrency: a star must not land on a Note that moved on.
select throws_ok(
  $$select public.execute_ui_operation(
    'note.favorite.v1',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'Reading list'),
      'favorited', false,
      'expectedVersion', 1
    ),
    'favorite-stale-version-0001'
  )$$,
  'P0001', 'version_conflict_or_not_found',
  'a favourite written against a stale version is refused'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.notes where favorited_at is not null), 0,
  'another owner cannot see which Notes were favourited'
);

select * from finish();
rollback;
