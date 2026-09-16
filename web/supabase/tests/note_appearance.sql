begin;
select plan(17);

-- Appearance is stored on the Note itself and written through an Operation
-- like everything else durable. The bounds live in check constraints rather
-- than only in TypeScript, because MCP, chat and any later writer reach the
-- same table and a constraint is the only rule all of them are forced through.
-- These assertions are aimed at that boundary: what the database refuses when
-- the client is not the one asking.

select has_column('public', 'notes', 'icon_emoji', 'a Note carries its own icon');
select has_column('public', 'notes', 'cover_key', 'a Note carries its own cover');
select has_column('public', 'notes', 'cover_position', 'a Note carries its cover offset');
select col_not_null('public', 'notes', 'cover_position', 'the cover offset always has a value');

-- The receipt is the record of what the appearance was before. The contract
-- says this Operation is not reversible, because nothing would replay that
-- snapshot, so the header offers a direct reset instead of a false undo.
select is(
  (select reversible from public.operation_contracts where operation_id = 'note.appearance.v1'),
  false, 'appearance is not advertised as reversible'
);
select is(
  (select count(*)::integer from public.operation_undo_support
   where operation_id = 'note.appearance.v1'),
  0, 'nothing claims to be able to undo an appearance change'
);
select is(
  (select exposures from public.operation_contracts where operation_id = 'note.appearance.v1'),
  array['ui'], 'appearance is reachable only from the interface'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'appearance-owner@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'appearance-stranger@example.test',
   extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);

select public.execute_ui_operation(
  'note.create.v1',
  '{"title":"A Note worth looking at","bodyMarkdown":"","parentNoteId":null}'::jsonb,
  'appearance-note-create-0001'
);

select lives_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-set-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1),
      'expectedVersion', (select version from public.notes limit 1),
      'iconEmoji', '📗', 'coverKey', 'focus', 'coverPosition', 30
    )::text
  ),
  'an icon and a cover can be given to a Note'
);
select is(
  (select icon_emoji || ':' || cover_key || ':' || cover_position from public.notes limit 1),
  '📗:focus:30', 'the appearance the person chose is what the Note stores'
);

-- Replaying the same request must not spend a second version. Appearance is
-- edited by dragging and clicking, so a retried request is ordinary here.
select lives_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-set-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1), 'expectedVersion', 1,
      'iconEmoji', '📗', 'coverKey', 'focus', 'coverPosition', 30
    )::text
  ),
  'replaying the same appearance request is accepted'
);
select is(
  (select count(*)::integer from public.operation_receipts
   where operation_id = 'note.appearance.v1'),
  1, 'a replayed appearance request writes one receipt, not two'
);

-- A stale version means somebody else already changed this Note. Appearance is
-- small, but it is still a write, and it must not silently overwrite.
select throws_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-stale-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1), 'expectedVersion', 1,
      'iconEmoji', '📕', 'coverKey', 'north', 'coverPosition', 10
    )::text
  ),
  'P0001', 'version_conflict_or_not_found',
  'a stale appearance write is refused as a conflict'
);

-- A cover the product cannot render is refused by name rather than stored and
-- discovered at paint time.
select throws_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-bad-cover-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1),
      'expectedVersion', (select version from public.notes limit 1),
      'coverKey', 'not-a-real-cover'
    )::text
  ),
  'P0001', 'invalid_input',
  'a cover the product cannot render is refused'
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-long-icon-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1),
      'expectedVersion', (select version from public.notes limit 1),
      'iconEmoji', repeat('x', 33)
    )::text
  ),
  'P0001', 'invalid_input',
  'an icon longer than the column allows is refused'
);

-- Clearing the cover returns the offset to centre, so two Notes that look
-- identical also compare equal.
select lives_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-clear-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes limit 1),
      'expectedVersion', (select version from public.notes limit 1),
      'iconEmoji', null, 'coverKey', null, 'coverPosition', 90
    )::text
  ),
  'appearance can be taken away again'
);
select is(
  (select coalesce(icon_emoji, '-') || ':' || coalesce(cover_key, '-') || ':' || cover_position
   from public.notes limit 1),
  '-:-:50', 'clearing the cover returns the offset to centre'
);

reset role;

-- Another owner must not be able to restyle a Note they cannot even see. The
-- refusal is deliberately the same one a missing Note gets, so a caller cannot
-- learn that the Note exists.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-000000000002","aal":"aal1"}', true
);
select throws_ok(
  format(
    'select public.execute_ui_operation(''note.appearance.v1'', %L::jsonb, ''appearance-cross-owner-0001'')',
    jsonb_build_object(
      'id', (select id from public.notes where title = 'A Note worth looking at'),
      'expectedVersion', 3, 'iconEmoji', '💀'
    )::text
  ),
  'P0001', 'version_conflict_or_not_found',
  'another owner cannot restyle a Note, and cannot learn that it exists'
);
reset role;

select * from finish();
rollback;
