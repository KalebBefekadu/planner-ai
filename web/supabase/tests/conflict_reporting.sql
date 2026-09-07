begin;
select plan(4);

-- A conflict is a decision the person has to see, not a transient clash worth
-- retrying. Raised as SQLSTATE 40001 it was indistinguishable from a
-- serialization failure: PostgREST answered 504 "The upstream server is timing
-- out" and discarded the message, so the editor reported a timeout and kept
-- retrying a write that could never succeed.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'conflict-reporting@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.execute_ui_operation(
    'note.create.v1',
    '{"title":"Contested decision","bodyMarkdown":"","parentNoteId":null}',
    'conflict-note-create-0001'
  )$$,
  'a Note exists to be contested'
);

-- The Note is at version 1, so claiming version 99 is exactly the clash that
-- happens when the same Note is open in two places and one of them saves first.
select throws_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    (select json_build_object(
      'id', id, 'title', 'Contested', 'bodyMarkdown', 'body', 'expectedVersion', 99
    )::text from public.notes)::jsonb,
    'conflict-note-update-0001'
  )$$,
  'P0001', 'version_conflict_or_not_found',
  'a stale write reports a conflict the client can read rather than a timeout'
);

select throws_ok(
  $$select public.execute_ui_operation(
    'note.update.v1',
    '{"id":"c9000000-0000-0000-0000-0000000000ff","title":"Missing","bodyMarkdown":"x","expectedVersion":1}',
    'conflict-note-missing-0001'
  )$$,
  'P0001', 'version_conflict_or_not_found',
  'a write against a Note that is gone reports the same readable conflict'
);

-- A real serialization failure is genuinely worth retrying, so it must keep its
-- own code rather than being folded into the conflict path.
create function pg_temp.raise_true_serialization() returns void
language plpgsql as $$
begin
  raise exception using errcode = '40001', message = 'could not serialize access';
end $$;

select throws_ok(
  $$select pg_temp.raise_true_serialization()$$,
  '40001', 'could not serialize access',
  'a genuine serialization failure keeps the retryable code'
);

select * from finish();
rollback;
