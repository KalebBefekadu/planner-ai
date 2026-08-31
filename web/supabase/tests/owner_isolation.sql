-- "Your material is yours" is the quietest promise the product makes and the
-- most damaging one to break. RLS is enabled on every table below with one
-- policy each, but four of them had no cross-owner assertion anywhere in the
-- suites: notes, planning_horizons, memories and notifications. Notes hold
-- what someone wrote; memories hold what the assistant is allowed to recall.
--
-- The old application had exactly this bug class — a query with no owner
-- filter returning another account's planning data — so the gap is worth
-- closing directly rather than trusting the policy to stay correct.
--
-- Each assertion is the same shape: owner A creates a record through the
-- supported path, then owner B counts it and must see nothing.

begin;
select plan(15);

-- Two real accounts, not two role switches: RLS is driven by the JWT subject.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'isolation-owner-a@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'd1000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'isolation-owner-b@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.notes'::regclass),
  'row security is on for notes'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.memories'::regclass),
  'row security is on for memories'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.planning_horizons'::regclass),
  'row security is on for planning horizons'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.notifications'::regclass),
  'row security is on for notifications'
);

-- ---------------------------------------------------------------- owner A
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-00000000000a', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Private note owner A","bodyMarkdown":"Something I would not want read","parentNoteId":null}',
    'isolation-note-a-0001'
  )$$,
  'owner A writes a Note'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'memory.create.v1',
    '{"statement":"Owner A remembers a private preference","sourceType":"user","sourceId":null}',
    'isolation-memory-a-0001'
  )$$,
  'owner A stores a Memory'
);
select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Owner A said something out loud","source":"voice"}',
    'isolation-capture-a-0001'
  )$$,
  'owner A records a Capture'
);

select isnt(
  (select count(*)::int from public.notes),
  0,
  'owner A can see their own Note'
);

-- ---------------------------------------------------------------- owner B
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-00000000000b', true);

select is(
  (select count(*)::int from public.notes),
  0,
  'another owner cannot read the Note'
);
select is(
  (select count(*)::int from public.memories),
  0,
  'another owner cannot read the Memory'
);
select is(
  (select count(*)::int from public.captures),
  0,
  'another owner cannot read the Capture'
);
select is(
  (select count(*)::int from public.planning_horizons),
  0,
  'another owner cannot read the planning horizons'
);
select is(
  (select count(*)::int from public.notifications),
  0,
  'another owner cannot read the notifications'
);
select is(
  (select count(*)::int from public.workspaces
    where owner_user_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'another owner cannot read the first owner''s workspace'
);
select is(
  (select count(*)::int from public.workspaces
    where owner_user_id <> 'd1000000-0000-0000-0000-00000000000b'),
  0,
  'the only workspace visible to an owner is their own'
);

select * from finish();
rollback;
