-- The product tells people: "your words are stored raw; cleanup is saved as a
-- revision, never a replacement." That promise is defended twice, and neither
-- layer had a test — so a future migration could drop either and all 42 suites
-- would still pass.
--
--   Layer 1: `authenticated` holds no UPDATE grant on captures at all. A user
--            session cannot issue the statement in the first place.
--   Layer 2: public.preserve_capture_source() rejects any change to raw_text,
--            source or created_at even from the SECURITY DEFINER path that
--            every legitimate write travels through.
--
-- These assertions pin the guarantee rather than the mechanism.

begin;
select plan(12);

select has_function(
  'public', 'preserve_capture_source', array[]::text[],
  'the Capture source guard exists'
);
select has_trigger(
  'public', 'captures', 'captures_preserve_source',
  'the Capture source guard is attached to captures'
);

-- Layer 1.
select table_privs_are(
  'public', 'captures', 'authenticated', array['SELECT'],
  'a signed-in session can read Captures but never UPDATE them directly'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c9000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'capture-immutable@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000090', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'capture.create.v1',
    '{"rawText":"Exactly what I said, hesitations and all","source":"voice"}',
    'capture-immutable-create-0001'
  )$$,
  'a Capture is stored through the supported path'
);

select is(
  (select raw_text from public.captures
    where raw_text = 'Exactly what I said, hesitations and all'),
  'Exactly what I said, hesitations and all',
  'the Capture is stored verbatim, not normalised on the way in'
);

select throws_ok(
  $$update public.captures set raw_text = 'A tidied-up version'$$,
  '42501', NULL,
  'a signed-in session cannot rewrite raw text even to try'
);

-- Layer 2: the trigger, reached the way a bug or a compromised service-role
-- client would reach it — past the grant, through the privileged path.
reset role;

select throws_ok(
  $$update public.captures set raw_text = 'A tidied-up version'
      where raw_text = 'Exactly what I said, hesitations and all'$$,
  'P0001', 'capture_source_is_immutable',
  'rewriting the raw text is refused even with table privileges'
);
select throws_ok(
  $$update public.captures set source = 'typed'
      where raw_text = 'Exactly what I said, hesitations and all'$$,
  'P0001', 'capture_source_is_immutable',
  'rewriting how the Capture was made is refused'
);
select throws_ok(
  $$update public.captures set created_at = now() - interval '10 days'
      where raw_text = 'Exactly what I said, hesitations and all'$$,
  'P0001', 'capture_source_is_immutable',
  'backdating a Capture is refused'
);
-- Clearing is still rewriting; the guard must have no soft spot for it.
select throws_ok(
  $$update public.captures set raw_text = ''
      where raw_text = 'Exactly what I said, hesitations and all'$$,
  'P0001', 'capture_source_is_immutable',
  'blanking the raw text is refused'
);

-- The guard must not freeze the whole row: filing, triage and trashing all
-- update other columns.
select lives_ok(
  $$update public.captures set state = 'reviewed'
      where raw_text = 'Exactly what I said, hesitations and all'$$,
  'the rest of the row stays editable, so filing and triage still work'
);

select is(
  (select raw_text from public.captures
    where state = 'reviewed'),
  'Exactly what I said, hesitations and all',
  'the raw text survives an update to the rest of the row'
);

select * from finish();
rollback;
